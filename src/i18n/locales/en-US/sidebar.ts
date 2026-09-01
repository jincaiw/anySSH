// ─── sidebar (en-US) ───────────────────────────────────────────────────────
//
// Activity rail: nav items, quick connect, collapse toggle.
//
// Keys are written WITHOUT the `sidebar.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.
//
// The nav labels double as page-tab labels (`openPageTab`), so they match
// `tabs.page.*` in English.

export default {
  // ─── Rail ───────────────────────────────────────────────────────────────
  mainNav: "Main navigation",

  // ─── Nav items (labels are reused as page tab titles) ───────────────────
  "nav.hosts": "Hosts",
  "nav.snippets": "Snippets",
  "nav.tunnels": "Tunnels",
  "nav.history": "History",

  // ─── Bottom actions ─────────────────────────────────────────────────────
  transfers: "Transfers",
  settings: "Settings",
  collapse: "Collapse",
  expand: "Expand",
};
