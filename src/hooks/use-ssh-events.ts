import { useEffect, useRef } from "react";
import type { SessionId, SshOutputPayload } from "../types";

export function useSshOutput(
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

      const un = await listen<SshOutputPayload>("ssh:output", (event) => {
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
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [sessionId]);
}
