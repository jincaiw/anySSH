import { t } from "../i18n";

/**
 * Parse a timestamp string from SQLite into a Date.
 * SQLite's `datetime('now')` returns UTC without a trailing "Z", which
 * `new Date()` would otherwise interpret as local time. Append "Z" so the
 * string is parsed as UTC.
 */
export function parseSqliteUtc(isoDate: string): Date {
  return new Date(isoDate.endsWith("Z") ? isoDate : isoDate + "Z");
}

/**
 * Format an ISO date string as a human-readable relative time.
 * Handles SQLite UTC strings without the trailing "Z".
 *
 * The en-US strings are byte-identical to the previous hard-coded copy so the
 * E2E suite keeps matching on them.
 */
export function relativeTime(isoDate: string): string {
  const now = Date.now();
  const then = parseSqliteUtc(isoDate).getTime();
  const diffMs = now - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return t("common.time.justNow");
  if (minutes < 60) return t("common.time.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("common.time.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days === 1) return t("common.time.yesterday");
  if (days < 30) return t("common.time.daysAgo", { count: days });
  return t("common.time.monthsAgo", { count: Math.floor(days / 30) });
}
