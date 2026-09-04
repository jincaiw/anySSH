// Dual-factor bastion helpers shared by the connect surfaces.
//
// A dual-factor bastion (堡垒机) only dispatches its SMS/OTP code after
// receiving a password response. The backend's `trigger_dual_factor_sms`
// command connects once with an empty password (strategy B answers the
// trigger prompt with a non-empty placeholder) and swallows the inevitable
// failure — the SMS is the outcome, not a session.

/** Outcome of a trigger attempt. `skipped` means an attempt for this host is
 *  already in flight (we never stack connections — a bastion that receives N
 *  trigger attempts sends N texts and may lock the account). */
export type DualFactorTriggerStatus = "sent" | "connected" | "unreachable" | "timeout" | "skipped";

/** Hosts with a trigger attempt currently in flight. Guards against double
 *  clicks on a host card, the resend button being hammered, and two surfaces
 *  (dashboard + host editor) firing for the same host at once. */
const inFlight = new Set<string>();

/** True when the bastion was actually reached and dispatched a code. */
export function triggerDispatched(status: DualFactorTriggerStatus): boolean {
  return status === "sent" || status === "connected";
}

/** Fire the SMS/OTP dispatch in the background. Never rejects: every failure
 *  is reported through the resolved status so callers can decide what to tell
 *  the user (an unreachable bastion means no code is coming). */
export async function fireDualFactorTrigger(hostId: string): Promise<DualFactorTriggerStatus> {
  if (inFlight.has(hostId)) return "skipped";
  inFlight.add(hostId);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const status = await invoke<DualFactorTriggerStatus>("trigger_dual_factor_sms", { hostId });
    return status ?? "unreachable";
  } catch {
    // Command-level failure (host deleted mid-flight, backend panic, …) —
    // treat like an unreachable host so the caller can surface it.
    return "unreachable";
  } finally {
    inFlight.delete(hostId);
  }
}
