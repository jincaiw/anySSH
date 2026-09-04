import { create } from "zustand";
import {
  DEFAULT_LOCALE,
  LANGUAGE_SETTING_KEY,
  isLocale,
  type Locale,
} from "../i18n";
import { SYSTEM_THEME_ID, sanitizeTheme, type TerminalTheme } from "../lib/terminal-themes";

export type CursorStyle = "block" | "bar" | "underline";
export type ThemeMode = "dark" | "light";
/** Which mouse button pastes the clipboard into the terminal (#71). */
export type PasteButton = "none" | "right" | "middle";
/** What double-clicking a file in the Explorer does. */
export type DoubleClickAction = "download" | "open";

/** Character encoding used for terminal I/O (and intended for SFTP names).
 *  Values must match the backend mapping in src-tauri/src/ssh/encoding.rs. */
export const TERMINAL_ENCODINGS = [
  { value: "utf-8", label: "UTF-8" },
  { value: "gbk", label: "GBK / GB2312" },
  { value: "big5", label: "Big5" },
  { value: "shift_jis", label: "Shift_JIS" },
  { value: "euc-kr", label: "EUC-KR" },
  { value: "euc-jp", label: "EUC-JP" },
  { value: "iso-8859-1", label: "ISO-8859-1" },
  { value: "windows-1252", label: "Windows-1252" },
] as const;

export type TerminalEncoding = (typeof TERMINAL_ENCODINGS)[number]["value"];

/** Preset LANG values offered for the "terminal LANG" setting (global default
 *  and per-host override). Custom values can be typed freely (validated
 *  against LANG_RE). */
export const LANG_PRESETS = [
  { value: "zh_CN.UTF-8", label: "zh_CN.UTF-8（简体中文）" },
  { value: "en_US.UTF-8", label: "en_US.UTF-8（美式英语）" },
  { value: "C.UTF-8", label: "C.UTF-8（无本地化，最兼容）" },
] as const;

/** Allowed syntax for a hand-typed LANG value (locale format only — the value
 *  is sent in an SSH `env` request and a shell `export` line, so no shell
 *  metacharacters may pass). Mirrors the backend `valid_lang` whitelist. */
export const LANG_RE = /^[A-Za-z0-9]{1,10}(_[A-Za-z0-9]{1,10})?(\.[A-Za-z0-9-]+)?(@[A-Za-z0-9]+)?$/;

/** Preset TERM values offered in the terminal-type dropdown. Custom values
 *  can be typed freely (validated against TERM_NAME_RE). */
export const TERMINAL_TYPES = [
  { value: "xterm-256color", label: "xterm-256color", recommended: true },
  { value: "xterm", label: "xterm", recommended: false },
  { value: "vt100", label: "VT100", recommended: false },
  { value: "vt102", label: "VT102", recommended: false },
  { value: "vt220", label: "VT220", recommended: false },
  { value: "linux", label: "Linux", recommended: false },
  { value: "ansi", label: "ANSI", recommended: false },
  { value: "scoansi", label: "SCOANSI", recommended: false },
] as const;

/** Allowed characters for a hand-typed TERM value (letters, digits, + - . _). */
export const TERM_NAME_RE = /^[A-Za-z0-9+._-]+$/;

/** Full custom accent colour in oklch components (lightness, chroma, hue). */
export interface AccentCustom { l: number; c: number; h: number }

/**
 * A configured external editor. `args` is a command template where `{path}` is
 * replaced with the file to open (the file is appended if `{path}` is absent).
 * `id` is a UI-only stable key; the backend ignores it. `execPath` is the
 * absolute path to the binary, or a macOS .app bundle.
 */
export interface EditorConfig {
  id: string;
  name: string;
  execPath: string;
  args: string;
}

interface SettingsState {
  // Appearance
  language: Locale;
  themeMode: ThemeMode;
  accentHue: number;
  accentCustom: AccentCustom | null;
  interfaceFont: string;
  interfaceMonoFont: string;

  // Updates
  autoUpdate: boolean;
  skippedUpdateVersion: string | null;

  // Terminal appearance
  terminalFontSize: number;
  terminalFontFamily: string;
  terminalCursorStyle: CursorStyle;
  terminalCursorBlink: boolean;
  terminalLineHeight: number;
  terminalScrollback: number;
  /** Global terminal colour theme. "system" follows the app theme's CSS
   *  palette; otherwise a builtin/custom theme id. */
  terminalThemeId: string;
  /** User-created terminal themes (Settings editor / .itermcolors imports). */
  terminalCustomThemes: TerminalTheme[];

  // Terminal clipboard
  terminalCopyOnSelect: boolean;
  terminalPasteButton: PasteButton;

  // Terminal session (encoding + TERM + LANG sent to the server)
  terminalEncoding: TerminalEncoding;
  terminalType: string;
  /** Global default LANG sent to servers on connect ("" = send nothing). */
  terminalLang: string;

  // Session logging
  /** Globally auto-record every terminal session to a local log file. */
  sessionLogEnabled: boolean;
  /** Keep ANSI escapes verbatim ("keep") or strip them ("strip"). */
  sessionLogAnsi: "keep" | "strip";
  /** Plain text log or Asciicast v2 (.cast, replayable with asciinema). */
  sessionLogFormat: "text" | "asciicast";
  /** Prefix each logged line with [HH:MM:SS]. */
  sessionLogTimestamps: boolean;
  /** Per-file size cap before rotation (_part2, _part3, …). */
  sessionLogMaxSizeMb: number;
  /** Files older than this are deleted on the next logging start (0 = keep). */
  sessionLogRetentionDays: number;
  /** Total log storage budget; oldest files are deleted first (0 = unlimited). */
  sessionLogQuotaMb: number;

  // Explorer
  explorerDoubleClickAction: DoubleClickAction;

  // Transfers
  transferConcurrency: number;

  // External editors
  editors: EditorConfig[];
  defaultEditorId: string | null;

  // State
  loaded: boolean;

  // Actions
  setLanguage: (language: Locale) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAccentHue: (hue: number) => void;
  setAccentCustom: (custom: AccentCustom | null) => void;
  setInterfaceFont: (font: string) => void;
  setInterfaceMonoFont: (font: string) => void;
  setAutoUpdate: (enabled: boolean) => void;
  setSkippedUpdateVersion: (version: string) => void;
  setTerminalFontSize: (size: number) => void;
  setTerminalFontFamily: (family: string) => void;
  setTerminalCursorStyle: (style: CursorStyle) => void;
  setTerminalCursorBlink: (blink: boolean) => void;
  setTerminalLineHeight: (height: number) => void;
  setTerminalScrollback: (lines: number) => void;
  setTerminalThemeId: (id: string) => void;
  /** Add or replace a custom theme (matched by id) and persist the list. */
  upsertTerminalCustomTheme: (theme: TerminalTheme) => void;
  removeTerminalCustomTheme: (id: string) => void;
  setTerminalCopyOnSelect: (enabled: boolean) => void;
  setTerminalPasteButton: (button: PasteButton) => void;
  setTerminalEncoding: (encoding: TerminalEncoding) => void;
  setTerminalType: (type: string) => void;
  /** Global default LANG; "" disables sending it. Validated against LANG_RE. */
  setTerminalLang: (lang: string) => void;
  setSessionLogEnabled: (enabled: boolean) => void;
  setSessionLogAnsi: (mode: "keep" | "strip") => void;
  setSessionLogFormat: (format: "text" | "asciicast") => void;
  setSessionLogTimestamps: (enabled: boolean) => void;
  setSessionLogMaxSizeMb: (mb: number) => void;
  setSessionLogRetentionDays: (days: number) => void;
  setSessionLogQuotaMb: (mb: number) => void;
  setExplorerDoubleClickAction: (action: DoubleClickAction) => void;
  setTransferConcurrency: (n: number) => void;
  addEditor: (editor: Omit<EditorConfig, "id">) => void;
  updateEditor: (id: string, patch: Partial<Omit<EditorConfig, "id">>) => void;
  removeEditor: (id: string) => void;
  setDefaultEditor: (id: string | null) => void;
  loadSettings: () => Promise<void>;
}

// Defaults
const DEFAULTS = {
  language: DEFAULT_LOCALE,
  themeMode: "dark" as ThemeMode,
  accentHue: 250,
  accentCustom: null as AccentCustom | null,
  interfaceFont: "'Geist', system-ui, sans-serif",
  interfaceMonoFont: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
  autoUpdate: true,
  skippedUpdateVersion: null as string | null,
  terminalFontSize: 14,
  terminalFontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
  terminalCursorStyle: "bar" as CursorStyle,
  terminalCursorBlink: true,
  terminalLineHeight: 1.2,
  terminalScrollback: 5000,
  terminalThemeId: SYSTEM_THEME_ID,
  terminalCustomThemes: [] as TerminalTheme[],
  terminalCopyOnSelect: false,
  terminalPasteButton: "none" as PasteButton,
  terminalEncoding: "utf-8" as TerminalEncoding,
  terminalType: "xterm-256color",
  terminalLang: "",
  sessionLogEnabled: false,
  sessionLogAnsi: "strip" as "keep" | "strip",
  sessionLogFormat: "text" as "text" | "asciicast",
  sessionLogTimestamps: false,
  sessionLogMaxSizeMb: 10,
  sessionLogRetentionDays: 30,
  sessionLogQuotaMb: 500,
  explorerDoubleClickAction: "download" as DoubleClickAction,
  transferConcurrency: 3,
  editors: [] as EditorConfig[],
  defaultEditorId: null as string | null,
};

/**
 * The Rust setup() hook injects the persisted theme onto <html> before the page
 * paints (see src-tauri/src/lib.rs). Seed the store from that attribute so the
 * initial render matches it — otherwise the default below would briefly override
 * the injected theme and re-introduce the startup flash. Falls back to the
 * default when the attribute is absent (e.g. a plain web/dev context).
 */
function initialThemeMode(): ThemeMode {
  if (typeof document !== "undefined" && document.documentElement.dataset.theme === "light") {
    return "light";
  }
  return DEFAULTS.themeMode;
}

/**
 * Seed the accent hue from the --accent-hue CSS variable injected by the Rust
 * setup() hook before first paint (mirrors initialThemeMode), so the initial
 * render matches the persisted accent and there's no flash. Falls back to the
 * default when absent.
 */
function initialAccentHue(): number {
  if (typeof document !== "undefined") {
    const v = document.documentElement.style.getPropertyValue("--accent-hue").trim();
    const n = Number(v);
    if (v && !Number.isNaN(n)) return n;
  }
  return DEFAULTS.accentHue;
}

/** Seed the custom accent from the data-accent-custom attribute injected by Rust
 *  before first paint (so a custom accent doesn't flash on startup). */
function initialAccentCustom(): AccentCustom | null {
  if (typeof document !== "undefined") {
    const v = document.documentElement.dataset.accentCustom;
    if (v) {
      const parts = v.trim().split(/\s+/).map(Number);
      if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
        return { l: parts[0], c: parts[1], h: parts[2] };
      }
    }
  }
  return null;
}

/** Seed the interface font from the data-interface-font attribute injected by
 *  Rust before first paint, so a custom UI font doesn't flash on startup. */
function initialInterfaceFont(): string {
  if (typeof document !== "undefined") {
    const v = document.documentElement.dataset.interfaceFont;
    if (v) return v;
  }
  return DEFAULTS.interfaceFont;
}

/** Seed the monospace UI font from a data attribute if present. Unlike the
 *  sans font this isn't injected by Rust today, so it normally falls back to
 *  the default — which already matches theme.css's `--font-mono`, so there's
 *  no flash before the store applies it. */
function initialInterfaceMonoFont(): string {
  if (typeof document !== "undefined") {
    const v = document.documentElement.dataset.interfaceMonoFont;
    if (v) return v;
  }
  return DEFAULTS.interfaceMonoFont;
}

/**
 * Seed the UI language from the `data-lang` attribute injected by the Rust
 * setup() hook before first paint, so a non-default language doesn't flash the
 * default copy on startup. The i18n module has already resolved the locale by
 * the time this runs — mirror it here so the Settings picker reflects reality.
 */
function initialLanguage(): Locale {
  if (typeof document !== "undefined") {
    const v = document.documentElement.dataset.lang;
    if (isLocale(v)) return v;
  }
  return DEFAULT_LOCALE;
}

/** Settings persist() writes currently in flight. Fire-and-forget writes are
 *  easy to lose across an app restart (an e2e relaunch can interrupt the IPC
 *  round-trip), so e2e helpers flush these before reloading the session. */
const inFlightPersists = new Set<Promise<unknown>>();

/** Resolve once every persist() issued so far has settled (test hook). */
export async function flushPendingPersists(): Promise<void> {
  while (inFlightPersists.size > 0) {
    await Promise.allSettled([...inFlightPersists]);
  }
}

// e2e tests reach this through the page context (WebDriver execute), since the
// store module itself can't be imported from outside the bundle.
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__anysshFlushSettings = flushPendingPersists;
}

/** Persist a single setting to the backend. Fire-and-forget. */
function persist(key: string, value: string) {
  const p = (async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("save_setting", { key, value });
    } catch { /* best-effort */ }
  })();
  inFlightPersists.add(p);
  void p.finally(() => inFlightPersists.delete(p));
}

/** Persist the whole editor config as one JSON blob (it's a list, not a scalar). */
function persistEditors(editors: EditorConfig[], defaultEditorId: string | null) {
  persist("editors_config", JSON.stringify({ editors, defaultEditorId }));
}

/** Editors that make the best out-of-the-box default, most-preferred first.
 *  Names must match the backend registry display names (see editors/mod.rs). */
const PREFERRED_DEFAULT_EDITORS = ["VS Code", "VSCodium", "Cursor", "Windsurf", "Sublime Text", "Zed"];

/** Old → new display names for editors renamed in the backend registry, applied
 *  to already-saved configs on load so existing users see the canonical name. */
const RENAMED_EDITORS: Record<string, string> = { "Visual Studio Code": "VS Code" };

/** Choose which seeded editor should be the default — a popular IDE if present,
 *  otherwise just the first one detected. */
function pickDefaultEditorId(editors: EditorConfig[]): string | null {
  for (const name of PREFERRED_DEFAULT_EDITORS) {
    const match = editors.find((e) => e.name === name);
    if (match) return match.id;
  }
  return editors[0]?.id ?? null;
}

let accentPersistTimer: ReturnType<typeof setTimeout> | undefined;

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULTS,
  language: initialLanguage(),
  themeMode: initialThemeMode(),
  accentHue: initialAccentHue(),
  accentCustom: initialAccentCustom(),
  interfaceFont: initialInterfaceFont(),
  interfaceMonoFont: initialInterfaceMonoFont(),
  loaded: false,

  setLanguage: (language) => {
    set({ language });
    persist(LANGUAGE_SETTING_KEY, language);
    // The i18n store owns <html lang>, localStorage and re-rendering.
    void import("../i18n").then((m) => m.useI18nStore.getState().setLocale(language));
  },

  setThemeMode: (mode) => {
    set({ themeMode: mode });
    persist("app_theme", mode);
  },

  setAccentHue: (hue) => {
    // Choosing a preset hue clears any custom colour.
    set({ accentHue: hue, accentCustom: null });
    persist("app_accent_hue", String(hue));
    persist("app_accent_custom", "");
  },

  setAccentCustom: (custom) => {
    set({ accentCustom: custom });
    // Debounce so dragging the wheel / sliders doesn't spam the backend.
    if (accentPersistTimer) clearTimeout(accentPersistTimer);
    const value = custom ? `${custom.l} ${custom.c} ${custom.h}` : "";
    accentPersistTimer = setTimeout(() => persist("app_accent_custom", value), 200);
  },

  setInterfaceFont: (font) => {
    set({ interfaceFont: font });
    persist("app_interface_font", font);
  },

  setInterfaceMonoFont: (font) => {
    set({ interfaceMonoFont: font });
    persist("app_interface_mono_font", font);
  },

  setAutoUpdate: (enabled) => {
    set({ autoUpdate: enabled });
    persist("app_auto_update", String(enabled));
  },

  setSkippedUpdateVersion: (version) => {
    set({ skippedUpdateVersion: version });
    persist("app_skipped_update", version);
  },

  setTerminalFontSize: (size) => {
    const clamped = Math.max(8, Math.min(42, size));
    set({ terminalFontSize: clamped });
    persist("terminal_font_size", String(clamped));
  },

  setTerminalFontFamily: (family) => {
    set({ terminalFontFamily: family });
    persist("terminal_font_family", family);
  },

  setTerminalCursorStyle: (style) => {
    set({ terminalCursorStyle: style });
    persist("terminal_cursor_style", style);
  },

  setTerminalCursorBlink: (blink) => {
    set({ terminalCursorBlink: blink });
    persist("terminal_cursor_blink", String(blink));
  },

  setTerminalLineHeight: (height) => {
    const clamped = Math.max(1.0, Math.min(2.0, height));
    set({ terminalLineHeight: clamped });
    persist("terminal_line_height", String(clamped));
  },

  setTerminalScrollback: (lines) => {
    const clamped = Math.max(500, Math.min(100000, lines));
    set({ terminalScrollback: clamped });
    persist("terminal_scrollback", String(clamped));
  },

  setTerminalThemeId: (id) => {
    set({ terminalThemeId: id });
    persist("terminal_theme_id", id);
  },

  upsertTerminalCustomTheme: (theme) => set((s) => {
    const next = s.terminalCustomThemes.some((t) => t.id === theme.id)
      ? s.terminalCustomThemes.map((t) => (t.id === theme.id ? theme : t))
      : [...s.terminalCustomThemes, theme];
    persist("terminal_custom_themes", JSON.stringify(next));
    return { terminalCustomThemes: next };
  }),

  removeTerminalCustomTheme: (id) => set((s) => {
    const next = s.terminalCustomThemes.filter((t) => t.id !== id);
    persist("terminal_custom_themes", JSON.stringify(next));
    // If the deleted theme was the global default, fall back to "system".
    if (s.terminalThemeId === id) persist("terminal_theme_id", SYSTEM_THEME_ID);
    return {
      terminalCustomThemes: next,
      terminalThemeId: s.terminalThemeId === id ? SYSTEM_THEME_ID : s.terminalThemeId,
    };
  }),

  setTerminalCopyOnSelect: (enabled) => {
    set({ terminalCopyOnSelect: enabled });
    persist("terminal_copy_on_select", String(enabled));
  },

  setExplorerDoubleClickAction: (action) => {
    set({ explorerDoubleClickAction: action });
    persist("explorer_double_click_action", action);
  },

  setTerminalPasteButton: (button) => {
    set({ terminalPasteButton: button });
    persist("terminal_paste_button", button);
  },

  setTerminalEncoding: (encoding) => {
    set({ terminalEncoding: encoding });
    persist("terminal_encoding", encoding);
  },

  setTerminalType: (type) => {
    // TERM names are sent verbatim to the server in the PTY request — keep a
    // tight whitelist so nothing injectable can end up in the protocol message.
    const trimmed = type.trim();
    const value = TERM_NAME_RE.test(trimmed) ? trimmed : DEFAULTS.terminalType;
    set({ terminalType: value });
    persist("terminal_type", value);
  },

  setTerminalLang: (lang) => {
    // LANG travels in an SSH `env` request and a shell `export` line — keep
    // the same locale-syntax whitelist the backend enforces. Empty disables.
    const trimmed = lang.trim();
    const value = trimmed === "" || LANG_RE.test(trimmed) ? trimmed : DEFAULTS.terminalLang;
    set({ terminalLang: value });
    persist("terminal_lang", value);
  },

  setSessionLogEnabled: (enabled) => {
    set({ sessionLogEnabled: enabled });
    persist("session_log_enabled", String(enabled));
  },

  setSessionLogAnsi: (mode) => {
    set({ sessionLogAnsi: mode });
    persist("session_log_ansi", mode);
  },

  setSessionLogFormat: (format) => {
    set({ sessionLogFormat: format });
    persist("session_log_format", format);
  },

  setSessionLogTimestamps: (enabled) => {
    set({ sessionLogTimestamps: enabled });
    persist("session_log_timestamps", String(enabled));
  },

  setSessionLogMaxSizeMb: (mb) => {
    const clamped = Math.max(1, Math.min(1024, Math.round(mb)));
    set({ sessionLogMaxSizeMb: clamped });
    persist("session_log_max_size_mb", String(clamped));
  },

  setSessionLogRetentionDays: (days) => {
    const clamped = Math.max(0, Math.min(3650, Math.round(days)));
    set({ sessionLogRetentionDays: clamped });
    persist("session_log_retention_days", String(clamped));
  },

  setSessionLogQuotaMb: (mb) => {
    const clamped = Math.max(0, Math.min(102400, Math.round(mb)));
    set({ sessionLogQuotaMb: clamped });
    persist("session_log_quota_mb", String(clamped));
  },

  setTransferConcurrency: (n) => {
    const clamped = Math.max(1, Math.min(10, n));
    set({ transferConcurrency: clamped });
    persist("transfer_concurrency", String(clamped));
    // Also update the backend transfer manager
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("sftp_set_concurrency", { maxConcurrent: clamped });
      } catch { /* best-effort */ }
    })();
  },

  addEditor: (editor) => set((s) => {
    const next = [...s.editors, { ...editor, id: crypto.randomUUID() }];
    // The first editor added becomes the default automatically.
    const defaultEditorId = s.defaultEditorId ?? next[next.length - 1].id;
    persistEditors(next, defaultEditorId);
    return { editors: next, defaultEditorId };
  }),

  updateEditor: (id, patch) => set((s) => {
    const next = s.editors.map((e) => (e.id === id ? { ...e, ...patch } : e));
    persistEditors(next, s.defaultEditorId);
    return { editors: next };
  }),

  removeEditor: (id) => set((s) => {
    const next = s.editors.filter((e) => e.id !== id);
    // If the default was removed, fall back to the first remaining editor.
    const defaultEditorId = s.defaultEditorId === id ? (next[0]?.id ?? null) : s.defaultEditorId;
    persistEditors(next, defaultEditorId);
    return { editors: next, defaultEditorId };
  }),

  setDefaultEditor: (id) => set((s) => {
    persistEditors(s.editors, id);
    return { defaultEditorId: id };
  }),

  loadSettings: async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const pairs = await invoke<[string, string][]>("load_all_settings");

      const updates: Partial<SettingsState> = {};
      let editorsSeeded = false;
      for (const [key, value] of pairs) {
        switch (key) {
          case LANGUAGE_SETTING_KEY:
            if (isLocale(value)) {
              updates.language = value;
              // Adopt it immediately — the pre-paint hook may not have run
              // (first launch, or the setting was written by another window).
              void import("../i18n").then((m) => m.applyPersistedLocale(value));
            }
            break;
          case "app_theme": updates.themeMode = value === "light" ? "light" : DEFAULTS.themeMode; break;
          case "app_accent_hue": updates.accentHue = Number(value) || DEFAULTS.accentHue; break;
          case "app_accent_custom": {
            const parts = value.trim().split(/\s+/).map(Number);
            updates.accentCustom = parts.length === 3 && parts.every((n) => !Number.isNaN(n))
              ? { l: parts[0], c: parts[1], h: parts[2] }
              : null;
            break;
          }
          case "terminal_font_size": updates.terminalFontSize = Number(value) || DEFAULTS.terminalFontSize; break;
          case "terminal_font_family": updates.terminalFontFamily = value || DEFAULTS.terminalFontFamily; break;
          case "terminal_cursor_style": updates.terminalCursorStyle = (value as CursorStyle) || DEFAULTS.terminalCursorStyle; break;
          case "terminal_cursor_blink": updates.terminalCursorBlink = value !== "false"; break;
          case "terminal_line_height": updates.terminalLineHeight = Number(value) || DEFAULTS.terminalLineHeight; break;
          case "terminal_scrollback": updates.terminalScrollback = Number(value) || DEFAULTS.terminalScrollback; break;
          case "terminal_theme_id": updates.terminalThemeId = value.trim() || DEFAULTS.terminalThemeId; break;
          case "terminal_custom_themes": {
            try {
              const parsed = JSON.parse(value) as unknown[];
              if (Array.isArray(parsed)) {
                updates.terminalCustomThemes = parsed
                  .map(sanitizeTheme)
                  .filter((t): t is TerminalTheme => t !== null);
              }
            } catch { /* ignore malformed list */ }
            break;
          }
          case "terminal_copy_on_select": updates.terminalCopyOnSelect = value === "true"; break;
          case "terminal_paste_button": updates.terminalPasteButton = value === "right" || value === "middle" ? value : DEFAULTS.terminalPasteButton; break;
          case "terminal_encoding": {
            const valid = TERMINAL_ENCODINGS.some((e) => e.value === value);
            updates.terminalEncoding = valid ? (value as TerminalEncoding) : DEFAULTS.terminalEncoding;
            break;
          }
          case "terminal_type": {
            const trimmed = value.trim();
            updates.terminalType = TERM_NAME_RE.test(trimmed) ? trimmed : DEFAULTS.terminalType;
            break;
          }
          case "terminal_lang": {
            const trimmed = value.trim();
            updates.terminalLang = trimmed === "" || LANG_RE.test(trimmed) ? trimmed : DEFAULTS.terminalLang;
            break;
          }
          case "explorer_double_click_action": updates.explorerDoubleClickAction = value === "open" ? "open" : "download"; break;
          case "session_log_enabled": updates.sessionLogEnabled = value === "true"; break;
          case "session_log_ansi": updates.sessionLogAnsi = value === "keep" ? "keep" : "strip"; break;
          case "session_log_format": updates.sessionLogFormat = value === "asciicast" ? "asciicast" : "text"; break;
          case "session_log_timestamps": updates.sessionLogTimestamps = value === "true"; break;
          case "session_log_max_size_mb": updates.sessionLogMaxSizeMb = Number(value) || DEFAULTS.sessionLogMaxSizeMb; break;
          case "session_log_retention_days": updates.sessionLogRetentionDays = Number(value) || DEFAULTS.sessionLogRetentionDays; break;
          case "session_log_quota_mb": updates.sessionLogQuotaMb = Number(value) || DEFAULTS.sessionLogQuotaMb; break;
          case "transfer_concurrency": updates.transferConcurrency = Number(value) || DEFAULTS.transferConcurrency; break;
          case "app_interface_font": updates.interfaceFont = value || DEFAULTS.interfaceFont; break;
          case "app_interface_mono_font": updates.interfaceMonoFont = value || DEFAULTS.interfaceMonoFont; break;
          case "app_auto_update": updates.autoUpdate = value !== "false"; break;
          case "app_skipped_update": updates.skippedUpdateVersion = value || null; break;
          case "editors_config": {
            try {
              const parsed = JSON.parse(value) as { editors?: EditorConfig[]; defaultEditorId?: string | null };
              const defaultEditorId = parsed.defaultEditorId ?? null;
              if (Array.isArray(parsed.editors)) {
                let renamed = false;
                const migrated = parsed.editors.map((e) => {
                  const next = RENAMED_EDITORS[e.name];
                  if (next && next !== e.name) { renamed = true; return { ...e, name: next }; }
                  return e;
                });
                updates.editors = migrated;
                if (renamed) persistEditors(migrated, defaultEditorId); // keep the rename
              }
              updates.defaultEditorId = defaultEditorId;
            } catch { /* ignore malformed config */ }
            break;
          }
          case "editors_seeded": editorsSeeded = value === "true"; break;
        }
      }

      // First run: auto-detect installed editors and add them so "Edit" / "Open
      // With" work out of the box. Tracked by a dedicated `editors_seeded` flag
      // (NOT the mere presence of editors_config) so that a user who later
      // deletes every editor won't have them silently re-added.
      if (!editorsSeeded) {
        const current = updates.editors ?? [];
        if (current.length > 0) {
          // A real config already exists (e.g. manually added) — respect it.
          persist("editors_seeded", "true");
        } else {
          try {
            const detected = await invoke<{ name: string; execPath: string; args: string }[]>("detect_editors");
            if (detected.length > 0) {
              const editors: EditorConfig[] = detected.map((d) => ({
                id: crypto.randomUUID(),
                name: d.name,
                execPath: d.execPath,
                args: d.args || "{path}",
              }));
              const defaultEditorId = pickDefaultEditorId(editors);
              updates.editors = editors;
              updates.defaultEditorId = defaultEditorId;
              persistEditors(editors, defaultEditorId);
              persist("editors_seeded", "true");
            }
            // Nothing detected → leave unseeded so we retry on the next launch.
          } catch { /* detection unavailable — leave unseeded to retry next launch */ }
        }
      }

      set({ ...updates, loaded: true });
    } catch {
      set({ loaded: true }); // Use defaults if backend unavailable
    }
  },
}));
