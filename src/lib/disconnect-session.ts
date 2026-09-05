import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../stores/session-store";

/**
 * Kind-aware session teardown.
 *
 * Closing a terminal used to hard-code `ssh_disconnect`, which silently
 * leaked telnet/serial/local sessions in the TermManager (PTY/serial handles
 * stayed open until app exit). This helper reads the session's `kind` from
 * the session store and routes the teardown to the owning backend:
 *
 * - `telnet` / `serial` / `local` → `term_close` (term module)
 * - `ssh` / unknown-store-entry    → `ssh_disconnect` (SshManager)
 * - anything else (defensive)      → both backends; each is a no-op for a
 *   session id it doesn't own, so trying both is always safe.
 */
export async function disconnectSession(sessionId: string): Promise<void> {
  const kind = useSessionStore.getState().sessions.get(sessionId)?.kind;

  try {
    if (kind === "telnet" || kind === "serial" || kind === "local") {
      await invoke("term_close", { sessionId });
    } else if (kind === "ssh" || kind === undefined) {
      await invoke("ssh_disconnect", { sessionId });
    } else {
      await invoke("ssh_disconnect", { sessionId }).catch(() => {
        /* not an ssh session */
      });
      await invoke("term_close", { sessionId }).catch(() => {
        /* not a term session */
      });
    }
  } catch {
    /* already disconnected */
  }
}
