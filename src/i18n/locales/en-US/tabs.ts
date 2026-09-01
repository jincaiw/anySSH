// ─── tabs (en-US) ───────────────────────────────────────────────────────
//
// Unified tab bar: tab labels, context menu, close affordances, plus the
// session counters in the status bar.
//
// Keys are written WITHOUT the `tabs.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Page tab labels ────────────────────────────────────────────────────
  // Captured into store state when a tab opens, so a language switch only
  // affects tabs created afterwards.
  "page.hosts": "Hosts",
  "page.snippets": "Snippets",
  "page.portForwarding": "Tunnels",
  "page.history": "History",
  "page.settings": "Settings",
  "page.transfers": "Transfers",

  // ─── Tab strip ──────────────────────────────────────────────────────────
  tablist: "Open sessions",
  scrollLeft: "Scroll tabs left",
  scrollRight: "Scroll tabs right",
  panes: "({count} panes)",
  zoomedPane: "Zoomed pane",
  close: "Close {label}",

  // ─── Snippet launcher ───────────────────────────────────────────────────
  // `{shortcut}` stays as-is: it is the platform key hint (⌘K / Ctrl K).
  snippets: "Snippets ({shortcut})",
  snippetPalette: "Open snippet palette",

  // ─── Status bar ─────────────────────────────────────────────────────────
  // The session status itself (Connected / Connecting / …) is backend data
  // and stays untranslated.
  sessionCount_one: "{count} session",
  sessionCount_other: "{count} sessions",
  noActiveSession: "No active session",
};
