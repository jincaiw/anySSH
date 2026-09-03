import { useState, useEffect, useCallback, useRef } from "react";
import { ModalShell, BTN_GHOST, BTN_PRIMARY, BTN_DANGER } from "../shared/ModalShell";
import { ModalBackdrop } from "../shared/ModalBackdrop";
import { useSettingsStore } from "../../stores/settings-store";
import { CustomSelect, type SelectOption } from "../shared/CustomSelect";
import { LOCALES, LOCALE_LABELS, useTranslation } from "../../i18n";
import type { Locale } from "../../i18n";
import { useUpdaterStore } from "../../stores/updater-store";
import { toast } from "../../stores/toast-store";
import { RefreshCw, CheckCircle2, AlertCircle, Palette, SquareTerminal, ArrowUpDown, Info, ExternalLink, Check, FileCode, Plus, Trash2, FolderOpen, Star, Search, Database, Download, Upload, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { TERMINAL_ENCODINGS, TERMINAL_TYPES, TERM_NAME_RE, LANG_PRESETS, LANG_RE } from "../../stores/settings-store";
import type { CursorStyle, ThemeMode, EditorConfig, PasteButton, DoubleClickAction, TerminalEncoding } from "../../stores/settings-store";

// ─── Shared styles ───────────────────────────────────────────────────────────

const LABEL_CLASS = "text-[length:var(--text-sm)] font-medium text-text-primary";
const DESC_CLASS = "text-[length:var(--text-xs)] text-text-muted mt-0.5";

const INPUT_CLASS = [
  "w-20 px-2.5 py-1.5 rounded-lg text-[length:var(--text-sm)] tabular-nums",
  "bg-bg-base border border-border text-text-primary",
  "outline-none focus:border-border-focus focus:ring-2 focus:ring-ring",
  "transition-[border-color,box-shadow] duration-[var(--duration-fast)]",
].join(" ");

const BTN_SECONDARY = [
  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg shrink-0",
  "text-[length:var(--text-sm)] font-medium",
  "bg-bg-base border border-border text-text-secondary",
  "hover:text-text-primary hover:border-border-focus",
  "disabled:opacity-50 disabled:pointer-events-none",
  "transition-all duration-[var(--duration-fast)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
].join(" ");

// Mirrors the input/label styling used by the Host modal so dialogs feel uniform.
const TEXT_INPUT_CLASS = [
  "w-full px-3 py-2 rounded-lg text-[length:var(--text-sm)]",
  "bg-bg-base border border-border text-text-primary placeholder:text-text-muted",
  "outline-none focus:border-border-focus focus:ring-2 focus:ring-ring",
  "transition-[border-color,box-shadow] duration-[var(--duration-fast)]",
].join(" ");

const FIELD_LABEL_CLASS = "block text-[length:var(--text-xs)] font-medium text-text-secondary mb-1";

const REPO_URL = "https://github.com/jincaiw/anySSH";

// ─── Sections ─────────────────────────────────────────────────────────────────
// Each settings category is a section here. To add a new category, add an entry
// to SECTIONS, a description, and render its content in <SectionContent />.

type SectionId = "appearance" | "terminal" | "explorer" | "transfers" | "editors" | "data" | "about";

// `labelKey` / description values are i18n keys, resolved with `t()` at render.
const SECTIONS: { id: SectionId; labelKey: string; icon: LucideIcon }[] = [
  { id: "appearance", labelKey: "settings.sections.appearance", icon: Palette },
  { id: "terminal", labelKey: "settings.sections.terminal", icon: SquareTerminal },
  { id: "explorer", labelKey: "settings.sections.explorer", icon: FolderOpen },
  { id: "transfers", labelKey: "settings.sections.transfers", icon: ArrowUpDown },
  { id: "editors", labelKey: "settings.sections.editors", icon: FileCode },
  { id: "data", labelKey: "settings.sections.data", icon: Database },
  { id: "about", labelKey: "settings.sections.about", icon: Info },
];

const SECTION_DESCRIPTIONS: Record<SectionId, string> = {
  appearance: "settings.sections.appearance.description",
  terminal: "settings.sections.terminal.description",
  explorer: "settings.sections.explorer.description",
  transfers: "settings.sections.transfers.description",
  editors: "settings.sections.editors.description",
  data: "settings.sections.data.description",
  about: "settings.sections.about.description",
};

/** Language picker options — endonyms from the i18n runtime, never translated. */
const LANGUAGE_OPTIONS: SelectOption[] = LOCALES.map((locale) => ({
  value: locale,
  label: LOCALE_LABELS[locale],
}));

// Remember the last-open section across tab switches. The settings page
// unmounts when another tab is active, so component state alone would reset.
let lastSettingsSection: SectionId = "appearance";

// ─── Component ───────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [active, setActive] = useState<SectionId>(() => lastSettingsSection);
  const selectSection = (id: SectionId) => { lastSettingsSection = id; setActive(id); };
  const activeSection = SECTIONS.find((s) => s.id === active);
  const { t } = useTranslation();

  return (
    <div className="flex flex-col h-full p-2">
      <div className="flex flex-1 min-h-0 rounded-lg overflow-hidden border border-border/60">
        {/* Sidebar */}
        <nav
          aria-label={t("settings.sections.ariaLabel")}
          className="w-60 shrink-0 flex flex-col gap-1 px-3 py-4 border-r border-border/50 bg-bg-surface/40 overflow-y-auto no-select"
        >
          <h2 className="px-3 pt-1 pb-2 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wider text-text-muted">
            {t("settings.title")}
          </h2>
          {SECTIONS.map(({ id, labelKey, icon: Icon }) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`settings-nav-${id}`}
                aria-current={isActive ? "page" : undefined}
                onClick={() => selectSection(id)}
                className={[
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg text-left",
                  "text-[length:var(--text-sm)] font-medium",
                  "transition-colors duration-[var(--duration-fast)]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-bg-overlay text-text-primary border border-border/60 shadow-[var(--shadow-sm)]"
                    : "text-text-secondary border border-transparent hover:text-text-primary hover:bg-bg-overlay/50",
                ].join(" ")}
              >
                <Icon
                  size={17}
                  strokeWidth={isActive ? 2 : 1.6}
                  className={`shrink-0 ${isActive ? "text-accent" : "text-text-muted"}`}
                />
                {t(labelKey)}
              </button>
            );
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-y-scroll bg-bg-base">
          <div className="max-w-4xl mx-auto px-8 py-6">
            {/* Section header */}
            <div className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
                {activeSection ? t(activeSection.labelKey) : undefined}
              </h1>
              <p className="text-[length:var(--text-sm)] text-text-muted mt-1.5">
                {t(SECTION_DESCRIPTIONS[active])}
              </p>
            </div>

            <SectionContent section={active} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Section content ───────────────────────────────────────────────────────────

function SectionContent({ section }: { section: SectionId }) {
  switch (section) {
    case "appearance":
      return <AppearanceSettings />;
    case "terminal":
      return <TerminalSettings />;
    case "explorer":
      return <ExplorerSettings />;
    case "transfers":
      return <TransferSettings />;
    case "editors":
      return <EditorsSettings />;
    case "data":
      return <DataSettings />;
    case "about":
      return <AboutSettings />;
  }
}

// Candidates for the interface font. Entries without a `family` are always
// offered (Geist is bundled; System UI is a generic). Entries with a `family`
// are only shown when that font is actually installed (see availableFonts),
// since an unavailable font silently falls back to the system default.
const INTERFACE_FONT_CANDIDATES: FontCandidate[] = [
  { value: "'Geist', system-ui, sans-serif", label: "Geist (Default)", labelKey: "settings.fonts.geistDefault" },
  { value: "system-ui, sans-serif", label: "System UI", labelKey: "settings.fonts.systemUI" },
  { value: "'Arial', system-ui, sans-serif", label: "Arial", family: "Arial" },
  { value: "'Avenir', system-ui, sans-serif", label: "Avenir", family: "Avenir" },
  { value: "'Avenir Next', system-ui, sans-serif", label: "Avenir Next", family: "Avenir Next" },
  { value: "'Calibri', system-ui, sans-serif", label: "Calibri", family: "Calibri" },
  { value: "'Cantarell', system-ui, sans-serif", label: "Cantarell", family: "Cantarell" },
  { value: "'DejaVu Sans', system-ui, sans-serif", label: "DejaVu Sans", family: "DejaVu Sans" },
  { value: "'Fira Sans', system-ui, sans-serif", label: "Fira Sans", family: "Fira Sans" },
  { value: "'FreeSans', system-ui, sans-serif", label: "FreeSans", family: "FreeSans" },
  { value: "'Helvetica', system-ui, sans-serif", label: "Helvetica", family: "Helvetica" },
  { value: "'Helvetica Neue', system-ui, sans-serif", label: "Helvetica Neue", family: "Helvetica Neue" },
  { value: "'Inter', system-ui, sans-serif", label: "Inter", family: "Inter" },
  { value: "'Lato', system-ui, sans-serif", label: "Lato", family: "Lato" },
  { value: "'Liberation Sans', system-ui, sans-serif", label: "Liberation Sans", family: "Liberation Sans" },
  { value: "'Lucida Grande', system-ui, sans-serif", label: "Lucida Grande", family: "Lucida Grande" },
  { value: "'Nimbus Sans', system-ui, sans-serif", label: "Nimbus Sans", family: "Nimbus Sans" },
  { value: "'Noto Sans', system-ui, sans-serif", label: "Noto Sans", family: "Noto Sans" },
  { value: "'Open Sans', system-ui, sans-serif", label: "Open Sans", family: "Open Sans" },
  { value: "'Roboto', system-ui, sans-serif", label: "Roboto", family: "Roboto" },
  { value: "'Segoe UI', system-ui, sans-serif", label: "Segoe UI", family: "Segoe UI" },
  { value: "'Source Sans 3', system-ui, sans-serif", label: "Source Sans 3", family: "Source Sans 3" },
  { value: "'Source Sans Pro', system-ui, sans-serif", label: "Source Sans Pro", family: "Source Sans Pro" },
  { value: "'Tahoma', system-ui, sans-serif", label: "Tahoma", family: "Tahoma" },
  { value: "'Trebuchet MS', system-ui, sans-serif", label: "Trebuchet MS", family: "Trebuchet MS" },
  { value: "'Ubuntu', system-ui, sans-serif", label: "Ubuntu", family: "Ubuntu" },
  { value: "'Verdana', system-ui, sans-serif", label: "Verdana", family: "Verdana" },
  { value: "'Work Sans', system-ui, sans-serif", label: "Work Sans", family: "Work Sans" },
];

// Monospace candidates for the terminal. The default matches the store's
// terminalFontFamily so it selects correctly; JetBrains Mono is bundled.
const TERMINAL_FONT_CANDIDATES: FontCandidate[] = [
  { value: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace", label: "JetBrains Mono (Default)", labelKey: "settings.fonts.jetbrainsMonoDefault" },
  { value: "'JetBrainsMono Nerd Font', 'JetBrains Mono', monospace", label: "JetBrains Nerd Font (icons)", labelKey: "settings.fonts.jetbrainsNerdFont" },
  { value: "monospace", label: "System Monospace", labelKey: "settings.fonts.systemMonospace" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code", family: "Cascadia Code" },
  { value: "'Cascadia Mono', monospace", label: "Cascadia Mono", family: "Cascadia Mono" },
  { value: "'Consolas', monospace", label: "Consolas", family: "Consolas" },
  { value: "'Courier New', monospace", label: "Courier New", family: "Courier New" },
  { value: "'DejaVu Sans Mono', monospace", label: "DejaVu Sans Mono", family: "DejaVu Sans Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code", family: "Fira Code" },
  { value: "'Fira Mono', monospace", label: "Fira Mono", family: "Fira Mono" },
  { value: "'Hack', monospace", label: "Hack", family: "Hack" },
  { value: "'IBM Plex Mono', monospace", label: "IBM Plex Mono", family: "IBM Plex Mono" },
  { value: "'Inconsolata', monospace", label: "Inconsolata", family: "Inconsolata" },
  { value: "'Liberation Mono', monospace", label: "Liberation Mono", family: "Liberation Mono" },
  { value: "'Menlo', monospace", label: "Menlo", family: "Menlo" },
  { value: "'Monaco', monospace", label: "Monaco", family: "Monaco" },
  { value: "'Noto Sans Mono', monospace", label: "Noto Sans Mono", family: "Noto Sans Mono" },
  { value: "'Roboto Mono', monospace", label: "Roboto Mono", family: "Roboto Mono" },
  { value: "'SF Mono', monospace", label: "SF Mono", family: "SF Mono" },
  { value: "'Source Code Pro', monospace", label: "Source Code Pro", family: "Source Code Pro" },
  { value: "'Ubuntu Mono', monospace", label: "Ubuntu Mono", family: "Ubuntu Mono" },
];

// Monospace candidates for the UI (`--font-mono`: permissions, paths, kbd,
// snippets, addresses). JetBrains Mono (the default) is bundled; "System UI"
// uses the OS UI monospace (`ui-monospace`). The rest are common system fonts,
// filtered to those actually installed.
const INTERFACE_MONO_FONT_CANDIDATES: FontCandidate[] = [
  { value: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace", label: "JetBrains Mono (Default)", labelKey: "settings.fonts.jetbrainsMonoDefault" },
  { value: "ui-monospace, monospace", label: "System UI", labelKey: "settings.fonts.systemUI" },
  { value: "'Cascadia Code', monospace", label: "Cascadia Code", family: "Cascadia Code" },
  { value: "'Cascadia Mono', monospace", label: "Cascadia Mono", family: "Cascadia Mono" },
  { value: "'Consolas', monospace", label: "Consolas", family: "Consolas" },
  { value: "'DejaVu Sans Mono', monospace", label: "DejaVu Sans Mono", family: "DejaVu Sans Mono" },
  { value: "'Fira Code', monospace", label: "Fira Code", family: "Fira Code" },
  { value: "'Hack', monospace", label: "Hack", family: "Hack" },
  { value: "'IBM Plex Mono', monospace", label: "IBM Plex Mono", family: "IBM Plex Mono" },
  { value: "'Menlo', monospace", label: "Menlo", family: "Menlo" },
  { value: "'Roboto Mono', monospace", label: "Roboto Mono", family: "Roboto Mono" },
  { value: "'SF Mono', monospace", label: "SF Mono", family: "SF Mono" },
  { value: "'Source Code Pro', monospace", label: "Source Code Pro", family: "Source Code Pro" },
  { value: "'Ubuntu Mono', monospace", label: "Ubuntu Mono", family: "Ubuntu Mono" },
];

/**
 * Whether a named font is actually installed. document.fonts.check() is
 * unreliable (it returns true for unknown names), so measure a test string:
 * if rendering with the font matches every generic fallback exactly, the font
 * isn't present and the browser fell back.
 */
function isFontAvailable(family: string): boolean {
  if (typeof document === "undefined") return false;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return false;
  const sample = "mmmmmmmmmmlli MWQ 0123";
  const size = "72px";
  for (const base of ["monospace", "serif", "sans-serif"]) {
    ctx.font = `${size} ${base}`;
    const baseWidth = ctx.measureText(sample).width;
    ctx.font = `${size} "${family}", ${base}`;
    if (ctx.measureText(sample).width !== baseWidth) return true;
  }
  return false;
}

type FontCandidate = { value: string; label: string; family?: string; labelKey?: string };

/** Filter candidates down to those actually installed on this system. */
function filterInstalledFonts(candidates: FontCandidate[], t: (key: string) => string): SelectOption[] {
  return candidates
    .filter((f) => !f.family || isFontAvailable(f.family))
    .map(({ value, label, labelKey }) => ({ value, label: labelKey ? t(labelKey) : label }));
}

/** Font-picker options: installed candidates, re-checked once web fonts load,
 *  with the current value kept selectable even if it isn't detected. */
function useInstalledFontOptions(candidates: FontCandidate[], current: string, t: (key: string) => string): SelectOption[] {
  const [available, setAvailable] = useState<SelectOption[]>(() => filterInstalledFonts(candidates, t));
  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready?.then(() => { if (!cancelled) setAvailable(filterInstalledFonts(candidates, t)); }).catch(() => {});
    return () => { cancelled = true; };
  }, [candidates, t]);
  if (available.some((o) => o.value === current)) return available;
  const cur = candidates.find((c) => c.value === current);
  return [{ value: current, label: cur?.labelKey ? t(cur.labelKey) : (cur?.label ?? t("settings.fonts.current")) }, ...available];
}

// `nameKey` is an i18n key — the swatch colour names are user-visible via
// `title` / `aria-label`.
const ACCENT_PRESETS: { nameKey: string; hue: number }[] = [
  { nameKey: "settings.appearance.accent.blue", hue: 250 },
  { nameKey: "settings.appearance.accent.indigo", hue: 277 },
  { nameKey: "settings.appearance.accent.violet", hue: 300 },
  { nameKey: "settings.appearance.accent.pink", hue: 350 },
  { nameKey: "settings.appearance.accent.red", hue: 25 },
  { nameKey: "settings.appearance.accent.orange", hue: 70 },
  { nameKey: "settings.appearance.accent.green", hue: 150 },
  { nameKey: "settings.appearance.accent.teal", hue: 195 },
];

function AppearanceSettings() {
  const themeMode = useSettingsStore((s) => s.themeMode);
  const setThemeMode = useSettingsStore((s) => s.setThemeMode);
  const accentHue = useSettingsStore((s) => s.accentHue);
  const setAccentHue = useSettingsStore((s) => s.setAccentHue);
  const accentCustom = useSettingsStore((s) => s.accentCustom);
  const setAccentCustom = useSettingsStore((s) => s.setAccentCustom);
  const interfaceFont = useSettingsStore((s) => s.interfaceFont);
  const setInterfaceFont = useSettingsStore((s) => s.setInterfaceFont);
  const interfaceMonoFont = useSettingsStore((s) => s.interfaceMonoFont);
  const setInterfaceMonoFont = useSettingsStore((s) => s.setInterfaceMonoFont);
  const language = useSettingsStore((s) => s.language);

  const { t } = useTranslation();

  const fontOptions = useInstalledFontOptions(INTERFACE_FONT_CANDIDATES, interfaceFont, t);
  const monoFontOptions = useInstalledFontOptions(INTERFACE_MONO_FONT_CANDIDATES, interfaceMonoFont, t);

  const [wheelOpen, setWheelOpen] = useState(false);
  const customRef = useRef<HTMLDivElement>(null);
  const isCustom = accentCustom !== null;
  const working = accentCustom ?? { l: 0.70, c: 0.15, h: accentHue };
  const workingColor = `oklch(${working.l} ${working.c} ${working.h})`;
  const updateCustom = (patch: Partial<typeof working>) => setAccentCustom({ ...working, ...patch });

  // Close the wheel popover on outside click / Escape.
  useEffect(() => {
    if (!wheelOpen) return;
    const onDown = (e: PointerEvent) => {
      if (customRef.current && !customRef.current.contains(e.target as Node)) setWheelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setWheelOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [wheelOpen]);

  return (
    <>
    <SettingsGroup label={t("settings.appearance.group.theme")}>
      <SettingRow>
        <div>
          <p className={LABEL_CLASS}>{t("settings.appearance.colorTheme")}</p>
          <p className={DESC_CLASS}>{t("settings.appearance.colorThemeHint")}</p>
        </div>
        <SegmentedControl<ThemeMode>
          id="s-light-theme"
          value={themeMode}
          onChange={setThemeMode}
          options={[
            { value: "dark", label: t("settings.appearance.theme.dark") },
            { value: "light", label: t("settings.appearance.theme.light") },
          ]}
        />
      </SettingRow>

      <SettingRow>
        <div>
          <p className={LABEL_CLASS}>{t("settings.appearance.accentColor")}</p>
          <p className={DESC_CLASS}>{t("settings.appearance.accentColorHint")}</p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {ACCENT_PRESETS.map((preset) => {
            const selected = !isCustom && accentHue === preset.hue;
            const color = `oklch(0.70 0.15 ${preset.hue})`;
            const presetName = t(preset.nameKey);
            return (
              <button
                key={preset.hue}
                type="button"
                title={presetName}
                aria-label={presetName}
                aria-pressed={selected}
                data-testid={`s-accent-${preset.hue}`}
                onClick={() => setAccentHue(preset.hue)}
                className="relative flex items-center justify-center w-6 h-6 rounded-full shrink-0 transition-transform duration-[var(--duration-fast)] hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{
                  backgroundColor: color,
                  boxShadow: selected ? `0 0 0 2px var(--color-bg-surface), 0 0 0 4px ${color}` : undefined,
                }}
              >
                {selected && <Check size={13} strokeWidth={3} className="text-white" />}
              </button>
            );
          })}

          {/* Custom — a rainbow swatch that opens the hue wheel */}
          <div className="relative" ref={customRef}>
            <button
              type="button"
              title={t("settings.appearance.accent.custom")}
              aria-label={t("settings.appearance.accent.customColor")}
              aria-haspopup="dialog"
              aria-expanded={wheelOpen}
              aria-pressed={isCustom}
              data-testid="s-accent-custom"
              onClick={() => setWheelOpen((o) => !o)}
              className="relative flex items-center justify-center w-6 h-6 rounded-full shrink-0 transition-transform duration-[var(--duration-fast)] hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              style={{
                background: isCustom
                  ? workingColor
                  : "conic-gradient(oklch(0.70 0.15 0), oklch(0.70 0.15 60), oklch(0.70 0.15 120), oklch(0.70 0.15 180), oklch(0.70 0.15 240), oklch(0.70 0.15 300), oklch(0.70 0.15 360))",
                boxShadow: isCustom ? `0 0 0 2px var(--color-bg-surface), 0 0 0 4px ${workingColor}` : undefined,
              }}
            >
              {isCustom && <Check size={13} strokeWidth={3} className="text-white [filter:drop-shadow(0_1px_1px_rgb(0_0_0/0.5))]" />}
            </button>

            {wheelOpen && (
              <div
                role="dialog"
                aria-label={t("settings.appearance.accent.customDialog")}
                className="absolute right-0 top-full mt-2 z-50 flex flex-col items-center gap-2 p-3 rounded-xl bg-bg-overlay border border-border shadow-[var(--shadow-lg)]"
              >
                <HueWheel
                  hue={working.h}
                  l={working.l}
                  c={working.c}
                  onChange={(h) => updateCustom({ h })}
                  size={140}
                />
                <div className="w-full flex flex-col gap-2.5">
                  <label className="flex flex-col gap-1">
                    <span className="text-[length:var(--text-2xs)] uppercase tracking-wider text-text-muted">{t("settings.appearance.accent.lightness")}</span>
                    <input
                      type="range" min={0.45} max={0.85} step={0.01} value={working.l}
                      onChange={(e) => updateCustom({ l: Number(e.target.value) })}
                      className="w-full h-1.5 cursor-pointer"
                      style={{ accentColor: workingColor }}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[length:var(--text-2xs)] uppercase tracking-wider text-text-muted">{t("settings.appearance.accent.saturation")}</span>
                    <input
                      type="range" min={0} max={0.3} step={0.005} value={working.c}
                      onChange={(e) => updateCustom({ c: Number(e.target.value) })}
                      className="w-full h-1.5 cursor-pointer"
                      style={{ accentColor: workingColor }}
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </SettingRow>
    </SettingsGroup>

    <SettingsGroup label={t("settings.appearance.group.interface")}>
      <SettingRow>
        <div>
          <label htmlFor="s-language" className={LABEL_CLASS}>{t("settings.appearance.language")}</label>
          <p className={DESC_CLASS}>{t("settings.appearance.languageHint")}</p>
        </div>
        <CustomSelect
          id="s-language"
          data-testid="settings-language"
          aria-label={t("settings.appearance.language")}
          value={language}
          onChange={(value) => useSettingsStore.getState().setLanguage(value as Locale)}
          options={LANGUAGE_OPTIONS}
          className="w-44"
        />
      </SettingRow>
      <SettingRow>
        <div>
          <p className={LABEL_CLASS}>{t("settings.appearance.interfaceFont")}</p>
          <p className={DESC_CLASS}>{t("settings.appearance.interfaceFontHint")}</p>
        </div>
        <CustomSelect
          id="s-interface-font"
          data-testid="s-interface-font"
          value={interfaceFont}
          onChange={setInterfaceFont}
          options={fontOptions}
          className="w-44"
          previewOptionFont
        />
      </SettingRow>
      <SettingRow>
        <div>
          <p className={LABEL_CLASS}>{t("settings.appearance.interfaceMonoFont")}</p>
          <p className={DESC_CLASS}>{t("settings.appearance.interfaceMonoFontHint")}</p>
        </div>
        <CustomSelect
          id="s-interface-mono-font"
          data-testid="s-interface-mono-font"
          value={interfaceMonoFont}
          onChange={setInterfaceMonoFont}
          options={monoFontOptions}
          className="w-44"
          previewOptionFont
        />
      </SettingRow>
    </SettingsGroup>
    </>
  );
}

/** Circular hue picker — click/drag around the ring to set the hue.
 *  Ring + thumb colours use the given lightness/chroma so the preview is honest
 *  (e.g. at zero chroma the ring turns gray). */
function HueWheel({ hue, onChange, size = 96, l = 0.70, c = 0.15 }: {
  hue: number; onChange: (h: number) => void; size?: number; l?: number; c?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const setFromPointer = useCallback((clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    let deg = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (deg < 0) deg += 360;
    onChange(Math.round(deg) % 360);
  }, [onChange]);

  const r = size / 2;
  const ringWidth = 14;
  const tr = r - ringWidth / 2; // thumb track radius (centre of the ring band)
  const rad = (hue * Math.PI) / 180;
  const thumbX = r + tr * Math.sin(rad);
  const thumbY = r - tr * Math.cos(rad);

  const stops: string[] = [];
  for (let d = 0; d <= 360; d += 15) stops.push(`oklch(${l} ${c} ${d}) ${d}deg`);

  return (
    <div
      ref={ref}
      role="slider"
      aria-label={t("settings.appearance.accent.hue")}
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={hue}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setFromPointer(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        setFromPointer(e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); onChange((hue + 1) % 360); }
        if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); onChange((hue + 359) % 360); }
      }}
      className="relative shrink-0 rounded-full cursor-pointer touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ width: size, height: size, background: `conic-gradient(${stops.join(", ")})` }}
    >
      {/* Donut hole — matches the card surface so the wheel reads as a ring */}
      <div className="absolute rounded-full bg-bg-overlay pointer-events-none" style={{ inset: ringWidth }} />
      {/* Thumb */}
      <span
        className="absolute w-4 h-4 rounded-full border-2 border-white shadow-[var(--shadow-md)] pointer-events-none -translate-x-1/2 -translate-y-1/2"
        style={{ left: thumbX, top: thumbY, backgroundColor: `oklch(${l} ${c} ${hue})` }}
      />
    </div>
  );
}

function TerminalSettings() {
  const fontSize = useSettingsStore((s) => s.terminalFontSize);
  const cursorStyle = useSettingsStore((s) => s.terminalCursorStyle);
  const cursorBlink = useSettingsStore((s) => s.terminalCursorBlink);
  const lineHeight = useSettingsStore((s) => s.terminalLineHeight);
  const scrollback = useSettingsStore((s) => s.terminalScrollback);

  const setFontSize = useSettingsStore((s) => s.setTerminalFontSize);
  const setCursorStyle = useSettingsStore((s) => s.setTerminalCursorStyle);
  const setCursorBlink = useSettingsStore((s) => s.setTerminalCursorBlink);
  const setLineHeight = useSettingsStore((s) => s.setTerminalLineHeight);
  const setScrollback = useSettingsStore((s) => s.setTerminalScrollback);
  const fontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const setFontFamily = useSettingsStore((s) => s.setTerminalFontFamily);
  const copyOnSelect = useSettingsStore((s) => s.terminalCopyOnSelect);
  const setCopyOnSelect = useSettingsStore((s) => s.setTerminalCopyOnSelect);
  const pasteButton = useSettingsStore((s) => s.terminalPasteButton);
  const setPasteButton = useSettingsStore((s) => s.setTerminalPasteButton);
  const terminalEncoding = useSettingsStore((s) => s.terminalEncoding);
  const setTerminalEncoding = useSettingsStore((s) => s.setTerminalEncoding);
  const terminalType = useSettingsStore((s) => s.terminalType);
  const setTerminalType = useSettingsStore((s) => s.setTerminalType);
  const terminalLang = useSettingsStore((s) => s.terminalLang);
  const setTerminalLang = useSettingsStore((s) => s.setTerminalLang);

  const { t } = useTranslation();

  const termFontOptions = useInstalledFontOptions(TERMINAL_FONT_CANDIDATES, fontFamily, t);

  return (
    <>
      <SettingsGroup label={t("settings.terminal.group.font")}>
        <SettingRow>
          <div>
            <label htmlFor="s-fontfamily" className={LABEL_CLASS}>{t("settings.terminal.fontFamily")}</label>
            <p className={DESC_CLASS}>{t("settings.terminal.fontFamilyHint")}</p>
          </div>
          <CustomSelect
            id="s-fontfamily"
            data-testid="s-fontfamily"
            value={fontFamily}
            onChange={setFontFamily}
            options={termFontOptions}
            className="w-44"
            previewOptionFont
          />
        </SettingRow>

        <SettingRow>
          <div>
            <label htmlFor="s-fontsize" className={LABEL_CLASS}>{t("settings.terminal.fontSize")}</label>
            <p className={DESC_CLASS}>{t("settings.terminal.fontSizeHint")}</p>
          </div>
          <RangeSetting id="s-fontsize" value={fontSize} min={8} max={42} step={1} unit="px" onChange={setFontSize} />
        </SettingRow>

        <SettingRow>
          <div>
            <label htmlFor="s-lineheight" className={LABEL_CLASS}>{t("settings.terminal.lineHeight")}</label>
            <p className={DESC_CLASS}>{t("settings.terminal.lineHeightHint")}</p>
          </div>
          <RangeSetting id="s-lineheight" value={lineHeight} min={1.0} max={2.0} step={0.1} decimals={1} onChange={setLineHeight} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup label={t("settings.terminal.group.cursor")}>
        <SettingRow>
          <div>
            <p className={LABEL_CLASS}>{t("settings.terminal.cursorStyle")}</p>
            <p className={DESC_CLASS}>{t("settings.terminal.cursorStyleHint")}</p>
          </div>
          <SegmentedControl<CursorStyle>
            id="s-cursor"
            value={cursorStyle}
            onChange={setCursorStyle}
            options={[
              { value: "bar", label: t("settings.terminal.cursor.bar") },
              { value: "block", label: t("settings.terminal.cursor.block") },
              { value: "underline", label: t("settings.terminal.cursor.underline") },
            ]}
          />
        </SettingRow>

        <SettingRow>
          <div>
            <label htmlFor="s-blink" className={LABEL_CLASS}>{t("settings.terminal.cursorBlink")}</label>
            <p className={DESC_CLASS}>{t("settings.terminal.cursorBlinkHint")}</p>
          </div>
          <Toggle id="s-blink" checked={cursorBlink} onChange={setCursorBlink} />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup label={t("settings.terminal.group.clipboard")}>
        <SettingRow>
          <div>
            <label htmlFor="s-copyonselect" className={LABEL_CLASS}>{t("settings.terminal.copyOnSelect")}</label>
            <p className={DESC_CLASS}>{t("settings.terminal.copyOnSelectHint")}</p>
          </div>
          <Toggle id="s-copyonselect" checked={copyOnSelect} onChange={setCopyOnSelect} />
        </SettingRow>

        <SettingRow>
          <div>
            <p className={LABEL_CLASS}>{t("settings.terminal.pasteButton")}</p>
            <p className={DESC_CLASS}>{t("settings.terminal.pasteButtonHint")}</p>
          </div>
          <SegmentedControl<PasteButton>
            id="s-pastebutton"
            value={pasteButton}
            onChange={setPasteButton}
            options={[
              { value: "none", label: t("settings.terminal.paste.off") },
              { value: "right", label: t("settings.terminal.paste.right") },
              { value: "middle", label: t("settings.terminal.paste.middle") },
            ]}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup label={t("settings.terminal.group.session")}>
        <SettingRow>
          <div>
            <label htmlFor="s-encoding" className={LABEL_CLASS}>{t("settings.terminal.encoding")}</label>
            <p className={DESC_CLASS}>{t("settings.terminal.encodingHint")}</p>
          </div>
          <CustomSelect
            id="s-encoding"
            data-testid="s-encoding"
            value={terminalEncoding}
            onChange={(v) => setTerminalEncoding(v as TerminalEncoding)}
            options={TERMINAL_ENCODINGS.map((e) => ({ value: e.value, label: e.label }))}
            className="w-44"
          />
        </SettingRow>

        <SettingRow>
          <div>
            <label htmlFor="s-lang" className={LABEL_CLASS}>{t("settings.terminal.lang")}</label>
            <p className={DESC_CLASS}>{t("settings.terminal.langHint")}</p>
          </div>
          <CustomSelect
            id="s-lang"
            data-testid="s-lang"
            value={terminalLang}
            onChange={setTerminalLang}
            options={[
              { value: "", label: t("settings.terminal.langNone") },
              ...LANG_PRESETS.map((p) => ({ value: p.value, label: p.label })),
            ]}
            className="w-44"
            editable
            editableValidate={(v) => LANG_RE.test(v)}
          />
        </SettingRow>

        <SettingRow>
          <div>
            <label htmlFor="s-termtype" className={LABEL_CLASS}>{t("settings.terminal.termType")}</label>
            <p className={DESC_CLASS}>{t("settings.terminal.termTypeHint")}</p>
          </div>
          <CustomSelect
            id="s-termtype"
            data-testid="s-termtype"
            value={terminalType}
            onChange={setTerminalType}
            options={TERMINAL_TYPES.map((opt) => ({
              value: opt.value,
              label: opt.recommended ? `${opt.label}${t("settings.terminal.recommendedSuffix")}` : opt.label,
            }))}
            className="w-44"
            editable
            editableValidate={(v) => TERM_NAME_RE.test(v)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup label={t("settings.terminal.group.history")}>
        <SettingRow>
          <div>
            <label htmlFor="s-scrollback" className={LABEL_CLASS}>{t("settings.terminal.scrollback")}</label>
            <p className={DESC_CLASS}>{t("settings.terminal.scrollbackHint")}</p>
          </div>
          <NumberSetting id="s-scrollback" value={scrollback} min={500} max={100000} step={500} onChange={setScrollback} />
        </SettingRow>
        <p className="px-1 text-[length:var(--text-xs)] text-text-muted">
          {t("settings.terminal.applyHint")}
        </p>
      </SettingsGroup>
    </>
  );
}

function ExplorerSettings() {
  const doubleClickAction = useSettingsStore((s) => s.explorerDoubleClickAction);
  const setDoubleClickAction = useSettingsStore((s) => s.setExplorerDoubleClickAction);
  const { t } = useTranslation();

  return (
    <SettingsGroup>
      <SettingRow>
        <div>
          <p className={LABEL_CLASS}>{t("settings.explorer.doubleClick")}</p>
          <p className={DESC_CLASS}>{t("settings.explorer.doubleClickHint")}</p>
        </div>
        <SegmentedControl<DoubleClickAction>
          id="s-doubleclick"
          value={doubleClickAction}
          onChange={setDoubleClickAction}
          options={[
            { value: "download", label: t("common.download") },
            { value: "open", label: t("settings.explorer.doubleClick.openInEditor") },
          ]}
        />
      </SettingRow>
      <p className="px-1 text-[length:var(--text-xs)] text-text-muted">
        {t("settings.explorer.fallbackHint")}
      </p>
    </SettingsGroup>
  );
}

function TransferSettings() {
  const transferConcurrency = useSettingsStore((s) => s.transferConcurrency);
  const setConcurrency = useSettingsStore((s) => s.setTransferConcurrency);
  const { t } = useTranslation();

  return (
    <SettingsGroup>
      <SettingRow>
        <div>
          <label htmlFor="s-concurrency" className={LABEL_CLASS}>{t("settings.transfers.concurrency")}</label>
          <p className={DESC_CLASS}>{t("settings.transfers.concurrencyHint")}</p>
        </div>
        <NumberSetting id="s-concurrency" value={transferConcurrency} min={1} max={10} step={1} onChange={setConcurrency} />
      </SettingRow>
    </SettingsGroup>
  );
}

// ─── Data ───────────────────────────────────────────────────────────────────────

function DataSettings() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // Import is two-step: pick a file, then prompt for its password.
  const [importPath, setImportPath] = useState<string | null>(null);
  const { t } = useTranslation();

  const pickImportFile = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        directory: false,
        title: t("settings.backup.selectFileTitle"),
        filters: [{ name: t("settings.backup.fileFilter"), extensions: ["ascpbak"] }],
      });
      if (typeof picked === "string") setImportPath(picked);
    } catch { /* dialog cancelled / unavailable */ }
  }, [t]);

  return (
    <>
      <SettingsGroup label={t("settings.data.group.backup")}>
        <SettingRow>
          <div>
            <p className={LABEL_CLASS}>{t("settings.data.export")}</p>
            <p className={DESC_CLASS}>
              {t("settings.data.exportHint")}
            </p>
          </div>
          <button type="button" data-testid="s-export-backup" onClick={() => setExportOpen(true)} className={BTN_SECONDARY}>
            <Download size={13} strokeWidth={2} /> {t("settings.data.exportAction")}
          </button>
        </SettingRow>
        <SettingRow>
          <div>
            <p className={LABEL_CLASS}>{t("settings.data.import")}</p>
            <p className={DESC_CLASS}>
              {t("settings.data.importHint")}
            </p>
          </div>
          <button type="button" data-testid="s-import-backup" onClick={() => void pickImportFile()} className={BTN_SECONDARY}>
            <Upload size={13} strokeWidth={2} /> {t("settings.data.importAction")}
          </button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup label={t("settings.data.group.danger")}>
        <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-bg-surface border border-status-error/30">
          <div>
            <p className={LABEL_CLASS}>{t("settings.data.clearAll")}</p>
            <p className={DESC_CLASS}>
              {t("settings.data.clearAllHint")}
            </p>
          </div>
          <button
            type="button"
            data-testid="s-clear-data"
            onClick={() => setConfirmOpen(true)}
            className={[
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg shrink-0",
              "text-[length:var(--text-sm)] font-medium",
              "bg-status-error/10 border border-status-error/40 text-status-error",
              "hover:bg-status-error/15",
              "transition-colors duration-[var(--duration-fast)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            ].join(" ")}
          >
            <Trash2 size={13} strokeWidth={2} /> {t("settings.data.clearAllAction")}
          </button>
        </div>
      </SettingsGroup>

      <BackupPasswordModal mode="export" open={exportOpen} onClose={() => setExportOpen(false)} />
      <BackupPasswordModal
        mode="import"
        open={importPath !== null}
        path={importPath ?? undefined}
        onClose={() => setImportPath(null)}
      />
      <ConfirmResetModal open={confirmOpen} onClose={() => setConfirmOpen(false)} />
    </>
  );
}

/** Passphrase dialog for encrypted backup export/import.
 *  - export: set + confirm a password, then a save-file dialog picks the path.
 *  - import: enter the file's password; on success the app relaunches so the
 *    restored data loads cleanly. */
function BackupPasswordModal({ mode, open, path, onClose }: {
  mode: "export" | "import";
  open: boolean;
  path?: string;
  onClose: () => void;
}) {
  const isExport = mode === "export";
  const MIN_LEN = 8;
  const { t } = useTranslation();
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const valid = isExport ? pw.length >= MIN_LEN && pw === confirm : pw.length > 0;
  const canSubmit = valid && !busy;

  useEffect(() => {
    if (open) {
      setPw("");
      setConfirm("");
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (isExport) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
        const dest = await save({
          title: t("settings.backup.saveFileTitle"),
          defaultPath: `anyssh-backup-${stamp}.ascpbak`,
          filters: [{ name: t("settings.backup.fileFilter"), extensions: ["ascpbak"] }],
        });
        if (!dest) { setBusy(false); return; } // dialog cancelled — keep the modal open
        await invoke("backup_export", { password: pw, path: dest });
        toast.success(t("settings.backup.savedToast"));
        onClose();
      } else {
        await invoke("backup_import", { password: pw, path });
        // Relaunch so all in-memory state reloads from the restored database.
        try {
          const { relaunch } = await import("@tauri-apps/plugin-process");
          await relaunch();
        } catch {
          window.location.reload();
        }
      }
    } catch (e: unknown) {
      setBusy(false);
      const msg = e && typeof e === "object" && "message" in e
        ? String((e as { message: unknown }).message)
        : null;
      toast.error(msg ?? (isExport ? t("settings.backup.exportFailedToast") : t("settings.backup.importFailedToast")));
    }
  }, [canSubmit, isExport, pw, path, onClose, t]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={isExport ? t("settings.backup.title.export") : t("settings.backup.title.import")}
      icon={isExport ? ShieldCheck : AlertCircle}
      iconVariant={isExport ? "accent" : "danger"}
      maxWidth="md"
      busy={busy}
      testId={`backup-modal-${mode}`}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BTN_GHOST}>{t("common.cancel")}</button>
          <button
            form="backup-form"
            type="submit"
            data-testid="backup-submit"
            disabled={!canSubmit}
            className={isExport ? BTN_PRIMARY : BTN_DANGER}
          >
            {busy && <RefreshCw size={13} strokeWidth={2} className="motion-safe:animate-spin" />}
            {isExport
              ? (busy ? t("settings.backup.exporting") : t("settings.backup.exportAction"))
              : (busy ? t("settings.backup.restoring") : t("settings.backup.importAction"))}
          </button>
        </>
      }
    >
        <form id="backup-form" onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-4">
          <p className="text-[length:var(--text-sm)] text-text-secondary">
            {isExport ? t("settings.backup.exportBody") : t("settings.backup.importBody")}
          </p>

          <div>
            <label htmlFor="backup-pw" className={FIELD_LABEL_CLASS}>{t("common.password")}</label>
            <input
              ref={inputRef}
              id="backup-pw"
              data-testid="backup-password"
              type="password"
              autoComplete={isExport ? "new-password" : "current-password"}
              value={pw}
              disabled={busy}
              onChange={(e) => setPw(e.target.value)}
              placeholder={isExport ? t("settings.backup.passwordHint", { min: MIN_LEN }) : t("settings.backup.passwordPlaceholder")}
              className={TEXT_INPUT_CLASS}
            />
          </div>

          {isExport && (
            <div>
              <label htmlFor="backup-pw2" className={FIELD_LABEL_CLASS}>{t("settings.backup.confirmPassword")}</label>
              <input
                id="backup-pw2"
                data-testid="backup-password-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                disabled={busy}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("settings.backup.confirmPlaceholder")}
                className={TEXT_INPUT_CLASS}
              />
              {confirm.length > 0 && pw !== confirm && (
                <p className="mt-1 text-[length:var(--text-xs)] text-status-error">{t("settings.backup.passwordMismatch")}</p>
              )}
            </div>
          )}

        </form>
    </ModalShell>
  );
}

/** Typed-confirmation dialog for the irreversible factory reset. The user must
 *  type the confirm word, then we wipe the backend and relaunch the app. */
function ConfirmResetModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const CONFIRM_WORD = "DELETE";
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useTranslation();

  const inputRef = useRef<HTMLInputElement>(null);

  const canReset = text.trim() === CONFIRM_WORD && !busy;

  useEffect(() => {
    if (open) {
      setText("");
      setBusy(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const doReset = useCallback(async () => {
    setBusy(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("factory_reset");
      // Relaunch so all in-memory state — frontend stores AND backend sessions —
      // restarts from the now-empty database, a true first-launch state.
      try {
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      } catch {
        // Relaunch unavailable (dev/web) — reload the webview as a fallback.
        window.location.reload();
      }
    } catch {
      setBusy(false);
      toast.error(t("settings.reset.failedToast"));
    }
  }, [t]);

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t("settings.reset.title")}
      icon={AlertCircle}
      iconVariant="danger"
      maxWidth="md"
      busy={busy}
      testId="reset-modal"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className={BTN_GHOST}>{t("common.cancel")}</button>
          <button
            type="button"
            data-testid="reset-confirm-submit"
            onClick={() => void doReset()}
            disabled={!canReset}
            className={`flex items-center gap-1.5 ${BTN_DANGER}`}
          >
            {busy && <RefreshCw size={13} strokeWidth={2} className="motion-safe:animate-spin" />}
            {busy ? t("settings.reset.clearing") : t("settings.reset.action")}
          </button>
        </>
      }
    >
        <div className="flex flex-col gap-4">
          <p className="text-[length:var(--text-sm)] text-text-secondary">
            {t("settings.reset.bodyPrefix")} <strong className="text-text-primary">{t("settings.reset.bodyEmphasis")}</strong> {t("settings.reset.bodySuffix")}
          </p>
          <div>
            <label htmlFor="reset-confirm" className={FIELD_LABEL_CLASS}>
              {t("settings.reset.typePrefix")} <code className="px-1 rounded bg-bg-base text-status-error">{CONFIRM_WORD}</code> {t("settings.reset.typeSuffix")}
            </label>
            <input
              ref={inputRef}
              id="reset-confirm"
              data-testid="reset-confirm-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canReset) void doReset(); }}
              placeholder={CONFIRM_WORD}
              className={TEXT_INPUT_CLASS}
            />
          </div>
        </div>
    </ModalShell>
  );
}

// ─── Editors ──────────────────────────────────────────────────────────────────

/** A detected editor as returned by the `detect_editors` backend command. */
type DetectedEditor = { name: string; execPath: string; args: string };

function EditorsSettings() {
  const editors = useSettingsStore((s) => s.editors);
  const defaultEditorId = useSettingsStore((s) => s.defaultEditorId);
  const addEditor = useSettingsStore((s) => s.addEditor);
  const removeEditor = useSettingsStore((s) => s.removeEditor);
  const setDefaultEditor = useSettingsStore((s) => s.setDefaultEditor);

  const [detected, setDetected] = useState<DetectedEditor[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const { t } = useTranslation();

  const configuredPaths = new Set(editors.map((e) => e.execPath));
  const newlyDetected = (detected ?? []).filter((e) => !configuredPaths.has(e.execPath));

  const scan = useCallback(async () => {
    setDetecting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const found = await invoke<DetectedEditor[]>("detect_editors");
      setDetected(found);
      // Feedback when the scan adds nothing new (the common case after the
      // first-run auto-seed) so the button doesn't feel inert.
      const configured = new Set(useSettingsStore.getState().editors.map((e) => e.execPath));
      if (found.filter((e) => !configured.has(e.execPath)).length === 0) {
        toast.info(found.length === 0
          ? t("settings.editors.noneFoundToast")
          : t("settings.editors.allAddedToast"));
      }
    } catch {
      toast.error(t("settings.editors.scanFailedToast"));
    } finally {
      setDetecting(false);
    }
  }, [t]);

  return (
    <>
      <SettingsGroup label={t("settings.editors.group")}>
        {editors.length === 0 ? (
          <div className="px-4 py-6 rounded-xl bg-bg-surface border border-border/50 text-center">
            <p className="text-[length:var(--text-sm)] text-text-muted">
              {t("settings.editors.empty")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {editors.map((ed) => (
              <EditorRow
                key={ed.id}
                editor={ed}
                isDefault={ed.id === defaultEditorId}
                onMakeDefault={() => setDefaultEditor(ed.id)}
                onRemove={() => removeEditor(ed.id)}
              />
            ))}
          </div>
        )}

        {/* Actions: the two ways to add an editor. */}
        <div className="flex items-center gap-2 mt-3">
          <button onClick={() => void scan()} disabled={detecting} className={BTN_SECONDARY}>
            {detecting
              ? <RefreshCw size={13} strokeWidth={2} className="motion-safe:animate-spin" />
              : <Search size={13} strokeWidth={2} />}
            {detecting ? t("settings.editors.scanning") : t("settings.editors.scan")}
          </button>
          <button onClick={() => setCustomOpen(true)} className={BTN_SECONDARY}>
            <Plus size={13} strokeWidth={2} /> {t("settings.editors.addCustom")}
          </button>
        </div>

        {editors.length > 0 && (
          <p className="px-1 mt-2 text-[length:var(--text-xs)] text-text-muted">
            {t("settings.editors.starHint")}
          </p>
        )}
      </SettingsGroup>

      {/* Detected-but-not-added editors appear only after a scan turns some up. */}
      {newlyDetected.length > 0 && (
        <SettingsGroup label={t("settings.editors.group.found")}>
          <div className="flex flex-col gap-2">
            {newlyDetected.map((ed) => (
              <div
                key={ed.execPath}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-bg-surface border border-border/50"
              >
                <div className="min-w-0">
                  <p className={LABEL_CLASS}>{ed.name}</p>
                  <p className="text-[length:var(--text-xs)] text-text-muted truncate" title={ed.execPath}>
                    {ed.execPath}
                  </p>
                </div>
                <button
                  onClick={() => addEditor({ name: ed.name, execPath: ed.execPath, args: ed.args || "{path}" })}
                  className={BTN_SECONDARY}
                >
                  <Plus size={13} strokeWidth={2} /> {t("common.add")}
                </button>
              </div>
            ))}
          </div>
        </SettingsGroup>
      )}

      <AddEditorModal open={customOpen} onClose={() => setCustomOpen(false)} onAdd={addEditor} />
    </>
  );
}

function EditorRow({ editor, isDefault, onMakeDefault, onRemove }: {
  editor: EditorConfig;
  isDefault: boolean;
  onMakeDefault: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-bg-surface border border-border/50">
      <div className="min-w-0">
        <p className={`${LABEL_CLASS} flex items-center gap-1.5`}>
          {editor.name}
          {isDefault && (
            <span className="text-[length:var(--text-2xs)] font-medium text-accent uppercase tracking-wide">{t("common.default")}</span>
          )}
        </p>
        <p className="text-[length:var(--text-xs)] text-text-muted truncate" title={editor.execPath}>
          {editor.execPath} <span className="opacity-60">· {editor.args}</span>
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onMakeDefault}
          disabled={isDefault}
          title={isDefault ? t("settings.editors.defaultEditor") : t("settings.editors.setAsDefault")}
          aria-label={isDefault ? t("settings.editors.defaultEditor") : t("settings.editors.setAsDefault")}
          className={[
            "p-1.5 rounded-lg border transition-colors duration-[var(--duration-fast)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isDefault
              ? "border-transparent text-accent pointer-events-none"
              : "border-border text-text-muted hover:text-text-primary hover:border-border-focus",
          ].join(" ")}
        >
          <Star size={15} strokeWidth={2} fill={isDefault ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          title={t("common.remove")}
          aria-label={t("settings.editors.removeNamed", { name: editor.name })}
          className="p-1.5 rounded-lg border border-border text-text-muted hover:text-status-error hover:border-status-error/40 transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 size={15} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

/** Modal form for adding a custom editor — opened from the Editors section so
 *  the multi-field form isn't always taking up space on the page. */
function AddEditorModal({ open, onClose, onAdd }: {
  open: boolean;
  onClose: () => void;
  onAdd: (editor: Omit<EditorConfig, "id">) => void;
}) {
  const [name, setName] = useState("");
  const [execPath, setExecPath] = useState("");
  const [args, setArgs] = useState("{path}");
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation();

  const nameRef = useRef<HTMLInputElement>(null);

  // Reset fields and play the open transition each time it's shown.
  useEffect(() => {
    if (open) {
      setName("");
      setExecPath("");
      setArgs("{path}");
      requestAnimationFrame(() => setVisible(true));
    } else {
      setVisible(false);
    }
  }, [open]);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => nameRef.current?.focus());
  }, [visible]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const browse = useCallback(async () => {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const picked = await openDialog({ multiple: false, directory: false, title: t("settings.editors.selectExecutableTitle") });
      if (typeof picked === "string") {
        setExecPath(picked);
        // Pre-fill the name from the file/app name when it's still blank.
        setName((cur) => (cur.trim() ? cur : (picked.split(/[\\/]/).pop() ?? "").replace(/\.(app|exe)$/i, "")));
      }
    } catch { /* dialog cancelled / unavailable */ }
  }, [t]);

  const canAdd = name.trim().length > 0 && execPath.trim().length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    onAdd({ name: name.trim(), execPath: execPath.trim(), args: args.trim() || "{path}" });
    onClose();
  };

  if (!open) return null;

  return (
    <ModalBackdrop
      onClose={onClose}
      className={[
        "fixed inset-0 z-50 flex items-start justify-center pt-[8vh]",
        "transition-[background-color,backdrop-filter] duration-[var(--duration-base)]",
        visible ? "bg-black/50 backdrop-blur-sm" : "bg-black/0 backdrop-blur-none",
      ].join(" ")}
    >
      <form
        onSubmit={submit}
        data-testid="editor-modal"
        className={[
          "w-full max-w-md rounded-xl bg-bg-overlay border border-border shadow-[var(--shadow-lg)]",
          "flex flex-col max-h-[84vh]",
          "transition-[opacity,transform] duration-[var(--duration-slow)] ease-[var(--ease-expo-out)]",
          visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border shrink-0">
          <h2 className="text-[length:var(--text-lg)] font-semibold text-text-primary">{t("settings.editors.addTitle")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-subtle transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1 min-h-0 flex flex-col gap-4">
          <div>
            <label htmlFor="ed-name" className={FIELD_LABEL_CLASS}>{t("common.name")}</label>
            <input
              ref={nameRef}
              id="ed-name"
              data-testid="ed-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("settings.editors.namePlaceholder")}
              className={TEXT_INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="ed-path" className={FIELD_LABEL_CLASS}>{t("settings.editors.executablePath")}</label>
            <div className="flex items-center gap-2">
              <input
                id="ed-path"
                data-testid="ed-path"
                type="text"
                value={execPath}
                onChange={(e) => setExecPath(e.target.value)}
                placeholder={t("settings.editors.pathPlaceholder")}
                className={TEXT_INPUT_CLASS}
              />
              <button
                type="button"
                onClick={() => void browse()}
                className="inline-flex items-center gap-1.5 px-3 py-2 shrink-0 rounded-lg text-[length:var(--text-sm)] font-medium bg-bg-base border border-border text-text-secondary hover:text-text-primary hover:border-border-focus hover:bg-bg-overlay transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <FolderOpen size={13} strokeWidth={2} /> {t("common.browse")}
              </button>
            </div>
          </div>

          <div>
            <label htmlFor="ed-args" className={FIELD_LABEL_CLASS}>{t("settings.editors.arguments")}</label>
            <input
              id="ed-args"
              data-testid="ed-args"
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="{path}"
              className={TEXT_INPUT_CLASS}
            />
            <p className={DESC_CLASS}>
              Use <code className="px-1 rounded bg-bg-base">{"{path}"}</code> where the file should go. If omitted, it's added at the end.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3 flex items-center justify-end gap-2 border-t border-border shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-[length:var(--text-sm)] text-text-secondary hover:text-text-primary rounded-lg transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canAdd}
            className="px-4 py-2 text-[length:var(--text-sm)] font-medium text-text-inverse bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-overlay"
          >
            Add editor
          </button>
        </div>
      </form>
    </ModalBackdrop>
  );
}

function AboutSettings() {
  const { t } = useTranslation();
  const autoUpdate = useSettingsStore((s) => s.autoUpdate);
  const setAutoUpdate = useSettingsStore((s) => s.setAutoUpdate);

  return (
    <>
      <SettingsGroup label={t("settings.about.group")}>
        <AboutCard />
      </SettingsGroup>
      <SettingsGroup label={t("settings.about.group.updates")}>
        <SettingRow>
          <div>
            <label htmlFor="s-auto-update" className={LABEL_CLASS}>{t("settings.about.autoUpdate")}</label>
            <p className={DESC_CLASS}>{t("settings.about.autoUpdateHint")}</p>
          </div>
          <Toggle id="s-auto-update" checked={autoUpdate} onChange={setAutoUpdate} />
        </SettingRow>
        <UpdateChecker />
      </SettingsGroup>
    </>
  );
}

function AboutCard() {
  const { t } = useTranslation();
  const [appVersion, setAppVersion] = useState<string | null>(null);

  // Real app version (injected from git tags at build).
  useEffect(() => {
    void (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setAppVersion(await getVersion());
      } catch { /* best-effort */ }
    })();
  }, []);

  const openRepo = useCallback(async () => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(REPO_URL);
    } catch { /* best-effort */ }
  }, []);

  return (
    <div className="px-4 py-3 rounded-xl bg-bg-surface border border-border/50">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-[length:var(--text-base)] font-semibold text-text-primary">anySSH</p>
          <p className={DESC_CLASS}>{t("settings.about.tagline")}</p>
        </div>
        <span className="shrink-0 text-[length:var(--text-xs)] tabular-nums text-text-muted">
          {appVersion ? `v${appVersion}` : ""}
        </span>
      </div>

      <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between gap-4">
        <div>
          <p className={LABEL_CLASS}>{t("settings.about.repository")}</p>
          <p className={DESC_CLASS}>{t("settings.about.repositoryHint")}</p>
        </div>
        <button
          onClick={() => void openRepo()}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg shrink-0",
            "text-[length:var(--text-sm)] font-medium",
            "bg-bg-base border border-border text-text-secondary",
            "hover:text-text-primary hover:border-border-focus",
            "transition-all duration-[var(--duration-fast)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          ].join(" ")}
        >
          <ExternalLink size={13} strokeWidth={2} />
          GitHub
        </button>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/** A labelled group of setting cards, mirroring the "THEME" / "INTERFACE" sections. */
function SettingsGroup({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 last:mb-0">
      {label && (
        <h2 className="px-1 mb-3 text-[length:var(--text-2xs)] font-semibold uppercase tracking-wider text-text-muted">
          {label}
        </h2>
      )}
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}

function SettingRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-bg-surface border border-border/50">
      {children}
    </div>
  );
}

function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={[
        "relative w-9 h-5 rounded-full shrink-0",
        "transition-colors duration-[var(--duration-fast)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        checked ? "bg-accent" : "bg-bg-muted",
      ].join(" ")}
    >
      <span
        className={[
          "absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-[var(--shadow-sm)]",
          "transition-transform duration-[var(--duration-fast)]",
          checked ? "translate-x-4" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}

/** Segmented toggle for small option sets (e.g. theme, cursor style). */
function SegmentedControl<T extends string>({ id, value, onChange, options }: {
  id?: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      className="inline-grid shrink-0 gap-1 p-1 rounded-lg bg-bg-base border border-border"
      style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            data-testid={id ? `${id}-${opt.value}` : undefined}
            onClick={() => onChange(opt.value)}
            className={[
              "px-3 py-1.5 rounded-md text-center text-[length:var(--text-sm)] font-medium",
              "transition-colors duration-[var(--duration-fast)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? "bg-bg-overlay text-text-primary shadow-[var(--shadow-sm)]"
                : "text-text-muted hover:text-text-primary",
            ].join(" ")}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Update checker ─────────────────────────────────────────────────────────

function UpdateChecker() {
  const { t } = useTranslation();
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const error = useUpdaterStore((s) => s.error);
  const progress = useUpdaterStore((s) => s.progress);
  const appVersion = useUpdaterStore((s) => s.appVersion);
  const checkManually = useUpdaterStore((s) => s.checkManually);
  const relaunchNow = useUpdaterStore((s) => s.relaunchNow);

  useEffect(() => {
    void useUpdaterStore.getState().loadAppVersion();
  }, []);

  const showCheck =
    status === "idle" || status === "up-to-date" || status === "error" || status === "available";

  return (
    <div className="px-4 py-3 rounded-xl bg-bg-surface border border-border/50">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className={LABEL_CLASS}>{t("updater.checker.appVersion")}</p>
          <p className={DESC_CLASS}>
            {status === "up-to-date" && t("updater.checker.upToDate")}
            {status === "available" && t("updater.checker.available", { version: version ?? "" })}
            {status === "downloading" && t("updater.checker.downloading", { progress })}
            {status === "ready" && t("updater.checker.ready")}
            {status === "error" && (error ?? t("updater.error.checkFailed"))}
            {(status === "idle" || status === "checking") && (appVersion ? t("updater.checker.currentVersion", { version: appVersion }) : t("updater.checker.readingVersion"))}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {status === "up-to-date" && (
            <CheckCircle2 size={15} strokeWidth={2} className="text-status-connected shrink-0" />
          )}
          {status === "error" && (
            <AlertCircle size={15} strokeWidth={2} className="text-status-error shrink-0" />
          )}

          {showCheck && (
            <button
              onClick={() => void checkManually()}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg",
                "text-[length:var(--text-sm)] font-medium",
                "bg-bg-base border border-border text-text-secondary",
                "hover:text-text-primary hover:border-border-focus",
                "transition-all duration-[var(--duration-fast)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ].join(" ")}
            >
              <RefreshCw size={13} strokeWidth={2} />
              {t("updater.checker.check")}
            </button>
          )}

          {status === "checking" && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-[length:var(--text-sm)] font-medium text-text-muted">
              <RefreshCw size={13} strokeWidth={2} className="motion-safe:animate-spin" />
              {t("updater.checker.checking")}
            </span>
          )}

          {status === "downloading" && (
            <div className="w-24 h-1.5 rounded-full bg-bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {status === "ready" && (
            <button
              onClick={() => void relaunchNow()}
              className={[
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg",
                "text-[length:var(--text-sm)] font-medium",
                "bg-status-connected text-text-inverse",
                "hover:opacity-90",
                "transition-all duration-[var(--duration-fast)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              ].join(" ")}
            >
              {t("updater.checker.restartNow")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Slider with a live value readout, for bounded numeric settings. */
function RangeSetting({ id, value, min, max, step, decimals = 0, unit = "", onChange }: {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 shrink-0">
      <input
        id={id}
        data-testid={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-36 h-1.5 cursor-pointer"
        style={{ accentColor: "var(--color-accent)" }}
      />
      <span className="w-10 shrink-0 text-right text-[length:var(--text-sm)] tabular-nums text-text-secondary">
        {value.toFixed(decimals)}{unit}
      </span>
    </div>
  );
}

/** Number input that uses local state while typing, commits on blur/Enter. */
function NumberSetting({ id, value, min, max, step, onChange }: {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));

  // Sync from store when value changes externally
  useEffect(() => {
    setLocal(String(value));
  }, [value]);

  const commit = () => {
    const n = Number(local);
    if (isNaN(n)) {
      setLocal(String(value)); // revert
      return;
    }
    const clamped = Math.max(min, Math.min(max, n));
    onChange(clamped);
    setLocal(String(clamped));
  };

  return (
    <input
      id={id}
      data-testid={id}
      type="text"
      inputMode="decimal"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        }
        // Arrow keys for increment/decrement
        if (e.key === "ArrowUp") {
          e.preventDefault();
          const next = Math.min(max, Number(local) + step);
          setLocal(String(Number(next.toFixed(2))));
          onChange(next);
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          const next = Math.max(min, Number(local) - step);
          setLocal(String(Number(next.toFixed(2))));
          onChange(next);
        }
      }}
      className={INPUT_CLASS}
    />
  );
}
