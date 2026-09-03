// ─── dashboard (en-US) ───────────────────────────────────────────────────────
//
// Hosts dashboard: cards, groups, recent connections, import.
//
// Keys are written WITHOUT the `dashboard.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Page chrome ────────────────────────────────────────────────────────
  title: "Hosts",
  subtitle:
    "Manage your saved servers, organize them into groups, and connect with one click",
  "search.placeholder": "Search hosts...",
  "search.ariaLabel": "Search hosts",
  "heading.groups": "Groups",
  "heading.hosts": "Hosts",
  "heading.cloudStorage": "Cloud Storage",

  // ─── Action buttons ─────────────────────────────────────────────────────
  "action.newServer": "New Server",
  "action.newServerHint": "New Server (Cmd+T)",
  "action.newS3": "New S3",
  "action.newS3Hint": "New S3 Connection",
  "action.newGroup": "New Group",
  "action.import": "Import",
  "action.importHint": "Import from SSH Config",
  "action.allHosts": "All Hosts",
  "action.backToAllHosts": "Back to all hosts",

  // ─── Feedback ───────────────────────────────────────────────────────────
  saving: "Saving…",
  duplicateSuffix: "(copy)",
  "error.loadHosts": "Failed to load hosts",
  "error.loadGroups": "Failed to load groups",
  "toast.reorderHostsFailed": "Couldn't save the new host order — reverted.",
  "toast.reorderGroupsFailed": "Couldn't save the new group order — reverted.",
  "toast.reorderS3Failed": "Couldn't save the new connection order — reverted.",

  // ─── Empty states ───────────────────────────────────────────────────────
  "empty.noMatch": "No hosts match “{query}”",
  "empty.noHostsInGroup": "No hosts in this group yet.",
  "empty.noSavedHosts": "No saved hosts yet. Connect to a server to save it here.",

  // ─── Connection dialog ──────────────────────────────────────────────────
  "connect.connecting": "Connecting...",
  "connect.failedTitle": "Connection Failed",
  "connect.fallback": "Connection failed. Check host, port, and credentials.",
  "connect.fallbackShort": "Connection failed.",
  "connect.s3Fallback": "S3 connection failed",
  "connect.passwordPromptTitle": "Authentication",
  "connect.passwordLabel": "Password",
  "connect.passwordPlaceholder": "Enter your password",
  "connect.passwordRequired": "Password cannot be empty.",
  "connect.passwordRemember": "Remember password",
  "connect.passwordDualFactorHint": "Dual-factor bastion: type static password + dynamic code (concatenated, no spaces)",
  "connect.passwordShow": "Show password",
  "connect.passwordHide": "Hide password",
  "connect.passwordSubmit": "Connect",
  "connect.passwordCancel": "Cancel",

  // ─── Host card ──────────────────────────────────────────────────────────
  "hostCard.connectTo": "Connect to {name}",
  "hostCard.ping": "Ping",
  "hostCard.pingAria": "Ping {name}",
  "hostCard.terminal": "Terminal",
  "hostCard.explorer": "Explorer",
  "hostCard.openTerminalFor": "Open terminal for {name}",
  "hostCard.openExplorerFor": "Open explorer for {name}",
  "hostCard.subtitle": "SSH, {username}",
  "hostCard.tunnelsThrough": "Tunnels through {name}",
  "hostCard.via": "via {name}",
  "hostCard.deleteTitle": "Delete this host?",
  "hostCard.deleteMessage": "This host will be permanently removed.",

  // ─── Health check (HostHealthStatus discriminants) ──────────────────────
  "health.checking": "Pinging...",
  "health.reachable": "SSH reachable{latency}",
  "health.dnsFailed": "DNS failed",
  "health.portClosed": "Port unreachable",
  "health.sshFailed": "SSH failed",
  "health.failed": "Ping failed",

  // ─── Environment badges ─────────────────────────────────────────────────
  "env.production": "PROD",
  "env.staging": "STAGE",
  "env.dev": "DEV",
  "env.testing": "TEST",

  // ─── OS labels ──────────────────────────────────────────────────────────
  "os.linux": "Linux",
  "os.macos": "macOS",
  "os.windows": "Windows",
  "os.freebsd": "FreeBSD",

  // ─── S3 card ────────────────────────────────────────────────────────────
  "s3Card.explore": "Explore",
  "s3Card.deleteTitle": "Delete this S3 connection?",
  "s3Card.deleteMessage": "This connection will be permanently removed.",

  // ─── Group card ─────────────────────────────────────────────────────────
  "group.hostCount_one": "{count} host",
  "group.hostCount_other": "{count} hosts",
  "group.delete": "Delete Group",

  // ─── Group modal ────────────────────────────────────────────────────────
  "groupModal.titleEdit": "Edit Group",
  "groupModal.namePlaceholder": "e.g., Production, Staging, Home Lab",
  "groupModal.icon": "Icon",
  "groupModal.colorAria": "Color {color}",
  "groupModal.create": "Create Group",
  "groupModal.errorNameRequired": "Group name is required",
  "groupModal.errorSaveFailed": "Failed to save group",

  // ─── Group delete dialog ────────────────────────────────────────────────
  "groupDelete.title": 'Delete "{name}"?',
  "groupDelete.confirmWithHosts": "Delete Group & Hosts",
  "groupDelete.empty": "This empty group will be permanently removed.",
  "groupDelete.contains_one": "This group contains {count} host.",
  "groupDelete.contains_other": "This group contains {count} hosts.",
  "groupDelete.alsoDelete_one": "Also delete all {count} host in this group",
  "groupDelete.alsoDelete_other": "Also delete all {count} hosts in this group",
  "groupDelete.uncheckedHint": "Unchecked: hosts will be moved out of the group",

  // ─── Recent connections ─────────────────────────────────────────────────
  "recent.heading": "Recent",
  "recent.ariaLabel": "Recent connections",
  "recent.reconnectTo": "Reconnect to {name} ({username}@{host}:{port})",

  // ─── SSH config import ──────────────────────────────────────────────────
  "import.title": "Import SSH Config",
  "import.done": "Done",
  "import.importing": "Importing…",
  "import.submit_one": "Import {count} host",
  "import.submit_other": "Import {count} hosts",
  "import.result_one": "{count} host imported",
  "import.result_other": "{count} hosts imported",
  "import.skipped": "{count} skipped",
  "import.scanning": "Scanning SSH config...",
  "import.browse": "Browse for config file",
  "import.noHosts": "No hosts found in SSH config",
  "import.tryAnother": "Try a different file",
  "import.change": "Change",
  "import.all": "All",
  "import.selected": "{selected} of {total} selected",
  "import.badgePattern": "pattern",
  "import.badgeExists": "exists",
  "import.errorParse": "Failed to parse SSH config",
  "import.errorSave": "Import failed",
  "import.browseTitle": "Select SSH config file",
};
