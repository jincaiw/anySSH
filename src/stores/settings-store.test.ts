import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore } from "./settings-store";
import { BUILTIN_THEMES } from "../lib/terminal-themes";

// The store reaches the backend via a dynamic `import("@tauri-apps/api/core")`,
// so we mock that module's `invoke` (persist is fire-and-forget, hence waitFor).
const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

describe("settings-store — terminal clipboard settings (#71)", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    // Reset just the keys under test to their defaults.
    useSettingsStore.setState({ terminalCopyOnSelect: false, terminalPasteButton: "none" });
  });

  it("defaults to copy-on-select off and paste disabled", () => {
    const s = useSettingsStore.getState();
    expect(s.terminalCopyOnSelect).toBe(false);
    expect(s.terminalPasteButton).toBe("none");
  });

  it("toggles copy-on-select and persists it as a string", async () => {
    useSettingsStore.getState().setTerminalCopyOnSelect(true);
    expect(useSettingsStore.getState().terminalCopyOnSelect).toBe(true);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_setting", {
        key: "terminal_copy_on_select",
        value: "true",
      }),
    );
  });

  it("sets the paste button and persists the raw choice", async () => {
    useSettingsStore.getState().setTerminalPasteButton("middle");
    expect(useSettingsStore.getState().terminalPasteButton).toBe("middle");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_setting", {
        key: "terminal_paste_button",
        value: "middle",
      }),
    );
  });

  it("loads both settings from persisted key/value pairs", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["terminal_copy_on_select", "true"],
          ["terminal_paste_button", "right"],
          // editors already seeded — skips the detect_editors first-run path.
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    const s = useSettingsStore.getState();
    expect(s.terminalCopyOnSelect).toBe(true);
    expect(s.terminalPasteButton).toBe("right");
  });

  it("falls back to the default for an unrecognized paste-button value", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["terminal_paste_button", "bogus"],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().terminalPasteButton).toBe("none");
  });
});

describe("settings-store — legacy bastion Backspace behaviour", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    useSettingsStore.setState({ terminalBackspaceCtrlH: false });
  });

  it("defaults to DEL (off)", () => {
    expect(useSettingsStore.getState().terminalBackspaceCtrlH).toBe(false);
  });

  it("toggles ^H mode and persists it as a string", async () => {
    useSettingsStore.getState().setTerminalBackspaceCtrlH(true);
    expect(useSettingsStore.getState().terminalBackspaceCtrlH).toBe(true);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_setting", {
        key: "terminal_backspace_ctrl_h",
        value: "true",
      }),
    );
  });

  it("loads the persisted choice on startup", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["terminal_backspace_ctrl_h", "true"],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().terminalBackspaceCtrlH).toBe(true);
  });
});

describe("settings-store — dual-factor bastion memory", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    useSettingsStore.setState({ dualFactorHostIds: [] });
  });

  it("starts with no remembered bastions", () => {
    expect(useSettingsStore.getState().dualFactorHostIds).toEqual([]);
  });

  it("marks a host and persists the id list", async () => {
    useSettingsStore.getState().markHostDualFactor("host-1");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_setting", {
        key: "dual_factor_hosts",
        value: '["host-1"]',
      }),
    );

    useSettingsStore.getState().markHostDualFactor("host-2");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("save_setting", {
        key: "dual_factor_hosts",
        value: '["host-1","host-2"]',
      }),
    );

    // Marking twice is a no-op — no third persist, list unchanged.
    invoke.mockClear();
    useSettingsStore.getState().markHostDualFactor("host-1");
    expect(useSettingsStore.getState().dualFactorHostIds).toEqual(["host-1", "host-2"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("loads the remembered list on startup and ignores malformed data", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["dual_factor_hosts", JSON.stringify(["a", 3, "b"])],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().dualFactorHostIds).toEqual(["a", "b"]);
  });
});

describe("settings-store — explorer double-click action", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    useSettingsStore.setState({ explorerDoubleClickAction: "download" });
  });

  it("defaults to download", () => {
    expect(useSettingsStore.getState().explorerDoubleClickAction).toBe("download");
  });

  it("sets and persists the double-click action", async () => {
    useSettingsStore.getState().setExplorerDoubleClickAction("open");
    expect(useSettingsStore.getState().explorerDoubleClickAction).toBe("open");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_setting", {
        key: "explorer_double_click_action",
        value: "open",
      }),
    );
  });

  it("loads the action, falling back to download for an unknown value", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["explorer_double_click_action", "nonsense"],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().explorerDoubleClickAction).toBe("download");
  });
});

describe("settings-store — interface monospace font", () => {
  const DEFAULT_MONO = "'JetBrains Mono', 'Fira Code', ui-monospace, monospace";

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    useSettingsStore.setState({ interfaceMonoFont: DEFAULT_MONO });
  });

  it("persists a chosen mono font under its settings key", async () => {
    useSettingsStore.getState().setInterfaceMonoFont("'Fira Code', monospace");
    expect(useSettingsStore.getState().interfaceMonoFont).toBe("'Fira Code', monospace");
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("save_setting", {
        key: "app_interface_mono_font",
        value: "'Fira Code', monospace",
      }),
    );
  });

  it("loads a persisted mono font and defaults when the value is empty", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["app_interface_mono_font", "'Hack', monospace"],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().interfaceMonoFont).toBe("'Hack', monospace");

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["app_interface_mono_font", ""],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });
    await useSettingsStore.getState().loadSettings();
    expect(useSettingsStore.getState().interfaceMonoFont).toBe(DEFAULT_MONO);
  });
});

describe("settings-store — dual-factor memory cleanup", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    useSettingsStore.setState({ dualFactorHostIds: [] });
  });

  it("unmarks a host and persists the shorter list", async () => {
    useSettingsStore.setState({ dualFactorHostIds: ["host-1", "host-2"] });
    useSettingsStore.getState().unmarkHostDualFactor("host-1");
    expect(useSettingsStore.getState().dualFactorHostIds).toEqual(["host-2"]);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("save_setting", {
        key: "dual_factor_hosts",
        value: JSON.stringify(["host-2"]),
      }),
    );
  });

  it("unmarking an unknown host is a no-op", async () => {
    useSettingsStore.setState({ dualFactorHostIds: ["host-1"] });
    invoke.mockClear();
    useSettingsStore.getState().unmarkHostDualFactor("nope");
    expect(useSettingsStore.getState().dualFactorHostIds).toEqual(["host-1"]);
    await new Promise((r) => setTimeout(r, 20));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("trims and de-duplicates a corrupted remembered list", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["dual_factor_hosts", JSON.stringify([" a ", "a", "", 7, "b"])],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().dualFactorHostIds).toEqual(["a", "b"]);
  });
});

describe("settings-store — terminal theme load validation", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    useSettingsStore.setState({
      terminalThemeId: "system",
      terminalCustomThemes: [],
    });
  });

  it("resets a selection that no longer exists so the UI and terminal agree", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["terminal_theme_id", "theme-deleted-elsewhere"],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().terminalThemeId).toBe("system");
  });

  it("keeps a selection that resolves to a builtin or custom theme", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          ["terminal_theme_id", "custom-1"],
          [
            "terminal_custom_themes",
            JSON.stringify([
              { id: "custom-1", name: "Mine", colors: BUILTIN_THEMES[0]!.colors },
            ]),
          ],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    expect(useSettingsStore.getState().terminalThemeId).toBe("custom-1");
  });

  it("drops custom themes whose id collides with a builtin or the system sentinel", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "load_all_settings") {
        return [
          [
            "terminal_custom_themes",
            JSON.stringify([
              { id: "system", name: "Bad sentinel", colors: BUILTIN_THEMES[0]!.colors },
              { id: "dracula", name: "Bad builtin", colors: BUILTIN_THEMES[0]!.colors },
              { id: "mine", name: "Good", colors: BUILTIN_THEMES[0]!.colors },
            ]),
          ],
          ["editors_seeded", "true"],
        ];
      }
      return undefined;
    });

    await useSettingsStore.getState().loadSettings();

    const ids = useSettingsStore.getState().terminalCustomThemes.map((t) => t.id);
    expect(ids).toEqual(["mine"]);
  });
});
