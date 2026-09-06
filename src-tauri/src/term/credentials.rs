//! Telnet scripts are credentials, including commands which may contain tokens.
//! Store the whole script in the existing encrypted vault under the host ID;
//! SQLite and backups without credentials contain only that reference.
use super::{LoginScriptStep, TermError};
use crate::{
    db::{DbError, SavedHost},
    vault::{self, StoredCredential, VaultError},
};

#[derive(Debug)]
pub struct CredentialChange {
    host_id: String,
    previous: Option<StoredCredential>,
    changed: bool,
}

impl CredentialChange {
    fn unchanged(host_id: &str) -> Self {
        Self {
            host_id: host_id.to_string(),
            previous: None,
            changed: false,
        }
    }

    /// Restore the vault state that existed before [`protect_script`].
    pub fn rollback(self) -> Result<(), DbError> {
        if !self.changed {
            return Ok(());
        }
        match self.previous {
            Some(credential) => vault::save_credential(&self.host_id, &credential),
            None => vault::delete_credential(&self.host_id),
        }
        .map_err(vault_error)
    }
}

fn vault_error(error: VaultError) -> DbError {
    DbError::InitError(error.to_string())
}

fn current_credential(id: &str) -> Result<Option<StoredCredential>, DbError> {
    match vault::get_credential(id) {
        Ok(credential) => Ok(Some(credential)),
        Err(VaultError::NotFound(_)) => Ok(None),
        Err(error) => Err(vault_error(error)),
    }
}

pub fn load_script(id: &str) -> Result<Vec<LoginScriptStep>, TermError> {
    match vault::get_credential(id).map_err(|e| TermError::Io(e.to_string()))? {
        StoredCredential::Password { password } => serde_json::from_str(&password)
            .map_err(|_| TermError::InvalidParams("saved login script is invalid".into())),
        _ => Err(TermError::InvalidParams(
            "saved login script is unavailable".into(),
        )),
    }
}

pub fn protect_script(host: &mut SavedHost) -> Result<CredentialChange, DbError> {
    if host.kind.as_deref() != Some("telnet") {
        return Ok(CredentialChange::unchanged(&host.id));
    }
    let Some(json) = &host.params_json else {
        return Ok(CredentialChange::unchanged(&host.id));
    };
    let mut params: serde_json::Value =
        serde_json::from_str(json).map_err(|e| DbError::InitError(e.to_string()))?;
    let script = if let Some(script) = params.get("loginScript") {
        Some(
            serde_json::from_value::<Vec<LoginScriptStep>>(script.clone())
                .map_err(|e| DbError::InitError(e.to_string()))?,
        )
    } else if let Some(id) = params
        .get("scriptCredentialId")
        .and_then(|v| v.as_str())
        .filter(|id| *id != host.id)
    {
        Some(load_script(id).map_err(|e| DbError::InitError(e.to_string()))?)
    } else {
        None
    };
    if let Some(script) = script {
        let previous = current_credential(&host.id)?;
        if script.is_empty() {
            let object = params
                .as_object_mut()
                .ok_or_else(|| DbError::InitError("invalid protocol parameters".into()))?;
            object.remove("loginScript");
            object.remove("scriptCredentialId");
            host.params_json = Some(params.to_string());
            vault::delete_credential(&host.id).map_err(vault_error)?;
            return Ok(CredentialChange {
                host_id: host.id.clone(),
                previous,
                changed: true,
            });
        }
        let password =
            serde_json::to_string(&script).map_err(|e| DbError::InitError(e.to_string()))?;
        vault::save_credential(&host.id, &StoredCredential::Password { password })
            .map_err(|e| DbError::InitError(e.to_string()))?;
        params
            .as_object_mut()
            .ok_or_else(|| DbError::InitError("invalid protocol parameters".into()))?
            .remove("loginScript");
        params["scriptCredentialId"] = host.id.clone().into();
        host.params_json = Some(params.to_string());
        return Ok(CredentialChange {
            host_id: host.id.clone(),
            previous,
            changed: true,
        });
    }
    Ok(CredentialChange::unchanged(&host.id))
}
