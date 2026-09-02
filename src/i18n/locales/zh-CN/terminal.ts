// ─── terminal (zh-CN) ───────────────────────────────────────────────────────
//
// Terminal panes: search bar, pane header, disconnect overlay, plus the
// connection-state labels and the host health-check copy produced by
// src/stores/health-store.ts.
//
// Keys are written WITHOUT the `terminal.` prefix — the locale index adds it.
// Must mirror ../en-US/terminal.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).

export default {
  // ─── Search bar (TerminalSearchBar) ──────────────────────────────────────
  "search.placeholder": "查找",
  "search.ariaLabel": "搜索终端",
  "search.matchCount": "{index}/{count}",
  "search.previous": "上一个匹配",
  "search.previousHint": "上一个匹配 (Shift+Enter)",
  "search.next": "下一个匹配",
  "search.nextHint": "下一个匹配 (Enter)",
  "search.matchCase": "区分大小写",
  "search.toggleCaseSensitivity": "切换区分大小写",
  "search.useRegex": "使用正则表达式",
  "search.toggleRegex": "切换正则表达式",
  "search.closeHint": "关闭 (Escape)",
  "search.close": "关闭搜索",

  // ─── Pane header (PaneHeader) ────────────────────────────────────────────
  "pane.splitRight": "向右分屏",
  "pane.splitRightHint": "向右分屏 (⌘D)",
  "pane.splitDown": "向下分屏",
  "pane.splitDownHint": "向下分屏 (⇧⌘D)",
  "pane.zoom": "最大化窗格",
  "pane.unzoom": "还原窗格",
  "pane.zoomHint": "最大化 (⇧⌘↵)",
  "pane.unzoomHint": "还原 (⇧⌘↵)",
  "pane.close": "关闭窗格",
  "pane.closeHint": "关闭窗格 (⌘W)",

  // ─── Disconnect overlay (DisconnectOverlay) ──────────────────────────────
  "disconnect.connectionError": "连接错误",
  "disconnect.connectionLost": "连接已断开",
  "disconnect.reconnect": "重新连接",
  "disconnect.reconnectFailed": "重连失败",
  "disconnect.closeSession": "关闭会话",

  // ─── Connection states ───────────────────────────────────────────────────
  "state.connected": "已连接",
  "state.connecting": "正在连接",
  "state.disconnected": "已断开",
  "state.error": "错误",

  // ─── Host health check (health-store) ────────────────────────────────────
  "health.pinging": "正在 Ping 主机...",
  "health.pingFailed": "Ping 失败",
};
