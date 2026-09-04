/**
 * Terminal colour themes.
 *
 * A theme is a flat palette covering everything xterm.js can colour:
 * background / foreground / cursor / selection plus the 16 ANSI slots.
 * Built-in themes ship with the app; user themes are created in Settings or
 * imported from iTerm2 `.itermcolors` files, and persisted as JSON blobs in
 * the settings store (see settings-store.ts).
 */

export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  /** Text colour drawn on top of a filled (block) cursor. */
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  // ANSI 16 — normal (0-7) then bright (8-15).
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface TerminalTheme {
  id: string;
  name: string;
  builtin: boolean;
  colors: TerminalThemeColors;
}

/** The sentinel theme: follow the app's dark/light interface theme using the
 *  legacy CSS-variable-derived palette (previous behaviour). */
export const SYSTEM_THEME_ID = "system";

/** Accepted hex colour syntax: `#RGB` or `#RRGGBB`, case-insensitive. */
export const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise a hex colour to lowercase 6-digit `#rrggbb`. Returns null when
 *  the input is not a valid hex colour. */
export function normalizeHex(input: string): string | null {
  const v = input.trim();
  if (!HEX_COLOR_RE.test(v)) return null;
  if (v.length === 4) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
  }
  return v.toLowerCase();
}

// ─── Built-in themes ─────────────────────────────────────────────────────────

function theme(
  id: string,
  name: string,
  colors: TerminalThemeColors,
): TerminalTheme {
  return { id, name, builtin: true, colors };
}

export const BUILTIN_THEMES: TerminalTheme[] = [
  theme("homebrew", "Homebrew", {
    background: "#000000",
    foreground: "#00ff00",
    cursor: "#00ff00",
    cursorAccent: "#000000",
    selectionBackground: "#4d4d4d",
    selectionForeground: "#ffffff",
    black: "#000000",
    red: "#990000",
    green: "#00a800",
    yellow: "#999900",
    blue: "#0000b2",
    magenta: "#b200b2",
    cyan: "#00a8b2",
    white: "#bfbfbf",
    brightBlack: "#666666",
    brightRed: "#ff3333",
    brightGreen: "#00cc00",
    brightYellow: "#ffff33",
    brightBlue: "#4a80ff",
    brightMagenta: "#ff33ff",
    brightCyan: "#00ccff",
    brightWhite: "#ffffff",
  }),
  theme("one-dark-pro", "One Dark Pro", {
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#61afef",
    cursorAccent: "#282c34",
    selectionBackground: "#3e4451",
    selectionForeground: "#d7dae0",
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#dcdfe4",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  }),
  theme("dracula", "Dracula", {
    background: "#282a36",
    foreground: "#f8f8f2",
    cursor: "#f8f8f2",
    cursorAccent: "#282a36",
    selectionBackground: "#44475a",
    selectionForeground: "#f8f8f2",
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  }),
  theme("solarized-dark", "Solarized Dark", {
    background: "#002b36",
    foreground: "#839496",
    cursor: "#93a1a1",
    cursorAccent: "#002b36",
    selectionBackground: "#073642",
    selectionForeground: "#eee8d5",
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#002b36",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  }),
  theme("tomorrow-night", "Tomorrow Night", {
    background: "#1d1f21",
    foreground: "#c5c8c6",
    cursor: "#c5c8c6",
    cursorAccent: "#1d1f21",
    selectionBackground: "#373b41",
    selectionForeground: "#c5c8c6",
    black: "#1d1f21",
    red: "#cc6666",
    green: "#b5bd68",
    yellow: "#f0c674",
    blue: "#81a2be",
    magenta: "#b294bb",
    cyan: "#8abeb7",
    white: "#c5c8c6",
    brightBlack: "#969896",
    brightRed: "#cc6666",
    brightGreen: "#b5bd68",
    brightYellow: "#f0c674",
    brightBlue: "#81a2be",
    brightMagenta: "#b294bb",
    brightCyan: "#8abeb7",
    brightWhite: "#ffffff",
  }),
  theme("nord", "Nord", {
    background: "#2e3440",
    foreground: "#d8dee9",
    cursor: "#d8dee9",
    cursorAccent: "#2e3440",
    selectionBackground: "#434c5e",
    selectionForeground: "#d8dee9",
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4",
  }),
];

/** Resolve a theme id to a TerminalTheme, falling back to the built-in set
 *  (and ultimately to One Dark Pro) when the id is unknown — e.g. a saved
 *  host references a custom theme the user later deleted. */
export function resolveTerminalTheme(
  id: string | null | undefined,
  customThemes: TerminalTheme[],
): TerminalTheme | null {
  if (!id || id === SYSTEM_THEME_ID) return null;
  return (
    customThemes.find((t) => t.id === id) ??
    BUILTIN_THEMES.find((t) => t.id === id) ??
    // Named fallback (NOT a positional index — reordering BUILTIN_THEMES
    // must not silently change the default for dangling references).
    BUILTIN_THEMES.find((t) => t.id === "one-dark-pro") ??
    BUILTIN_THEMES[0] ??
    null
  );
}

// ─── iTerm2 .itermcolors import ──────────────────────────────────────────────

/** plist dict keys → palette slot. `Ansi N Color` is handled separately. */
const NAMED_SLOT_MAP: Record<string, keyof TerminalThemeColors> = {
  "background color": "background",
  "foreground color": "foreground",
  "cursor color": "cursor",
  "cursor text color": "cursorAccent",
  "selection color": "selectionBackground",
  "selected text color": "selectionForeground",
};

/** iTerm2 colour components are floats in [0,1]; 8-bit hex needs rounding. */
function componentToHex(v: number): string {
  const n = Math.max(0, Math.min(255, Math.round(v * 255)));
  return n.toString(16).padStart(2, "0");
}

/**
 * Parse the contents of an iTerm2 `.itermcolors` file (an XML property list)
 * into a TerminalTheme. Components may be given as "Red/Green/Blue Component"
 * floats — or, in newer exports, "Red/Green/Blue" 8-bit ints — both supported.
 * Returns null when the file has no recognizable colour dictionaries.
 */
export function parseItermColors(xml: string, name: string): TerminalTheme | null {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
  } catch {
    return null;
  }
  if (doc.getElementsByTagName("parsererror").length > 0) return null;

  // Collect every <dict> that has a "key"-style name: iTerm2 wraps each colour
  // in a top-level <dict> with a <key>Name</key> or the enclosing <key> is the
  // colour name (classic format). We handle both by reading either the dict's
  // own <key>Name</key> entry or nothing and matching on sibling structure.
  const partial: Partial<Record<keyof TerminalThemeColors, string>> = {};

  // Classic .itermcolors shape: <dict> containing one <key>Colour Name</key>
  // followed by the colour's <dict>. Walk top-level dict children pairwise.
  const top = doc.getElementsByTagName("dict")[0];
  if (!top) return null;
  const children = Array.from(top.children);
  for (let i = 0; i < children.length - 1; i++) {
    const keyEl = children[i]!;
    const valueEl = children[i + 1]!;
    if (keyEl.tagName !== "key" || valueEl.tagName !== "dict") continue;
    const key = (keyEl.textContent ?? "").trim().toLowerCase();
    if (!key) continue;

    let r: number | null = null;
    let g: number | null = null;
    let b: number | null = null;
    let scale = 1; // floats in [0,1] by spec
    for (let j = 0; j < valueEl.children.length - 1; j += 2) {
      const ck = (valueEl.children[j]!.textContent ?? "").trim().toLowerCase();
      // Skip empty values — Number("") is 0, which would silently turn a
      // malformed/empty component into pure black instead of ignoring it.
      const raw = (valueEl.children[j + 1]?.textContent ?? "").trim();
      if (!raw) continue;
      const cv = Number(raw);
      if (Number.isNaN(cv)) continue;
      if (ck === "red component") r = cv;
      else if (ck === "green component") g = cv;
      else if (ck === "blue component") b = cv;
      // Newer iTerm2 exports 8-bit ints without the "Component" suffix.
      else if (ck === "red") { r = cv; scale = 255; }
      else if (ck === "green") { g = cv; scale = 255; }
      else if (ck === "blue") { b = cv; scale = 255; }
    }
    if (r === null || g === null || b === null) continue;

    const hex = `#${componentToHex(r / scale)}${componentToHex(g / scale)}${componentToHex(b / scale)}`;

    const slot = NAMED_SLOT_MAP[key];
    if (slot) {
      partial[slot] = hex;
      continue;
    }
    const ansiMatch = /^ansi (\d+) color$/.exec(key);
    if (ansiMatch) {
      const idx = Number(ansiMatch[1]);
      if (idx >= 0 && idx <= 15) {
        const order: (keyof TerminalThemeColors)[] = [
          "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
          "brightBlack", "brightRed", "brightGreen", "brightYellow",
          "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
        ];
        partial[order[idx]!] = hex;
      }
    }
  }

  if (!partial.background && !partial.foreground && !partial.black) return null;

  // Sensible fallbacks for files that omit cursor/selection entries.
  const colors: TerminalThemeColors = {
    background: partial.background ?? "#000000",
    foreground: partial.foreground ?? "#ffffff",
    cursor: partial.cursor ?? partial.foreground ?? "#ffffff",
    cursorAccent: partial.cursorAccent ?? partial.background ?? "#000000",
    selectionBackground: partial.selectionBackground ?? partial.cursor ?? "#4d4d4d",
    selectionForeground: partial.selectionForeground ?? partial.foreground ?? "#ffffff",
    black: partial.black ?? "#000000",
    red: partial.red ?? "#cd3131",
    green: partial.green ?? "#0dbc79",
    yellow: partial.yellow ?? "#e5e510",
    blue: partial.blue ?? "#2472c8",
    magenta: partial.magenta ?? "#bc3fbc",
    cyan: partial.cyan ?? "#11a8cd",
    white: partial.white ?? "#e5e5e5",
    brightBlack: partial.brightBlack ?? "#666666",
    brightRed: partial.brightRed ?? partial.red ?? "#f14c4c",
    brightGreen: partial.brightGreen ?? partial.green ?? "#23d18b",
    brightYellow: partial.brightYellow ?? partial.yellow ?? "#f5f543",
    brightBlue: partial.brightBlue ?? partial.blue ?? "#3b8eea",
    brightMagenta: partial.brightMagenta ?? partial.magenta ?? "#d670d6",
    brightCyan: partial.brightCyan ?? partial.cyan ?? "#29b8db",
    brightWhite: partial.brightWhite ?? "#ffffff",
  };

  return {
    id: crypto.randomUUID(),
    name: name.replace(/\.itermcolors$/i, "") || "Imported",
    builtin: false,
    colors,
  };
}

/** Validate a theme object coming from persistence / the editor. Returns a
 *  fully-populated theme (invalid slots fall back to defaults) or null when
 *  the shape is fundamentally wrong. */
export function sanitizeTheme(raw: unknown): TerminalTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<TerminalTheme>;
  if (typeof t.id !== "string" || typeof t.name !== "string") return null;
  const c = t.colors as Partial<TerminalThemeColors> | undefined;
  if (!c || typeof c !== "object") return null;
  const pick = (v: unknown, fallback: string): string =>
    typeof v === "string" && HEX_COLOR_RE.test(v.trim())
      ? normalizeHex(v) ?? fallback
      : fallback;
  return {
    id: t.id,
    name: t.name,
    builtin: false,
    colors: {
      background: pick(c.background, "#282c34"),
      foreground: pick(c.foreground, "#abb2bf"),
      cursor: pick(c.cursor, "#61afef"),
      cursorAccent: pick(c.cursorAccent, "#282c34"),
      selectionBackground: pick(c.selectionBackground, "#3e4451"),
      selectionForeground: pick(c.selectionForeground, "#d7dae0"),
      black: pick(c.black, "#282c34"),
      red: pick(c.red, "#e06c75"),
      green: pick(c.green, "#98c379"),
      yellow: pick(c.yellow, "#e5c07b"),
      blue: pick(c.blue, "#61afef"),
      magenta: pick(c.magenta, "#c678dd"),
      cyan: pick(c.cyan, "#56b6c2"),
      white: pick(c.white, "#dcdfe4"),
      brightBlack: pick(c.brightBlack, "#5c6370"),
      brightRed: pick(c.brightRed, "#e06c75"),
      brightGreen: pick(c.brightGreen, "#98c379"),
      brightYellow: pick(c.brightYellow, "#e5c07b"),
      brightBlue: pick(c.brightBlue, "#61afef"),
      brightMagenta: pick(c.brightMagenta, "#c678dd"),
      brightCyan: pick(c.brightCyan, "#56b6c2"),
      brightWhite: pick(c.brightWhite, "#ffffff"),
    },
  };
}
