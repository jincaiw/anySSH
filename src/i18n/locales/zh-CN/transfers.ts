// ─── transfers (zh-CN) ───────────────────────────────────────────────────────
//
// Transfer queue: rows, popover, transfers page.
//
// Keys are written WITHOUT the `transfers.` prefix — the locale index adds it.
// Must mirror ../en-US/transfers.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).

export default {
  // ─── Headings / shared ───────────────────────────────────────────────────
  title: "传输",
  "page.subtitle": "所有会话中正在进行、排队等待和已完成的文件传输",
  listAria: "传输条目",
  clearCompleted: "清除已完成",
  clearCompletedAria: "清除已完成的传输",
  openInTab: "在标签页中打开",
  "openInTabAria": "在标签页中打开传输列表",
  closeAria: "关闭传输列表",

  // ─── Summary counts ──────────────────────────────────────────────────────
  "summary.activeCount_one": "{count} 个进行中",
  "summary.activeCount_other": "{count} 个进行中",
  "summary.queuedCount_one": "{count} 个排队中",
  "summary.queuedCount_other": "{count} 个排队中",
  "summary.doneCount_one": "{count} 个已完成",
  "summary.doneCount_other": "{count} 个已完成",

  // ─── Empty state ─────────────────────────────────────────────────────────
  empty: "暂无传输",
  emptyHint: "将文件拖到文件浏览器中即可上传",
  calculating: "计算中...",

  // ─── Row ────────────────────────────────────────────────────────────────
  "row.fileProgress": "{done}/{total} 个文件",
  "row.progressAria": "{name} {direction} 进度",
  "row.retry": "重试传输",
  "row.retryAria": "重试 {name}",
  "row.cancel": "取消传输",
  "row.cancelAria": "取消 {name}",
  "row.dismissAria": "关闭 {name}",

  // ─── Status ─────────────────────────────────────────────────────────────
  "status.Queued": "排队中",
  "status.InProgress": "进行中",
  "status.Completed": "已完成",
  "status.Failed": "失败",
  "status.Cancelled": "已取消",
  "status.done": "完成",
};
