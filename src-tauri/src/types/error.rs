use serde::Serialize;

/// All SSH-related errors surfaced to the frontend via Tauri command results.
#[derive(Debug, thiserror::Error)]
pub enum SshError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Authentication failed: {0}")]
    AuthenticationFailed(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Channel error: {0}")]
    ChannelError(String),

    #[error("Key parse error: {0}")]
    KeyParseError(String),

    #[error("I/O error: {0}")]
    IoError(String),

    #[allow(dead_code)]
    #[error("Session already disconnected")]
    AlreadyDisconnected,

    #[error("Invalid encoding: {0}")]
    InvalidEncoding(String),

    #[error("Connection cancelled")]
    Cancelled,
}

impl Serialize for SshError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("SshError", 2)?;
        let kind = match self {
            SshError::ConnectionFailed(_) => "connection_failed",
            SshError::AuthenticationFailed(_) => "authentication_failed",
            SshError::SessionNotFound(_) => "session_not_found",
            SshError::ChannelError(_) => "channel_error",
            SshError::KeyParseError(_) => "key_parse_error",
            SshError::IoError(_) => "io_error",
            SshError::AlreadyDisconnected => "already_disconnected",
            SshError::InvalidEncoding(_) => "invalid_encoding",
            SshError::Cancelled => "cancelled",
        };
        state.serialize_field("kind", kind)?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl From<std::io::Error> for SshError {
    fn from(e: std::io::Error) -> Self {
        SshError::IoError(e.to_string())
    }
}

impl From<russh::Error> for SshError {
    fn from(e: russh::Error) -> Self {
        let message = match &e {
            // russh's Display for this variant is just "No common algorithm",
            // which is useless for diagnosis. Surface the category and both
            // sides' algorithm lists so connection failures are actionable.
            russh::Error::NoCommonAlgo { kind, ours, theirs } => {
                let category = match kind {
                    russh::AlgorithmKind::Kex => "key exchange",
                    russh::AlgorithmKind::Key => "host key",
                    russh::AlgorithmKind::Cipher => "cipher",
                    russh::AlgorithmKind::Mac => "MAC",
                    russh::AlgorithmKind::Compression => "compression",
                };
                format!(
                    "No common {category} algorithm (client offers: {}; server offers: {})",
                    ours.join(", "),
                    theirs.join(", ")
                )
            }
            _ => e.to_string(),
        };
        SshError::ConnectionFailed(message)
    }
}

impl From<russh_keys::Error> for SshError {
    fn from(e: russh_keys::Error) -> Self {
        SshError::KeyParseError(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The frontend distinguishes a deliberate cancel from a failure by the
    /// serialized `kind`, so the wire shape is a contract.
    #[test]
    fn cancelled_serializes_with_a_distinct_kind() {
        let json = serde_json::to_value(SshError::Cancelled).expect("serialize");
        assert_eq!(json["kind"], "cancelled");
        assert_eq!(json["message"], "Connection cancelled");
    }
}
