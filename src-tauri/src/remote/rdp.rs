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
    tokio::time::timeout(Duration::from_secs(30), async {
        let mut tcp = TcpStream::connect((host, port))
            .await
            .map_err(|e| BridgeError::Upstream(e.to_string()))?;
        tcp.write_all(&[3, 0, 0, 19, 14, 224, 0, 0, 0, 0, 0, 1, 0, 8, 0, 3, 0, 0, 0])
            .await
            .map_err(|e| BridgeError::Upstream(e.to_string()))?;
        read_tpkt(&mut tcp).await?;
        let tls = TlsConnector::from(pinned_client_config(None))
            .connect(server_name_for(host), tcp)
            .await
            .map_err(|e| BridgeError::Upstream(e.to_string()))?;
        let cert = tls
            .get_ref()
            .1
            .peer_certificates()
            .and_then(|certs| certs.first())
            .ok_or_else(|| BridgeError::Upstream("server supplied no certificate".into()))?;
        Ok(certificate_fingerprint(cert.as_ref()))
    })
    .await
    .map_err(|_| BridgeError::Upstream("certificate inspection timed out".into()))?
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
    let mut buf = Vec::with_capacity(64);
    let mut chunk = [0u8; 512];
    loop {
        let n = tokio::time::timeout(STEP_TIMEOUT, stream.read(&mut chunk))
            .await
            .map_err(|_| BridgeError::Upstream("timeout reading X.224 confirm".into()))?
            .map_err(|e| BridgeError::Upstream(format!("read X.224 confirm: {e}")))?;
        if n == 0 {
            return Err(BridgeError::Upstream(
                "upstream closed during X.224 negotiation".into(),
            ));
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

    if let Err(_err) = result {
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
    let x224_request = match request {
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
    /// PROTOCOL_HYBRID (CredSSP) — 19 bytes, exactly what a real server
    /// sends for NLA (see netbird `detectCredSSPFromX224`).
    const X224_CONFIRM: [u8; 19] = [
        0x03, 0x00, 0x00, 0x13, // TPKT: version 3, reserved, total len 19
        0x0E, 0xD0, // LI=14, CC TPDU code 0xD0
        0x00, 0x00, 0x00, 0x00, 0x00, // dst-ref, src-ref, class
        0x02, 0x00, 0x00, 0x08, // NEG_RSP: type 2, flags 0, len 8
        0x00, 0x00, 0x00, 0x02, // selectedProtocol = PROTOCOL_HYBRID
    ];

    /// Fake RDP server: X.224 exchange, then a real TLS 1.2 handshake with a
    /// self-signed cert, then echo loop inside the TLS session.
    async fn spawn_fake_rdp_server() -> (String, u16, Vec<u8>) {
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
                    if sock.write_all(&X224_CONFIRM).await.is_err() {
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
