use russh::client;
use russh::keys::{HashAlg, PublicKeyOrCertificate};
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

// russh 0.63 declares `Handler` as a native async-trait (RPITIT), so the
// `#[async_trait]` macro is gone — the impl is a plain `impl` block.
impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    /// Called when the server presents its host key. Authenticated connection
    /// paths accept only the fingerprint previously approved by the user.
    ///
    /// The argument is `PublicKeyOrCertificate` (0.63.0+): a host may send an
    /// OpenSSH certificate instead of a bare key. Fingerprints are taken over
    /// the plain public key in both cases, so trust decisions stay identical.
    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        // `Fingerprint`'s `Display` already carries the `SHA256:` prefix and
        // the encoding matches russh 0.46's, so already-trusted host entries
        // in SQLite keep matching after the upgrade.
        let fingerprint = server_public_key
            .public_key()
            .fingerprint(HashAlg::Sha256)
            .to_string();
        if let Ok(mut presented) = self.presented.lock() {
            *presented = Some(fingerprint.clone());
        }
        Ok(self.accept_any || self.expected.as_deref() == Some(fingerprint.as_str()))
    }
}
