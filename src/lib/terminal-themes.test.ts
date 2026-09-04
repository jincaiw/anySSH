import { describe, it, expect } from "vitest";
import {
  normalizeHex,
  HEX_COLOR_RE,
  parseItermColors,
  sanitizeTheme,
  resolveTerminalTheme,
  BUILTIN_THEMES,
  SYSTEM_THEME_ID,
} from "./terminal-themes";

// ─── normalizeHex / HEX_COLOR_RE ─────────────────────────────────────────────

describe("normalizeHex", () => {
  it("passes through 6-digit hex lowercased", () => {
    expect(normalizeHex("#282C34")).toBe("#282c34");
  });

  it("expands 3-digit hex", () => {
    expect(normalizeHex("#F0A")).toBe("#ff00aa");
  });

  it("rejects non-hex input", () => {
    expect(normalizeHex("282c34")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("#gggggg")).toBeNull();
    expect(normalizeHex("")).toBeNull();
  });

  it("HEX_COLOR_RE accepts both shorthand forms", () => {
    expect(HEX_COLOR_RE.test("#abc")).toBe(true);
    expect(HEX_COLOR_RE.test("#AABBCC")).toBe(true);
    expect(HEX_COLOR_RE.test("aabbcc")).toBe(false);
  });
});

// ─── parseItermColors ────────────────────────────────────────────────────────

function itermXml(colors: Record<string, [number, number, number]>): string {
  const entries = Object.entries(colors)
    .map(([name, [r, g, b]]) => `
      <key>${name}</key>
      <dict>
        <key>Red Component</key><real>${r}</real>
        <key>Green Component</key><real>${g}</real>
        <key>Blue Component</key><real>${b}</real>
      </dict>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>${entries}</dict></plist>`;
}

describe("parseItermColors", () => {
  it("parses background/foreground/ANSI slots from float components", () => {
    const xml = itermXml({
      "Background Color": [0.157, 0.173, 0.204], // 282c34
      "Foreground Color": [0.671, 0.698, 0.749], // abb2bf
      "Cursor Color": [0.38, 0.686, 0.937],
      "Ansi 0 Color": [0, 0, 0],
      "Ansi 1 Color": [0.878, 0.424, 0.459], // e06c75
      "Ansi 15 Color": [1, 1, 1],
    });
    const theme = parseItermColors(xml, "One Dark.itermcolors");
    expect(theme).not.toBeNull();
    expect(theme!.name).toBe("One Dark");
    expect(theme!.builtin).toBe(false);
    expect(theme!.colors.background).toBe("#282c34");
    expect(theme!.colors.foreground).toBe("#abb2bf");
    expect(theme!.colors.red).toBe("#e06c75");
    expect(theme!.colors.brightWhite).toBe("#ffffff");
    // Fallbacks for entries the file omitted.
    expect(theme!.colors.selectionBackground).toBeTruthy();
  });

  it("maps cursor/selection slots when present", () => {
    const xml = itermXml({
      "Background Color": [0, 0, 0],
      "Foreground Color": [1, 1, 1],
      "Cursor Text Color": [0, 0, 0],
      "Selection Color": [0.2, 0.2, 0.2],
      "Selected Text Color": [1, 1, 1],
    });
    const theme = parseItermColors(xml, "x");
    expect(theme!.colors.cursorAccent).toBe("#000000");
    expect(theme!.colors.selectionBackground).toBe("#333333");
    expect(theme!.colors.selectionForeground).toBe("#ffffff");
  });

  it("accepts 8-bit integer components (newer exports)", () => {
    const xml = `<?xml version="1.0"?><plist version="1.0"><dict>
      <key>Background Color</key><dict>
        <key>Red</key><integer>40</integer>
        <key>Green</key><integer>44</integer>
        <key>Blue</key><integer>52</integer>
      </dict>
      <key>Foreground Color</key><dict>
        <key>Red</key><integer>171</integer>
        <key>Green</key><integer>178</integer>
        <key>Blue</key><integer>191</integer>
      </dict>
    </dict></plist>`;
    const theme = parseItermColors(xml, "ints");
    expect(theme!.colors.background).toBe("#282c34");
    expect(theme!.colors.foreground).toBe("#abb2bf");
  });

  it("skips empty component values instead of reading them as 0", () => {
    // Number("") === 0 — a malformed empty <string/> must be ignored, not
    // silently turned into a pure-black component.
    const xml = `<?xml version="1.0"?><plist version="1.0"><dict>
      <key>Background Color</key><dict>
        <key>Red Component</key><string></string>
        <key>Green Component</key><real>0.5</real>
        <key>Blue Component</key><real>1</real>
      </dict>
      <key>Foreground Color</key><dict>
        <key>Red Component</key><real>1</real>
        <key>Green Component</key><real>1</real>
        <key>Blue Component</key><real>1</real>
      </dict>
    </dict></plist>`;
    const theme = parseItermColors(xml, "empty-comp");
    expect(theme).not.toBeNull();
    // Red was skipped → fallback default (not "#0080ff", which a 0 red would
    // have produced from the green/blue that were present).
    expect(theme!.colors.background).toBe("#000000");
  });

  it("returns null for garbage input", () => {
    expect(parseItermColors("not xml at all", "x")).toBeNull();
    expect(parseItermColors("<plist><dict></dict></plist>", "x")).toBeNull();
    // XML parser error node
    expect(parseItermColors("<dict><key>Background", "x")).toBeNull();
  });
});

// ─── sanitizeTheme ───────────────────────────────────────────────────────────

describe("sanitizeTheme", () => {
  it("keeps valid themes intact and forces non-builtin", () => {
    const src = BUILTIN_THEMES[0]!;
    const out = sanitizeTheme({ id: "custom-1", name: "Mine", colors: src.colors });
    expect(out!.id).toBe("custom-1");
    expect(out!.name).toBe("Mine");
    expect(out!.builtin).toBe(false);
    expect(out!.colors).toEqual(src.colors);
  });

  it("replaces invalid colour slots with defaults instead of dropping them", () => {
    const out = sanitizeTheme({
      id: "custom-2",
      name: "Broken",
      colors: { ...BUILTIN_THEMES[0]!.colors, background: "not-a-color", red: "#00ff00" },
    });
    expect(out!.colors.background).toBe("#282c34"); // default fallback
    expect(out!.colors.red).toBe("#00ff00");
  });

  it("returns null for malformed shapes", () => {
    expect(sanitizeTheme(null)).toBeNull();
    expect(sanitizeTheme("nope")).toBeNull();
    expect(sanitizeTheme({ id: "x" })).toBeNull();
    expect(sanitizeTheme({ id: "x", name: "y" })).toBeNull();
  });
});

// ─── resolveTerminalTheme ────────────────────────────────────────────────────

describe("resolveTerminalTheme", () => {
  it("returns null for the system sentinel", () => {
    expect(resolveTerminalTheme(SYSTEM_THEME_ID, [])).toBeNull();
    expect(resolveTerminalTheme(null, [])).toBeNull();
    expect(resolveTerminalTheme(undefined, [])).toBeNull();
  });

  it("prefers custom themes over builtins with the same id", () => {
    const custom = { ...BUILTIN_THEMES[0]!, builtin: false, name: "Custom" };
    expect(resolveTerminalTheme("homebrew", [custom])?.name).toBe("Custom");
  });

  it("resolves builtin ids and falls back for unknown ones", () => {
    expect(resolveTerminalTheme("dracula", [])?.id).toBe("dracula");
    // The dangling-reference fallback must be one-dark-pro by ID, not by
    // position in BUILTIN_THEMES.
    expect(resolveTerminalTheme("deleted-custom-id", [])?.id).toBe("one-dark-pro");
  });
});
