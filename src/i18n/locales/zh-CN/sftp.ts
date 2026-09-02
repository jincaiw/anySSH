// ─── sftp (zh-CN) ───────────────────────────────────────────────────────
//
// SFTP/SCP sessions: session picker, drop dialogs, path bar.
//
// Keys are written WITHOUT the `sftp.` prefix — the locale index adds it.
// Must mirror ../en-US/sftp.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).

export default {
  // ─── Session picker (SftpSessionPicker) ──────────────────────────────────
  "sessionPicker.title": "文件浏览器",
  "sessionPicker.subtitle": "选择一个已连接的 SSH 会话来浏览其文件系统。",
  "sessionPicker.activeSessions": "活动会话",
  "sessionPicker.openSftp": "打开 SFTP",
  "sessionPicker.opening": "正在打开…",
  "sessionPicker.openSftpFor": "为 {label} 打开 SFTP",
  "sessionPicker.openBrowserFor": "为 {label} 打开文件浏览器",
  "sessionPicker.openFailed": "打开 SFTP 会话失败",
  "sessionPicker.emptyTitle": "没有活动的 SSH 会话",
  // The empty-state body wraps "Hosts" in an accent-styled span, so the copy
  // is split in three to keep that markup intact.
  "sessionPicker.emptyBodyBefore": "请先从",
  "sessionPicker.emptyHosts": "主机",
  "sessionPicker.emptyBodyAfter": "页面连接一台主机，然后再回到这里浏览文件。",

  // ─── Connection status labels (SftpSessionPicker) ────────────────────────
  // Display-only map for the backend `ConnectionStatus` discriminants — the
  // raw values are never fed to `t()` (see statusLabel in the component).
  "status.Connected": "已连接",
  "status.Connecting": "正在连接",
  "status.Disconnecting": "正在断开",
  "status.Disconnected": "已断开",
  "status.Error": "错误",

  // ─── Session tabs (SftpTabs) ─────────────────────────────────────────────
  "tabs.close": "关闭 {label}",

  // ─── Breadcrumbs (PathBar) ───────────────────────────────────────────────
  // The label doubles as an E2E selector (`[aria-label='Current path']`).
  "pathBar.label": "当前路径",
  "pathBar.navigateTo": "导航到 {path}",

  // ─── Drop overwrite confirmation (DropOverwriteDialog) ───────────────────
  "overwrite.title_one": "覆盖该项目？",
  "overwrite.title_other": "覆盖 {count} 个项目？",
  "overwrite.confirm_one": "覆盖",
  "overwrite.confirm_other": "覆盖 {count} 项",
  // The conflicting name keeps its monospace styling, so it stays outside the
  // translated tail.
  "overwrite.bodySingle": "已存在于此处。",
  "overwrite.bodyMultiple": "{count} 个项目已存在于此处。",
  "overwrite.note": "文件将被替换；文件夹会合并，仅替换其中同名的文件。",

  // ─── Explorer pane header (ExplorerPage) ─────────────────────────────────
  "page.fallbackLabel": "文件浏览器",
  "page.scpLabel": "{label} · SCP",

  // ─── Explorer view (ExplorerView) ────────────────────────────────────────
  "explorer.uploadFailed": "上传失败：{message}",
  "explorer.downloadFailed": "下载失败：{message}",
  "explorer.listFailed": "列出目录失败",
  "explorer.sudoEnableFailed": "启用 sudo 模式失败",
  "explorer.sudoDisableFailed": "禁用 sudo 模式失败",
  "explorer.downloadTo": "将“{name}”下载到…",
  "explorer.saveAs": "将“{name}”另存为…",
  "explorer.downloadItemsTo": "下载 {count} 个项目到…",
  "explorer.preparingDownload": "正在准备下载…",
  "explorer.downloaded_one": "已下载 {count} 个项目",
  "explorer.downloaded_other": "已下载 {count} 个项目",
  // Titles handed to the native file picker.
  "explorer.uploadFileTitle": "上传文件",
  "explorer.uploadFolderTitle": "上传文件夹",
  "explorer.unexpectedError": "发生未知错误",
  "explorer.pasteFailed": "粘贴失败",
  "explorer.moveFailed": "移动失败",
  "explorer.copyFailed": "复制失败",
};
