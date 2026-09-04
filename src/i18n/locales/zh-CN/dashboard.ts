// ─── dashboard (zh-CN) ───────────────────────────────────────────────────────
//
// Hosts dashboard: cards, groups, recent connections, import.
//
// Keys are written WITHOUT the `dashboard.` prefix — the locale index adds it.
// Must mirror ../en-US/dashboard.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).

export default {
  // ─── Page chrome ────────────────────────────────────────────────────────
  title: "主机",
  subtitle: "管理已保存的服务器，用分组整理它们，一键连接",
  "search.placeholder": "搜索主机...",
  "search.ariaLabel": "搜索主机",
  "heading.groups": "分组",
  "heading.hosts": "主机",
  "heading.cloudStorage": "云存储",

  // ─── Action buttons ─────────────────────────────────────────────────────
  "action.newServer": "新建服务器",
  "action.newServerHint": "新建服务器（Cmd+T）",
  "action.newS3": "新建 S3",
  "action.newS3Hint": "新建 S3 连接",
  "action.newGroup": "新建分组",
  "action.import": "导入",
  "action.importHint": "从 SSH 配置导入",
  "action.allHosts": "全部主机",
  "action.backToAllHosts": "返回全部主机",

  // ─── Feedback ───────────────────────────────────────────────────────────
  saving: "保存中…",
  duplicateSuffix: "（副本）",
  "error.loadHosts": "加载主机失败",
  "error.loadGroups": "加载分组失败",
  "toast.reorderHostsFailed": "无法保存新的主机顺序 — 已还原。",
  "toast.reorderGroupsFailed": "无法保存新的分组顺序 — 已还原。",
  "toast.reorderS3Failed": "无法保存新的连接顺序 — 已还原。",

  // ─── Empty states ───────────────────────────────────────────────────────
  "empty.noMatch": "没有匹配“{query}”的主机",
  "empty.noHostsInGroup": "该分组下还没有主机。",
  "empty.noSavedHosts": "还没有保存的主机。连接到服务器后即可保存在这里。",

  // ─── Connection dialog ──────────────────────────────────────────────────
  "connect.connecting": "正在连接...",
  "connect.failedTitle": "连接失败",
  "connect.fallback": "连接失败。请检查主机、端口和凭据。",
  "connect.fallbackShort": "连接失败。",
  "connect.s3Fallback": "S3 连接失败",
  "connect.passwordPromptTitle": "身份认证",
  "connect.passwordLabel": "密码",
  "connect.passwordPlaceholder": "请输入密码",
  "connect.passwordRemember": "记住密码",
  "connect.passwordDualFactorHint": "双因子堡垒机：输入 静态密码+动态码（直接拼接，无空格）。若尚未收到短信验证码，可先留空密码连接一次以触发短信下发",
  "connect.passwordPromptArmedHint": "已触发短信下发：请输入 静态密码+动态码（直接拼接，无空格）。未收到短信？点击“重新发送短信”",
  "connect.passwordResend": "重新发送短信",
  "connect.passwordDisableAuto": "不再自动触发短信",
  "connect.dualFactorDisabled": "已关闭该主机的自动短信触发",
  "connect.dualFactorTriggerFailed": "无法连接堡垒机，短信验证码可能未下发。请检查网络与主机可达性后重试",
  "connect.dualFactorTriggered": "双因子触发已发送：如已收到短信验证码，请点「重试」并输入 静态密码+动态码（直接拼接，无空格）",
  "connect.passwordShow": "显示密码",
  "connect.passwordHide": "隐藏密码",
  "connect.passwordSubmit": "连接",
  "connect.passwordCancel": "取消",

  // ─── Host card ──────────────────────────────────────────────────────────
  "hostCard.connectTo": "连接到 {name}",
  "hostCard.ping": "Ping",
  "hostCard.pingAria": "Ping {name}",
  "hostCard.terminal": "终端",
  "hostCard.explorer": "文件",
  "hostCard.openTerminalFor": "打开 {name} 的终端",
  "hostCard.openExplorerFor": "打开 {name} 的文件管理器",
  "hostCard.subtitle": "SSH，{username}",
  "hostCard.tunnelsThrough": "通过 {name} 建立隧道",
  "hostCard.via": "经由 {name}",
  "hostCard.deleteTitle": "删除该主机？",
  "hostCard.deleteMessage": "该主机将被永久删除。",

  // ─── Health check (HostHealthStatus discriminants) ──────────────────────
  "health.checking": "正在 Ping...",
  "health.reachable": "SSH 可达{latency}",
  "health.dnsFailed": "DNS 解析失败",
  "health.portClosed": "端口不可达",
  "health.sshFailed": "SSH 失败",
  "health.failed": "Ping 失败",

  // ─── Environment badges ─────────────────────────────────────────────────
  "env.production": "生产",
  "env.staging": "预发",
  "env.dev": "开发",
  "env.testing": "测试",

  // ─── OS labels ──────────────────────────────────────────────────────────
  "os.linux": "Linux",
  "os.macos": "macOS",
  "os.windows": "Windows",
  "os.freebsd": "FreeBSD",

  // ─── S3 card ────────────────────────────────────────────────────────────
  "s3Card.explore": "浏览",
  "s3Card.deleteTitle": "删除该 S3 连接？",
  "s3Card.deleteMessage": "该连接将被永久删除。",

  // ─── Group card ─────────────────────────────────────────────────────────
  "group.hostCount_one": "{count} 台主机",
  "group.hostCount_other": "{count} 台主机",
  "group.delete": "删除分组",

  // ─── Group modal ────────────────────────────────────────────────────────
  "groupModal.titleEdit": "编辑分组",
  "groupModal.namePlaceholder": "例如：生产、预发、家庭实验室",
  "groupModal.icon": "图标",
  "groupModal.colorAria": "颜色 {color}",
  "groupModal.create": "创建分组",
  "groupModal.errorNameRequired": "请输入分组名称",
  "groupModal.errorSaveFailed": "保存分组失败",

  // ─── Group delete dialog ────────────────────────────────────────────────
  "groupDelete.title": "删除“{name}”？",
  "groupDelete.confirmWithHosts": "删除分组及主机",
  "groupDelete.empty": "该空分组将被永久删除。",
  "groupDelete.contains_one": "该分组包含 {count} 台主机。",
  "groupDelete.contains_other": "该分组包含 {count} 台主机。",
  "groupDelete.alsoDelete_one": "同时删除该分组中的 {count} 台主机",
  "groupDelete.alsoDelete_other": "同时删除该分组中的 {count} 台主机",
  "groupDelete.uncheckedHint": "不勾选：主机将被移出该分组",

  // ─── Recent connections ─────────────────────────────────────────────────
  "recent.heading": "最近连接",
  "recent.ariaLabel": "最近连接",
  "recent.reconnectTo": "重新连接到 {name}（{username}@{host}:{port}）",

  // ─── SSH config import ──────────────────────────────────────────────────
  "import.title": "导入 SSH 配置",
  "import.done": "完成",
  "import.importing": "正在导入…",
  "import.submit_one": "导入 {count} 台主机",
  "import.submit_other": "导入 {count} 台主机",
  "import.result_one": "已导入 {count} 台主机",
  "import.result_other": "已导入 {count} 台主机",
  "import.skipped": "跳过 {count} 项",
  "import.scanning": "正在扫描 SSH 配置...",
  "import.browse": "选择配置文件",
  "import.noHosts": "SSH 配置中没有找到主机",
  "import.tryAnother": "换个文件试试",
  "import.change": "更改",
  "import.all": "全选",
  "import.selected": "已选择 {total} 项中的 {selected} 项",
  "import.badgePattern": "通配",
  "import.badgeExists": "已存在",
  "import.errorParse": "解析 SSH 配置失败",
  "import.errorSave": "导入失败",
  "import.browseTitle": "选择 SSH 配置文件",
};
