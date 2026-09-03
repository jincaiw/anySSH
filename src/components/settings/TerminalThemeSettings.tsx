import { useRef, useState } from "react";
import { Pencil, Trash2, Plus, FileUp } from "lucide-react";
import { ModalShell, BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY } from "../shared/ModalShell";
import { ConfirmDangerDialog } from "../shared/ConfirmDangerDialog";
import { useSettingsStore } from "../../stores/settings-store";
import { useTranslation } from "../../i18n";
import { toast } from "../../stores/toast-store";
import {
  BUILTIN_THEMES,
  SYSTEM_THEME_ID,
  normalizeHex,
  parseItermColors,
  sanitizeTheme,
  type TerminalTheme,
  type TerminalThemeColors,
} from "../../lib/terminal-themes";

// ─── Colour field metadata ───────────────────────────────────────────────────

type ColorSlot = keyof TerminalThemeColors;

const BASIC_SLOTS: ColorSlot[] = [
  "background",
  "foreground",
  "cursor",
  "cursorAccent",
  "selectionBackground",
  "selectionForeground",
];

const ANSI_SLOTS: ColorSlot[] = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
];

const ANSI_BRIGHT_SLOTS: ColorSlot[] = [
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

const slotLabelKey = (slot: ColorSlot) => `settings.terminal.theme.c.${slot}`;

// ─── Theme preview card ──────────────────────────────────────────────────────

function ThemePreview({ colors }: { colors: TerminalThemeColors }) {
  return (
    <div
      className="rounded-md border border-border/40 h-14 px-2 py-1.5 flex flex-col justify-between overflow-hidden"
      style={{ backgroundColor: colors.background }}
    >
      <div className="font-mono text-[10px] leading-none truncate">
        <span style={{ color: colors.foreground }}>$ ssh user@host</span>
        <span
          className="inline-block w-[5px] h-[10px] align-middle ml-0.5"
          style={{ backgroundColor: colors.cursor }}
        />
      </div>
      <div className="flex gap-[3px]">
        {ANSI_SLOTS.map((slot) => (
          <span
            key={slot}
            className="flex-1 h-1.5 rounded-[2px]"
            style={{ backgroundColor: colors[slot] }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Colour row editor ───────────────────────────────────────────────────────

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  // Local text state so typing a partial hex doesn't snap back mid-edit.
  const [text, setText] = useState<string | null>(null);
  const display = text ?? value;

  const commitText = () => {
    if (text === null) return;
    const normalized = normalizeHex(text);
    if (normalized) onChange(normalized);
    setText(null);
  };

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <label
        className="w-8 h-8 rounded-lg border border-border overflow-hidden shrink-0 cursor-pointer relative"
        title={label}
      >
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="absolute inset-0 w-[150%] h-[150%] -translate-x-1/4 -translate-y-1/4 cursor-pointer p-0 border-0"
          aria-label={label}
        />
      </label>
      <span className="flex-1 text-[length:var(--text-sm)] text-text-primary truncate">{label}</span>
      <input
        type="text"
        value={display}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitText();
          }
        }}
        spellCheck={false}
        className="w-24 px-2.5 py-1.5 rounded-lg text-[length:var(--text-xs)] font-mono tabular-nums bg-bg-base border border-border text-text-primary outline-none focus:border-border-focus focus:ring-2 focus:ring-ring transition-[border-color,box-shadow] duration-[var(--duration-fast)]"
        aria-label={`${label} hex`}
      />
    </div>
  );
}

// ─── Theme editor modal ──────────────────────────────────────────────────────

function ThemeEditorModal({
  editing,
  onClose,
}: {
  editing: TerminalTheme | "new" | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const upsertTheme = useSettingsStore((s) => s.upsertTerminalCustomTheme);
  const setTerminalThemeId = useSettingsStore((s) => s.setTerminalThemeId);

  const isNew = editing === "new";
  const source = editing && editing !== "new" ? editing : null;

  const [name, setName] = useState(source?.name ?? "");
  const [colors, setColors] = useState<TerminalThemeColors>(
    () =>
      source?.colors ??
      // Seed a new theme from the currently selected builtin/custom theme so
      // the user starts from something legible instead of a blank slate.
      (structuredClone(
        useSettingsStore.getState().terminalCustomThemes.find(
          (th) => th.id === useSettingsStore.getState().terminalThemeId,
        )?.colors ?? BUILTIN_THEMES.find((th) => th.id === "one-dark-pro")!.colors,
      )),
  );

  const setColor = (slot: ColorSlot, hex: string) =>
    setColors((c) => ({ ...c, [slot]: hex }));

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const theme: TerminalTheme = sanitizeTheme({
      id: source?.id ?? crypto.randomUUID(),
      name: trimmed,
      builtin: false,
      colors,
    })!;
    upsertTheme(theme);
    if (isNew) setTerminalThemeId(theme.id);
    onClose();
  };

  return (
    <ModalShell
      open={editing !== null}
      onClose={onClose}
      title={isNew ? t("settings.terminal.theme.editor.new") : t("settings.terminal.theme.editor.edit")}
      icon={Pencil}
      maxWidth="md"
      scrollable
      testId="theme-editor"
      footer={
        <>
          <button type="button" className={BTN_GHOST} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            onClick={handleSave}
            disabled={!name.trim()}
            data-testid="theme-editor-save"
          >
            {t("common.save")}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <label htmlFor="theme-name" className="block text-[length:var(--text-xs)] font-medium text-text-secondary mb-1">
            {t("settings.terminal.theme.editor.name")}
          </label>
          <input
            id="theme-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("settings.terminal.theme.editor.namePlaceholder")}
            className="w-full px-3 py-2 rounded-lg text-[length:var(--text-sm)] bg-bg-base border border-border text-text-primary outline-none focus:border-border-focus focus:ring-2 focus:ring-ring transition-[border-color,box-shadow] duration-[var(--duration-fast)]"
            data-testid="theme-editor-name"
          />
        </div>

        {/* Live preview of the palette being edited */}
        <ThemePreview colors={colors} />

        <section>
          <h3 className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-text-muted mb-1">
            {t("settings.terminal.theme.editor.group.basic")}
          </h3>
          {BASIC_SLOTS.map((slot) => (
            <ColorRow
              key={slot}
              label={t(slotLabelKey(slot))}
              value={colors[slot]}
              onChange={(hex) => setColor(slot, hex)}
            />
          ))}
        </section>

        <section>
          <h3 className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-text-muted mb-1">
            {t("settings.terminal.theme.editor.group.ansi")}
          </h3>
          {ANSI_SLOTS.map((slot) => (
            <ColorRow
              key={slot}
              label={t(slotLabelKey(slot))}
              value={colors[slot]}
              onChange={(hex) => setColor(slot, hex)}
            />
          ))}
        </section>

        <section>
          <h3 className="text-[length:var(--text-xs)] font-semibold uppercase tracking-widest text-text-muted mb-1">
            {t("settings.terminal.theme.editor.group.ansiBright")}
          </h3>
          {ANSI_BRIGHT_SLOTS.map((slot) => (
            <ColorRow
              key={slot}
              label={t(slotLabelKey(slot))}
              value={colors[slot]}
              onChange={(hex) => setColor(slot, hex)}
            />
          ))}
        </section>
      </div>
    </ModalShell>
  );
}

// ─── Main section ────────────────────────────────────────────────────────────

export function TerminalThemeSettings() {
  const { t } = useTranslation();
  const terminalThemeId = useSettingsStore((s) => s.terminalThemeId);
  const customThemes = useSettingsStore((s) => s.terminalCustomThemes);
  const setTerminalThemeId = useSettingsStore((s) => s.setTerminalThemeId);
  const removeTheme = useSettingsStore((s) => s.removeTerminalCustomTheme);

  const [editorState, setEditorState] = useState<TerminalTheme | "new" | null>(null);
  const [deleting, setDeleting] = useState<TerminalTheme | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const allThemes = [...BUILTIN_THEMES, ...customThemes];

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const theme = parseItermColors(text, file.name);
      if (!theme) {
        toast.error(t("settings.terminal.theme.import.failed"));
        return;
      }
      useSettingsStore.getState().upsertTerminalCustomTheme(theme);
      useSettingsStore.getState().setTerminalThemeId(theme.id);
      toast.success(t("settings.terminal.theme.import.success", { name: theme.name }));
    } catch {
      toast.error(t("settings.terminal.theme.import.failed"));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 self-end">
        <button
          type="button"
          className={BTN_SECONDARY}
          onClick={() => fileRef.current?.click()}
          data-testid="theme-import"
        >
          <FileUp size={14} strokeWidth={2} />
          {t("settings.terminal.theme.import")}
        </button>
        <button
          type="button"
          className={BTN_SECONDARY}
          onClick={() => setEditorState("new")}
          data-testid="theme-new"
        >
          <Plus size={14} strokeWidth={2} />
          {t("settings.terminal.theme.new")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".itermcolors,text/xml,application/xml"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = "";
          }}
        />
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
        {/* Follow-app-theme option (legacy CSS-variable palette) */}
        <button
          type="button"
          data-testid="theme-card-system"
          aria-pressed={terminalThemeId === SYSTEM_THEME_ID}
          onClick={() => setTerminalThemeId(SYSTEM_THEME_ID)}
          className={[
            "rounded-xl p-2.5 text-left border transition-all duration-[var(--duration-fast)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            terminalThemeId === SYSTEM_THEME_ID
              ? "border-border-focus ring-2 ring-ring bg-bg-overlay"
              : "border-border hover:border-border-focus bg-bg-surface",
          ].join(" ")}
        >
          <div className="h-14 rounded-md border border-border/40 bg-gradient-to-br from-bg-base to-bg-surface flex items-center justify-center mb-1.5">
            <span className="text-[length:var(--text-2xs)] text-text-muted font-mono">Aa</span>
          </div>
          <p className="text-[length:var(--text-xs)] font-medium text-text-primary truncate">
            {t("settings.terminal.theme.system")}
          </p>
        </button>

        {allThemes.map((theme) => {
          const selected = terminalThemeId === theme.id;
          return (
            <div
              key={theme.id}
              data-testid={`theme-card-${theme.id}`}
              className={[
                "relative rounded-xl p-2.5 group border transition-all duration-[var(--duration-fast)]",
                selected
                  ? "border-border-focus ring-2 ring-ring bg-bg-overlay"
                  : "border-border hover:border-border-focus bg-bg-surface",
              ].join(" ")}
            >
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => setTerminalThemeId(theme.id)}
                className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
              >
                <ThemePreview colors={theme.colors} />
                <p className="mt-1.5 text-[length:var(--text-xs)] font-medium text-text-primary truncate">
                  {theme.name}
                </p>
              </button>
              {!theme.builtin && (
                <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-[var(--duration-fast)]">
                  <button
                    type="button"
                    aria-label={t("common.edit")}
                    title={t("common.edit")}
                    onClick={() => setEditorState(theme)}
                    className="p-1 rounded-md bg-bg-overlay/90 border border-border text-text-muted hover:text-text-primary transition-colors duration-[var(--duration-fast)]"
                  >
                    <Pencil size={11} strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    aria-label={t("common.delete")}
                    title={t("common.delete")}
                    onClick={() => setDeleting(theme)}
                    className="p-1 rounded-md bg-bg-overlay/90 border border-border text-text-muted hover:text-status-error transition-colors duration-[var(--duration-fast)]"
                  >
                    <Trash2 size={11} strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-[length:var(--text-xs)] text-text-muted">
        {t("settings.terminal.theme.liveHint")}
      </p>

      <ThemeEditorModal editing={editorState} onClose={() => setEditorState(null)} />

      <ConfirmDangerDialog
        open={deleting !== null}
        title={t("settings.terminal.theme.delete.title")}
        message={t("settings.terminal.theme.delete.message", { name: deleting?.name ?? "" })}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) removeTheme(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
