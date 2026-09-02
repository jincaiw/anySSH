// ─── i18n type contracts ────────────────────────────────────────────────────
//
// AnySSH ships a small, dependency-free i18n layer (no react-i18next): the UI
// is a thin view layer and the copy is plain strings, so a ~200-line module
// covers lookup, interpolation, CLDR pluralisation and persistence.

/** Locales the UI is translated into. `zh-CN` is the product default. */
export type Locale = "zh-CN" | "en-US";

/**
 * A namespace catalogue: flat, dot-separated keys → localized string.
 *
 * Namespace files export keys *without* their namespace prefix; the per-locale
 * index prefixes them (so `settings.ts` → `settings.*`). Nesting is tolerated
 * and flattened at load time, but flat keys are preferred: they keep diffs
 * readable and make duplicate keys obvious.
 */
export type Catalog = Record<string, string>;

/** Values interpolated into a translation through `{name}` placeholders. */
export type TVars = Record<string, string | number>;
