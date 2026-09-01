// ─── errors (zh-CN) ─────────────────────────────────────────────────────────
//
// Backend `{ kind, message }` error kinds mapped to user-facing copy.
//
// Keys are written WITHOUT the `errors.` prefix — the locale index adds it.
// Must mirror ../en-US/errors.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).
//
// Protocol-neutral on purpose: several Rust error enums share a discriminant,
// so one key has to read correctly for SSH, SFTP, SCP and S3 alike. The raw
// diagnostic tail is preserved by src/lib/backend-errors.ts.

export default {
  // ─── SSH (src-tauri/src/types/error.rs) ───────────────────────────────────
  connection_failed: "连接失败",
  authentication_failed: "认证失败",
  session_not_found: "会话不存在",
  ssh_session_not_found: "SSH 会话不存在",
  channel_error: "通道错误",
  key_parse_error: "密钥解析错误",
  io_error: "I/O 错误",
  already_disconnected: "会话已断开",
  cancelled: "连接已取消",

  // ─── SFTP / SCP ───────────────────────────────────────────────────────────
  protocol_error: "协议错误",
  remote_io_error: "远端 I/O 错误",
  local_io_error: "本地 I/O 错误",
  remote_error: "远端错误",
  command_failed: "命令执行失败",
  parse_error: "解析错误",
  transfer_cancelled: "传输已取消",
  invalid_path: "路径无效",
  permission_denied: "权限不足",
  not_found: "未找到",

  // ─── S3 ───────────────────────────────────────────────────────────────────
  operation_error: "S3 错误",
  credential_error: "凭据无效",

  // ─── Database / vault / backup ────────────────────────────────────────────
  sqlite: "数据库错误",
  init_error: "数据库初始化失败",
  validation: "取值无效",
  keychain: "钥匙串错误",
  invalid_data: "凭据数据无效",
  db: "数据库错误",
  decrypt: "密码错误，或备份文件已损坏",
  crypto: "加密错误",
  format: "不是有效的 anySCP 备份文件",
  io: "I/O 错误",

  // ─── Generic fallbacks ────────────────────────────────────────────────────
  unknown: "出现错误",
  invokeFailed: "请求失败",
} as const;
