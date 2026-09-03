// ─── terminal (en-US) ───────────────────────────────────────────────────────
//
// Terminal panes: search bar, pane header, disconnect overlay, plus the
// connection-state labels and the host health-check copy produced by
// src/stores/health-store.ts.
//
// Keys are written WITHOUT the `terminal.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Search bar (TerminalSearchBar) ──────────────────────────────────────
  "search.placeholder": "Find",
  "search.ariaLabel": "Search terminal",
  // Match counter, e.g. "2 of 7". E2E asserts the result matches /of/.
  "search.matchCount": "{index} of {count}",
  "search.previous": "Previous match",
  "search.previousHint": "Previous match (Shift+Enter)",
  "search.next": "Next match",
  "search.nextHint": "Next match (Enter)",
  "search.matchCase": "Match case",
  "search.toggleCaseSensitivity": "Toggle case sensitivity",
  "search.useRegex": "Use regex",
  "search.toggleRegex": "Toggle regex",
  "search.closeHint": "Close (Escape)",
  "search.close": "Close search",

  // ─── Pane header (PaneHeader) ────────────────────────────────────────────
  "pane.splitRight": "Split right",
  "pane.splitRightHint": "Split right (⌘D)",
  "pane.splitDown": "Split down",
  "pane.splitDownHint": "Split down (⇧⌘D)",
  "pane.zoom": "Zoom pane",
  "pane.unzoom": "Unzoom pane",
  "pane.zoomHint": "Zoom (⇧⌘↵)",
  "pane.unzoomHint": "Unzoom (⇧⌘↵)",
  "pane.close": "Close pane",
  "pane.closeHint": "Close pane (⌘W)",

  // ─── Disconnect overlay (DisconnectOverlay) ──────────────────────────────
  "disconnect.connectionError": "Connection error",
  "disconnect.connectionLost": "Connection lost",
  "disconnect.reconnect": "Reconnect",
  "disconnect.reconnectFailed": "Reconnection failed",
  "disconnect.closeSession": "Close session",

  // ─── Per-session encoding switcher (EncodingSwitcher) ─────────────────────
  "encoding.title": "Character encoding (this session only, not persisted)",
  "encoding.ariaLabel": "Switch character encoding for this session",

  // ─── Connection states ───────────────────────────────────────────────────
  // The backend emits these as English discriminants. Callers must map the
  // known values onto these keys and fall back to the raw value — never feed
  // a raw discriminant into t().
  "state.connected": "Connected",
  "state.connecting": "Connecting",
  "state.disconnected": "Disconnected",
  "state.error": "Error",

  // ─── Host health check (health-store) ────────────────────────────────────
  "health.pinging": "Pinging host...",
  "health.pingFailed": "Ping failed",

  // ─── Session context menu (Terminal right-click) ─────────────────────────
  "menu.paste": "Paste",
  "menu.startLog": "Start session log",
  "menu.stopLog": "Stop session log",
  "menu.viewLog": "View session logs",
  "menu.openLogDir": "Open logs folder",

  // ─── Session log viewer (SessionLogViewer) ───────────────────────────────
  "logViewer.title": "Session logs",
  "logViewer.empty": "No file selected",
  "logViewer.searchPlaceholder": "Search in log...",
  "logViewer.refresh": "Refresh list",
  "logViewer.export": "Export",
  "logViewer.exportTitle": "Export session log",
  "logViewer.exportError": "Export failed",
  "logViewer.openDir": "Open folder",
  "logViewer.noFiles": "No session logs yet. Logs are written when a session records (right-click menu or ⇧⌘L).",
  "logViewer.emptyContent": "This log file is empty.",
  "logViewer.loading": "Loading...",
  "logViewer.truncated": "Large file — showing the tail only.",
  "logViewer.readError": "Could not read this log file.",
  "logViewer.live": "Currently recording",
};
