import { useEffect } from "react";
import { useSessionStore } from "../stores/session-store";
import type { SshStatusPayload } from "../types";

/**
 * Global listener for session status events emitted by the Rust backend:
 * `ssh:status` for SSH sessions and `term:status` for the generic
 * character-stream layer (telnet / serial / local PTY). Both update the
 * session store so the UI reflects connection state changes.
 * Mount once in AppShell.
 */
export function useSshStatus(): void {
  const updateStatus = useSessionStore((s) => s.updateStatus);

  useEffect(() => {
    let cancelled = false;
    const unlistens: Array<() => void> = [];

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;

      // Both channels carry the same payload shape, so one handler serves
      // both; the term layer reuses ConnectionStatus verbatim.
      const onStatus = (event: { payload: SshStatusPayload }) => {
        const { session_id, status } = event.payload;
        updateStatus(session_id, status.status, status.message);
      };

      const un = await listen<SshStatusPayload>("ssh:status", onStatus);
      if (cancelled) {
        un();
        return;
      }
      unlistens.push(un);

      const unTerm = await listen<SshStatusPayload>("term:status", onStatus);
      if (cancelled) {
        unTerm();
        return;
      }
      unlistens.push(unTerm);
    })();

    return () => {
      cancelled = true;
      unlistens.forEach((fn) => fn());
    };
  }, [updateStatus]);
}
