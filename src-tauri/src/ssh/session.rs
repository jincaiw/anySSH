use crate::types::{ConnectionStatus, SshError, SshOutputPayload, SshStatusPayload};
use russh::client::Handle;
use russh::ChannelMsg;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};

use super::encoding::{SessionSettings, StreamConverter};
use super::handler::SshClientHandler;
use super::sessionlog::SessionLogContext;

/// Commands sent from the frontend to the reader/writer task.
enum SessionCmd {
    Data(Vec<u8>),
    Resize {
        cols: u32,
        rows: u32,
    },
    /// Rebuild both stream converters with a new encoding at runtime. The
    /// switch takes effect on the next chunk in each direction; any partial
    /// multi-byte sequence buffered in the old converter is discarded (the
    /// user is expected to switch at a shell prompt, where nothing is pending).
    SetEncoding {
        label: String,
    },
    Eof,
}

/// Wraps a single connected SSH session. Input is funneled through an mpsc
/// channel so the background task owns the russh channel exclusively —
/// eliminating the deadlock that occurs when a Mutex is shared between
/// the reader (blocking on `wait()`) and the writer (`data()`).
///
/// The underlying `Handle` is stored in an `Arc<Mutex<>>` so that the SFTP
/// layer can open additional channels on the same connection without taking
/// ownership and without cloning (which `Handle` does not support).
/// Minimal config needed to open additional channels on the same connection.
#[derive(Clone)]
pub struct SplitConfig {
    pub default_shell: Option<String>,
}

pub struct SshSession {
    handle: Arc<Mutex<Handle<SshClientHandler>>>,
    cmd_tx: mpsc::UnboundedSender<SessionCmd>,
    reader_task: tokio::task::JoinHandle<()>,
    #[allow(dead_code)]
    session_id: String,
    split_config: SplitConfig,
    /// When this session is reached through a ProxyJump chain, the jump-host
    /// handles (one per hop) are held here so the tunnel underneath stays open
    /// for the session's lifetime. Shared via `Arc` so split panes on the same
    /// connection keep the tunnel alive even after the parent session is closed.
    /// Never locked/accessed for I/O — merely held to prevent russh from tearing
    /// the tunnel down. Empty for a direct (non-tunnelled) connection.
    #[allow(dead_code)]
    jump_handles: Arc<Vec<Handle<SshClientHandler>>>,
    /// The encoding label this session is currently transcoding with. Updated
    /// synchronously by [`SshSession::set_encoding`] (the converters themselves
    /// are rebuilt inside the reader/writer task) so split panes can inherit
    /// the source session's *runtime* encoding rather than the global default.
    current_encoding: Arc<std::sync::RwLock<String>>,
    /// Terminal session log: handle + host/user metadata for file naming, and
    /// the auto-start decision resolved at connect time.
    log: SessionLogContext,
}

impl SshSession {
    /// Open a PTY channel on an authenticated connection, start the output
    /// reader loop, and return the session wrapper.
    // ProxyJump support added `jump_handles`, pushing this one over the 7-arg lint.
    #[allow(clippy::too_many_arguments)]
    pub async fn open_pty(
        handle: Handle<SshClientHandler>,
        jump_handles: Arc<Vec<Handle<SshClientHandler>>>,
        session_id: String,
        cols: u32,
        rows: u32,
        app_handle: AppHandle,
        default_shell: Option<String>,
        startup_command: Option<String>,
        settings: SessionSettings,
        log: SessionLogContext,
    ) -> Result<Self, SshError> {
        // Wrap the handle immediately so it can be shared with SFTP later.
        let handle = Arc::new(Mutex::new(handle));

        let channel = handle
            .lock()
            .await
            .channel_open_session()
            .await
            .map_err(|e| SshError::ChannelError(e.to_string()))?;

        channel
            .request_pty(false, &settings.term, cols, rows, 0, 0, &[])
            .await
            .map_err(|e| SshError::ChannelError(e.to_string()))?;

        // LANG environment variable (per-host override → global default).
        // Best-effort: servers that restrict `AcceptEnv` (or bastion
        // appliances) silently drop `env` requests; the shell-level
        // `export LANG=…` fallback below covers those.
        if !settings.lang.is_empty() {
            let _ = channel.set_env(false, "LANG", settings.lang.clone()).await;
        }

        // Use custom shell if specified, otherwise request default login shell
        if let Some(shell) = &default_shell {
            channel
                .exec(false, shell.as_bytes())
                .await
                .map_err(|e| SshError::ChannelError(e.to_string()))?;
        } else {
            channel
                .request_shell(false)
                .await
                .map_err(|e| SshError::ChannelError(e.to_string()))?;
        }

        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SessionCmd>();

        // Schedule startup command: wait for the shell to initialize (MOTD,
        // profile scripts, prompt) then send the command via the normal
        // input channel. The 800ms delay is a pragmatic choice that works
        // across most servers and shell configs.
        // The LANG export is prepended so the fallback path (servers that
        // filter `env` requests) applies before any user command runs.
        if let Some(cmd) = super::encoding::with_lang_export(&settings.lang, startup_command) {
            let startup_tx = cmd_tx.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                let input = format!("{}\n", cmd);
                let _ = startup_tx.send(SessionCmd::Data(input.into_bytes()));
            });
        }

        let reader_session_id = session_id.clone();
        let reader_app = app_handle.clone();

        // Per-direction converters. UTF-8 (the default) constructs no decoder
        // or encoder and the bytes pass through untouched.
        let mut out_conv = StreamConverter::new(&settings.encoding);
        let mut in_conv = StreamConverter::new(&settings.encoding);

        // Runtime encoding record (shared with `set_encoding` so split panes
        // can inherit the live value).
        let current_encoding = Arc::new(std::sync::RwLock::new(settings.encoding.clone()));

        // Auto-record (global setting or bookmark preset) starts the logger
        // before the reader loop runs, so even the banner/MOTD is captured.
        if let Some(options) = log.auto_start.clone() {
            let _ = log.logger.start(options, &log.host, &log.user);
        }

        // The task only needs the logger handle; the session keeps its own
        // copy, so clone the Arc-based logger instead of moving the context.
        let task_log = log.logger.clone();

        // The background task owns the channel exclusively. It multiplexes
        // between reading SSH output and processing frontend commands.
        let reader_task = tokio::spawn(async move {
            let mut channel = channel;

            loop {
                tokio::select! {
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { data }) => {
                                let data = out_conv.decode_to_utf8(&data);
                                if task_log.is_active() {
                                    if let Ok(text) = std::str::from_utf8(&data) {
                                        task_log.on_output(text);
                                    }
                                }
                                let payload = SshOutputPayload {
                                    session_id: reader_session_id.clone(),
                                    data,
                                };
                                let _ = reader_app.emit("ssh:output", &payload);
                            }
                            Some(ChannelMsg::ExtendedData { data, .. }) => {
                                let data = out_conv.decode_to_utf8(&data);
                                if task_log.is_active() {
                                    if let Ok(text) = std::str::from_utf8(&data) {
                                        task_log.on_output(text);
                                    }
                                }
                                let payload = SshOutputPayload {
                                    session_id: reader_session_id.clone(),
                                    data,
                                };
                                let _ = reader_app.emit("ssh:output", &payload);
                            }
                            Some(ChannelMsg::Eof | ChannelMsg::Close) | None => {
                                let status_payload = SshStatusPayload {
                                    session_id: reader_session_id.clone(),
                                    status: ConnectionStatus::Disconnected,
                                };
                                let _ = reader_app.emit("ssh:status", &status_payload);
                                break;
                            }
                            _ => {}
                        }
                    }
                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(SessionCmd::Data(data)) => {
                                if task_log.is_active() {
                                    if let Ok(text) = std::str::from_utf8(&data) {
                                        task_log.on_input(text);
                                    }
                                }
                                let data = in_conv.encode_from_utf8(&data, false);
                                let _ = channel.data(&data[..]).await;
                            }
                            Some(SessionCmd::Resize { cols, rows }) => {
                                let _ = channel.window_change(cols, rows, 0, 0).await;
                            }
                            Some(SessionCmd::SetEncoding { label }) => {
                                out_conv = StreamConverter::new(&label);
                                in_conv = StreamConverter::new(&label);
                            }
                            Some(SessionCmd::Eof) | None => {
                                let _ = channel.eof().await;
                                let _ = channel.close().await;
                                break;
                            }
                        }
                    }
                }
            }
        });

        let _ = app_handle.emit(
            "ssh:status",
            &SshStatusPayload {
                session_id: session_id.clone(),
                status: ConnectionStatus::Connected,
            },
        );

        Ok(Self {
            handle,
            cmd_tx,
            reader_task,
            session_id,
            split_config: SplitConfig { default_shell },
            jump_handles,
            current_encoding,
            log,
        })
    }

    /// Open a new PTY channel on the same authenticated connection.
    /// Used for split panes — avoids re-authentication.
    #[allow(clippy::too_many_arguments)]
    pub async fn open_split_pty(
        handle: Arc<Mutex<Handle<SshClientHandler>>>,
        jump_handles: Arc<Vec<Handle<SshClientHandler>>>,
        session_id: String,
        cols: u32,
        rows: u32,
        app_handle: AppHandle,
        default_shell: Option<String>,
        settings: SessionSettings,
        log: SessionLogContext,
    ) -> Result<Self, SshError> {
        let channel = handle
            .lock()
            .await
            .channel_open_session()
            .await
            .map_err(|e| SshError::ChannelError(e.to_string()))?;

        channel
            .request_pty(false, &settings.term, cols, rows, 0, 0, &[])
            .await
            .map_err(|e| SshError::ChannelError(e.to_string()))?;

        // LANG environment variable (best-effort — see `open_pty`).
        if !settings.lang.is_empty() {
            let _ = channel.set_env(false, "LANG", settings.lang.clone()).await;
        }

        if let Some(shell) = &default_shell {
            channel
                .exec(false, shell.as_bytes())
                .await
                .map_err(|e| SshError::ChannelError(e.to_string()))?;
        } else {
            channel
                .request_shell(false)
                .await
                .map_err(|e| SshError::ChannelError(e.to_string()))?;
        }

        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<SessionCmd>();

        let reader_session_id = session_id.clone();
        let reader_app = app_handle.clone();

        // Per-direction converters (no-op when the encoding is UTF-8).
        let mut out_conv = StreamConverter::new(&settings.encoding);
        let mut in_conv = StreamConverter::new(&settings.encoding);

        // Runtime encoding record (shared with `set_encoding`).
        let current_encoding = Arc::new(std::sync::RwLock::new(settings.encoding.clone()));

        // Split panes start logging when their source pane is logging (the
        // manager resolves this into `auto_start`). Same capture-the-banner
        // ordering as `open_pty`.
        if let Some(options) = log.auto_start.clone() {
            let _ = log.logger.start(options, &log.host, &log.user);
        }

        // Same clone-not-move reasoning as `open_pty`.
        let task_log = log.logger.clone();

        let reader_task = tokio::spawn(async move {
            let mut channel = channel;
            loop {
                tokio::select! {
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { data }) => {
                                let data = out_conv.decode_to_utf8(&data);
                                if task_log.is_active() {
                                    if let Ok(text) = std::str::from_utf8(&data) {
                                        task_log.on_output(text);
                                    }
                                }
                                let payload = SshOutputPayload {
                                    session_id: reader_session_id.clone(),
                                    data,
                                };
                                let _ = reader_app.emit("ssh:output", &payload);
                            }
                            Some(ChannelMsg::ExtendedData { data, .. }) => {
                                let data = out_conv.decode_to_utf8(&data);
                                if task_log.is_active() {
                                    if let Ok(text) = std::str::from_utf8(&data) {
                                        task_log.on_output(text);
                                    }
                                }
                                let payload = SshOutputPayload {
                                    session_id: reader_session_id.clone(),
                                    data,
                                };
                                let _ = reader_app.emit("ssh:output", &payload);
                            }
                            Some(ChannelMsg::Eof | ChannelMsg::Close) | None => {
                                let status_payload = SshStatusPayload {
                                    session_id: reader_session_id.clone(),
                                    status: ConnectionStatus::Disconnected,
                                };
                                let _ = reader_app.emit("ssh:status", &status_payload);
                                break;
                            }
                            _ => {}
                        }
                    }
                    cmd = cmd_rx.recv() => {
                        match cmd {
                            Some(SessionCmd::Data(data)) => {
                                if task_log.is_active() {
                                    if let Ok(text) = std::str::from_utf8(&data) {
                                        task_log.on_input(text);
                                    }
                                }
                                let data = in_conv.encode_from_utf8(&data, false);
                                let _ = channel.data(&data[..]).await;
                            }
                            Some(SessionCmd::Resize { cols, rows }) => {
                                let _ = channel.window_change(cols, rows, 0, 0).await;
                            }
                            Some(SessionCmd::SetEncoding { label }) => {
                                out_conv = StreamConverter::new(&label);
                                in_conv = StreamConverter::new(&label);
                            }
                            Some(SessionCmd::Eof) | None => {
                                let _ = channel.eof().await;
                                let _ = channel.close().await;
                                break;
                            }
                        }
                    }
                }
            }
        });

        let _ = app_handle.emit(
            "ssh:status",
            &SshStatusPayload {
                session_id: session_id.clone(),
                status: ConnectionStatus::Connected,
            },
        );

        Ok(Self {
            handle,
            cmd_tx,
            reader_task,
            session_id,
            split_config: SplitConfig { default_shell },
            // Share the parent's ProxyJump tunnel chain so it stays alive for as
            // long as this split pane lives, independent of the parent session.
            jump_handles,
            current_encoding,
            log,
        })
    }

    /// Return the shared Handle so the SFTP layer can lock it briefly to open
    /// its own channel on the same authenticated connection.
    pub fn ssh_handle(&self) -> Arc<Mutex<Handle<SshClientHandler>>> {
        self.handle.clone()
    }

    /// Return the shared ProxyJump tunnel chain so a split pane can keep the same
    /// tunnel alive for its own lifetime. Empty for a direct connection.
    pub fn jump_handles(&self) -> Arc<Vec<Handle<SshClientHandler>>> {
        self.jump_handles.clone()
    }

    /// Return the config needed to open additional split channels.
    pub fn host_config(&self) -> SplitConfig {
        self.split_config.clone()
    }

    /// Write raw bytes into the PTY channel (user keystrokes).
    pub async fn send_input(&self, data: &[u8]) -> Result<(), SshError> {
        self.cmd_tx
            .send(SessionCmd::Data(data.to_vec()))
            .map_err(|_| SshError::ChannelError("session task closed".to_string()))
    }

    /// Resize the remote PTY.
    pub async fn resize_pty(&self, cols: u32, rows: u32) -> Result<(), SshError> {
        self.cmd_tx
            .send(SessionCmd::Resize { cols, rows })
            .map_err(|_| SshError::ChannelError("session task closed".to_string()))
    }

    /// Switch the character encoding at runtime. The converters live inside
    /// the reader/writer task, so the switch is delivered as a command and
    /// takes effect on the next chunk in each direction. The label is also
    /// recorded synchronously (in `current_encoding`) so a split pane created
    /// afterwards inherits the live encoding, not the global default.
    pub fn set_encoding(&self, label: &str) -> Result<(), SshError> {
        if let Ok(mut cur) = self.current_encoding.write() {
            *cur = label.to_string();
        }
        self.cmd_tx
            .send(SessionCmd::SetEncoding {
                label: label.to_string(),
            })
            .map_err(|_| SshError::ChannelError("session task closed".to_string()))
    }

    /// The encoding this session is currently transcoding with.
    pub fn encoding(&self) -> String {
        self.current_encoding
            .read()
            .map(|e| e.clone())
            .unwrap_or_else(|_| "utf-8".to_string())
    }

    /// The session-log context (logger handle + naming metadata).
    pub fn log(&self) -> &SessionLogContext {
        &self.log
    }

    /// Gracefully disconnect: stop the session log (flushing it), then signal
    /// EOF to the background task.
    pub async fn disconnect(self) -> Result<(), SshError> {
        self.log.logger.stop();
        let _ = self.cmd_tx.send(SessionCmd::Eof);
        let _ = self.reader_task.await;
        Ok(())
    }
}
