// Dual-factor bastion helpers shared by the connect surfaces.
//
// A dual-factor bastion (堡垒机) only dispatches its SMS/OTP code after
// receiving a password response. The backend's `trigger_dual_factor_sms`
// command connects once with an empty password (strategy B answers the
// trigger prompt with a non-empty placeholder) and swallows the inevitable
// failure — the SMS is the outcome, not a session.

/** Fire the SMS/OTP dispatch in the background. Fire-and-forget: every
 *  outcome (rejection, timeout, network error) is absorbed on the Rust side. */
export function fireDualFactorTrigger(hostId: string): void {
  void (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("trigger_dual_factor_sms", { hostId });
    } catch {
      /* trigger is best-effort — the user can resend from the prompt */
    }
  })();
}
