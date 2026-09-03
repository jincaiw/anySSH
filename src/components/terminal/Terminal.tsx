import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { useSshOutput } from "../../hooks/use-ssh-events";
import {
  ensureTerminal,
  getTerminal,
  getTerminalTheme,
} from "../../stores/terminal-instances";
import { useSettingsStore } from "../../stores/settings-store";
import { useSessionStore } from "../../stores/session-store";
import { resolveTerminalTheme } from "../../lib/terminal-themes";
import type { SessionId } from "../../types";

interface TerminalProps {
  sessionId: SessionId;
}

/**
 * Renders a session's terminal. The xterm.js instance itself is owned by the
 * terminal-instances registry, not this component — see that module for why.
 * This component only mounts the cached host element into the DOM and forwards
 * resize/appearance changes, so the scrollback buffer survives the remounts
 * that happen whenever the surrounding layout changes shape (e.g. on split).
 */
export function Terminal({ sessionId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const fontSize = useSettingsStore((s) => s.terminalFontSize);
  const lineHeight = useSettingsStore((s) => s.terminalLineHeight);
  const cursorStyle = useSettingsStore((s) => s.terminalCursorStyle);
  const cursorBlink = useSettingsStore((s) => s.terminalCursorBlink);
  const scrollback = useSettingsStore((s) => s.terminalScrollback);
  const copyOnSelect = useSettingsStore((s) => s.terminalCopyOnSelect);
  const pasteButton = useSettingsStore((s) => s.terminalPasteButton);
  // Colour theme: the per-host override (from the session's HostConfig) wins
  // over the global setting. Subscribing to all three keeps theme switches
  // live — the effect below repaints the open xterm without recreating it.
  // themeMode is also tracked so the "system" sentinel (no explicit theme)
  // still repaints when the app switches between dark and light.
  const globalThemeId = useSettingsStore((s) => s.terminalThemeId);
  const customThemes = useSettingsStore((s) => s.terminalCustomThemes);
  const themeMode = useSettingsStore((s) => s.themeMode);
  const hostThemeId = useSessionStore(
    (s) => s.sessions.get(sessionId)?.hostConfig.terminal_theme,
  );
  const effectiveTheme = resolveTerminalTheme(
    hostThemeId ?? globalThemeId,
    customThemes,
  );
  const themeBackground = effectiveTheme?.colors.background ?? null;

  // Read the live clipboard-behaviour settings through refs so the listeners
  // registered once below pick up toggles without being torn down and
  // re-attached (which would also re-create the xterm selection subscription).
  const copyOnSelectRef = useRef(copyOnSelect);
  copyOnSelectRef.current = copyOnSelect;
  const pasteButtonRef = useRef(pasteButton);
  pasteButtonRef.current = pasteButton;

  // Create the instance eagerly on the first byte so early output (banner /
  // MOTD / initial prompt) that lands before the mount effect runs is written
  // into the scrollback rather than dropped. createEntry opens into a detached
  // element; the mount effect later attaches that same cached element.
  useSshOutput(sessionId, (data) => {
    ensureTerminal(sessionId).term.write(data);
  });

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let observer: ResizeObserver | null = null;

    // Wait for fonts to load so xterm measures glyphs correctly.
    document.fonts.ready.then(() => {
      const container = containerRef.current;
      if (disposed || !container) return;

      const { element, fitAddon } = ensureTerminal(sessionId);
      container.appendChild(element);

      // Fit after layout settles, then again whenever the container resizes.
      requestAnimationFrame(() => {
        if (!disposed) fitAddon.fit();
      });

      observer = new ResizeObserver(() => {
        requestAnimationFrame(() => {
          if (
            !disposed &&
            container.clientWidth > 0 &&
            container.clientHeight > 0
          ) {
            fitAddon.fit();
          }
        });
      });
      observer.observe(container);
    });

    return () => {
      disposed = true;
      observer?.disconnect();
      // Detach the cached element but keep the xterm instance (and its
      // scrollback) alive — the registry disposes it when the session ends.
      const entry = getTerminal(sessionId);
      if (entry?.element.parentElement) {
        entry.element.parentElement.removeChild(entry.element);
      }
    };
  }, [sessionId]);

  // Live theme switching: repaint the already-open terminal when the global
  // theme, the custom theme list, or this host's override changes. The theme
  // object must be replaced (not mutated) for xterm to detect the change.
  useEffect(() => {
    const term = getTerminal(sessionId)?.term;
    if (term) term.options.theme = getTerminalTheme(effectiveTheme);
  }, [sessionId, effectiveTheme, themeMode]);

  // Clipboard behaviours (#71): copy-on-select and configurable paste button.
  // Registered once per session; the current setting values are read through
  // refs so changing them in Settings takes effect on the live terminal.
  //
  // Clipboard I/O goes through the Tauri clipboard plugin, not
  // navigator.clipboard: the macOS WKWebView blocks navigator.clipboard.readText(),
  // which would make paste silently no-op. The native plugin reads/writes
  // through Rust and works in every webview.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const { term } = ensureTerminal(sessionId);

    const selectionSub = term.onSelectionChange(() => {
      if (!copyOnSelectRef.current) return;
      const selection = term.getSelection();
      if (!selection) return;
      void (async () => {
        try {
          const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
          await writeText(selection);
        } catch { /* clipboard unavailable */ }
      })();
    });

    const paste = () => {
      void (async () => {
        try {
          const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
          const text = await readText();
          if (text) term.paste(text);
        } catch { /* clipboard read unavailable */ }
      })();
    };

    // Paste on mousedown for the middle button (pasting on auxclick is unreliable
    // in WebKit once mousedown's default is prevented), and on contextmenu for
    // the right button — replacing the native menu. Capture phase so xterm's own
    // mouse handling can't swallow the event first. Both gated on the setting.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1 && pasteButtonRef.current === "middle") {
        e.preventDefault();
        paste();
      }
    };
    const onContextMenu = (e: MouseEvent) => {
      if (pasteButtonRef.current === "right") {
        e.preventDefault();
        paste();
      }
    };

    container.addEventListener("mousedown", onMouseDown, true);
    container.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      selectionSub.dispose();
      container.removeEventListener("mousedown", onMouseDown, true);
      container.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [sessionId]);

  // Apply appearance changes to the already-open terminal (not just new ones).
  useEffect(() => {
    const entry = getTerminal(sessionId);
    if (!entry) return;
    const { term, fitAddon } = entry;
    term.options.fontFamily = fontFamily;
    term.options.fontSize = fontSize;
    term.options.lineHeight = lineHeight;
    term.options.cursorStyle = cursorStyle;
    term.options.cursorBlink = cursorBlink;
    term.options.scrollback = scrollback;
    // Re-fit so the new glyph metrics recompute rows/cols, then repaint.
    fitAddon.fit();
    term.refresh(0, term.rows - 1);
  }, [sessionId, fontFamily, fontSize, lineHeight, cursorStyle, cursorBlink, scrollback]);

  return (
    <div
      ref={containerRef}
      data-testid={`terminal-${sessionId}`}
      data-session-id={sessionId}
      className="h-full w-full bg-bg-base p-2"
      // Explicit themes own the pane background too — otherwise the padding
      // around the xterm surface would stay the app's base colour.
      style={themeBackground ? { backgroundColor: themeBackground } : undefined}
      onKeyDown={(e) => {
        if (e.metaKey && (e.key === "d" || e.key === "D")) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    />
  );
}
