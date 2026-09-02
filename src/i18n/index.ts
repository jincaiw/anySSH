// ─── i18n runtime ───────────────────────────────────────────────────────────
//
// A minimal translation layer built on Zustand (already a dependency) instead
// of react-i18next: we need lookup, `{name}` interpolation and CLDR plural
// selection — nothing more.
//
// Three entry points:
//   • `useTranslation()`  — reactive, for components. Re-renders on switch.
//   • `t()`               — non-reactive, for stores / hooks / utils (toasts,
//                           error strings) that run outside React's render.
//   • `useI18nStore`      — the locale store, for the language picker.

import { useMemo } from "react";
import { create } from "zustand";
import { CATALOGS, FALLBACK_LOCALE } from "./catalog";
import type { Catalog, Locale, TVars } from "./types";

export type { Locale, TVars } from "./types";
export { FALLBACK_LOCALE } from "./catalog";

/** Locales offered in Settings, in display order. */
export const LOCALES: Locale[] = ["zh-CN", "en-US"];

/** Used when the OS language matches nothing we ship. */
export const DEFAULT_LOCALE: Locale = "zh-CN";

/** Endonyms — a language picker always shows each language in its own script. */
export const LOCALE_LABELS: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "en-US": "English",
};

/** localStorage mirror of the persisted choice (see `app_language` below). */
const STORAGE_KEY = "anyssh.locale";

/** Backend settings key — the same store that keeps theme/accent/font. */
export const LANGUAGE_SETTING_KEY = "app_language";

// ─── Locale resolution ──────────────────────────────────────────────────────

export function isLocale(value: unknown): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

/** Map a BCP-47 tag (`zh`, `zh-Hans-CN`, `en-GB`, …) onto a shipped locale. */
export function matchLocale(tag: string | undefined | null): Locale | null {
  if (!tag) return null;
  const t = tag.toLowerCase();
  if (t.startsWith("zh")) return "zh-CN";
  if (t.startsWith("en")) return "en-US";
  return null;
}

function systemLocales(): string[] {
  if (typeof navigator === "undefined") return [];
  const nav = navigator as Navigator & { languages?: readonly string[] };
  if (nav.languages && nav.languages.length > 0) return [...nav.languages];
  return nav.language ? [nav.language] : [];
}

/**
 * Pick the locale for the very first render.
 *
 * Precedence:
 *   1. Vitest — force `en-US`. The unit specs assert on English copy, and the
 *      product default is Chinese, so without this the whole suite would need
 *      rewriting. (`process.env.VITEST` is set by the runner.)
 *   2. `data-lang` on `<html>`, injected by the Rust `setup()` hook before the
 *      first paint (mirrors how theme/accent/font avoid a startup flash). This
 *      carries both the persisted choice and the `ANYSSH_UI_LANG` override the
 *      E2E container sets, so specs see a stable English UI.
 *   3. The user's previous choice, mirrored in localStorage.
 *   4. The OS/UI language; anything we don't ship falls through to
 *      `DEFAULT_LOCALE`.
 */
export function detectInitialLocale(): Locale {
  if (typeof process !== "undefined" && process.env?.VITEST) return "en-US";

  if (typeof document !== "undefined") {
    const injected = document.documentElement.dataset.lang;
    if (isLocale(injected)) return injected;
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* localStorage unavailable (private mode, blocked storage) — ignore */
  }

  for (const tag of systemLocales()) {
    const match = matchLocale(tag);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

// ─── Store ──────────────────────────────────────────────────────────────────

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/** Keep `<html lang>` in sync so screen readers and IMEs follow the UI. */
function applyDocumentLang(locale: Locale) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
}

/** Fire-and-forget persistence to the SQLite settings table. */
function persistLocale(locale: Locale) {
  void (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_setting", { key: LANGUAGE_SETTING_KEY, value: locale });
    } catch {
      /* backend unavailable (plain web/dev context) — localStorage still has it */
    }
  })();
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: detectInitialLocale(),
  setLocale: (locale) => {
    set({ locale });
    applyDocumentLang(locale);
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* best-effort */
    }
    persistLocale(locale);
  },
}));

// ─── Lookup ─────────────────────────────────────────────────────────────────

/**
 * Resolve `key` against `catalog`, honouring CLDR plural suffixes when `vars`
 * carries a `count`.
 *
 * Given `t("common.selectedCount", { count: 3 })` we look for
 * `common.selectedCount_other`
 * (`_one` when the count is singular in this locale) before falling back to the
 * bare key. Chinese only ever selects `other`; English selects `one`/`other`.
 */
function pluralKey(key: string, count: number, locale: Locale): string {
  let suffix = "other";
  try {
    suffix = new Intl.PluralRules(locale).select(count);
  } catch {
    /* PluralRules unavailable — assume `other` */
  }
  return `${key}_${suffix}`;
}

const INTERPOLATION = /\{(\w+)\}/g;

/** Translate `key` in `locale`, interpolating `{name}` placeholders. */
export function translate(locale: Locale, key: string, vars?: TVars): string {
  const catalog: Catalog = CATALOGS[locale];

  let raw = catalog[key];
  if (raw === undefined && vars && typeof vars.count === "number") {
    raw = catalog[pluralKey(key, vars.count, locale)];
  }

  // Fall back to English rather than showing a raw key to a Chinese user.
  if (raw === undefined) {
    raw = CATALOGS[FALLBACK_LOCALE][key];
    if (raw === undefined && vars && typeof vars.count === "number") {
      raw = CATALOGS[FALLBACK_LOCALE][pluralKey(key, vars.count, FALLBACK_LOCALE)];
    }
  }

  if (raw === undefined) {
    if (import.meta.env?.DEV) {
      console.warn(`[i18n] missing translation for "${key}"`);
    }
    return key;
  }

  if (!vars) return raw;
  return raw.replace(INTERPOLATION, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Non-reactive `t` — reads the locale at call time. Safe outside React. */
export function t(key: string, vars?: TVars): string {
  return translate(useI18nStore.getState().locale, key, vars);
}

/**
 * Like `t()` but returns `null` instead of a fallback when the key exists in
 * neither catalogue.
 *
 * Used by the backend-error mapper: an unmapped error `kind` should fall back
 * to the English message the backend sent, not to a raw i18n key.
 */
export function translateIfPresent(key: string, vars?: TVars): string | null {
  const locale = useI18nStore.getState().locale;
  const direct = CATALOGS[locale][key] ?? CATALOGS[FALLBACK_LOCALE][key];
  if (direct !== undefined) return translate(locale, key, vars);
  if (vars && typeof vars.count === "number") {
    const plural = pluralKey(key, vars.count, locale);
    if (CATALOGS[locale][plural] ?? CATALOGS[FALLBACK_LOCALE][plural]) {
      return translate(locale, key, vars);
    }
  }
  return null;
}

/** Reactive `t` for components: re-renders the caller when the locale changes. */
export function useTranslation() {
  const locale = useI18nStore((s) => s.locale);
  const t = useMemo(
    () => (key: string, vars?: TVars) => translate(locale, key, vars),
    [locale],
  );
  return { t, locale };
}

/**
 * Adopt the language persisted in the backend (`app_language`) once settings
 * load. Called from `loadSettings` — the Rust pre-paint hook already covers the
 * common case, this just catches a first-run write or an out-of-band change.
 */
export function applyPersistedLocale(value: string | null | undefined) {
  if (!isLocale(value)) return;
  const current = useI18nStore.getState().locale;
  if (current === value) return;
  useI18nStore.setState({ locale: value });
  applyDocumentLang(value);
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* best-effort */
  }
}

// Apply the initial value on load so `<html lang>` is right even if the user
// never opens Settings.
applyDocumentLang(useI18nStore.getState().locale);
