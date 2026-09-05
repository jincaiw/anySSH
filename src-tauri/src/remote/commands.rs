//! Tauri commands for remote graphics sessions (P3: VNC; P4 adds RDP on
//! the same bridge). The commands only hand out `{ws_url, token}` — all
//! frame/input traffic flows over the WebSocket directly.

use crate::db::HostDb;
use std::sync::Arc;
use tauri::{AppHandle, State};

use super::bridge::{BridgeError, BridgeManager};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncOpenResult {
    pub ws_url: String,
    pub token: String,
}

/// Register a one-time `/vnc/<token>` route to the target server and return
/// the loopback WS endpoint for noVNC. Starts the bridge listener on first
/// use (lazily, 127.0.0.1 only).
#[tauri::command]
pub async fn vnc_open(
    host: String,
    port: u16,
    state: State<'_, BridgeManager>,
    _app_handle: AppHandle,
) -> Result<VncOpenResult, BridgeError> {
    let listener_port = state.ensure_listener().await?;
    let endpoint = state.open_vnc(host, port, listener_port);
    Ok(VncOpenResult {
        ws_url: endpoint.ws_url,
        token: endpoint.token,
    })
}

/// Tear down a VNC session (pending token or live connection).
#[tauri::command]
pub async fn vnc_close(token: String, state: State<'_, BridgeManager>) -> Result<(), BridgeError> {
    state.close_session(&token)
}

/// Register a one-time `/rdp/<token>` RDCleanPath route and return the
/// loopback WS endpoint for ironrdp-web (WASM). The WASM client performs
/// the RDCleanPath handshake; the bridge captures and forwards the server
/// certificate chain and enforces the fingerprint explicitly trusted in the DB.
#[tauri::command]
pub async fn rd_open(
    host: String,
    port: u16,
    db: State<'_, Arc<HostDb>>,
    state: State<'_, BridgeManager>,
    _app_handle: AppHandle,
) -> Result<VncOpenResult, BridgeError> {
    let fingerprint = db
        .get_setting(&certificate_key(&host, port))
        .map_err(|e| BridgeError::Rejected(e.to_string()))?
        .ok_or_else(|| BridgeError::Rejected("RDP certificate confirmation required".into()))?;
    let listener_port = state.ensure_listener().await?;
    let endpoint = state.open_rdp(host, port, listener_port, fingerprint);
    Ok(VncOpenResult {
        ws_url: endpoint.ws_url,
        token: endpoint.token,
    })
}

/// Tear down an RDP session (pending token or live tunnel).
#[tauri::command]
pub async fn rd_close(token: String, state: State<'_, BridgeManager>) -> Result<(), BridgeError> {
    state.close_session(&token)
}

fn certificate_key(host: &str, port: u16) -> String {
    format!(
        "rdp_certificate:{}:{port}",
        host.trim().to_ascii_lowercase()
    )
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CertificateInspection {
    fingerprint: String,
    trusted_fingerprint: Option<String>,
}
#[tauri::command]
pub async fn rd_inspect_certificate(
    host: String,
    port: u16,
    db: State<'_, Arc<HostDb>>,
) -> Result<CertificateInspection, BridgeError> {
    let fingerprint = super::rdp::inspect_certificate(&host, port).await?;
    let trusted_fingerprint = db
        .get_setting(&certificate_key(&host, port))
        .map_err(|e| BridgeError::Rejected(e.to_string()))?;
    Ok(CertificateInspection {
        fingerprint,
        trusted_fingerprint,
    })
}
#[tauri::command]
pub fn rd_trust_certificate(
    host: String,
    port: u16,
    fingerprint: String,
    db: State<'_, Arc<HostDb>>,
) -> Result<(), BridgeError> {
    if port == 0
        || host.trim().is_empty()
        || fingerprint.len() != 64
        || !fingerprint.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(BridgeError::Rejected(
            "invalid certificate fingerprint or address".into(),
        ));
    }
    db.save_setting(
        &certificate_key(&host, port),
        &fingerprint.to_ascii_lowercase(),
    )
    .map_err(|e| BridgeError::Rejected(e.to_string()))
}
