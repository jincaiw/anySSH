// ─── tabs (zh-CN) ───────────────────────────────────────────────────────
//
// 统一标签栏：标签标题、右键菜单、关闭操作，以及状态栏的会话计数。
//
// 键名不带 `tabs.` 前缀 —— 由 locale index 统一添加。
// 与 en-US 逐键对应；en-US 是 E2E 契约，不得改写。

export default {
  // ─── 页面标签标题 ───────────────────────────────────────────────────────
  // 标签打开时标题会写入 store，因此切换语言只影响之后新建的标签。
  "page.hosts": "主机",
  "page.snippets": "代码片段",
  "page.portForwarding": "隧道",
  "page.history": "历史记录",
  "page.settings": "设置",
  "page.transfers": "传输",

  // ─── 标签条 ─────────────────────────────────────────────────────────────
  tablist: "已打开的会话",
  scrollLeft: "向左滚动标签",
  scrollRight: "向右滚动标签",
  panes: "（{count} 个窗格）",
  zoomedPane: "已放大的窗格",
  close: "关闭 {label}",

  // ─── 代码片段入口 ───────────────────────────────────────────────────────
  // `{shortcut}` 保持原样：这是平台快捷键提示（⌘K / Ctrl K）。
  snippets: "代码片段（{shortcut}）",
  snippetPalette: "打开代码片段面板",

  // ─── 状态栏 ─────────────────────────────────────────────────────────────
  // 会话状态本身（Connected / Connecting / …）是后端数据，不翻译。
  sessionCount_one: "{count} 个会话",
  sessionCount_other: "{count} 个会话",
  noActiveSession: "没有活动会话",
};
