// Localising errors that originate in the Rust backend.
//
// Every backend error enum (`SshError`, `SftpError`, `ScpError`, `S3Error`,
// `DbError`, `VaultError`, `BackupError`) serialises itself as
// `{ kind, message }` — see e.g. src-tauri/src/types/error.rs. `kind` is a
// stable, machine-readable discriminant, so it is a safe translation key;
// `message` is an English sentence of the form `"<prefix>: <detail>"`.
//
// We deliberately do NOT translate the Rust side. Instead we swap the English
// prefix for the localized one and keep the detail verbatim — the detail is
// usually an OS or protocol message (`Connection refused (os error 61)`) that
// is more useful untranslated, and translating it would mean mirroring every
// third-party error string in two catalogues.

import { translate, translateIfPresent, FALLBACK_LOCALE } from "../i18n";

/**
 * Error kinds whose Rust `#[error(…)]` has no `{0}` placeholder, i.e. the
 * localized label *is* the entire message. Appending a detail to these would
 * repeat the sentence in two languages.
 */
const CONSTANT_MESSAGE_KINDS = new Set([
  "already_disconnected", // "Session already disconnected"
  "cancelled", // "Connection cancelled"
  "transfer_cancelled", // "Transfer cancelled"
  "decrypt", // "Incorrect password, or the backup file is corrupt"
]);

/**
 * Longest English `<prefix>` we're willing to strip as a prefix rather than
 * treat as part of the detail. Guards against slicing a path like
 * `/mnt/c/Users/Bob: file.txt` in half.
 */
const MAX_PREFIX_LENGTH = 64;

/** The `kind` discriminant of a backend error, if there is one. */
export function errorKindOf(err: unknown): string | null {
  if (err && typeof err === "object" && "kind" in err) {
    const kind = (err as { kind: unknown }).kind;
    if (typeof kind === "string" && kind.length > 0) return kind;
  }
  return null;
}

/** The `message` half of a backend error, or the value itself when it's a string. */
export function rawErrorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "";
}

/**
 * Split `"<English prefix>: <detail>"` into just `<detail>`.
 *
 * The prefix is matched against the en-US label when possible, and otherwise
 * peeled off at the first `": "`. The raw message is returned unchanged when
 * neither applies — for `DbError::Validation` the whole message *is* the
 * detail.
 */
function detailOf(raw: string, englishLabel: string | null): string {
  if (englishLabel && raw.startsWith(englishLabel)) {
    return raw.slice(englishLabel.length).replace(/^:\s*/, "").trim();
  }
  const idx = raw.indexOf(": ");
  if (idx > -1 && idx <= MAX_PREFIX_LENGTH) return raw.slice(idx + 2).trim();
  return raw;
}

/**
 * Turn a rejected `invoke()` into a message shown in the user's language.
 *
 * Falls through to the backend's own English message when the `kind` is
 * unknown to the catalogue — an untranslated error beats a raw i18n key.
 */
export function localizeBackendError(err: unknown): string {
  const raw = rawErrorMessage(err).trim();
  const kind = errorKindOf(err);

  if (kind) {
    const label = translateIfPresent(`errors.${kind}`);
    if (label) {
      if (CONSTANT_MESSAGE_KINDS.has(kind)) return label;
      const detail = detailOf(raw, translate(FALLBACK_LOCALE, `errors.${kind}`));
      return detail ? `${label}: ${detail}` : label;
    }
  }

  return raw || String(translateIfPresent("errors.unknown") ?? "Something went wrong");
}

/**
 * Marker the Rust auth path appends when the dual-factor bastion trigger
 * was delivered from an empty-password connect. The auth failure is then
 * EXPECTED — the SMS / OTP dispatch is the outcome — so UI surfaces show a
 * friendly localized guide above (or instead of) the technical trail.
 */
export const DUAL_FACTOR_TRIGGER_MARKER = "dual-factor trigger sent";

/** Localized next-step guidance when the marker is present, else null. */
export function dualFactorHintOf(message: string | null | undefined): string | null {
  if (!message || !message.includes(DUAL_FACTOR_TRIGGER_MARKER)) return null;
  return translateIfPresent("dashboard.connect.dualFactorTriggered");
}
