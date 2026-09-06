use async_trait::async_trait;
use russh::client;
use russh_keys::key::PublicKey;
use std::sync::{Arc, Mutex};

/// Handles server events for a single SSH connection.
pub struct SshClientHandler {
    expected: Option<String>,
    presented: Arc<Mutex<Option<String>>>,
    accept_any: bool,
}

impl SshClientHandler {
    pub fn verifying(expected: Option<String>) -> (Self, Arc<Mutex<Option<String>>>) {
        let presented = Arc::new(Mutex::new(None));
        (
            Self {
                expected,
                presented: Arc::clone(&presented),
                accept_any: false,
            },
            presented,
        )
    }

    /// Only for unauthenticated health probes, which never send credentials.
    pub fn accept_any() -> Self {
        Self {
            expected: None,
            presented: Arc::new(Mutex::new(None)),
            accept_any: true,
        }
    }
}

#[async_trait]
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    /// Called when the server presents its host key. Authenticated connection
    /// paths accept only the fingerprint previously approved by the user.
    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = format!("SHA256:{}", server_public_key.fingerprint());
        if let Ok(mut presented) = self.presented.lock() {
            *presented = Some(fingerprint.clone());
        }
        Ok(self.accept_any || self.expected.as_deref() == Some(fingerprint.as_str()))
    }
}
