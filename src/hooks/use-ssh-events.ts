import { useEffect, useRef } from "react";
import type { SessionId, SshOutputPayload } from "../types";

/**
 * Which event channel a terminal reads its output stream from. SSH sessions
 * keep the legacy `ssh:output` channel (zero regression); every new
 * character-stream kind (telnet / serial / local PTY) shares the generic
 * `term:output` channel emitted by the term layer.
 */
export type TermChannel = "ssh" | "term";

function useChannelOutput(
  channel: TermChannel,
  sessionId: SessionId | null,
  onData: (data: Uint8Array) => void,
): void {
  const onDataRef = useRef(onData);
  onDataRef.current = onData;

  useEffect(() => {
    if (!sessionId) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      if (cancelled) return;

      const un = await listen<SshOutputPayload>(`${channel}:output`, (event) => {
        if (event.payload.session_id === sessionId) {
          onDataRef.current(new Uint8Array(event.payload.data));
        }
      });
      // The component can unmount while `listen()` is still resolving: the
      // cleanup below then ran with `unlisten` still undefined, and this
      // assignment leaked a listener for the rest of the process. Its
      // callback calls ensureTerminal(sessionId), which would resurrect an
      // xterm instance for an already-disposed session.
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      if (channel === "term") {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!cancelled) await invoke("term_start", { sessionId }).catch(() => {});
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [sessionId, channel]);
}

/** Terminal output for SSH sessions (`ssh:output`). */
export function useSshOutput(
  sessionId: SessionId | null,
  onData: (data: Uint8Array) => void,
): void {
  useChannelOutput("ssh", sessionId, onData);
}

/** Terminal output for telnet / serial / local-PTY sessions (`term:output`,
 *  emitted by the backend term layer). Pass `null` to disable. */
export function useTermOutput(
  sessionId: SessionId | null,
  onData: (data: Uint8Array) => void,
): void {
  useChannelOutput("term", sessionId, onData);
}
