// ─── sftp (en-US) ───────────────────────────────────────────────────────
//
// SFTP/SCP sessions: session picker, drop dialogs, path bar.
//
// Keys are written WITHOUT the `sftp.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Session picker (SftpSessionPicker) ──────────────────────────────────
  "sessionPicker.title": "File Browser",
  "sessionPicker.subtitle": "Select an active SSH session to browse its filesystem.",
  "sessionPicker.activeSessions": "Active Sessions",
  "sessionPicker.openSftp": "Open SFTP",
  "sessionPicker.opening": "Opening…",
  "sessionPicker.openSftpFor": "Open SFTP for {label}",
  "sessionPicker.openBrowserFor": "Open file browser for {label}",
  "sessionPicker.openFailed": "Failed to open SFTP session",
  "sessionPicker.emptyTitle": "No active SSH sessions",
  // The empty-state body wraps "Hosts" in an accent-styled span, so the copy
  // is split in three to keep that markup intact.
  "sessionPicker.emptyBodyBefore": "Connect to a host from the",
  "sessionPicker.emptyHosts": "Hosts",
  "sessionPicker.emptyBodyAfter": "page first, then return here to browse files.",

  // ─── Connection status labels (SftpSessionPicker) ────────────────────────
  // Display-only map for the backend `ConnectionStatus` discriminants — the
  // raw values are never fed to `t()` (see statusLabel in the component).
  "status.Connected": "Connected",
  "status.Connecting": "Connecting",
  "status.Disconnecting": "Disconnecting",
  "status.Disconnected": "Disconnected",
  "status.Error": "Error",

  // ─── Session tabs (SftpTabs) ─────────────────────────────────────────────
  "tabs.close": "Close {label}",

  // ─── Breadcrumbs (PathBar) ───────────────────────────────────────────────
  // The label doubles as an E2E selector (`[aria-label='Current path']`).
  "pathBar.label": "Current path",
  "pathBar.navigateTo": "Navigate to {path}",

  // ─── Drop overwrite confirmation (DropOverwriteDialog) ───────────────────
  "overwrite.title_one": "Overwrite item?",
  "overwrite.title_other": "Overwrite {count} items?",
  "overwrite.confirm_one": "Overwrite",
  "overwrite.confirm_other": "Overwrite {count}",
  // The conflicting name keeps its monospace styling, so it stays outside the
  // translated tail.
  "overwrite.bodySingle": "already exists here.",
  "overwrite.bodyMultiple": "{count} items already exist here.",
  "overwrite.note": "Files are replaced; folders are merged, replacing only same-named files inside.",

  // ─── Explorer pane header (ExplorerPage) ─────────────────────────────────
  "page.fallbackLabel": "Explorer",
  "page.scpLabel": "{label} · SCP",

  // ─── Explorer view (ExplorerView) ────────────────────────────────────────
  "explorer.uploadFailed": "Upload failed: {message}",
  "explorer.downloadFailed": "Download failed: {message}",
  "explorer.listFailed": "Failed to list directory",
  "explorer.sudoEnableFailed": "Failed to enable sudo mode",
  "explorer.sudoDisableFailed": "Failed to disable sudo mode",
  "explorer.downloadTo": 'Download "{name}" to…',
  "explorer.saveAs": 'Save "{name}" as…',
  "explorer.downloadItemsTo": "Download {count} items to…",
  "explorer.preparingDownload": "Preparing download…",
  "explorer.downloaded_one": "Downloaded {count} item",
  "explorer.downloaded_other": "Downloaded {count} items",
  // Titles handed to the native file picker.
  "explorer.uploadFileTitle": "Upload file",
  "explorer.uploadFolderTitle": "Upload folder",
  "explorer.unexpectedError": "Unexpected error",
  "explorer.pasteFailed": "Paste failed",
  "explorer.moveFailed": "Move failed",
  "explorer.copyFailed": "Copy failed",
};
