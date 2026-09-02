// ─── errors (en-US) ─────────────────────────────────────────────────────────
//
// Backend `{ kind, message }` error kinds mapped to user-facing copy.
//
// Keys are written WITHOUT the `errors.` prefix — the locale index adds it.
//
// One key per `kind` string the Rust backend can emit. Several error enums
// (SSH / SFTP / SCP / S3 / DB / vault / backup) reuse the same discriminant —
// `session_not_found`, `not_found`, `io_error`, `channel_error` … — so the copy
// here is deliberately protocol-neutral. `src/lib/backend-errors.ts` splits the
// English prefix off the raw `message` and re-attaches it in the UI language,
// which keeps the OS/rust diagnostic tail (`Connection refused (os error 61)`)
// intact for support.

export default {
  // ─── SSH (src-tauri/src/types/error.rs) ───────────────────────────────────
  connection_failed: "Connection failed",
  authentication_failed: "Authentication failed",
  session_not_found: "Session not found",
  ssh_session_not_found: "SSH session not found",
  channel_error: "Channel error",
  key_parse_error: "Key parse error",
  io_error: "I/O error",
  already_disconnected: "Session already disconnected",
  cancelled: "Connection cancelled",

  // ─── SFTP / SCP ───────────────────────────────────────────────────────────
  protocol_error: "Protocol error",
  remote_io_error: "Remote I/O error",
  local_io_error: "Local I/O error",
  remote_error: "Remote error",
  command_failed: "Command failed",
  parse_error: "Parse error",
  transfer_cancelled: "Transfer cancelled",
  invalid_path: "Invalid path",
  permission_denied: "Permission denied",
  not_found: "Not found",

  // ─── S3 ───────────────────────────────────────────────────────────────────
  operation_error: "S3 error",
  credential_error: "Invalid credentials",

  // ─── Database / vault / backup ────────────────────────────────────────────
  sqlite: "Database error",
  init_error: "Failed to initialize database",
  validation: "Invalid value",
  keychain: "Keychain error",
  invalid_data: "Invalid credential data",
  db: "Database error",
  decrypt: "Incorrect password, or the backup file is corrupt",
  crypto: "Crypto error",
  format: "Not a valid anySSH backup file",
  io: "I/O error",

  // ─── Generic fallbacks ────────────────────────────────────────────────────
  unknown: "Something went wrong",
  invokeFailed: "The request failed",
} as const;
