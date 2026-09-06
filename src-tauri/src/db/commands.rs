use std::sync::{Arc, LazyLock, Mutex};

use tauri::State;
use tokio::task;
use tracing::instrument;

use super::{ConnectionHistoryEntry, DbError, HostDb, HostGroup, RecentConnection, SavedHost};

/// Serializes host/database writes with their external vault mutations so a
/// failed validation cannot expose a credential from an uncommitted edit.
static HOST_WRITE_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn vault_error(error: crate::vault::VaultError) -> DbError {
    DbError::InitError(error.to_string())
}

fn credential_snapshot(id: &str) -> Result<Option<crate::vault::StoredCredential>, DbError> {
    match crate::vault::get_credential(id) {
        Ok(credential) => Ok(Some(credential)),
        Err(crate::vault::VaultError::NotFound(_)) => Ok(None),
        Err(error) => Err(vault_error(error)),
    }
}

fn restore_credential(
    id: &str,
    credential: Option<crate::vault::StoredCredential>,
) -> Result<(), DbError> {
    match credential {
        Some(credential) => crate::vault::save_credential(id, &credential),
        None => crate::vault::delete_credential(id),
    }
    .map_err(vault_error)
}

/// Persist (insert or update) a host entry.
///
/// ProxyJump cycles, self-references, and dangling tunnel-host targets are
/// rejected atomically with the write inside [`HostDb::save_host_validated`].
#[tauri::command]
#[instrument(skip(state, host), fields(id = %host.id))]
pub async fn save_host(mut host: SavedHost, state: State<'_, Arc<HostDb>>) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || {
        let _guard = HOST_WRITE_LOCK
            .lock()
            .map_err(|e| DbError::InitError(format!("host write lock poisoned: {e}")))?;
        let change = crate::term::credentials::protect_script(&mut host)?;
        if let Err(error) = db.save_host_validated(&host) {
            change.rollback()?;
            return Err(error);
        }
        Ok(())
    })
    .await
    .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Return all saved hosts, ordered by label.
#[tauri::command]
#[instrument(skip(state))]
pub async fn list_hosts(state: State<'_, Arc<HostDb>>) -> Result<Vec<SavedHost>, DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || {
        let _guard = HOST_WRITE_LOCK
            .lock()
            .map_err(|e| DbError::InitError(format!("host write lock poisoned: {e}")))?;
        let mut hosts = db.list_hosts()?;
        for host in &mut hosts {
            let previous = host.params_json.clone();
            let change = crate::term::credentials::protect_script(host)?;
            if host.params_json != previous {
                if let Err(error) = db.save_host_validated(host) {
                    change.rollback()?;
                    return Err(error);
                }
            }
        }
        Ok(hosts)
    })
    .await
    .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Permanently delete a saved host by its UUID string.
#[tauri::command]
#[instrument(skip(state), fields(id = %id))]
pub async fn delete_host(id: String, state: State<'_, Arc<HostDb>>) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || {
        let _guard = HOST_WRITE_LOCK
            .lock()
            .map_err(|e| DbError::InitError(format!("host write lock poisoned: {e}")))?;
        let previous = credential_snapshot(&id)?;
        crate::vault::delete_credential(&id).map_err(vault_error)?;
        if let Err(error) = db.delete_host(&id) {
            restore_credential(&id, previous)?;
            return Err(error);
        }
        Ok(())
    })
    .await
    .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Persist a manual host ordering produced by drag-and-drop on the dashboard.
///
/// `ordered_ids` is the full list of host ids in their new display order; each
/// host's `sort_order` is set to its position. Rolls back and returns
/// `DbError::NotFound` if any id is unknown (e.g. a host deleted concurrently).
#[tauri::command]
#[instrument(skip(state), fields(count = ordered_ids.len()))]
pub async fn reorder_hosts(
    ordered_ids: Vec<String>,
    state: State<'_, Arc<HostDb>>,
) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.reorder_hosts(&ordered_ids))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Look up a single host by its UUID string.  Returns `None` when not found.
#[tauri::command]
#[instrument(skip(state), fields(id = %id))]
pub async fn get_host(
    id: String,
    state: State<'_, Arc<HostDb>>,
) -> Result<Option<SavedHost>, DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.get_host(&id))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Create a new host group.
#[tauri::command]
#[instrument(skip(state), fields(id = %group.id))]
pub async fn create_group(group: HostGroup, state: State<'_, Arc<HostDb>>) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.create_group(&group))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Update an existing host group.
#[tauri::command]
#[instrument(skip(state), fields(id = %group.id))]
pub async fn update_group(group: HostGroup, state: State<'_, Arc<HostDb>>) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.update_group(&group))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Persist a manual group ordering produced by drag-and-drop on the dashboard.
///
/// `ordered_ids` is the full list of group ids in their new display order; each
/// group's `sort_order` is set to its position. Rolls back and returns
/// `DbError::NotFound` if any id is unknown (e.g. a group deleted concurrently).
#[tauri::command]
#[instrument(skip(state), fields(count = ordered_ids.len()))]
pub async fn reorder_groups(
    ordered_ids: Vec<String>,
    state: State<'_, Arc<HostDb>>,
) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.reorder_groups(&ordered_ids))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Return all host groups, ordered by sort_order then name.
#[tauri::command]
#[instrument(skip(state))]
pub async fn list_groups(state: State<'_, Arc<HostDb>>) -> Result<Vec<HostGroup>, DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.list_groups())
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Permanently delete a host group.  Member hosts are orphaned (their
/// `group_id` is set to NULL) rather than deleted.
#[tauri::command]
#[instrument(skip(state), fields(id = %id))]
pub async fn delete_group(id: String, state: State<'_, Arc<HostDb>>) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.delete_group(&id))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Delete a host group AND all hosts inside it.
#[tauri::command]
#[instrument(skip(state), fields(id = %id))]
pub async fn delete_group_with_hosts(
    id: String,
    state: State<'_, Arc<HostDb>>,
) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || {
        let _guard = HOST_WRITE_LOCK
            .lock()
            .map_err(|e| DbError::InitError(format!("host write lock poisoned: {e}")))?;
        let host_ids = db
            .list_hosts()?
            .into_iter()
            .filter(|host| host.group_id.as_deref() == Some(id.as_str()))
            .map(|host| host.id)
            .collect::<Vec<_>>();
        let snapshots = host_ids
            .iter()
            .map(|host_id| Ok((host_id.clone(), credential_snapshot(host_id)?)))
            .collect::<Result<Vec<_>, DbError>>()?;
        for (index, host_id) in host_ids.iter().enumerate() {
            if let Err(error) = crate::vault::delete_credential(host_id).map_err(vault_error) {
                for (restore_id, credential) in snapshots.iter().take(index) {
                    restore_credential(restore_id, credential.clone())?;
                }
                return Err(error);
            }
        }
        if let Err(error) = db.delete_group_with_hosts(&id) {
            for (host_id, credential) in snapshots {
                restore_credential(&host_id, credential)?;
            }
            return Err(error);
        }
        Ok(())
    })
    .await
    .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Record a successful connection for the given host id.  Also prunes the
/// history table to keep at most 50 rows.
#[tauri::command]
#[instrument(skip(state), fields(host_id = %host_id))]
pub async fn record_connection(
    host_id: String,
    state: State<'_, Arc<HostDb>>,
) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.record_connection(&host_id))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

/// Return the most-recent distinct connection per host, ordered newest-first.
/// `limit` caps the number of rows returned.
#[tauri::command]
#[instrument(skip(state), fields(limit = %limit))]
pub async fn list_recent_connections(
    limit: u32,
    state: State<'_, Arc<HostDb>>,
) -> Result<Vec<RecentConnection>, DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.list_recent_connections(limit))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

// ─── Connection History (full audit log) ──────────────────────────────────────

#[tauri::command]
#[instrument(skip(state))]
pub async fn list_connection_history(
    host_id: Option<String>,
    limit: u32,
    offset: u32,
    state: State<'_, Arc<HostDb>>,
) -> Result<Vec<ConnectionHistoryEntry>, DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.list_connection_history(host_id.as_deref(), limit, offset))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

#[tauri::command]
#[instrument(skip(state), fields(id = %id))]
pub async fn delete_connection_history_entry(
    id: i64,
    state: State<'_, Arc<HostDb>>,
) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.delete_connection_history_entry(id))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

// ─── App Settings ─────────────────────────────────────────────────────────────

#[tauri::command]
#[instrument(skip(state))]
pub async fn save_setting(
    key: String,
    value: String,
    state: State<'_, Arc<HostDb>>,
) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.save_setting(&key, &value))
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

#[tauri::command]
#[instrument(skip(state))]
pub async fn load_all_settings(
    state: State<'_, Arc<HostDb>>,
) -> Result<Vec<(String, String)>, DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || db.load_all_settings())
        .await
        .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}

// ─── Factory reset ─────────────────────────────────────────────────────────────

/// Permanently wipe ALL local data — saved hosts, groups, connection history,
/// snippets, port-forward rules, S3 connections, and app settings — plus their
/// stored credentials in the OS keychain. Returns anySSH to first-launch state.
///
/// This is irreversible; the frontend gates it behind a typed confirmation and
/// relaunches the app afterwards.
#[tauri::command]
#[instrument(skip(state))]
pub async fn factory_reset(state: State<'_, Arc<HostDb>>) -> Result<(), DbError> {
    let db = Arc::clone(&state);
    task::spawn_blocking(move || {
        let keys = db.factory_reset()?;
        // Purge secrets from the keychain. Best-effort: a missing entry is fine,
        // and one bad key shouldn't abort the rest — the rows are already gone.
        for host_id in &keys.host_ids {
            if let Err(e) = crate::vault::delete_credential(host_id) {
                tracing::warn!(host_id = %host_id, error = %e, "factory reset: keychain purge failed");
            }
        }
        for s3_id in &keys.s3_ids {
            let key = format!("s3:{s3_id}");
            if let Err(e) = crate::vault::delete_credential(&key) {
                tracing::warn!(key = %key, error = %e, "factory reset: keychain purge failed");
            }
        }
        Ok::<(), DbError>(())
    })
    .await
    .map_err(|e| DbError::InitError(format!("task panicked: {e}")))?
}
