// ─── settings (en-US) ───────────────────────────────────────────────────────
//
// Settings page: every section, label and description.
//
// Keys are written WITHOUT the `settings.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Page chrome ─────────────────────────────────────────────────────────
  title: "Settings",
  "sections.ariaLabel": "Settings sections",

  "sections.appearance": "Appearance",
  "sections.terminal": "Terminal",
  "sections.explorer": "Explorer",
  "sections.transfers": "Transfers",
  "sections.editors": "Editors",
  "sections.data": "Data",
  "sections.about": "About & Updates",

  "sections.appearance.description": "Theme and interface look.",
  "sections.terminal.description": "Font, cursor, and scrollback history.",
  "sections.explorer.description": "How the file browser behaves.",
  "sections.transfers.description": "Control how files are transferred.",
  "sections.editors.description": "Editors used by “Edit” / “Open With” in the file browser.",
  "sections.data.description": "Back up, restore, and reset your data.",
  "sections.about.description": "App information, links, and updates.",

  // ─── Appearance ──────────────────────────────────────────────────────────
  "appearance.language": "Language",
  "appearance.languageHint": "Choose the interface language.",

  "appearance.group.theme": "Theme",
  "appearance.colorTheme": "Color Theme",
  "appearance.colorThemeHint": "Switch between the dark and softer grey light interface",
  "appearance.theme.dark": "Dark",
  "appearance.theme.light": "Light",

  "appearance.accentColor": "Accent Color",
  "appearance.accentColorHint": "Used for buttons, links, and active states",
  "appearance.accent.blue": "Blue",
  "appearance.accent.indigo": "Indigo",
  "appearance.accent.violet": "Violet",
  "appearance.accent.pink": "Pink",
  "appearance.accent.red": "Red",
  "appearance.accent.orange": "Orange",
  "appearance.accent.green": "Green",
  "appearance.accent.teal": "Teal",
  "appearance.accent.custom": "Custom",
  "appearance.accent.customColor": "Custom color",
  "appearance.accent.customDialog": "Custom accent color",
  "appearance.accent.hue": "Accent hue",
  "appearance.accent.lightness": "Lightness",
  "appearance.accent.saturation": "Saturation",

  "appearance.group.interface": "Interface",
  "appearance.interfaceFont": "Interface Font",
  "appearance.interfaceFontHint": "Font for menus, labels, and panels",
  "appearance.interfaceMonoFont": "Interface Monospace Font",
  "appearance.interfaceMonoFontHint": "Font for paths, permissions, and code (not the terminal)",

  // ─── Font picker options ─────────────────────────────────────────────────
  // Font family names themselves are never translated; only the descriptive
  // parts ("(Default)", "System UI", …) get a key.
  "fonts.geistDefault": "Geist (Default)",
  "fonts.systemUI": "System UI",
  "fonts.jetbrainsMonoDefault": "JetBrains Mono (Default)",
  "fonts.jetbrainsNerdFont": "JetBrains Nerd Font (icons)",
  "fonts.systemMonospace": "System Monospace",
  "fonts.current": "Current",

  // ─── Terminal ────────────────────────────────────────────────────────────
  "terminal.group.font": "Font",
  "terminal.fontFamily": "Font Family",
  "terminal.fontFamilyHint": "Monospace font used by terminals",
  "terminal.fontSize": "Font Size",
  "terminal.fontSizeHint": "Size in pixels (8–42)",
  "terminal.lineHeight": "Line Height",
  "terminal.lineHeightHint": "Spacing between lines (1.0–2.0)",

  "terminal.group.cursor": "Cursor",
  "terminal.cursorStyle": "Cursor Style",
  "terminal.cursorStyleHint": "Shape of the terminal cursor",
  "terminal.cursor.bar": "Bar",
  "terminal.cursor.block": "Block",
  "terminal.cursor.underline": "Underline",
  "terminal.cursorBlink": "Cursor Blink",
  "terminal.cursorBlinkHint": "Animate the cursor",

  "terminal.group.clipboard": "Clipboard",
  "terminal.copyOnSelect": "Copy on Select",
  "terminal.copyOnSelectHint": "Copy highlighted text to the clipboard automatically",
  "terminal.pasteButton": "Paste Button",
  "terminal.pasteButtonHint": "Mouse button that pastes the clipboard into the terminal",
  "terminal.paste.off": "Off",
  "terminal.paste.right": "Right-click",
  "terminal.paste.middle": "Middle-click",

  "terminal.group.session": "Session",
  "terminal.encoding": "Encoding",
  "terminal.encodingHint": "Affects terminal rendering; align with the server's locale (also covers Chinese filenames over SFTP)",
  "terminal.termType": "Terminal Type",
  "terminal.termTypeHint": "Sent to the server as the TERM environment variable; affects colours, cursor control and more",
  "terminal.recommendedSuffix": " (recommended)",

  "terminal.group.history": "History",
  "terminal.scrollback": "Scrollback Buffer",
  "terminal.scrollbackHint": "Number of lines to keep in history (500–100,000)",
  "terminal.applyHint": "Changes apply to open terminals immediately.",

  // ─── Explorer ────────────────────────────────────────────────────────────
  "explorer.doubleClick": "Double-click a File",
  "explorer.doubleClickHint": "What happens when you double-click a file in the browser",
  "explorer.doubleClick.openInEditor": "Open in Editor",
  "explorer.fallbackHint": "Opening falls back to downloading when no editor is configured (see Editors).",

  // ─── Transfers ───────────────────────────────────────────────────────────
  "transfers.concurrency": "Concurrent Transfers",
  "transfers.concurrencyHint": "Maximum simultaneous file transfers (1–10)",

  // ─── Data / backup ───────────────────────────────────────────────────────
  "data.group.backup": "Backup",
  "data.export": "Export encrypted backup",
  "data.exportHint":
    "Save all hosts, groups, snippets, settings, and stored credentials to a single password-protected file.",
  "data.exportAction": "Export…",
  "data.import": "Import backup",
  "data.importHint": "Restore from a backup file. This replaces all current data and restarts anySSH.",
  "data.importAction": "Import…",

  "backup.selectFileTitle": "Select anySSH backup",
  "backup.saveFileTitle": "Save anySSH backup",
  "backup.fileFilter": "anySSH backup",
  "backup.title.export": "Export encrypted backup",
  "backup.title.import": "Import backup",
  "backup.exportBody":
    "Choose a password to encrypt the backup. You’ll need it to restore — there’s no way to recover the data without it.",
  "backup.importBody":
    "Enter the password this backup was created with. Importing replaces all current data and restarts anySSH.",
  "backup.passwordPlaceholder": "Backup password",
  "backup.confirmPassword": "Confirm password",
  "backup.confirmPlaceholder": "Re-enter password",
  "backup.passwordMismatch": "Passwords don’t match.",
  "backup.passwordHint": "At least {min} characters",
  "backup.exportAction": "Choose file & export",
  "backup.exporting": "Exporting…",
  "backup.importAction": "Import & restart",
  "backup.restoring": "Restoring…",
  "backup.savedToast": "Encrypted backup saved.",
  "backup.exportFailedToast": "Couldn’t export backup.",
  "backup.importFailedToast": "Import failed.",

  // ─── Data / danger zone ──────────────────────────────────────────────────
  "data.group.danger": "Danger zone",
  "data.clearAll": "Clear all data",
  "data.clearAllHint":
    "Permanently delete every saved host, group, connection history entry, snippet, port-forward rule, and S3 connection — along with their stored credentials and all app preferences. anySSH restarts at first-launch state. This can’t be undone.",
  "data.clearAllAction": "Clear all data…",
  "reset.title": "Clear all data?",
  "reset.bodyPrefix": "This permanently deletes",
  "reset.bodyEmphasis": "all",
  "reset.bodySuffix":
    "saved hosts, groups, history, snippets, port-forward rules, S3 connections, stored credentials, and preferences. anySSH will restart fresh. This action cannot be undone.",
  "reset.typePrefix": "Type",
  "reset.typeSuffix": "to confirm",
  "reset.action": "Clear all data",
  "reset.clearing": "Clearing…",
  "reset.failedToast": "Couldn’t clear data. Please try again.",

  // ─── Editors ─────────────────────────────────────────────────────────────
  "editors.group": "Editors",
  "editors.empty": "No editors configured. Scan for installed editors, or add one manually.",
  "editors.scan": "Scan for editors",
  "editors.scanning": "Scanning…",
  "editors.addCustom": "Add custom editor",
  "editors.starHint": "The starred editor is used by “Edit”; the rest appear under “Open With”.",
  "editors.group.found": "Found on this computer",
  "editors.defaultEditor": "Default editor",
  "editors.setAsDefault": "Set as default",
  "editors.removeNamed": "Remove {name}",
  "editors.addTitle": "Add Editor",
  "editors.namePlaceholder": "e.g. Sublime Text",
  "editors.executablePath": "Executable path",
  "editors.pathPlaceholder": "/path/to/editor",
  "editors.arguments": "Arguments",
  "editors.argsHintPrefix": "Use",
  "editors.argsHintSuffix": "where the file should go. If omitted, it's added at the end.",
  "editors.selectExecutableTitle": "Select editor executable",
  "editors.addAction": "Add editor",
  "editors.noneFoundToast": "No editors found on this computer.",
  "editors.allAddedToast": "All detected editors are already added.",
  "editors.scanFailedToast": "Couldn't scan for editors.",

  // ─── Editors (fallback copy for src/lib/editor-errors.ts) ─────────────────
  "editors.launchFailedHint":
    "Couldn't open the editor. Configure one in Settings → Editors.",

  // ─── About ───────────────────────────────────────────────────────────────
  "about.group": "About",
  "about.tagline": "A modern desktop client for SSH, SFTP, and S3",
  "about.repository": "Repository",
  "about.repositoryHint": "Source code, issues, and releases on GitHub",
  "about.group.updates": "Updates",
  "about.autoUpdate": "Automatic Updates",
  "about.autoUpdateHint": "Download and install updates in the background, applied on the next launch",
};
