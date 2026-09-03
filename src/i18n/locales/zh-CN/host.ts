// ─── host (zh-CN) ───────────────────────────────────────────────────────
//
// Host edit / new-host modal and its auth, proxy and tunnel fields.
//
// Keys are written WITHOUT the `host.` prefix — the locale index adds it.
// Must mirror ../en-US/host.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).

export default {
  // ─── Modal shell ────────────────────────────────────────────────────────
  "title.new": "新建主机",
  "title.edit": "编辑主机",
  "action.connecting": "正在连接…",
  "action.saving": "正在保存…",
  "action.deleting": "正在删除…",
  loading: "正在加载主机数据",

  // ─── Sections ───────────────────────────────────────────────────────────
  "section.connection": "连接",
  "section.tunnel": "隧道",
  "section.advanced": "高级",
  "section.appearance": "外观",
  "section.notes": "备注",

  // ─── Field labels ───────────────────────────────────────────────────────
  "field.authType": "认证方式",
  "field.sshKey": "SSH 密钥",
  "field.passphrase": "密钥密码",
  "field.keepAlive": "保活间隔",
  "field.keepAliveSeconds": "（秒）",
  "field.defaultShell": "默认 Shell",
  "field.startupCommand": "启动命令",
  "field.startDirectory": "起始目录",
  "field.terminalEncoding": "终端编码",
  "field.lang": "语言环境 (LANG)",
  "field.environment": "环境",
  "field.osType": "系统类型",

  // ─── Field placeholders ─────────────────────────────────────────────────
  "field.labelPlaceholder": "例如：生产服务器",
  "field.hostPlaceholder": "192.168.1.1 或主机名",
  "field.usernamePlaceholder": "root",
  "field.selectKey": "选择密钥...",
  "field.passwordPrompt": "输入密码以连接",
  "field.passphrasePrompt": "没有则留空",
  "field.startDirectoryHint": "文件管理器打开时所在的目录，默认为主目录。",
  "field.followGlobal": "跟随全局（{value}）",
  "field.followGlobalNoValue": "跟随全局",
  "field.terminalHint": "LANG 用于设置远程会话的语言环境，留空跟随全局设置；堡垒机过滤环境变量时自动降级为启动注入。",

  // ─── Auth methods (AuthType discriminants) ──────────────────────────────
  "auth.password": "密码",
  "auth.privateKey": "私钥",

  // ─── Keychain credential ────────────────────────────────────────────────
  "credential.saved": "凭据已保存在系统钥匙串中",
  "credential.clearAria": "清除已保存的凭据",
  "credential.mask": "••••••••",
  "credential.browseTitle": "选择 SSH 私钥（Cmd+Shift+. 显示隐藏文件）",
  "credential.invalidKey": "无效的密钥文件",

  // ─── Group picker ───────────────────────────────────────────────────────
  "group.none": "无分组",

  // ─── Tunnel / ProxyJump ─────────────────────────────────────────────────
  "tunnel.toggle": "通过 SSH 隧道连接",
  "tunnel.host": "隧道主机",
  "tunnel.placeholder": "选择主机…",
  "tunnel.hintNoHosts": "请先创建另一台已保存的主机作为隧道跳板。",
  "tunnel.stale": "此前选择的隧道主机已不可用，请另选一台或关闭隧道。",
  "tunnel.noCandidates": "没有其他已保存的主机可作为隧道跳板，请先创建一台主机。",

  // ─── Appearance ─────────────────────────────────────────────────────────
  "appearance.autoTitle": "自动（按名称哈希）",
  "appearance.autoAria": "自动颜色",
  "appearance.auto": "自动",
  "appearance.colorAria": "颜色 {color}",

  // ─── Option lists (values are backend discriminants) ────────────────────
  "environment.production": "生产",
  "environment.staging": "预发",
  "environment.dev": "开发",
  "environment.testing": "测试",
  "os.auto": "自动",
  "os.linux": "Linux",
  "os.macos": "macOS",
  "os.windows": "Windows",
  "os.freebsd": "FreeBSD",

  // ─── Notes ──────────────────────────────────────────────────────────────
  "notes.placeholder": "关于这台服务器的备注...",

  // ─── Delete confirmation ────────────────────────────────────────────────
  "delete.question": "删除该主机？",

  // ─── Validation ─────────────────────────────────────────────────────────
  "validation.hostRequired": "请填写主机",
  "validation.usernameRequired": "请填写用户名",
  "validation.portRange": "端口必须在 1 到 65535 之间",
  "validation.keepAlive": "保活间隔必须是正数",
  "validation.langInvalid": "LANG 格式无效（示例：zh_CN.UTF-8）",
  "validation.noTunnelHosts": "没有其他已保存的主机可作为隧道跳板",
  "validation.selectTunnelHost": "请选择隧道主机，或关闭 SSH 隧道",

  // ─── Errors ─────────────────────────────────────────────────────────────
  "error.load": "加载主机数据失败",
  "error.save": "保存主机失败",
  "error.delete": "删除主机失败",
  "error.connect": "连接失败",
};
