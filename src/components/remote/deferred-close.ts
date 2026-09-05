/**
 * StrictMode-safe deferred teardown for protocol canvases.
 *
 * React StrictMode (enabled in dev) mounts → unmounts → remounts every
 * component once, so a canvas effect's cleanup runs *before* the second
 * mount connects. The cleanup of VncCanvas/RdpCanvas revokes the one-time
 * bridge token (`vnc_close` / `rd_close`); when that happens synchronously
 * the token is gone by the time the second mount tries to connect, and the
 * bridge rejects the handshake. The same race exists for any future effect
 * re-run triggered by a dependency change.
 *
 * The fix: make the backend-revoke step *deferred*. Cleanup registers a
 ~300 ms timer; the effect start calls `cancelDeferredClose` so a genuine
 * unmount (no follow-up mount) still tears down promptly, while a
 * StrictMode remount cancels the pending revoke instead.
 */

type CloseFn = () => Promise<unknown> | void;

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Cancel a pending deferred close registered under `key` (no-op if none). */
export function cancelDeferredClose(key: string): void {
  const id = pending.get(key);
  if (id !== undefined) {
    clearTimeout(id);
    pending.delete(key);
  }
}

/**
 * Schedule `close` to run after `delayMs` unless `cancelDeferredClose(key)`
 * runs first. Errors are swallowed — teardown is best-effort.
 */
export function deferClose(key: string, close: CloseFn, delayMs = 300): void {
  cancelDeferredClose(key);
  const id = setTimeout(() => {
    pending.delete(key);
    void Promise.resolve()
      .then(close)
      .catch(() => {
        /* teardown is best-effort */
      });
  }, delayMs);
  pending.set(key, id);
}
