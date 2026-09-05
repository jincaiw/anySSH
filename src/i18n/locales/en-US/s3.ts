// ─── s3 (en-US) ───────────────────────────────────────────────────────
//
// S3 connect dialog and bucket browser.
//
// Keys are written WITHOUT the `s3.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Page (S3Page) ───────────────────────────────────────────────────────
  "page.title": "Cloud Storage",
  "page.subtitle": "Browse and manage files in S3 buckets and S3-compatible storage services like MinIO, R2, and Wasabi",
  "page.searchPlaceholder": "Search connections...",
  "page.searchAriaLabel": "Search S3 connections",
  "page.newConnection": "New Connection",
  "page.saved": "Saved",
  "page.active": "Active",
  "page.noMatch": "No connections match “{query}”",
  "page.emptyTitle": "No S3 connections",
  "page.emptyHint": "Connect to Amazon S3, MinIO, Cloudflare R2, or any S3-compatible storage",
  "page.deleteTitle": "Delete this S3 connection?",
  "page.deleteMessage": "This connection will be permanently removed.",

  // ─── Connect / edit dialog (S3ConnectDialog) ─────────────────────────────
  "dialog.titleNew": "Connect to Object Storage",
  "dialog.titleEdit": "Edit Object Storage Connection",
  "dialog.saving": "Saving…",
  "dialog.connecting": "Connecting…",
  "dialog.saveFailed": "Save failed",
  "dialog.connectFailed": "Connection failed",
  "dialog.section.provider": "Provider",
  "dialog.section.credentials": "Credentials",
  "dialog.section.connection": "Connection",
  "dialog.section.appearance": "Appearance",
  "dialog.section.notes": "Notes",
  "dialog.service": "Service",
  "dialog.labelPlaceholder": "My S3 Bucket",
  "dialog.keepCredentials": "Leave blank to keep existing credentials",
  "dialog.accessKey": "Access Key ID",
  "dialog.accessKeyPlaceholder": "AKIAIOSFODNN7EXAMPLE",
  "dialog.secretKey": "Secret Access Key",
  "dialog.secretKeyPlaceholder": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "dialog.credentialPlaceholder": "••••••••••••",
  "dialog.region": "Region",
  "dialog.bucket": "Bucket",
  "dialog.endpoint": "Endpoint URL",
  "dialog.endpointPlaceholder": "https://s3.example.com",
  "dialog.group": "Group",
  "dialog.noGroup": "No group",
  "dialog.environment": "Environment",
  "dialog.environment.production": "Production",
  "dialog.environment.staging": "Staging",
  "dialog.environment.dev": "Dev",
  "dialog.environment.testing": "Testing",
  "dialog.colorAria": "Color {color}",
  "dialog.notesPlaceholder": "Notes about this connection...",

  // ─── Browser (S3Browser) ─────────────────────────────────────────────────
  "browser.buckets": "Buckets",
  "browser.noBuckets": "No buckets found",
  "browser.downloadTitle": 'Download "{name}"',
  "browser.uploadFileTitle": "Upload file",
  "browser.uploadFolderTitle": "Upload folder",
  "browser.listBucketsFailed": "Failed to list buckets",
  "browser.listObjectsFailed": "Failed to list objects",
  "browser.switchBucketFailed": "Failed to switch bucket",
  "browser.backToBuckets": "Back to bucket list",
};
