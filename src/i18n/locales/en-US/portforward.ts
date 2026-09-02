// ─── portforward (en-US) ───────────────────────────────────────────────────────
//
// SSH port forwarding rules and tunnels.
//
// Keys are written WITHOUT the `portforward.` prefix — the locale index adds it.
// Bars are E2E-visible: keep them identical to the previous hard-coded copy.

export default {
  // ─── Page ───────────────────────────────────────────────────────────────
  title: "Tunnels",
  subtitle: "Forward local ports to remote services through SSH tunnels for secure database, API, and service access",

  // ─── Search ─────────────────────────────────────────────────────────────
  "search.placeholder": "Search rules...",
  "search.label": "Search forwarding rules",

  // ─── Toolbar ────────────────────────────────────────────────────────────
  newRule: "New Rule",

  // ─── Rule cards ─────────────────────────────────────────────────────────
  standalone: "Standalone",
  portFallback: "Port {port}",
  startTunnel: "Start tunnel",
  stopTunnel: "Stop tunnel",
  copyAddress: "Copy localhost address",
  connections: "{count} conn",
  auto: "auto",

  // ─── Context menu ───────────────────────────────────────────────────────
  "context.startTunnel": "Start Tunnel",
  "context.stopTunnel": "Stop Tunnel",

  // ─── Empty / no-match states ────────────────────────────────────────────
  noMatch: "No rules match “{query}”",
  "empty.title": "No forwarding rules yet",
  "empty.hint": "Forward local ports to remote services through SSH tunnels",

  // ─── Delete confirmation ────────────────────────────────────────────────
  "delete.title": "Delete this tunnel rule?",
  "delete.message": "This tunnel rule will be permanently removed.",

  // ─── Rule dialog ────────────────────────────────────────────────────────
  "dialog.newTitle": "New Rule",
  "dialog.editTitle": "Edit Rule",
  "dialog.create": "Create",

  "section.connection": "Connection",
  "section.ports": "Ports",
  "section.options": "Options",

  noHosts: "No saved hosts. Add a host first.",
  "placeholder.label": "My Database",
  "placeholder.description": "Production read replica for analytics...",

  localPort: "Local Port",
  remotePort: "Remote Port",
  "placeholder.port": "5432",

  bindAddress: "Bind Address",
  "bind.localOnly": "127.0.0.1 (local only)",
  "bind.allInterfaces": "0.0.0.0 (all interfaces)",

  autoStart: "Auto-start",
  autoStartHint: "Start tunnel when host connects",

  // ─── Errors ─────────────────────────────────────────────────────────────
  startFailed: "Tunnel failed to start",
};
