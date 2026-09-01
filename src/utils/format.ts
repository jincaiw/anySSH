import { t } from "../i18n";

/**
 * Format a byte count to a human-readable string.
 * Examples: 0 → "0 B", 1024 → "1.0 KB", 1048576 → "1.0 MB"
 *
 * Unit symbols are the same in every locale we ship, but they still come from
 * the catalogue so a future locale can localise them (e.g. octets).
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return t("common.unit.b", { value: "0" });
  const k = 1024;
  const units = ["common.unit.b", "common.unit.kb", "common.unit.mb", "common.unit.gb", "common.unit.tb"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = (bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0);
  return t(units[i], { value });
}

/**
 * Format a transfer speed in bytes/sec to a human-readable string.
 * Examples: 500 → "500 B/s", 2048 → "2.0 KB/s", 5242880 → "5.0 MB/s"
 */
export function formatSpeed(bps: number): string {
  if (bps < 1024) return t("common.unit.bytesPerSecond", { value: String(bps) });
  if (bps < 1024 * 1024) return t("common.unit.kbPerSecond", { value: (bps / 1024).toFixed(1) });
  return t("common.unit.mbPerSecond", { value: (bps / (1024 * 1024)).toFixed(1) });
}

/**
 * Format an ETA in seconds to a human-readable string.
 * Returns an empty string when eta is null or zero.
 */
export function formatEta(secs: number | null): string {
  if (secs === null || secs <= 0) return "";
  if (secs < 60) return t("common.unit.etaSeconds", { value: String(secs) });
  if (secs < 3600) {
    return t("common.unit.etaMinutes", {
      minutes: Math.floor(secs / 60),
      seconds: secs % 60,
    });
  }
  return t("common.unit.etaHours", {
    hours: Math.floor(secs / 3600),
    minutes: Math.floor((secs % 3600) / 60),
  });
}

import type { TransferStatusValue } from "../types";

/**
 * Coerce a TransferStatusValue (which may be a tagged union object) into a
 * plain string for display or comparison purposes.
 *
 * NOTE: the returned value is the raw backend discriminant, not display copy —
 * it is compared against other status strings throughout the transfer UI. Use
 * `transferStatusLabel()` when you need to show it to the user.
 */
export function getStatusString(status: TransferStatusValue): string {
  if (typeof status === "string") return status;
  if ("Failed" in status) return "Failed";
  return "Unknown";
}
