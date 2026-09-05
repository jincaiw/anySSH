//! The WebSocket bridge (§3.7) — lazily-started loopback listener with
//! one-time-token routing and byte passthrough.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};

use dashmap::DashMap;
use serde::Serialize;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

const IDLE_SHUTDOWN: Duration = Duration::from_secs(30);
const WATCHDOG_TICK: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// Upstream → WS chunk size (read buffer).
pub(crate) const PUMP_BUF: usize = 16 * 1024;

/// What a token routes to. RDP adds its variant in P4.
#[derive(Debug, Clone)]
pub enum Route {
    /// Plain byte passthrough (websockify semantics).
    Vnc { host: String, port: u16 },
    /// RDCleanPath proxy (X.224 + TLS cert capture, then byte passthrough
    /// inside the proxy-terminated TLS session). See `remote/rdp.rs`.
    Rdp {
        host: String,
        port: u16,
        fingerprint: String,
    },
}

#[derive(Debug, Error)]
pub enum BridgeError {
    #[error("bridge listener error: {0}")]
    Listener(String),
    #[error("no such session: {0}")]
    NoSuchSession(String),
    /// Reserved for the RDP (P4) handshake path, which reports upstream
    /// failures to the client instead of closing silently.
    #[allow(dead_code)]
    #[error("upstream connect failed: {0}")]
    Upstream(String),
    /// Reserved for the RDP (P4) handshake path (bad token/headers).
    #[allow(dead_code)]
    #[error("connection rejected: {0}")]
    Rejected(String),
}

impl Serialize for BridgeError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("BridgeError", 2)?;
        let kind = match self {
            BridgeError::Listener(_) => "listener",
            BridgeError::NoSuchSession(_) => "no_such_session",
            BridgeError::Upstream(_) => "upstream",
            BridgeError::Rejected(_) => "rejected",
        };
        state.serialize_field("kind", kind)?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

/// Result payload of `vnc_open` — the webview connects here with noVNC.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsEndpoint {
    pub ws_url: String,
    pub token: String,
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

pub(crate) struct Shared {
    pub(crate) pending: DashMap<String, Route>,
    pub(crate) active: DashMap<String, CancellationToken>,
    last_activity: Mutex<Instant>,
}

impl Shared {
    pub(crate) fn touch(&self) {
        if let Ok(mut t) = self.last_activity.lock() {
            *t = Instant::now();
        }
    }
}

struct ListenerHandle {
    port: u16,
    shutdown: CancellationToken,
    accept_task: JoinHandle<()>,
    watchdog_task: JoinHandle<()>,
}

/// Registry + loopback listener owner. Managed state; VNC and (later) RDP
/// share one listener.
pub struct BridgeManager {
    start_lock: tokio::sync::Mutex<()>,
    inner: Mutex<Option<ListenerHandle>>,
    shared: Arc<Shared>,
}

impl Default for BridgeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl BridgeManager {
    pub fn new() -> Self {
        Self {
            start_lock: tokio::sync::Mutex::new(()),
            inner: Mutex::new(None),
            shared: Arc::new(Shared {
                pending: DashMap::new(),
                active: DashMap::new(),
                last_activity: Mutex::new(Instant::now()),
            }),
        }
    }

    /// Register a VNC route and return the loopback WS endpoint for the
    /// webview client.
    pub fn open_vnc(&self, host: String, port: u16, listener_port: u16) -> WsEndpoint {
        let token = new_token();
        self.shared
            .pending
            .insert(token.clone(), Route::Vnc { host, port });
        self.shared.touch();
        WsEndpoint {
            ws_url: format!("ws://127.0.0.1:{listener_port}/vnc/{token}"),
            token,
        }
    }

    /// Register an RDP route and return the loopback WS endpoint for the
    /// ironrdp-web WASM client (it performs the RDCleanPath handshake).
    pub fn open_rdp(
        &self,
        host: String,
        port: u16,
        listener_port: u16,
        fingerprint: String,
    ) -> WsEndpoint {
        let token = new_token();
        self.shared.pending.insert(
            token.clone(),
            Route::Rdp {
                host,
                port,
                fingerprint,
            },
        );
        self.shared.touch();
        WsEndpoint {
            ws_url: format!("ws://127.0.0.1:{listener_port}/rdp/{token}"),
            token,
        }
    }

    /// Drop a pending token or cancel a live session.
    pub fn close_session(&self, token: &str) -> Result<(), BridgeError> {
        self.shared.touch();
        if let Some((_, route)) = self.shared.pending.remove(token) {
            // A token nobody connected to yet — cancel its upstream dial if
            // one raced in (dialer holds no map entry until connected).
            let _ = route;
            return Ok(());
        }
        if let Some((_, cancel)) = self.shared.active.remove(token) {
            cancel.cancel();
            return Ok(());
        }
        Err(BridgeError::NoSuchSession(token.to_string()))
    }

    /// Test-only accessor for the shared state (used by rdp.rs tests).
    #[cfg(test)]
    pub(crate) fn shared(&self) -> &Shared {
        &self.shared
    }

    /// Return the listener port, starting the loopback listener if needed.
    /// A listener the watchdog already shut down is detected by its finished
    /// accept task and replaced.
    pub async fn ensure_listener(&self) -> Result<u16, BridgeError> {
        let _start = self.start_lock.lock().await;
        {
            let mut guard = self.inner.lock().unwrap();
            match guard.as_ref() {
                Some(h) if !h.accept_task.is_finished() => return Ok(h.port),
                Some(_) => {
                    if let Some(h) = guard.take() {
                        h.shutdown.cancel();
                        h.accept_task.abort();
                        h.watchdog_task.abort();
                    }
                }
                None => {}
            }
        }

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| BridgeError::Listener(format!("bind 127.0.0.1:0: {e}")))?;
        let port = listener
            .local_addr()
            .map_err(|e| BridgeError::Listener(e.to_string()))?
            .port();

        let shutdown = CancellationToken::new();
        let shared = self.shared.clone();

        let accept_task = tokio::spawn(accept_loop(listener, shared.clone(), shutdown.clone()));
        let watchdog_task = tokio::spawn(idle_watchdog(shared, shutdown.clone()));

        self.inner.lock().unwrap().replace(ListenerHandle {
            port,
            shutdown,
            accept_task,
            watchdog_task,
        });
        self.shared.touch();
        Ok(port)
    }
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("OS CSPRNG unavailable");
    let mut hex = String::with_capacity(64);
    for b in bytes {
        hex.push_str(&format!("{b:02x}"));
    }
    hex
}

/// Watchdog: after `IDLE_SHUTDOWN` with no pending tokens and no active
/// sessions, cancel the accept loop and clear the listener handle.
async fn idle_watchdog(shared: Arc<Shared>, shutdown: CancellationToken) {
    loop {
        tokio::select! {
            _ = shutdown.cancelled() => return,
            _ = tokio::time::sleep(WATCHDOG_TICK) => {}
        }
        let idle_since = *shared
            .last_activity
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        if shared.pending.is_empty()
            && shared.active.is_empty()
            && idle_since.elapsed() >= IDLE_SHUTDOWN
        {
            shutdown.cancel();
            return;
        }
    }
}

async fn accept_loop(
    listener: tokio::net::TcpListener,
    shared: Arc<Shared>,
    shutdown: CancellationToken,
) {
    loop {
        tokio::select! {
            _ = shutdown.cancelled() => return,
            accepted = listener.accept() => {
                match accepted {
                    Ok((stream, _peer)) => {
                        // A fresh connection counts as activity (prevents the
                        // watchdog racing a client that dialed at the deadline).
                        shared.touch();
                        let shared = shared.clone();
                        tokio::spawn(handle_connection(stream, shared));
                    }
                    Err(_) => return,
                }
            }
        }
    }
}

/// Handshake, resolve the one-time token, then pump bytes both ways until
/// either side closes.
// tungstenite's accept_hdr_async callback error type (ErrorResponse) is an
// alias for the full Response - large by design, not worth boxing.
#[allow(clippy::result_large_err)]
async fn handle_connection(stream: TcpStream, shared: Arc<Shared>) {
    let path = Arc::new(Mutex::<Option<String>>::new(None));
    let path_cb = path.clone();
    let ws = tokio::time::timeout(
        CONNECT_TIMEOUT,
        tokio_tungstenite::accept_hdr_async(
            stream,
            move |req: &Request, resp: Response| -> std::result::Result<Response, ErrorResponse> {
                if let Ok(mut p) = path_cb.lock() {
                    *p = Some(req.uri().path().to_string());
                }
                Ok(resp)
            },
        ),
    )
    .await;
    let ws = match ws {
        Ok(Ok(ws)) => ws,
        _ => return,
    };
    let path = path.lock().ok().and_then(|p| p.clone()).unwrap_or_default();

    // Route by path: /vnc/<token> (byte passthrough) or /rdp/<token>
    // (RDCleanPath proxy, see rdp.rs).
    let (token, route) = if let Some(token) = path.strip_prefix("/vnc/") {
        let Some((_, route)) = shared.pending.remove(token) else {
            return;
        };
        (token, route)
    } else if let Some(token) = path.strip_prefix("/rdp/") {
        let Some((_, route)) = shared.pending.remove(token) else {
            return;
        };
        (token, route)
    } else {
        return;
    };

    let (host, port) = match route {
        Route::Vnc { host, port } => (host, port),
        Route::Rdp {
            host,
            port,
            fingerprint,
        } => {
            super::rdp::handle_rdp_client(ws, host, port, fingerprint, shared, token.to_string())
                .await;
            return;
        }
    };

    let sess_cancel = CancellationToken::new();
    shared.active.insert(token.to_string(), sess_cancel.clone());
    let _guard = ActiveSessionGuard(shared.clone(), token.to_string());
    let dial = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((host.as_str(), port)));
    let tcp = match tokio::select! {
        _ = sess_cancel.cancelled() => return,
        result = dial => result,
    } {
        Ok(Ok(tcp)) => tcp,
        _ => return, // upstream unreachable — client sees an abrupt close
    };

    shared.touch();

    let (mut ws_tx, mut ws_rx) = ws.split();
    let (mut tcp_rx, mut tcp_tx) = tcp.into_split();

    let up_cancel = sess_cancel.clone();
    let down_cancel = sess_cancel.clone();

    let up = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = up_cancel.cancelled() => break,
                msg = ws_rx.next() => match msg {
                    Some(Ok(Message::Binary(b))) => {
                        if tcp_tx.write_all(&b).await.is_err() { break; }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
        }
    });

    let down = tokio::spawn(async move {
        let mut buf = vec![0u8; PUMP_BUF];
        loop {
            tokio::select! {
                _ = down_cancel.cancelled() => break,
                n = tcp_rx.read(&mut buf) => match n {
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

    // Whichever direction ends first takes the whole session down.
    finish_pumps(up, down, sess_cancel).await;
}

pub(crate) struct ActiveSessionGuard(pub Arc<Shared>, pub String);
impl Drop for ActiveSessionGuard {
    fn drop(&mut self) {
        self.0.active.remove(&self.1);
        self.0.touch();
    }
}

pub(crate) async fn finish_pumps(
    mut up: JoinHandle<()>,
    mut down: JoinHandle<()>,
    cancel: CancellationToken,
) {
    tokio::select! {
        _ = &mut up => { down.abort(); let _ = down.await; },
        _ = &mut down => { up.abort(); let _ = up.await; },
        _ = cancel.cancelled() => {
            up.abort(); down.abort();
            let _ = up.await; let _ = down.await;
        }
    }
    cancel.cancel();
}

// ---------------------------------------------------------------------------
// Tests (loopback integration — no external VNC server needed)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal echo "VNC server": accepts any TCP connection and echoes
    /// every byte back. All sockets bind 127.0.0.1 ephemeral ports.
    async fn spawn_echo_server() -> (String, u16) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    loop {
                        match sock.read(&mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                if sock.write_all(&buf[..n]).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                });
            }
        });
        (addr.ip().to_string(), addr.port())
    }

    #[tokio::test]
    async fn concurrent_listener_initialization_uses_one_port() {
        let manager = BridgeManager::new();
        let (one, two, three) = tokio::join!(
            manager.ensure_listener(),
            manager.ensure_listener(),
            manager.ensure_listener()
        );
        assert_eq!(one.as_ref().unwrap(), two.as_ref().unwrap());
        assert_eq!(one.unwrap(), three.unwrap());
    }

    #[tokio::test]
    async fn completed_pump_cancels_pending_peer_without_double_poll() {
        for upstream_finishes in [true, false] {
            let cancel = CancellationToken::new();
            let finished = tokio::spawn(async {});
            let waiting = tokio::spawn(std::future::pending::<()>());
            let (up, down) = if upstream_finishes {
                (finished, waiting)
            } else {
                (waiting, finished)
            };
            tokio::time::timeout(
                Duration::from_secs(2),
                finish_pumps(up, down, cancel.clone()),
            )
            .await
            .unwrap();
            assert!(cancel.is_cancelled());
        }
    }

    #[tokio::test]
    async fn completed_vnc_session_removes_active_entry() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let manager = BridgeManager::new();
        let bridge_port = manager.ensure_listener().await.unwrap();
        let endpoint = manager.open_vnc("127.0.0.1".into(), port, bridge_port);
        let (_ws, _) = tokio_tungstenite::connect_async(&endpoint.ws_url)
            .await
            .unwrap();
        let (tcp, _) = listener.accept().await.unwrap();
        drop(tcp);
        tokio::time::timeout(Duration::from_secs(2), async {
            while !manager.shared.active.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("finished tunnel must release its active session");
    }

    #[tokio::test]
    async fn vnc_passthrough_roundtrip() {
        let (host, port) = spawn_echo_server().await;
        let mgr = BridgeManager::new();
        let listener_port = mgr.ensure_listener().await.unwrap();
        let ep = mgr.open_vnc(host, port, listener_port);

        // Route must be pending until a client consumes it.
        assert_eq!(mgr.shared.pending.len(), 1);

        let (mut ws, _resp) = tokio_tungstenite::connect_async(ep.ws_url.as_str())
            .await
            .unwrap();

        ws.send(Message::Binary(b"hello bridge".to_vec().into()))
            .await
            .unwrap();

        // Read with a timeout so a broken bridge fails the test, not hangs.
        let echoed = tokio::time::timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("echo timeout")
            .expect("stream ended")
            .expect("ws error");
        assert_eq!(echoed.into_data().as_ref(), b"hello bridge");

        // Token consumed on connect; session now active.
        assert!(mgr.shared.pending.is_empty());
        assert_eq!(mgr.shared.active.len(), 1);

        // Closing via the manager cancels the active session.
        mgr.close_session(&ep.token).unwrap();
        assert!(mgr.shared.active.is_empty());
    }

    #[tokio::test]
    async fn token_is_single_use() {
        let (host, port) = spawn_echo_server().await;
        let mgr = BridgeManager::new();
        let listener_port = mgr.ensure_listener().await.unwrap();
        let ep = mgr.open_vnc(host, port, listener_port);

        // First client consumes the token and works.
        let (mut ws1, _) = tokio_tungstenite::connect_async(ep.ws_url.as_str())
            .await
            .unwrap();
        ws1.send(Message::Binary(b"a".to_vec().into()))
            .await
            .unwrap();
        let _ = tokio::time::timeout(Duration::from_secs(5), ws1.next())
            .await
            .expect("echo timeout")
            .expect("stream ended")
            .expect("ws error");

        // Second client with the SAME token: the bridge completes the
        // handshake (accept happens before route lookup) but closes the
        // socket immediately because the token is gone.
        let (mut ws2, _) = tokio_tungstenite::connect_async(ep.ws_url.as_str())
            .await
            .unwrap();
        let outcome = tokio::time::timeout(Duration::from_secs(5), ws2.next()).await;
        match outcome {
            Err(_) => panic!("consumed-token connection should be closed promptly"),
            Ok(None) => {}                        // stream ended
            Ok(Some(Ok(Message::Close(_)))) => {} // explicit close
            Ok(Some(Ok(m))) => panic!("unexpected data on consumed token: {m:?}"),
            Ok(Some(Err(_))) => {} // aborted
        }
        assert!(mgr.shared.pending.is_empty());
    }

    #[tokio::test]
    async fn unknown_token_is_rejected() {
        let mgr = BridgeManager::new();
        let listener_port = mgr.ensure_listener().await.unwrap();
        let (mut ws, _) = tokio_tungstenite::connect_async(format!(
            "ws://127.0.0.1:{listener_port}/vnc/deadbeef"
        ))
        .await
        .unwrap();
        // The bridge closes immediately; the client sees EOF/close/error.
        let outcome = tokio::time::timeout(Duration::from_secs(5), ws.next()).await;
        match outcome {
            Err(_) => panic!("unknown-token connection should be closed promptly"),
            Ok(None) => {}
            Ok(Some(Ok(Message::Close(_)))) => {}
            Ok(Some(Ok(m))) => panic!("unexpected data on unknown token: {m:?}"),
            Ok(Some(Err(_))) => {}
        }
        assert!(mgr.shared.pending.is_empty());
        assert!(mgr.shared.active.is_empty());
    }
}
