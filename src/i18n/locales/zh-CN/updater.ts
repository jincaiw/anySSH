// ─── updater (zh-CN) ───────────────────────────────────────────────────────
//
// Update check dialog, the Settings update row, and update-related toasts.
//
// Keys are written WITHOUT the `updater.` prefix — the locale index adds it.
// Must mirror ../en-US/updater.ts key-for-key (src/i18n/__tests__/i18n-parity.test.ts).

export default {
  // ─── Update dialog ───────────────────────────────────────────────────────
  "dialog.title": "有新版本可用",
  "dialog.available": "可用",
  "dialog.youHave": "，当前版本 v{version}",
  "dialog.changelog": "在 GitHub 上查看更新日志",
  "dialog.skip": "跳过此版本",
  "dialog.later": "稍后",
  "dialog.install": "安装",

  // ─── Settings → About & Updates → App Version row ────────────────────────
  "checker.appVersion": "应用版本",
  "checker.upToDate": "当前已是最新版本",
  "checker.available": "v{version} 可用",
  "checker.downloading": "正在下载更新... {progress}%",
  "checker.ready": "更新已下载，重启后生效。",
  "checker.currentVersion": "当前：v{version}",
  "checker.readingVersion": "正在读取版本…",
  "checker.check": "检查",
  "checker.checking": "正在检查...",
  "checker.restartNow": "立即重启",

  // ─── Errors surfaced from src/stores/updater-store.ts ─────────────────────
  "error.checkFailed": "检查更新失败",
  "error.downloadFailed": "下载失败",
  "error.relaunchFailed": "无法自动重启，请手动重新打开应用",
};
