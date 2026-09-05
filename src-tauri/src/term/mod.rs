//! Generic character-stream terminal layer (Telnet / Serial / local PTY).
//!
//! This is the P0 abstraction from `docs/multi-protocol-expansion-plan.md`
//! §5: one `TermIo` duplex-byte-stream trait plus a generic session loop that
//! owns encoding conversion (GBK/Big5/… via `StreamConverter`), session
//! logging and the `term:output` / `term:status` event channels. Concrete
//! backends plug in by returning a `Box<dyn TermIo>` and calling
//! [`spawn_session`]:
//!
//! * local PTY (portable-pty)  → P1a
//! * Telnet (IAC negotiation)  → P1b
//! * Serial (serialport crate) → P2
//!
//! SSH deliberately stays on the legacy `ssh:*` channels and `SshManager`
//! this cycle (zero-regression dual-track); the two layers only share
//! helpers (`StreamConverter`, `SessionLogContext`).
//!
//! P0 ships the abstraction only — everything below is wired up by the
//! backend tasks above, hence the module-wide dead-code allowance.
#![allow(dead_code)]

pub mod commands;
pub mod credentials;
pub mod local;
pub mod serial;
pub mod telnet;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

use crate::ssh::encoding::StreamConverter;
use crate::ssh::sessionlog::{SessionLogContext, SessionLogger};
use crate::types::ConnectionStatus;
use dashmap::DashMap;

// ---------------------------------------------------------------------------
// Event payloads (`term:output` / `term:status`)
// ---------------------------------------------------------------------------

/// Payload emitted on the `term:output` Tauri event channel. Shape-identical
/// to `SshOutputPayload` so the frontend can share one hook body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TermOutputPayload {
    pub session_id: String,
    /// Raw terminal bytes from the backend, already transcoded to UTF-8.
    pub data: Vec<u8>,
}

/// Payload emitted on the `term:status` Tauri event channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TermStatusPayload {
    pub session_id: String,
    pub status: ConnectionStatus,
}

// ---------------------------------------------------------------------------
// Kinds & parameters
// ---------------------------------------------------------------------------

/// Which character-stream kind a term session carries. Mirrored by the
/// frontend `TermSessionKind` type (`src/types/ssh.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TermKind {
    Telnet,
    Serial,
    Local,
}

impl TermKind {
    /// Canonical string stored in `saved_hosts.kind` (default `'ssh'`).
    pub fn as_str(self) -> &'static str {
        match self {
            TermKind::Telnet => "telnet",
            TermKind::Serial => "serial",
            TermKind::Local => "local",
        }
    }
}

/// One expect/send step of a Telnet auto-login script (P1b). `expect` is a
/// byte-oriented regex supporting the `\r \n \t \xNN` escapes; `send` is
/// literal text with the same escapes plus `\r` appended by the executor.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginScriptStep {
    pub expect: String,
    pub send: String,
}

/// Everything needed to open a term session, tagged by kind. This is the
/// wire contract for `term_open` and the JSON stored in
/// `saved_hosts.params_json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TermParams {
    Telnet {
        host: String,
        /// Defaults to 23 when omitted.
        #[serde(default = "default_telnet_port")]
        port: u16,
        /// Optional auto-login script, executed once the TCP stream is up.
        #[serde(default)]
        login_script: Option<Vec<LoginScriptStep>>,
        #[serde(default)]
        script_credential_id: Option<String>,
        /// Per-session encoding override (encoding_rs label); `None` falls
        /// back to the global `terminal_encoding` setting.
        #[serde(default)]
        encoding: Option<String>,
    },
    Serial {
        /// OS device path, e.g. `/dev/ttyUSB0` or `COM3` (from
        /// `serial_list_ports`).
        port: String,
        #[serde(default = "default_baud")]
        baud: u32,
        /// 5–8 (default 8).
        #[serde(default = "default_data_bits")]
        data_bits: u8,
        /// 1 or 2 (default 1).
        #[serde(default = "default_stop_bits")]
        stop_bits: u8,
        /// `"none" | "even" | "odd"` (default none).
        #[serde(default = "default_parity")]
        parity: String,
        /// `"none" | "hardware" | "software"` (default none).
        #[serde(default = "default_flow_control")]
        flow_control: String,
        #[serde(default)]
        encoding: Option<String>,
    },
    Local {
        /// Shell binary; `None` resolves `$SHELL` → zsh → bash (macOS/Linux)
        /// or pwsh → powershell → cmd (Windows).
        #[serde(default)]
        shell: Option<String>,
        /// Working directory the shell starts in.
        #[serde(default)]
        start_directory: Option<String>,
        #[serde(default)]
        encoding: Option<String>,
    },
}

fn default_telnet_port() -> u16 {
    23
}
fn default_baud() -> u32 {
    115_200
}
fn default_data_bits() -> u8 {
    8
}
fn default_stop_bits() -> u8 {
    1
}
fn default_parity() -> String {
    "none".to_string()
}
fn default_flow_control() -> String {
    "none".to_string()
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// All term-layer errors surfaced to the frontend via Tauri command results.
/// Serialized with the same `kind`/`message` struct shape as `SshError`.
#[derive(Debug, thiserror::Error)]
pub enum TermError {
    #[error("Session not found: {0}")]
    SessionNotFound(String),

    /// The backend for this kind has not landed yet (P0 → P1a/P1b/P2).
    #[error("Backend not available yet: {0}")]
    Unsupported(&'static str),

    #[error("I/O error: {0}")]
    Io(String),

    #[error("Protocol error: {0}")]
    Protocol(String),

    #[error("Invalid encoding: {0}")]
    InvalidEncoding(String),

    #[error("Invalid parameters: {0}")]
    InvalidParams(String),
}

impl Serialize for TermError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("TermError", 2)?;
        let kind = match self {
            TermError::SessionNotFound(_) => "session_not_found",
            TermError::Unsupported(_) => "unsupported",
            TermError::Io(_) => "io_error",
            TermError::Protocol(_) => "protocol_error",
            TermError::InvalidEncoding(_) => "invalid_encoding",
            TermError::InvalidParams(_) => "invalid_params",
        };
        state.serialize_field("kind", kind)?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl From<std::io::Error> for TermError {
    fn from(e: std::io::Error) -> Self {
        TermError::Io(e.to_string())
    }
}

// ---------------------------------------------------------------------------
// Backend trait
// ---------------------------------------------------------------------------

/// A connected, duplex character-stream backend. One instance per open
/// session, owned exclusively by the session loop (like the russh channel in
/// `ssh/session.rs`) — no shared locks, no write contention.
#[async_trait]
pub trait TermIo: Send {
    /// Read the next chunk of backend output. Returns `Ok(0)` on clean EOF.
    async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize>;

    /// Write user keystrokes to the backend.
    async fn write(&mut self, data: &[u8]) -> std::io::Result<usize>;

    /// Resize the terminal, if the backend supports it (PTY: winsize;
    /// Telnet: NAWS; Serial: no-op).
    async fn resize(&mut self, _cols: u32, _rows: u32) {}

    /// Tear the connection down (close PTY / TCP socket / serial port).
    async fn shutdown(&mut self);
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/// Commands sent from the frontend (via the manager) to the session loop.
enum TermCmd {
    Start,
    Data(Vec<u8>),
    Resize {
        cols: u32,
        rows: u32,
    },
    /// Swap both stream converters to a new encoding; effective on the next
    /// chunk (same semantics as the SSH layer's `SetEncoding`).
    SetEncoding {
        label: String,
    },
    Close,
}

/// Handle to one running term session. Cloning-free: the manager stores one
/// per session id and forwards commands through the mpsc channel.
pub struct TermHandle {
    pub kind: TermKind,
    cmd_tx: mpsc::UnboundedSender<TermCmd>,
    reader_task: Option<JoinHandle<()>>,
    /// The encoding this session currently transcodes with (shared with the
    /// loop so `encoding()` reads the live value).
    current_encoding: Arc<RwLock<String>>,
    /// Handle copy used by `close()` to flush + stop the session log.
    logger: SessionLogger,
    context: SessionLogContext,
    params: Option<TermParams>,
}

impl TermHandle {
    fn send(&self, data: &[u8]) -> Result<(), TermError> {
        self.cmd_tx
            .send(TermCmd::Data(data.to_vec()))
            .map_err(|_| TermError::SessionNotFound("session task closed".to_string()))
    }

    fn resize(&self, cols: u32, rows: u32) -> Result<(), TermError> {
        self.cmd_tx
            .send(TermCmd::Resize { cols, rows })
            .map_err(|_| TermError::SessionNotFound("session task closed".to_string()))
    }

    fn set_encoding(&self, label: &str) -> Result<(), TermError> {
        if encoding_rs::Encoding::for_label(label.as_bytes()).is_none() {
            return Err(TermError::InvalidEncoding(label.to_string()));
        }
        if let Ok(mut cur) = self.current_encoding.write() {
            *cur = label.to_string();
        }
        self.cmd_tx
            .send(TermCmd::SetEncoding {
                label: label.to_string(),
            })
            .map_err(|_| TermError::SessionNotFound("session task closed".to_string()))
    }

    fn encoding(&self) -> String {
        self.current_encoding
            .read()
            .map(|e| e.clone())
            .unwrap_or_else(|_| "utf-8".to_string())
    }

    /// Gracefully close: stop the session log (flushing it), signal the loop,
    /// and wait for the backend `shutdown()` to run.
    async fn close(&mut self) {
        self.logger.stop();
        let _ = self.cmd_tx.send(TermCmd::Close);
        if let Some(task) = self.reader_task.take() {
            let _ = task.await;
        }
    }
}

/// Spawn the generic reader/writer loop for a connected backend and return
/// its handle. This is the term-layer counterpart of `SshSession::open_pty`'s
/// task: it owns `io` exclusively, multiplexes backend output against
/// frontend commands, transcodes both directions, feeds the session log and
/// emits `term:output` / `term:status`.
pub fn spawn_session(
    session_id: String,
    kind: TermKind,
    mut io: Box<dyn TermIo>,
    app: AppHandle,
    encoding: &str,
    log: SessionLogContext,
) -> TermHandle {
    let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<TermCmd>();

    let current_encoding = Arc::new(RwLock::new(encoding.to_string()));
    let task_encoding = current_encoding.clone();

    // Auto-record (global setting or bookmark preset) starts the logger
    // before the loop runs, so even the banner is captured — same ordering
    // as the SSH layer.
    if let Some(options) = log.auto_start.clone() {
        let _ = log.logger.start(options, &log.host, &log.user, None);
    }
    let logger = log.logger.clone();
    let task_logger = logger.clone();

    // Per-direction converters. UTF-8 constructs no decoder/encoder and the
    // bytes pass through untouched.
    let mut out_conv = StreamConverter::new(encoding);
    let mut in_conv = StreamConverter::new(encoding);

    let reader_session_id = session_id.clone();
    let reader_app = app.clone();

    let reader_task = tokio::spawn(async move {
        let mut buf = vec![0u8; 8192];
        // The webview must subscribe before any banner or short-lived process
        // output is emitted. Start is idempotent across StrictMode remounts.
        let mut started = false;

        loop {
            tokio::select! {
                n = io.read(&mut buf), if started => {
                    let is_eof_or_err = matches!(&n, Ok(0)) || n.is_err();
                    if is_eof_or_err {
                        // Clean EOF or backend failure — either way the
                        // session is over. Distinguish the two for the UI.
                        let status = match &n {
                            Ok(0) => ConnectionStatus::Disconnected,
                            Err(e) => ConnectionStatus::Error(e.to_string()),
                            Ok(_) => ConnectionStatus::Disconnected,
                        };
                        let payload = TermStatusPayload {
                            session_id: reader_session_id.clone(),
                            status,
                        };
                        let _ = reader_app.emit("term:status", &payload);
                        break;
                    }
                    let n = n.unwrap_or(0);
                    let data = out_conv.decode_to_utf8(&buf[..n]);
                    if task_logger.is_active() {
                        if let Ok(text) = std::str::from_utf8(&data) {
                            task_logger.on_output(text);
                        }
                    }
                    let payload = TermOutputPayload {
                        session_id: reader_session_id.clone(),
                        data,
                    };
                    let _ = reader_app.emit("term:output", &payload);
                }
                cmd = cmd_rx.recv() => {
                    match cmd {
                        Some(TermCmd::Start) => started = true,
                        Some(TermCmd::Data(data)) => {
                            if task_logger.is_active() {
                                if let Ok(text) = std::str::from_utf8(&data) {
                                    task_logger.on_input(text);
                                }
                            }
                            let data = in_conv.encode_from_utf8(&data, false);
                            if let Err(e) = io.write(&data).await {
                                let payload = TermStatusPayload {
                                    session_id: reader_session_id.clone(),
                                    status: ConnectionStatus::Error(e.to_string()),
                                };
                                let _ = reader_app.emit("term:status", &payload);
                                break;
                            }
                        }
                        Some(TermCmd::Resize { cols, rows }) => {
                            io.resize(cols, rows).await;
                        }
                        Some(TermCmd::SetEncoding { label }) => {
                            out_conv = StreamConverter::new(&label);
                            in_conv = StreamConverter::new(&label);
                            if let Ok(mut cur) = task_encoding.write() {
                                *cur = label;
                            }
                        }
                        Some(TermCmd::Close) | None => {
                            let payload = TermStatusPayload {
                                session_id: reader_session_id.clone(),
                                status: ConnectionStatus::Disconnected,
                            };
                            let _ = reader_app.emit("term:status", &payload);
                            break;
                        }
                    }
                }
            }
        }
        io.shutdown().await;
        task_logger.stop();
    });

    let _ = app.emit(
        "term:status",
        &TermStatusPayload {
            session_id,
            status: ConnectionStatus::Connected,
        },
    );

    TermHandle {
        kind,
        cmd_tx,
        reader_task: Some(reader_task),
        current_encoding,
        logger,
        context: log,
        params: None,
    }
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

/// Registry of open term sessions, keyed by session id. Mirrors the role
/// `SshManager` plays for SSH, minus connection setup (each backend owns its
/// own connect logic and calls [`spawn_session`] when its stream is up).
pub struct TermManager {
    sessions: DashMap<String, TermHandle>,
}

impl Default for TermManager {
    fn default() -> Self {
        Self::new()
    }
}

impl TermManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    pub fn insert(&self, session_id: String, mut handle: TermHandle, params: TermParams) {
        handle.params = Some(params);
        self.sessions.insert(session_id, handle);
    }

    pub fn start(&self, id: &str) -> Result<(), TermError> {
        self.sessions
            .get(id)
            .ok_or_else(|| TermError::SessionNotFound(id.into()))?
            .cmd_tx
            .send(TermCmd::Start)
            .map_err(|_| TermError::SessionNotFound(id.into()))
    }

    pub fn params(&self, id: &str) -> Result<TermParams, TermError> {
        self.sessions
            .get(id)
            .and_then(|s| s.params.clone())
            .ok_or_else(|| TermError::SessionNotFound(id.into()))
    }

    pub fn contains(&self, id: &str) -> bool {
        self.sessions.contains_key(id)
    }

    pub fn session_log_context(&self, id: &str) -> Option<SessionLogContext> {
        self.sessions.get(id).map(|s| s.context.clone())
    }

    /// Close a session and drop its handle. Returns the kind, or `None` when
    /// the id was already gone.
    pub async fn close(&self, session_id: &str) -> Option<TermKind> {
        match self.sessions.remove(session_id) {
            Some((_, mut handle)) => {
                let kind = handle.kind;
                handle.close().await;
                Some(kind)
            }
            None => None,
        }
    }

    /// Retain connection settings after a failed retry, including exclusive
    /// serial devices whose old reader must be stopped before opening again.
    pub async fn stop_for_reconnect(&self, id: &str) {
        if let Some((key, mut handle)) = self.sessions.remove(id) {
            handle.close().await;
            self.sessions.insert(key, handle);
        }
    }

    pub fn send(&self, session_id: &str, data: &[u8]) -> Result<(), TermError> {
        self.sessions
            .get(session_id)
            .ok_or_else(|| TermError::SessionNotFound(session_id.to_string()))?
            .send(data)
    }

    pub fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), TermError> {
        self.sessions
            .get(session_id)
            .ok_or_else(|| TermError::SessionNotFound(session_id.to_string()))?
            .resize(cols, rows)
    }

    pub fn set_encoding(&self, session_id: &str, label: &str) -> Result<(), TermError> {
        self.sessions
            .get(session_id)
            .ok_or_else(|| TermError::SessionNotFound(session_id.to_string()))?
            .set_encoding(label)
    }

    pub fn encoding(&self, session_id: &str) -> Result<String, TermError> {
        Ok(self
            .sessions
            .get(session_id)
            .ok_or_else(|| TermError::SessionNotFound(session_id.to_string()))?
            .encoding())
    }
}
