// ─── host (en-US) ───────────────────────────────────────────────────────
//
// Host edit / new-host modal and its auth, proxy and tunnel fields.
//
// Keys are written WITHOUT the `host.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Modal shell ────────────────────────────────────────────────────────
  "title.new": "New Host",
  "title.edit": "Edit Host",
  "action.connecting": "Connecting…",
  "action.saving": "Saving…",
  "action.deleting": "Deleting…",
  loading: "Loading host data",

  // ─── Sections ───────────────────────────────────────────────────────────
  "section.connection": "Connection",
  "section.tunnel": "Tunnel",
  "section.advanced": "Advanced",
  "section.appearance": "Appearance",
  "section.notes": "Notes",

  // ─── Field labels ───────────────────────────────────────────────────────
  "field.authType": "Auth Type",
  "field.sshKey": "SSH Key",
  "field.passphrase": "Passphrase",
  "field.keepAlive": "Keep Alive",
  "field.keepAliveSeconds": "(seconds)",
  "field.defaultShell": "Default Shell",
  "field.startupCommand": "Startup Command",
  "field.startDirectory": "Start Directory",
  "field.forceSessionLog": "Force session log",
  "field.forceSessionLogHint": "(record every connection)",
  "field.terminalEncoding": "Terminal Encoding",
  "field.lang": "Locale (LANG)",
  "field.environment": "Environment",
  "field.osType": "OS Type",
  "field.terminalTheme": "Terminal Theme",
  "field.terminalThemeHint": "Colour scheme for this connection only; empty follows the global default.",
  "field.backspace": "Backspace Key",
  "field.backspaceHint": "Switch to Ctrl+H (8) when this legacy bastion TUI ignores Backspace in its input fields.",

  // ─── Field placeholders ─────────────────────────────────────────────────
  "field.labelPlaceholder": "e.g., Production Server",
  "field.hostPlaceholder": "192.168.1.1 or hostname",
  "field.usernamePlaceholder": "root",
  "field.selectKey": "Select a key...",
  "field.passwordPrompt": "Enter password to connect",
  "field.passphrasePrompt": "Leave empty if none",
  "field.startDirectoryHint":
    "Directory the file browser opens in. Defaults to the home folder.",
  "field.followGlobal": "Follow global ({value})",
  "field.followGlobalNoValue": "Follow global",
  "field.terminalHint":
    "LANG sets the remote session's locale; leave empty to follow the global setting. Falls back to startup injection when a bastion host filters environment variables.",

  // ─── Auth methods (AuthType discriminants) ──────────────────────────────
  "auth.password": "Password",
  "auth.privateKey": "Private Key",

  // ─── Keychain credential ────────────────────────────────────────────────
  "credential.saved": "Credential saved in system keychain",
  "credential.clearAria": "Clear saved credential",
  "credential.mask": "••••••••",
  "credential.browseTitle":
    "Select SSH Private Key (Cmd+Shift+. to show hidden files)",
  "credential.invalidKey": "Invalid key file",

  // ─── Group picker ───────────────────────────────────────────────────────
  "group.none": "No group",

  // ─── Tunnel / ProxyJump ─────────────────────────────────────────────────
  "tunnel.toggle": "Connect through SSH tunnel",
  "tunnel.host": "Tunnel Host",
  "tunnel.placeholder": "Select a host…",
  "tunnel.hintNoHosts": "Create another saved host first to tunnel through it.",
  "tunnel.stale":
    "The previously selected tunnel host is no longer available. Pick another or disable the tunnel.",
  "tunnel.noCandidates":
    "No other saved hosts available to tunnel through. Create another host first.",

  // ─── Appearance ─────────────────────────────────────────────────────────
  "appearance.autoTitle": "Auto (hash-based)",
  "appearance.autoAria": "Auto color",
  "appearance.auto": "Auto",
  "appearance.colorAria": "Color {color}",

  // ─── Option lists (values are backend discriminants) ────────────────────
  "environment.production": "Production",
  "environment.staging": "Staging",
  "environment.dev": "Dev",
  "environment.testing": "Testing",
  "os.auto": "Auto",
  "os.linux": "Linux",
  "os.macos": "macOS",
  "os.windows": "Windows",
  "os.freebsd": "FreeBSD",

  // ─── Notes ──────────────────────────────────────────────────────────────
  "notes.placeholder": "Notes about this server...",

  // ─── Delete confirmation ────────────────────────────────────────────────
  "delete.question": "Delete this host?",

  // ─── Validation ─────────────────────────────────────────────────────────
  "validation.hostRequired": "Host is required",
  "validation.usernameRequired": "Username is required",
  "validation.portRange": "Port must be between 1 and 65535",
  "validation.keepAlive": "Keep Alive must be a positive number",
  "validation.langInvalid": "Invalid LANG format (e.g. zh_CN.UTF-8)",
  "validation.noTunnelHosts":
    "No other saved hosts are available to tunnel through",
  "validation.selectTunnelHost":
    "Select a tunnel host or disable the SSH tunnel",

  // ─── Errors ─────────────────────────────────────────────────────────────
  "error.load": "Failed to load host data",
  "error.save": "Failed to save host",
  "error.delete": "Failed to delete host",
  "error.connect": "Connection failed",
};
