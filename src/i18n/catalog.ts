import type { Catalog, Locale } from "./types";
import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";

/**
 * Every compiled catalogue, keyed by locale.
 *
 * `en-US` is the source of truth: it doubles as the fallback whenever a key is
 * missing from another locale (or that locale hasn't been updated yet), and it
 * must stay byte-identical to the historical hard-coded English copy so the
 * WebdriverIO E2E suite — which selects elements by visible text — keeps
 * passing. Never "improve" an `en-US` string as part of a translation change.
 */
export const CATALOGS: Record<Locale, Catalog> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

/** The locale every other locale falls back to. */
export const FALLBACK_LOCALE: Locale = "en-US";
