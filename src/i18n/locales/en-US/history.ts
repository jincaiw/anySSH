// ─── history (en-US) ───────────────────────────────────────────────────────
//
// Connection history / audit log page.
//
// Keys are written WITHOUT the `history.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Page ───────────────────────────────────────────────────────────────
  title: "History",
  subtitle: "Audit log of all SSH connections — when you connected, to which host, and as which user",
  connectionCount: "{count} connections",

  // ─── Search / filter ────────────────────────────────────────────────────
  "search.placeholder": "Search connections...",
  "search.label": "Search connection history",
  "filter.label": "Filter by host",
  allHosts: "All Hosts",
  filterBy: "Filter by {host}",

  // ─── Entries ────────────────────────────────────────────────────────────
  entryHint: "Double-click to reconnect · Right-click for options",

  // ─── Context menu ───────────────────────────────────────────────────────
  terminal: "Terminal",
  explorer: "Explorer",

  // ─── Paging ─────────────────────────────────────────────────────────────
  loadMore: "Load more",
  // Three ASCII dots, not an ellipsis — matches the previous hard-coded copy.
  loading: "Loading...",

  // ─── Empty / no-match states ────────────────────────────────────────────
  noMatch: "No connections match “{query}”",
  "empty.title": "No connection history",
  "empty.hint": "Your SSH connection log will appear here as you connect to hosts",

  // ─── Delete confirmation ────────────────────────────────────────────────
  "delete.title": "Delete this history record?",
  "delete.message": "This record will be permanently removed.",
  "toast.deleteFailed": "Failed to delete history entry.",

  // ─── Date groups + relative time ────────────────────────────────────────
  // Older groups fall back to `toLocaleDateString`, which the browser already
  // localises — only the two fixed labels need keys.
  "group.today": "Today",
  "group.yesterday": "Yesterday",
  "time.justNow": "Just now",
  "time.minutesAgo": "{count}m ago",
  "time.hoursAgo": "{count}h ago",
  "time.daysAgo": "{count}d ago",
};
