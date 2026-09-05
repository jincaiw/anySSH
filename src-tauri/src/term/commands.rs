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
    kind: TermKind,
    encoding: &str,
    session_id: String,
    app_handle: AppHandle,
    log: SessionLogContext,
) -> String {
    let handle = spawn_session(session_id.clone(), kind, io, app_handle, encoding, log);
    state.insert(session_id.clone(), handle);
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
    let settings = session_settings_from_db(&db);

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
            )?;
            let user = std::env::var("USER")
                .or_else(|_| std::env::var("USERNAME"))
                .unwrap_or_default();
            let log = log_context(&db, "localhost".to_string(), user);
            let session_id = SessionId::new().0;
            Ok(finish_open(
                &state,
                Box::new(io),
                TermKind::Local,
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
            encoding,
        } => {
            let encoding = encoding.unwrap_or_else(|| settings.encoding.clone());
            let io = TelnetIo::connect(&host, port, login_script, cols as u16, rows as u16).await?;
            let log = log_context(&db, format!("{host}:{port}"), "telnet".to_string());
            let session_id = SessionId::new().0;
            Ok(finish_open(
                &state,
                Box::new(io),
                TermKind::Telnet,
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
                TermKind::Serial,
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
