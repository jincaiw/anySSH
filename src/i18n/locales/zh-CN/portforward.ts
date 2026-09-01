// ─── portforward (zh-CN) ───────────────────────────────────────────────────────
//
// 端口转发规则与隧道。
//
// 键名不带 `portforward.` 前缀 —— 由 locale index 统一添加。
// 与 en-US 逐键对应；en-US 是 E2E 契约，不得改写。

export default {
  // ─── 页面 ───────────────────────────────────────────────────────────────
  title: "隧道",
  subtitle: "通过 SSH 隧道将本地端口转发到远程服务，安全访问数据库、API 与各类服务",

  // ─── 搜索 ───────────────────────────────────────────────────────────────
  "search.placeholder": "搜索规则...",
  "search.label": "搜索转发规则",

  // ─── 工具栏 ─────────────────────────────────────────────────────────────
  newRule: "新建规则",

  // ─── 规则卡片 ───────────────────────────────────────────────────────────
  standalone: "独立",
  portFallback: "端口 {port}",
  startTunnel: "启动隧道",
  stopTunnel: "停止隧道",
  copyAddress: "复制本地地址",
  connections: "{count} 个连接",
  auto: "自动",

  // ─── 右键菜单 ───────────────────────────────────────────────────────────
  "context.startTunnel": "启动隧道",
  "context.stopTunnel": "停止隧道",

  // ─── 空状态 / 无匹配 ────────────────────────────────────────────────────
  noMatch: "没有匹配“{query}”的规则",
  "empty.title": "还没有转发规则",
  "empty.hint": "通过 SSH 隧道将本地端口转发到远程服务",

  // ─── 删除确认 ───────────────────────────────────────────────────────────
  "delete.title": "删除这条隧道规则？",
  "delete.message": "该隧道规则将被永久删除。",

  // ─── 规则弹窗 ───────────────────────────────────────────────────────────
  "dialog.newTitle": "新建规则",
  "dialog.editTitle": "编辑规则",
  "dialog.create": "创建",

  "section.connection": "连接",
  "section.ports": "端口",
  "section.options": "选项",

  noHosts: "没有已保存的主机，请先添加主机。",
  "placeholder.label": "我的数据库",
  "placeholder.description": "用于分析的生产只读副本...",

  localPort: "本地端口",
  remotePort: "远程端口",
  "placeholder.port": "5432",

  bindAddress: "绑定地址",
  "bind.localOnly": "127.0.0.1（仅本地）",
  "bind.allInterfaces": "0.0.0.0（所有网卡）",

  autoStart: "自动启动",
  autoStartHint: "主机连接时自动启动隧道",

  // ─── 错误 ───────────────────────────────────────────────────────────────
  startFailed: "隧道启动失败",
};
