// ─── transfers (en-US) ───────────────────────────────────────────────────────
//
// Transfer queue: rows, popover, transfers page.
//
// Keys are written WITHOUT the `transfers.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Headings / shared ───────────────────────────────────────────────────
  title: "Transfers",
  "page.subtitle": "Active, queued, and completed file transfers across all sessions",
  listAria: "Transfer items",
  clearCompleted: "Clear completed",
  clearCompletedAria: "Clear completed transfers",
  openInTab: "Open in a tab",
  openInTabAria: "Open transfers in a tab",
  closeAria: "Close transfers",

  // ─── Summary counts ──────────────────────────────────────────────────────
  "summary.activeCount_one": "{count} active",
  "summary.activeCount_other": "{count} active",
  "summary.queuedCount_one": "{count} queued",
  "summary.queuedCount_other": "{count} queued",
  "summary.doneCount_one": "{count} done",
  "summary.doneCount_other": "{count} done",

  // ─── Empty state ─────────────────────────────────────────────────────────
  empty: "No transfers",
  emptyHint: "Drag files onto the explorer to upload",
  calculating: "Calculating...",

  // ─── Row ────────────────────────────────────────────────────────────────
  "row.fileProgress": "{done}/{total} files",
  "row.progressAria": "{name} {direction} progress",
  "row.retry": "Retry transfer",
  "row.retryAria": "Retry {name}",
  "row.cancel": "Cancel transfer",
  "row.cancelAria": "Cancel {name}",
  "row.dismissAria": "Dismiss {name}",

  // ─── Status ─────────────────────────────────────────────────────────────
  // Keys named after the backend's English discriminant (`statusLabel()` maps
  // one onto the other); `done` is the row's own completed wording.
  "status.Queued": "Queued",
  "status.InProgress": "InProgress",
  "status.Completed": "Completed",
  "status.Failed": "Failed",
  "status.Cancelled": "Cancelled",
  "status.done": "Done",
};
