//! RDP bridge (P4) — RDCleanPath proxy per §3.4/§5.5.
//!
//! Contract (verified against `ironrdp-web`'s `connect_rdcleanpath` and the
//! production reference implementations — netbird `client/wasm/internal/rdp`,
//! nirvati-connect):
//!
//! 1. Client sends `RDCleanPathPdu::new_request(x224_request, destination,
//!    proxy_auth, pcb)` as the first WS binary message (DER).
//! 2. Proxy writes the X.224 Connection Request to the upstream RDP server
//!    and reads the X.224 Connection Confirm (TPKT-framed).
//! 3. Proxy performs the TLS handshake with the server itself, using a
//!    fingerprint explicitly approved and persisted before route creation.
//!    TLS handshake signatures are verified; the peer certificate chain is
//!    also forwarded to the client for CredSSP channel binding.
//! 4. Proxy replies `RDCleanPathPdu::new_response(server_addr, x224_confirm,
//!    cert_chain)` (DER over WS), then pipes raw bytes between the WS and
//!    the established TLS session. The client runs CredSSP/NLA end-to-end
//!    through that tunnel (the connector is marked "upgraded", so it skips
//!    its own TLS handshake — exactly the netbird topology).
//!
//! Errors during steps 2–4 are reported to the client as RDCleanPath error
//! PDUs (general/WSA) instead of an abrupt close, so the webview can show a
//! meaningful message.

use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as TlsError, SignatureScheme};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;

use super::bridge::{BridgeError, Shared};
use tokio_util::sync::CancellationToken;

/// Connect/handshake budget for each upstream step (netbird uses 5s+5s; we
/// take 10s per step for slow WAN links).
const STEP_TIMEOUT: Duration = Duration::from_secs(10);
const X224_MAX: usize = 1024;

/// RDP security protocol negotiation flags (MS-RDP 2.2.1.1.1). Only the
/// values the inspector branches on are read; the rest are kept here so the
/// negotiation request in [`x224_inspect_request`] and any future "did the
/// server pick X?" diagnostics stay grounded in a single source of truth.
#[allow(dead_code)]
mod protocol {
    pub const RDP: u32 = 0x0000_0000;
    pub const SSL: u32 = 0x0000_0001;
    pub const HYBRID: u32 = 0x0000_0002;
}

/// Build the inspection CR variants. Two hard requirements learned from the
/// field (29.1.0.122:33890 bastion):
///
/// 1. Offer every modern protocol (RDP | SSL | HYBRID), not just
///    PROTOCOL_RDP — servers that only accept SSL close mid-handshake with
///    ECONNRESET otherwise; mstsc sends the same triple.
/// 2. Carry the `Cookie: mstshash=<value>` negotiable data mstsc always
///    sends: bastion proxies route/validate the channel by this cookie and
///    silently close cookie-less requests (clean EOF, no bytes back).
///
/// Build an X.224 Connection Request PDU.
///
/// Layout: TPKT header, CR TPDU (LI, code 0xE0, five zero bytes), an
/// optional `Cookie: mstshash=<value>` line, and an optional RDP_NEG_REQ
/// (type 1, flags 0, len 8, little-endian requestedProtocols).
fn build_x224_cr(cookie: Option<&str>, protocols: Option<u32>) -> Vec<u8> {
    let mut var = Vec::new();
    if let Some(c) = cookie {
        var.extend_from_slice(format!("Cookie: mstshash={c}\r\n").as_bytes());
    }
    if let Some(p) = protocols {
        var.extend_from_slice(&[0x01, 0x00, 0x08, 0x00]);
        // MS-RDPBCGR encodes every negotiation integer little-endian (ironrdp's
        // `WriteCursor::write_u32` is `to_le_bytes`; `write_u32_be` exists only
        // for the rare big-endian fields). Emitting this big-endian made the
        // server read `requestedProtocols = 0x03000000` — an undefined flag
        // combination — and drop the connection instantly.
        var.extend_from_slice(&p.to_le_bytes());
    }
    let li = 6 + var.len();
    let total = (4 + 1 + li) as u16;
    let mut pdu = Vec::with_capacity(total as usize);
    pdu.extend_from_slice(&[0x03, 0x00, (total >> 8) as u8, total as u8]);
    pdu.push(li as u8);
    pdu.extend_from_slice(&[0xE0, 0x00, 0x00, 0x00, 0x00, 0x00]);
    pdu.extend_from_slice(&var);
    pdu
}

/// mstsc uses the NetBIOS-style name: no domain dots, uppercase, <=15 chars.
fn short_host(host: &str) -> String {
    let s = host.split('.').next().unwrap_or(host).to_uppercase();
    if s.is_empty() {
        "ANYSSH".to_string()
    } else {
        s.chars().take(15).collect()
    }
}

/// The X.224 CR variants anySSH probes on inspection, most-likely first.
/// mstsc on the same Windows machine succeeds and both share the OS TCP
/// stack, so the discriminator must be in the CR bytes — enumerate the sane
/// space and remember which shape the server accepts.
fn x224_inspect_variants() -> Vec<(&'static str, Vec<u8>)> {
    let host = mstshash_value();
    let short = short_host(&host);
    vec![
        ("host+SSL|HYBRID", build_x224_cr(Some(&host), Some(0x3))),
        ("shost+SSL|HYBRID", build_x224_cr(Some(&short), Some(0x3))),
        ("host+SSL", build_x224_cr(Some(&host), Some(0x1))),
        (
            "host+HYBRID|HYBRID_EX",
            build_x224_cr(Some(&host), Some(0xA)),
        ),
        ("nocookie+SSL|HYBRID", build_x224_cr(None, Some(0x3))),
        ("host+legacy-no-nego", build_x224_cr(Some(&host), None)),
        ("host+RDP-only(0x0)", build_x224_cr(Some(&host), Some(0x0))),
        // Same shape as #1, tried last (with the inter-variant delay in
        // between): if #1 failed and this succeeds, the upstream is rate
        // limiting / punishing rapid attempts rather than rejecting a shape.
        (
            "retry#host+SSL|HYBRID",
            build_x224_cr(Some(&host), Some(0x3)),
        ),
    ]
}

/// Index into [`x224_inspect_variants`] the upstream last accepted for a
/// target, so the session path replays the exact same CR shape.
fn variant_cache() -> &'static std::sync::Mutex<std::collections::HashMap<String, usize>> {
    static MAP: std::sync::OnceLock<std::sync::Mutex<std::collections::HashMap<String, usize>>> =
        std::sync::OnceLock::new();
    MAP.get_or_init(Default::default)
}

fn remember_variant(target: &str, idx: usize) {
    if let Ok(mut m) = variant_cache().lock() {
        m.insert(target.to_string(), idx);
    }
}

fn winning_variant(target: &str) -> Option<usize> {
    variant_cache()
        .lock()
        .ok()
        .and_then(|m| m.get(target).copied())
}

/// mstsc sends `Cookie: mstshash=<client hostname>` (uppercase NetBIOS-style
/// name). Some bastions route/validate the channel by that value, so mirror
/// mstsc exactly: use this machine's hostname, falling back to `anyssh`.
fn mstshash_value() -> String {
    let name = hostname::get()
        .map(|h| h.to_string_lossy().trim().to_string())
        .unwrap_or_default();
    if name.is_empty() {
        "anyssh".to_string()
    } else {
        name
    }
}

/// Replace (or insert) the mstshash cookie in an X.224 Connection Request
/// PDU in place, then recompute the TPKT length and the X.224 LI. Used to
/// align the WASM connector's CR (cookie = username or absent) with what
/// mstsc sends (cookie = client hostname) before it goes upstream.
fn rewrite_x224_cookie(request: &mut Vec<u8>, hostname: &str) {
    let Some(&li) = request.get(4) else { return };
    let Some(variable) = request.get_mut(11..5 + li as usize) else {
        return;
    };
    // Strip an existing "Cookie: msts…" (cookie or routing token) line.
    let mut var: Vec<u8> = variable.to_vec();
    if let Some(start) = var
        .windows(12)
        .position(|w| w.eq_ignore_ascii_case(b"Cookie: msts"))
    {
        if let Some(end) = var[start..]
            .windows(2)
            .position(|w| w == b"\r\n")
            .map(|p| start + p + 2)
        {
            var.drain(start..end);
        }
    }
    let mut new_var = format!("Cookie: mstshash={hostname}\r\n").into_bytes();
    new_var.extend_from_slice(&var);
    request.splice(11..5 + li as usize, new_var.iter().copied());

    let new_li = request.len() - 5;
    request[4] = new_li as u8;
    let total = request.len() as u16;
    request[2..4].copy_from_slice(&total.to_be_bytes());
}

/// Inspect the X.224 Connection Confirm for the server's RDP_NEG_RSP and
/// return the negotiated protocol. Falls back to `PROTOCOL_RDP` when the
/// server replies with a bare X.224 CC (no negotiation payload): per
/// MS-RDPBCGR, an absent RDP_NEG_RSP means no negotiation took place, so the
/// connection runs under standard RDP security — *not* TLS. Assuming TLS here
/// made the probe attempt a handshake the server never agreed to.
fn selected_security_protocol(x224_confirm: &[u8]) -> u32 {
    // TPKT(4) + X.224 header(7) + RDP_NEG_RSP(type 1, flags 1, length 2, pad 2, proto 4) = 19.
    const RDP_NEG_RSP_TYPE: u8 = 0x02;
    if x224_confirm.len() >= 19 && x224_confirm[11] == RDP_NEG_RSP_TYPE {
        // MS-RDPBCGR negotiation integers are little-endian.
        return u32::from_le_bytes([
            x224_confirm[15],
            x224_confirm[16],
            x224_confirm[17],
            x224_confirm[18],
        ]);
    }
    // No negotiation structure — the server ignored RDP_NEG_REQ, so the
    // session uses standard RDP security (PROTOCOL_RDP).
    protocol::RDP
}

/// Human-readable summary of an X.224 Connection Confirm, used by the
/// variant-matrix diagnostic so one user test reveals the server's policy.
fn describe_confirm(confirm: &[u8]) -> String {
    let hex: String = confirm
        .iter()
        .take(32)
        .map(|b| format!("{b:02x}"))
        .collect::<Vec<_>>()
        .join("");
    let body = if confirm.len() >= 19 && confirm[11] == 0x02 {
        let proto = u32::from_le_bytes([confirm[15], confirm[16], confirm[17], confirm[18]]);
        match proto {
            0 => "NEG_RSP selected=PROTOCOL_RDP (standard security, no TLS)".to_string(),
            1 => "NEG_RSP selected=PROTOCOL_SSL".to_string(),
            2 => "NEG_RSP selected=PROTOCOL_HYBRID (NLA)".to_string(),
            other => format!("NEG_RSP selected=0x{other:x}"),
        }
    } else if confirm.len() >= 19 && confirm[11] == 0x03 {
        let code = u32::from_le_bytes([confirm[15], confirm[16], confirm[17], confirm[18]]);
        let name = match code {
            1 => "SSL_REQUIRED_BY_SERVER",
            2 => "SSL_NOT_ALLOWED_BY_SERVER",
            3 => "SSL_CERT_NOT_ON_SERVER",
            4 => "INCONSISTENT_FLAGS",
            5 => "HYBRID_REQUIRED_BY_SERVER",
            _ => "unknown",
        };
        format!("RDP_NEG_FAILURE code=0x{code:x} ({name})")
    } else {
        format!(
            "plain X.224 CC (len={}, no RDP_NEG_RSP) -> server wants standard RDP security",
            confirm.len()
        )
    };
    format!("{body}, hex[:32]={hex}")
}

/// Self-signed RDP certificates require explicit, persistent fingerprint trust.
/// The inspection connection supplies no credentials; authenticated sessions
/// require the exact fingerprint approved by the user.
#[derive(Debug)]
struct PinnedServer(Option<String>);

pub fn certificate_fingerprint(cert: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(cert))
}

impl ServerCertVerifier for PinnedServer {
    fn verify_server_cert(
        &self,
        cert: &CertificateDer<'_>,
        _: &[CertificateDer<'_>],
        _: &ServerName<'_>,
        _: &[u8],
        _: UnixTime,
    ) -> Result<ServerCertVerified, TlsError> {
        if self
            .0
            .as_ref()
            .is_some_and(|expected| *expected != certificate_fingerprint(cert.as_ref()))
        {
            return Err(TlsError::General(
                "RDP certificate changed; explicit confirmation required".into(),
            ));
        }
        Ok(ServerCertVerified::assertion())
    }
    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }
    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, TlsError> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &rustls::crypto::ring::default_provider().signature_verification_algorithms,
        )
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

pub async fn inspect_certificate(host: &str, port: u16) -> Result<String, BridgeError> {
    // Every variant gets its own probe (6s reply budget each); the first
    // shape the server answers is remembered and used for the TLS upgrade.
    tokio::time::timeout(Duration::from_secs(90), async {
        let variants = x224_inspect_variants();
        let mut tried: Vec<String> = Vec::new();
        let mut saw_standard_rdp = false;
        for (idx, (name, cr)) in variants.iter().enumerate() {
            // Space attempts out: some bastions punish rapid successive
            // handshakes, which would otherwise mask the real CR policy.
            if idx > 0 {
                tokio::time::sleep(Duration::from_millis(1500)).await;
            }
            let (tcp, confirm) = match probe_variant(host, port, cr).await {
                Ok(pair) => pair,
                Err(detail) => {
                    tried.push(format!("[{name}: {detail}]"));
                    continue;
                }
            };
            let described = describe_confirm(&confirm);
            let nego_rsp = confirm.len() >= 19 && confirm[11] == 0x02;
            let selected = selected_security_protocol(&confirm);
            if !nego_rsp || selected == protocol::RDP {
                if !nego_rsp {
                    saw_standard_rdp = true;
                }
                tried.push(format!("[{name}: X.224 OK but {described}]"));
                continue;
            }
            // Negotiated TLS/NLA — try the upgrade on this same connection.
            let tls = TlsConnector::from(pinned_client_config(None))
                .connect(server_name_for(host), tcp)
                .await;
            match tls {
                Ok(tls) => {
                    let cert = tls
                        .get_ref()
                        .1
                        .peer_certificates()
                        .and_then(|certs| certs.first())
                        .ok_or_else(|| {
                            BridgeError::Upstream("server supplied no certificate".into())
                        })?;
                    remember_variant(&format!("{host}:{port}"), idx);
                    return Ok(certificate_fingerprint(cert.as_ref()));
                }
                Err(e) => tried.push(format!(
                    "[{name}: X.224 OK ({described}) but TLS failed: {e}]"
                )),
            }
        }
        let conclusion = if saw_standard_rdp {
            " — the server answers only a CR without RDP_NEG_REQ with a plain X.224 CC, \
             i.e. it requires standard RDP security (which the IronRDP backend does not \
             implement; mstsc still supports it)"
        } else {
            ""
        };
        Err(BridgeError::Upstream(format!(
            "no X.224 variant completed TLS; tried {}{conclusion}",
            tried.join(" ")
        )))
    })
    .await
    .map_err(|_| BridgeError::Upstream("certificate inspection timed out".into()))?
}

/// One X.224 probe: connect, send CR, wait up to 6s for the confirm.
/// Ok((stream, confirm)) keeps the stream for the TLS upgrade; Err(text)
/// describes the failure with timing (FIN vs RST vs timeout).
async fn probe_variant(host: &str, port: u16, cr: &[u8]) -> Result<(TcpStream, Vec<u8>), String> {
    let started = std::time::Instant::now();
    // Bounded: an unreachable/blackholed host would otherwise rely on the OS
    // connect timeout and burn the caller's whole 90s inspection budget with
    // a message that names no host.
    let mut tcp = tokio::time::timeout(Duration::from_secs(10), TcpStream::connect((host, port)))
        .await
        .map_err(|_| format!("connect to {host}:{port} timed out after 10s"))?
        .map_err(|e| format!("connect failed: {e}"))?;
    tcp.write_all(cr)
        .await
        .map_err(|e| format!("send failed: {e}"))?;
    let mut buf = Vec::with_capacity(64);
    let mut chunk = [0u8; 512];
    loop {
        match tokio::time::timeout(Duration::from_secs(6), tcp.read(&mut chunk)).await {
            Err(_) => return Err("no reply in 6s".into()),
            Ok(Err(e)) if e.kind() == std::io::ErrorKind::ConnectionReset => {
                return Err(format!("RST after {:.2}s", started.elapsed().as_secs_f32()))
            }
            Ok(Err(e)) => {
                return Err(format!(
                    "read error after {:.2}s: {e}",
                    started.elapsed().as_secs_f32()
                ))
            }
            Ok(Ok(0)) => {
                return Err(format!(
                    "FIN (closed, 0 bytes) after {:.2}s",
                    started.elapsed().as_secs_f32()
                ))
            }
            Ok(Ok(n)) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.len() >= 4 {
                    let total = u16::from_be_bytes([buf[2], buf[3]]) as usize;
                    if !(4..=X224_MAX).contains(&total) {
                        return Err(format!("implausible TPKT length {total}"));
                    }
                    if buf.len() >= total {
                        buf.truncate(total);
                        return Ok((tcp, buf));
                    }
                }
            }
        }
    }
}

/// TLS 1.2-only client config: CredSSP/NLA on Windows requires TLS 1.2
/// (netbird forces the same); TLS 1.3 is never offered.
fn pinned_client_config(fingerprint: Option<String>) -> Arc<rustls::ClientConfig> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS12])
        .expect("TLS 1.2 must be supported by the ring provider")
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(PinnedServer(fingerprint)))
        .with_no_client_auth();
    Arc::new(config)
}

/// ServerName for the TLS client hello. IP literals parse directly; anything
/// else that rustls rejects (shouldn't happen for real hostnames) falls back
/// to a fixed syntactically-valid name — certificate identity is checked by its approved fingerprint.
fn server_name_for(host: &str) -> ServerName<'static> {
    ServerName::try_from(host.to_string())
        .or_else(|_| ServerName::try_from("anyssh-bridge".to_string()))
        .expect("fallback name is a valid DNS name")
}

/// Read one TPKT-framed PDU (X.224 Connection Confirm). TPKT bytes 2–3 are
/// the total packet length (big-endian, header included).
async fn read_tpkt(stream: &mut TcpStream) -> Result<Vec<u8>, BridgeError> {
    let started = std::time::Instant::now();
    let mut buf = Vec::with_capacity(64);
    let mut chunk = [0u8; 512];
    loop {
        let n = tokio::time::timeout(STEP_TIMEOUT, stream.read(&mut chunk))
            .await
            .map_err(|_| BridgeError::Upstream("timeout reading X.224 confirm".into()))?
            .map_err(|e| BridgeError::Upstream(format!("read X.224 confirm: {e}")))?;
        if n == 0 {
            return Err(BridgeError::Upstream(format!(
                "upstream closed during X.224 negotiation without a reply after {:.1}s \
                     (server may require RDP over TLS/NLA, reject empty credentials over plain \
                     RDP, or refuse the mstshash cookie)",
                started.elapsed().as_secs_f32()
            )));
        }
        buf.extend_from_slice(&chunk[..n]);
        if buf.len() >= 4 {
            let total = u16::from_be_bytes([buf[2], buf[3]]) as usize;
            if !(4..=X224_MAX).contains(&total) {
                return Err(BridgeError::Upstream(format!(
                    "implausible TPKT length {total}"
                )));
            }
            if buf.len() >= total {
                buf.truncate(total);
                return Ok(buf);
            }
        }
    }
}

/// Drive one RDP session: RDCleanPath handshake + TLS-terminated passthrough.
///
/// The token is already removed from `pending` by the caller; this function
/// registers/clears it in `active` and must be run until the session ends.
pub async fn handle_rdp_client(
    mut ws: WebSocketStream<TcpStream>,
    host: String,
    port: u16,
    fingerprint: String,
    shared: Arc<Shared>,
    token: String,
) {
    shared.touch();

    // Register as active before the handshake so `rd_close` can cancel us.
    let cancel = CancellationToken::new();
    shared.active.insert(token.clone(), cancel.clone());
    let _guard = super::bridge::ActiveSessionGuard(shared.clone(), token.clone());

    let result = tokio::select! {
        _ = cancel.cancelled() => return,
        result = tokio::time::timeout(Duration::from_secs(40), run_handshake(&mut ws, &host, port, &cancel, &fingerprint)) =>
            result.unwrap_or_else(|_| Err(BridgeError::Upstream("RDP handshake timed out".into()))),
    };

    if let Err(err) = result {
        // The RDCleanPath error PDU carries no text, so the client can only
        // render a generic failure. Without this line a changed certificate,
        // a TLS error and a plain refused connection are indistinguishable in
        // the field — log the actual cause before telling the client.
        tracing::warn!(
            host = %host,
            port = port,
            error = %err,
            "RDP handshake failed"
        );
        // Tell the WASM client why it failed (it surfaces RDCleanPathErr).
        let error_pdu = ironrdp_rdcleanpath::RDCleanPathPdu::new_general_error().to_der();
        if let Ok(bytes) = error_pdu {
            let _ =
                tokio::time::timeout(STEP_TIMEOUT, ws.send(Message::Binary(bytes.into()))).await;
        }
        shared.active.remove(&token);
        shared.touch();
        return;
    }

    let tls = result.unwrap();
    let (mut up_rx, mut up_tx) = tokio::io::split(tls);
    let (mut ws_tx, mut ws_rx) = ws.split();

    let up_cancel = cancel.clone();
    let down_cancel = cancel.clone();

    let up = tokio::spawn(async move {
        let mut buf = vec![0u8; super::bridge::PUMP_BUF];
        loop {
            tokio::select! {
                _ = up_cancel.cancelled() => break,
                n = up_rx.read(&mut buf) => match n {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if ws_tx.send(Message::Binary(buf[..n].to_vec().into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    });

    let down = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = down_cancel.cancelled() => break,
                msg = ws_rx.next() => match msg {
                    Some(Ok(Message::Binary(b))) => {
                        if up_tx.write_all(&b).await.is_err() { break; }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
        }
    });

    super::bridge::finish_pumps(up, down, cancel).await;
}

/// Handshake half of `handle_rdp_client`: returns the established TLS
/// session ready for byte passthrough.
async fn run_handshake(
    ws: &mut WebSocketStream<TcpStream>,
    host: &str,
    port: u16,
    cancel: &CancellationToken,
    fingerprint: &str,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>, BridgeError> {
    // ── 1. First WS message = client RDCleanPath request ────────────────
    let first = tokio::select! {
        _ = cancel.cancelled() => return Err(BridgeError::Rejected("session closed".into())),
        msg = ws.next() => match msg {
            Some(Ok(Message::Binary(b))) => b,
            _ => return Err(BridgeError::Rejected("expected RDCleanPath request".into())),
        },
    };
    let request = ironrdp_rdcleanpath::RDCleanPathPdu::from_der(first.as_ref())
        .map_err(|e| BridgeError::Rejected(format!("bad RDCleanPath request: {e}")))?;
    let request = request
        .into_enum()
        .map_err(|e| BridgeError::Rejected(e.to_string()))?;
    let mut x224_request = match request {
        ironrdp_rdcleanpath::RDCleanPath::Request {
            x224_connection_request,
            ..
        } => x224_connection_request.as_bytes().to_vec(),
        _ => {
            return Err(BridgeError::Rejected(
                "expected an RDCleanPath request PDU".into(),
            ))
        }
    };
    // mstsc parity: the connector's cookie is the username (or absent) when
    // credentials are empty; rewrite it to the mstsc-style client hostname
    // before the request goes upstream (bastions route by it).
    rewrite_x224_cookie(&mut x224_request, &mstshash_value());
    // If inspection found the CR shape this server accepts, replay it
    // exactly instead of the connector's shape.
    if let Some(idx) = winning_variant(&format!("{host}:{port}")) {
        if let Some((_, cr)) = x224_inspect_variants().get(idx) {
            x224_request = cr.clone();
        }
    }

    // ── 2. Dial upstream (route host, not the client-supplied destination —
    //       the route registration is the trust anchor) ────────────────────
    let target = format!("{host}:{port}");
    let mut tcp = tokio::time::timeout(STEP_TIMEOUT, TcpStream::connect((host, port)))
        .await
        .map_err(|_| BridgeError::Upstream(format!("connect {target}: timed out")))?
        .map_err(|e| BridgeError::Upstream(format!("connect {target}: {e}")))?;

    // ── 3. X.224 negotiation ─────────────────────────────────────────────
    tokio::time::timeout(STEP_TIMEOUT, tcp.write_all(&x224_request))
        .await
        .map_err(|_| BridgeError::Upstream("timeout writing X.224 request".into()))?
        .map_err(|e| BridgeError::Upstream(format!("write X.224 request: {e}")))?;
    let x224_confirm = read_tpkt(&mut tcp).await?;

    // ── 4. TLS handshake with the server (pinned, TLS 1.2) ──────────────
    let connector = TlsConnector::from(pinned_client_config(Some(fingerprint.to_owned())));
    let name = server_name_for(host);
    let tls = tokio::time::timeout(STEP_TIMEOUT, connector.connect(name, tcp))
        .await
        .map_err(|_| BridgeError::Upstream("timeout during upstream TLS handshake".into()))?
        .map_err(|e| BridgeError::Upstream(format!("upstream TLS handshake: {e}")))?;

    let cert_chain: Vec<Vec<u8>> = tls
        .get_ref()
        .1
        .peer_certificates()
        .map(|certs| certs.iter().map(|c| c.as_ref().to_vec()).collect())
        .unwrap_or_default();
    if cert_chain.is_empty() {
        return Err(BridgeError::Upstream(
            "upstream presented no certificate chain".into(),
        ));
    }

    // ── 5. Response PDU → client ─────────────────────────────────────────
    let response =
        ironrdp_rdcleanpath::RDCleanPathPdu::new_response(target.clone(), x224_confirm, cert_chain)
            .map_err(|e| BridgeError::Upstream(format!("encode RDCleanPath response: {e}")))?
            .to_der()
            .map_err(|e| BridgeError::Upstream(format!("encode RDCleanPath response: {e}")))?;
    tokio::select! {
        _ = cancel.cancelled() => return Err(BridgeError::Rejected("session closed".into())),
        sent = ws.send(Message::Binary(response.into())) => {
            sent.map_err(|e| BridgeError::Upstream(format!("send RDCleanPath response: {e}")))?;
        }
    }

    Ok(tls)
}

// ---------------------------------------------------------------------------
// Tests — loopback integration with a fake RDP server (TCP + X.224 + TLS)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_rustls::TlsAcceptor;

    /// X.224 Connection Confirm with an RDP Negotiation Response selecting
    /// PROTOCOL_HYBRID (CredSSP) — 19 bytes, in the real little-endian wire
    /// format (`02 00 08 00` header, protocol LE at offset 15).
    const X224_CONFIRM: [u8; 19] = [
        0x03, 0x00, 0x00, 0x13, // TPKT: version 3, reserved, total len 19
        0x0E, 0xD0, // LI=14, CC TPDU code 0xD0
        0x00, 0x00, 0x00, 0x00, 0x00, // dst-ref, src-ref, class
        0x02, 0x00, 0x08, 0x00, // NEG_RSP: type 2, flags 0, len 8 (little-endian)
        0x02, 0x00, 0x00, 0x00, // selectedProtocol = PROTOCOL_HYBRID (little-endian)
    ];

    /// Same shape but selecting PROTOCOL_SSL — what mstsc sees from a Windows
    /// host that has NLA off and only supports RDP-over-TLS.
    const X224_CONFIRM_SSL: [u8; 19] = [
        0x03, 0x00, 0x00, 0x13, 0x0E, 0xD0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x08, 0x00,
        0x01, 0x00, 0x00, 0x00,
    ];

    /// X.224 CC selecting PROTOCOL_RDP only — the server wants no TLS at all.
    /// `inspect_certificate` must refuse this path (no cert to inspect).
    const X224_CONFIRM_PLAIN: [u8; 19] = [
        0x03, 0x00, 0x00, 0x13, 0x0E, 0xD0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x08, 0x00,
        0x00, 0x00, 0x00, 0x00,
    ];

    /// RDP_NEG_FAILURE (type 3) with HYBRID_REQUIRED_BY_SERVER — the canonical
    /// hardened-server reply when the client offers too little.
    const X224_CONFIRM_FAILURE: [u8; 19] = [
        0x03, 0x00, 0x00, 0x13, 0x0E, 0xD0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03, 0x00, 0x08, 0x00,
        0x05, 0x00, 0x00, 0x00,
    ];

    /// Fake RDP server: X.224 exchange, then a real TLS 1.2 handshake with a
    /// self-signed cert, then echo loop inside the TLS session.
    async fn spawn_fake_rdp_server() -> (String, u16, Vec<u8>) {
        spawn_fake_rdp_server_with(&X224_CONFIRM).await
    }

    /// Same as `spawn_fake_rdp_server` but lets the test pick which X.224
    /// Connection Confirm (and therefore which selected RDP security
    /// protocol) the server replies with.
    async fn spawn_fake_rdp_server_with(confirm: &'static [u8; 19]) -> (String, u16, Vec<u8>) {
        let certified_key =
            rcgen::generate_simple_self_signed(["anyssh-fake-rdp".to_string()]).unwrap();
        let cert_der = certified_key.cert.der().to_vec();
        let key_der = certified_key.signing_key.serialize_der();

        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let server_config = rustls::ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(
                vec![CertificateDer::from(cert_der.clone())],
                rustls::pki_types::PrivateKeyDer::Pkcs8(
                    rustls::pki_types::PrivatePkcs8KeyDer::from(key_der),
                ),
            )
            .unwrap();
        let acceptor = TlsAcceptor::from(Arc::new(server_config));

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let acceptor = acceptor.clone();
                tokio::spawn(async move {
                    // Consume the X.224 request, answer with the confirm.
                    let mut buf = [0u8; 512];
                    let _ = sock.read(&mut buf).await;
                    if sock.write_all(confirm).await.is_err() {
                        return;
                    }
                    // TLS handshake, then echo inside the tunnel.
                    let Ok(mut tls) = acceptor.accept(sock).await else {
                        return;
                    };
                    let mut buf = [0u8; 1024];
                    loop {
                        match tls.read(&mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                if tls.write_all(&buf[..n]).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                });
            }
        });
        (addr.ip().to_string(), addr.port(), cert_der)
    }

    #[tokio::test]
    async fn certificate_inspection_returns_leaf_fingerprint_without_credentials() {
        let (host, port, cert) = spawn_fake_rdp_server().await;
        assert_eq!(
            inspect_certificate(&host, port).await.unwrap(),
            certificate_fingerprint(&cert)
        );
    }

    /// When the server selects PROTOCOL_SSL (the bastion's path), the
    /// inspector must still upgrade to TLS and surface the certificate —
    /// this is the case the 29.1.0.122 / 33890 server hit.
    #[tokio::test]
    async fn certificate_inspection_handles_ssl_only_negotiation() {
        let (host, port, cert) = spawn_fake_rdp_server_with(&X224_CONFIRM_SSL).await;
        assert_eq!(
            inspect_certificate(&host, port).await.unwrap(),
            certificate_fingerprint(&cert)
        );
    }

    /// When the server only accepts plain RDP (no TLS), the inspector must
    /// refuse with a precise error rather than getting stuck or returning
    /// a TLS handshake failure.
    #[tokio::test]
    async fn certificate_inspection_rejects_plain_rdp_negotiation() {
        // Server replies PROTOCOL_RDP, then hangs up — no TLS, no cert.
        let (host, port, _) = spawn_fake_rdp_server_with(&X224_CONFIRM_PLAIN).await;
        let err = inspect_certificate(&host, port).await.unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("no X.224 variant completed TLS") && msg.contains("selected=PROTOCOL_RDP"),
            "expected the aggregate 'no TLS' diagnostic, got: {msg}"
        );
    }

    /// The inspect request must carry the mstshash cookie (mstsc parity) —
    /// bastions route by it and close cookie-less requests (29.1.0.122).
    #[test]
    fn inspect_request_carries_mstshash_cookie_and_valid_framing() {
        let pdu = x224_inspect_variants().remove(0).1;
        // TPKT: version 3 and total length in bytes 2-3.
        assert_eq!(pdu[0], 0x03);
        assert_eq!(u16::from_be_bytes([pdu[2], pdu[3]]) as usize, pdu.len());
        // LI covers everything after the LI byte; CR TPDU code 0xE0.
        assert_eq!(pdu[4] as usize, pdu.len() - 5);
        assert_eq!(pdu[5], 0xE0);
        // The mstshash cookie sits in the variable part, before the NEG_REQ.
        let cookie = format!("Cookie: mstshash={}\r\n", mstshash_value());
        assert_eq!(&pdu[11..11 + cookie.len()], cookie.as_bytes());
        // NEG_REQ tail: type 1, flags 0, length 8, protocols RDP|SSL|HYBRID
        // encoded little-endian (`03 00 00 00`, not `00 00 00 03`).
        let neg = &pdu[11 + cookie.len()..];
        assert_eq!(neg, &[0x01, 0x00, 0x08, 0x00, 0x03, 0x00, 0x00, 0x00][..]);
    }

    /// The session-path CR (from the WASM connector) must end up carrying the
    /// mstsc-style hostname cookie, with a replaced username cookie.
    #[test]
    fn rewrite_x224_cookie_replaces_username_cookie() {
        // Connector shape: cookie from the username, then the NEG_REQ.
        let mut pdu = x224_inspect_variants().remove(0).1;
        let old_len = pdu.len();
        rewrite_x224_cookie(&mut pdu, "WIN-DEV-01");
        assert!(String::from_utf8_lossy(&pdu).contains("Cookie: mstshash=WIN-DEV-01\r\n"));
        assert!(!String::from_utf8_lossy(&pdu).contains("anyssh"));
        assert_eq!(u16::from_be_bytes([pdu[2], pdu[3]]) as usize, pdu.len());
        assert_eq!(pdu[4] as usize, pdu.len() - 5);
        let _ = old_len;
    }

    /// A CR without any cookie must get one inserted, keeping the NEG_REQ.
    #[test]
    fn rewrite_x224_cookie_inserts_when_absent() {
        let mut pdu = vec![
            0x03, 0x00, 0x00, 0x13, 0x0E, 0xE0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x08,
            0x00, 0x03, 0x00, 0x00, 0x00,
        ];
        rewrite_x224_cookie(&mut pdu, "HOST-X");
        let text = String::from_utf8_lossy(&pdu);
        assert!(text.contains("Cookie: mstshash=HOST-X\r\n"));
        assert!(text.ends_with("\u{01}\u{00}\u{08}\u{00}\u{03}\u{00}\u{00}\u{00}"));
        assert_eq!(u16::from_be_bytes([pdu[2], pdu[3]]) as usize, pdu.len());
        assert_eq!(pdu[4] as usize, pdu.len() - 5);
    }

    /// Short/garbled PDUs must be left untouched rather than panicking.
    #[test]
    fn rewrite_x224_cookie_ignores_malformed_input() {
        for mut junk in [
            vec![],
            vec![0x03],
            vec![0x03, 0x00, 0x00, 0x13],
            vec![0x03, 0x00, 0x00, 0x13, 0xFF],
        ] {
            rewrite_x224_cookie(&mut junk, "H");
        }
    }

    /// `selected_security_protocol` must parse the little-endian wire format.
    #[test]
    fn selected_security_protocol_parses_little_endian_wire_format() {
        assert_eq!(selected_security_protocol(&X224_CONFIRM), protocol::HYBRID);
        assert_eq!(selected_security_protocol(&X224_CONFIRM_SSL), protocol::SSL);
        assert_eq!(
            selected_security_protocol(&X224_CONFIRM_PLAIN),
            protocol::RDP
        );
    }

    /// Regression: a bare X.224 CC (no RDP_NEG_RSP) means *no negotiation*, so
    /// the session runs under standard RDP security. Assuming TLS here made the
    /// probe attempt a handshake the server never agreed to.
    #[test]
    fn selected_security_protocol_defaults_to_rdp_without_negotiation() {
        let bare_cc: [u8; 11] = [
            0x03, 0x00, 0x00, 0x0b, 0x06, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        assert_eq!(selected_security_protocol(&bare_cc), protocol::RDP);
    }

    /// Regression for the endianness bug that produced the bogus "bastion only
    /// accepts standard RDP security" conclusion: the same protocol value
    /// encoded big-endian must NOT be recognised. A server reading anySSH's
    /// big-endian `0x3` saw `0x03000000` — undefined flags — and dropped the
    /// connection, which the diagnostic then misreported as a policy refusal.
    #[test]
    fn big_endian_protocol_field_is_rejected() {
        let be_ssl: [u8; 19] = [
            0x03, 0x00, 0x00, 0x13, 0x0E, 0xD0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x08,
            0x00, 0x00, 0x00, 0x00, 0x01,
        ];
        let parsed = selected_security_protocol(&be_ssl);
        assert_ne!(parsed, protocol::SSL, "big-endian must not read as SSL");
        assert_eq!(parsed, 0x0100_0000);
    }

    /// The CR builder must place `requestedProtocols` little-endian. This is
    /// the field the whole incident traced back to.
    #[test]
    fn build_x224_cr_encodes_requested_protocols_little_endian() {
        let cr = build_x224_cr(Some("HOST"), Some(0x3));
        let neg = &cr[11 + "Cookie: mstshash=HOST\r\n".len()..];
        assert_eq!(neg, &[0x01, 0x00, 0x08, 0x00, 0x03, 0x00, 0x00, 0x00][..]);

        // Single-bit and combined values keep the same little-endian layout.
        let ssl = build_x224_cr(None, Some(0x1));
        assert_eq!(&ssl[ssl.len() - 4..], &[0x01, 0x00, 0x00, 0x00][..]);
        let hybrid_ex = build_x224_cr(None, Some(0xA));
        assert_eq!(
            &hybrid_ex[hybrid_ex.len() - 4..],
            &[0x0A, 0x00, 0x00, 0x00][..]
        );
    }

    /// CR builder framing: TPKT/LI consistent, cookie before NEG_REQ,
    /// protocols little-endian; legacy mode has no NEG_REQ at all.
    #[test]
    fn build_x224_cr_framing_and_variants() {
        let pdu = build_x224_cr(Some("HOST"), Some(0x3));
        assert_eq!(u16::from_be_bytes([pdu[2], pdu[3]]) as usize, pdu.len());
        assert_eq!(pdu[4] as usize, pdu.len() - 5);
        assert_eq!(pdu[5], 0xE0);
        assert_eq!(&pdu[11..11 + 8], b"Cookie: ");
        let text = String::from_utf8_lossy(&pdu);
        assert!(text.contains("Cookie: mstshash=HOST\r\n"));
        assert!(text.ends_with("\u{1}\u{0}\u{8}\u{0}\u{3}\0\0\0"));

        let legacy = build_x224_cr(Some("HOST"), None);
        assert!(!String::from_utf8_lossy(&legacy).ends_with('\u{3}'));

        let bare = build_x224_cr(None, Some(0x1));
        assert!(!String::from_utf8_lossy(&bare).contains("Cookie"));
        assert_eq!(bare[4] as usize, 6 + 8);
    }

    /// short_host mimics mstsc: first label, uppercased, <=15 chars.
    #[test]
    fn short_host_is_netbios_style() {
        assert_eq!(short_host("pc-office.corp.example.com"), "PC-OFFICE");
        assert_eq!(short_host("plain"), "PLAIN");
        assert_eq!(short_host(""), "ANYSSH");
        let long = "a-very-long-hostname-value";
        assert_eq!(short_host(long).len(), 15);
    }

    /// The variant list must be non-empty and each entry well-framed.
    #[test]
    fn inspect_variants_are_well_formed() {
        let variants = x224_inspect_variants();
        assert_eq!(variants.len(), 8);
        for (name, pdu) in &variants {
            assert_eq!(
                u16::from_be_bytes([pdu[2], pdu[3]]) as usize,
                pdu.len(),
                "{name}"
            );
            assert_eq!(pdu[5], 0xE0, "{name}");
        }
    }

    /// Confirm summaries must distinguish NEG_RSP / NEG_FAILURE / plain CC.
    #[test]
    fn describe_confirm_classifies_replies() {
        let ssl = describe_confirm(&X224_CONFIRM_SSL);
        assert!(ssl.contains("selected=PROTOCOL_SSL"), "{ssl}");
        assert!(ssl.contains("hex[:32]="), "{ssl}");

        let plain = describe_confirm(&X224_CONFIRM_PLAIN);
        assert!(plain.contains("selected=PROTOCOL_RDP"), "{plain}");

        let hybrid = describe_confirm(&X224_CONFIRM);
        assert!(hybrid.contains("selected=PROTOCOL_HYBRID"), "{hybrid}");

        let failure = describe_confirm(&X224_CONFIRM_FAILURE);
        assert!(failure.contains("RDP_NEG_FAILURE"), "{failure}");
        assert!(failure.contains("HYBRID_REQUIRED_BY_SERVER"), "{failure}");

        let bare_cc: [u8; 11] = [
            0x03, 0x00, 0x00, 0x0b, 0x06, 0xd0, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        let s = describe_confirm(&bare_cc);
        assert!(
            s.contains("plain X.224 CC") && s.contains("standard RDP security"),
            "{s}"
        );
    }

    /// Winning-variant cache round-trip.
    #[test]
    fn variant_cache_roundtrip() {
        let key = format!("cache-test-{}", std::process::id());
        assert_eq!(winning_variant(&key), None);
        remember_variant(&key, 3);
        assert_eq!(winning_variant(&key), Some(3));
    }

    #[tokio::test]
    async fn changed_certificate_is_rejected_before_tunneling() {
        let (host, port, _) = spawn_fake_rdp_server().await;
        let mut tcp = TcpStream::connect((host.as_str(), port)).await.unwrap();
        tcp.write_all(&dummy_x224_request()).await.unwrap();
        read_tpkt(&mut tcp).await.unwrap();
        let result = TlsConnector::from(pinned_client_config(Some("0".repeat(64))))
            .connect(server_name_for(&host), tcp)
            .await;
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("certificate changed"));
    }

    fn dummy_x224_request() -> Vec<u8> {
        // Minimal X.224 Connection Request (TPKT + CR TPDU, class 0).
        vec![
            0x03, 0x00, 0x00, 0x0B, 0x06, 0xE0, 0x00, 0x00, 0x00, 0x00, 0x00,
        ]
    }

    #[tokio::test]
    async fn rdp_handshake_and_tls_tunnel_roundtrip() {
        let (host, port, cert_der) = spawn_fake_rdp_server().await;
        let mgr = super::super::bridge::BridgeManager::new();
        let listener_port = mgr.ensure_listener().await.unwrap();
        let ep = mgr.open_rdp(
            host.clone(),
            port,
            listener_port,
            certificate_fingerprint(&cert_der),
        );

        let (mut ws, _) = tokio_tungstenite::connect_async(ep.ws_url.as_str())
            .await
            .unwrap();

        // 1. Client → proxy: RDCleanPath request.
        let req = ironrdp_rdcleanpath::RDCleanPathPdu::new_request(
            dummy_x224_request(),
            format!("{host}:{port}"),
            String::new(),
            None,
        )
        .unwrap();
        ws.send(Message::Binary(req.to_der().unwrap().into()))
            .await
            .unwrap();

        // 2. Proxy → client: response with X.224 confirm + server cert chain.
        let resp = tokio::time::timeout(Duration::from_secs(10), ws.next())
            .await
            .expect("response timeout")
            .expect("stream ended")
            .expect("ws error");
        let pdu = ironrdp_rdcleanpath::RDCleanPathPdu::from_der(resp.into_data().as_ref())
            .expect("response is not a valid RDCleanPath PDU");
        match pdu.into_enum().expect("response variant") {
            ironrdp_rdcleanpath::RDCleanPath::Response {
                x224_connection_response,
                server_cert_chain,
                server_addr,
            } => {
                assert_eq!(x224_connection_response.as_bytes(), &X224_CONFIRM);
                assert_eq!(server_cert_chain.len(), 1);
                assert_eq!(server_cert_chain[0].as_bytes(), cert_der.as_slice());
                assert_eq!(server_addr, format!("{host}:{port}")); // host cloned above, still valid
            }
            other => panic!("expected Response, got {other:?}"),
        }

        // 3. Byte passthrough: data written over the WS lands inside the
        //    server's TLS session and is echoed back.
        ws.send(Message::Binary(b"credssp-goes-here".to_vec().into()))
            .await
            .unwrap();
        let echoed = tokio::time::timeout(Duration::from_secs(10), ws.next())
            .await
            .expect("echo timeout")
            .expect("stream ended")
            .expect("ws error");
        assert_eq!(echoed.into_data().as_ref(), b"credssp-goes-here");

        // 4. Session is active; closing it via the manager tears down.
        assert!(mgr.shared().pending.is_empty());
        assert_eq!(mgr.shared().active.len(), 1);
        mgr.close_session(&ep.token).unwrap();
        assert!(mgr.shared().active.is_empty());
    }

    #[tokio::test]
    async fn rdp_upstream_unreachable_reports_error_pdu() {
        // Nothing listens on this port — the bridge must answer with a
        // RDCleanPath error PDU instead of closing the socket silently.
        let mgr = super::super::bridge::BridgeManager::new();
        let listener_port = mgr.ensure_listener().await.unwrap();
        let ep = mgr.open_rdp("127.0.0.1".into(), 1, listener_port, "0".repeat(64)); // port 1: reserved/unbound

        let (mut ws, _) = tokio_tungstenite::connect_async(ep.ws_url.as_str())
            .await
            .unwrap();
        let req = ironrdp_rdcleanpath::RDCleanPathPdu::new_request(
            dummy_x224_request(),
            "127.0.0.1:1".into(),
            String::new(),
            None,
        )
        .unwrap();
        ws.send(Message::Binary(req.to_der().unwrap().into()))
            .await
            .unwrap();

        let resp = tokio::time::timeout(Duration::from_secs(15), ws.next())
            .await
            .expect("error response timeout")
            .expect("stream ended")
            .expect("ws error");
        let pdu = ironrdp_rdcleanpath::RDCleanPathPdu::from_der(resp.into_data().as_ref())
            .expect("error response is not a valid RDCleanPath PDU");
        match pdu.into_enum().expect("error variant") {
            ironrdp_rdcleanpath::RDCleanPath::GeneralErr(_) => {}
            other => panic!("expected GeneralErr, got {other:?}"),
        }
        assert!(mgr.shared().active.is_empty());
    }
}
