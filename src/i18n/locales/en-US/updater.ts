// ─── updater (en-US) ───────────────────────────────────────────────────────
//
// Update check dialog, the Settings update row, and update-related toasts.
//
// Keys are written WITHOUT the `updater.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Update dialog ───────────────────────────────────────────────────────
  "dialog.title": "Update available",
  "dialog.available": "is available",
  "dialog.youHave": " — you have v{version}",
  "dialog.changelog": "View changelog on GitHub",
  "dialog.skip": "Skip this version",
  "dialog.later": "Later",
  "dialog.install": "Install",

  // ─── Settings → About & Updates → App Version row ────────────────────────
  "checker.appVersion": "App Version",
  "checker.upToDate": "You're on the latest version",
  "checker.available": "v{version} is available",
  "checker.downloading": "Downloading update... {progress}%",
  "checker.ready": "Update downloaded. Restart to apply.",
  "checker.currentVersion": "Current: v{version}",
  "checker.readingVersion": "Reading version…",
  "checker.check": "Check",
  "checker.checking": "Checking...",
  "checker.restartNow": "Restart Now",

  // ─── Errors surfaced from src/stores/updater-store.ts ─────────────────────
  "error.checkFailed": "Failed to check for updates",
  "error.downloadFailed": "Download failed",
  "error.relaunchFailed": "Couldn't restart automatically — please reopen the app",
};
