//! Tauri commands for the term layer (`term_open` / `term_send` /
//! `term_resize` / `term_set_encoding` / `term_close`) plus the serial
//! helpers (`serial_list_ports` / `serial_start_hotplug`).
//!
//! Live backends: `Local` (portable-pty, P1a), `Telnet` (self-built IAC
//! client, P1b) and `Serial` (serialport, P2).

use std::sync::Arc;

use tauri::{AppHandle, State};

use super::local::LocalPtyIo;
use super::serial::SerialIo;
use super::telnet::TelnetIo;
use super::{TermError, TermIo, TermKind, TermManager, TermParams};
use crate::db::HostDb;
use crate::ssh::encoding::session_settings_from_db;
use crate::ssh::sessionlog::{self, SessionLogContext, SessionLogger};
use crate::term::spawn_session;
use crate::types::SessionId;

/// Session-log context for a term session: user naming metadata plus the
/// global auto-record setting (same source the SSH layer reads; term
/// sessions have no per-host bookmark preset).
fn log_context(db: &HostDb, host: String, user: String) -> SessionLogContext {
    let auto_start = if sessionlog::session_log_enabled_from_db(db) {
        Some(sessionlog::session_log_options_from_db(db))
    } else {
        None
    };
    SessionLogContext {
        logger: SessionLogger::new(),
        host,
        user,
        auto_start,
    }
}

/// Register a connected backend with the manager and return its id.
fn finish_open(
    state: &TermManager,
    io: Box<dyn TermIo>,
    backend: (TermKind, TermParams),
    encoding: &str,
    session_id: String,
    app_handle: AppHandle,
    log: SessionLogContext,
) -> String {
    let handle = spawn_session(session_id.clone(), backend.0, io, app_handle, encoding, log);
    state.insert(session_id.clone(), handle, backend.1);
    session_id
}

#[tauri::command]
pub async fn term_open(
    params: TermParams,
    cols: u32,
    rows: u32,
    state: State<'_, TermManager>,
    db: State<'_, Arc<HostDb>>,
    app_handle: AppHandle,
) -> Result<String, TermError> {
    // Global terminal settings (encoding default comes from the same
    // settings the SSH layer reads; per-session override wins).
    if cols == 0 || rows == 0 || cols > u16::MAX as u32 || rows > u16::MAX as u32 {
        return Err(TermError::InvalidParams(
            "terminal dimensions must be between 1 and 65535".into(),
        ));
    }
    let selected_encoding = match &params {
        TermParams::Local { encoding, .. }
        | TermParams::Telnet { encoding, .. }
        | TermParams::Serial { encoding, .. } => encoding,
    };
    if let Some(label) = selected_encoding {
        if encoding_rs::Encoding::for_label(label.as_bytes()).is_none() {
            return Err(TermError::InvalidEncoding(label.clone()));
        }
    }
    let settings = session_settings_from_db(&db);
    let saved_params = params.clone();

    match params {
        TermParams::Local {
            shell,
            start_directory,
            encoding,
        } => {
            let encoding = encoding.unwrap_or_else(|| settings.encoding.clone());
            let io = LocalPtyIo::open(
                shell.as_deref(),
                start_directory.as_deref(),
                cols as u16,
                rows as u16,
                &settings.term,
            )?;
            let user = std::env::var("USER")
                .or_else(|_| std::env::var("USERNAME"))
                .unwrap_or_default();
            let log = log_context(&db, "localhost".to_string(), user);
            let session_id = SessionId::new().0;
            Ok(finish_open(
                &state,
                Box::new(io),
                (TermKind::Local, saved_params),
                &encoding,
                session_id,
                app_handle,
                log,
            ))
        }
        TermParams::Telnet {
            host,
            port,
            login_script,
            script_credential_id,
            encoding,
        } => {
            let encoding = encoding.unwrap_or_else(|| settings.encoding.clone());
            let login_script = if let Some(id) = script_credential_id {
                Some(
                    tokio::task::spawn_blocking(move || crate::term::credentials::load_script(&id))
                        .await
                        .map_err(|e| TermError::Io(e.to_string()))??,
                )
            } else {
                login_script
            };
            let io = TelnetIo::connect(&host, port, login_script, cols as u16, rows as u16).await?;
            let log = log_context(&db, format!("{host}:{port}"), "telnet".to_string());
            let session_id = SessionId::new().0;
            Ok(finish_open(
                &state,
                Box::new(io),
                (TermKind::Telnet, saved_params),
                &encoding,
                session_id,
                app_handle,
                log,
            ))
        }
        TermParams::Serial {
            port,
            baud,
            data_bits,
            stop_bits,
            parity,
            flow_control,
            encoding,
        } => {
            let encoding = encoding.unwrap_or_else(|| settings.encoding.clone());
            let io = SerialIo::open(&port, baud, data_bits, stop_bits, &parity, &flow_control)?;
            let log = log_context(&db, port.clone(), "serial".to_string());
            let session_id = SessionId::new().0;
            Ok(finish_open(
                &state,
                Box::new(io),
                (TermKind::Serial, saved_params),
                &encoding,
                session_id,
                app_handle,
                log,
            ))
        }
    }
}

#[tauri::command]
pub async fn term_send(
    session_id: String,
    data: Vec<u8>,
    state: State<'_, TermManager>,
) -> Result<(), TermError> {
    state.send(&session_id, &data)
}

#[tauri::command]
pub async fn term_resize(
    session_id: String,
    cols: u32,
    rows: u32,
    state: State<'_, TermManager>,
) -> Result<(), TermError> {
    state.resize(&session_id, cols, rows)
}

/// Switch the character encoding of a live term session at runtime
/// (runtime-only, never persisted — same semantics as
/// `ssh_set_session_encoding`).
#[tauri::command]
pub async fn term_set_encoding(
    session_id: String,
    encoding: String,
    state: State<'_, TermManager>,
) -> Result<(), TermError> {
    state.set_encoding(&session_id, &encoding)
}

#[tauri::command]
pub async fn term_close(
    session_id: String,
    state: State<'_, TermManager>,
) -> Result<(), TermError> {
    match state.close(&session_id).await {
        Some(_) => Ok(()),
        None => Err(TermError::SessionNotFound(session_id)),
    }
}

// ---------------------------------------------------------------------------
// Serial helpers (P2)
// ---------------------------------------------------------------------------

/// Enumerate serial ports with USB identity metadata (connect dialog).
#[tauri::command]
pub async fn serial_list_ports() -> Result<Vec<super::serial::PortInfo>, TermError> {
    // Blocking syscalls, but a few ms — spawn_blocking keeps the runtime
    // clean anyway.
    tokio::task::spawn_blocking(super::serial::list_ports)
        .await
        .map_err(|e| TermError::Io(format!("join: {e}")))?
}

/// Start the port hotplug poller (once per process). Emits
/// `serial:ports-changed` with the new path list on any change; the open
/// dialog listens for it and refreshes.
#[tauri::command]
pub async fn serial_start_hotplug(app_handle: AppHandle) {
    super::serial::ensure_hotplug_watcher(app_handle);
}

#[tauri::command]
pub async fn term_start(
    session_id: String,
    state: State<'_, TermManager>,
) -> Result<(), TermError> {
    state.start(&session_id)
}

#[tauri::command]
pub async fn term_duplicate(
    source_session_id: String,
    reconnect: bool,
    state: State<'_, TermManager>,
    db: State<'_, Arc<HostDb>>,
    app_handle: AppHandle,
) -> Result<String, TermError> {
    let mut params = state.params(&source_session_id)?;
    if matches!(params, TermParams::Serial { .. }) && !reconnect {
        return Err(TermError::InvalidParams(
            "Serial ports cannot be shared by split panes".into(),
        ));
    }
    let encoding = state.encoding(&source_session_id)?;
    match &mut params {
        TermParams::Local {
            encoding: value, ..
        }
        | TermParams::Telnet {
            encoding: value, ..
        }
        | TermParams::Serial {
            encoding: value, ..
        } => *value = Some(encoding),
    }
    if reconnect {
        state.stop_for_reconnect(&source_session_id).await;
    }
    let result = term_open(params, 80, 24, state.clone(), db, app_handle).await;
    if reconnect && result.is_ok() {
        state.close(&source_session_id).await;
    }
    result
}

#[tauri::command]
pub async fn term_session_log_status(
    session_id: String,
    state: State<'_, TermManager>,
) -> Result<crate::ssh::commands::SessionLogStatus, TermError> {
    let entry = state
        .session_log_context(&session_id)
        .ok_or(TermError::SessionNotFound(session_id))?;
    Ok(crate::ssh::commands::SessionLogStatus {
        active: entry.logger.is_active(),
        path: entry
            .logger
            .info()
            .map(|i| i.path.to_string_lossy().to_string()),
        host: entry.host,
        user: entry.user,
    })
}

#[tauri::command]
pub async fn term_start_session_log(
    session_id: String,
    path: Option<String>,
    state: State<'_, TermManager>,
    db: State<'_, Arc<HostDb>>,
) -> Result<String, TermError> {
    let entry = state
        .session_log_context(&session_id)
        .ok_or(TermError::SessionNotFound(session_id))?;
    entry
        .logger
        .start(
            sessionlog::session_log_options_from_db(&db),
            &entry.host,
            &entry.user,
            path.map(std::path::PathBuf::from),
        )
        .map(|p| p.display().to_string())
        .map_err(|e| TermError::Io(e.to_string()))
}

#[tauri::command]
pub async fn term_stop_session_log(
    session_id: String,
    state: State<'_, TermManager>,
) -> Result<(), TermError> {
    state
        .session_log_context(&session_id)
        .ok_or(TermError::SessionNotFound(session_id))?
        .logger
        .stop();
    Ok(())
}
