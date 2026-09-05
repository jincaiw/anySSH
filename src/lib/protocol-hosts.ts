import { useHostsStore } from "../stores/hosts-store";
import type { SavedHost } from "../types";

/**
 * Multi-protocol saved hosts (P5): telnet/serial/vnc/rdp quick-connect
 * sessions persist themselves into `saved_hosts` (kind + params_json, see
 * plan §5 lines 337–342) so they behave like regular host cards — click to
 * reconnect, groups, drag ordering.
 *
 * Secrets are intentionally NOT persisted (matching the SSH host contract):
 * RDP reconnects re-prompt for the password; VNC auth (if any) is handled
 * inside the RFB handshake by noVNC.
 */

export type ProtocolHostKind = "telnet" | "serial" | "local" | "vnc" | "rdp";

/** Build a `SavedHost` payload for a non-SSH protocol. SSH-specific fields
 *  (username/auth/key…) are filled with inert defaults — the reconnect path
 *  for these kinds never reads them. */
export function buildProtocolHost(
  kind: ProtocolHostKind,
  label: string,
  host: string,
  port: number,
  params: unknown,
  username = "",
): SavedHost {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    label,
    host,
    port,
    username,
    auth_type: "none",
    group_id: null,
    created_at: now,
    updated_at: now,
    key_path: null,
    color: null,
    notes: null,
    environment: null,
    os_type: null,
    startup_command: null,
    proxy_jump: null,
    proxy_jump_host_id: null,
    start_directory: null,
    keep_alive_interval: null,
    default_shell: null,
    lang: null,
    terminal_encoding: null,
    backspace_sends_ctrl_h: null,
    terminal_theme: null,
    font_size: null,
    last_connected_at: null,
    connection_count: null,
    force_session_log: null,
    kind,
    params_json: JSON.stringify(params),
  };
}

/** Persist a protocol host card. Best-effort from the caller's perspective:
 *  the session is already (or about to be) open — a failed save must not
 *  break the connection, so errors are logged and swallowed after a refresh
 *  attempt. */
export async function persistProtocolHost(host: SavedHost): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("save_host", { host });
    await useHostsStore.getState().loadHosts();
  } catch (err) {
    console.error("Failed to save protocol host:", err);
  }
}

/** True when the host card is an SSH (or legacy untyped) entry. */
export function isSshHost(host: SavedHost): boolean {
  return !host.kind || host.kind === "ssh" || host.kind === "s3";
}
