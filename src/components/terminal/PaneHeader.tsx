import { duplicateTerminal } from "../../lib/terminal-transport";
import { Columns2, Rows2, Maximize2, Minimize2, X } from "lucide-react";
import { useSessionStore } from "../../stores/session-store";
import { useTabStore } from "../../stores/tab-store";
import { useTranslation } from "../../i18n";
import { disconnectSession } from "../../lib/disconnect-session";

interface PaneHeaderProps {
  sessionId: string;
  /** The unified tab that owns this pane — needed to clean up the tab bar. */
  tabId: string;
}

export function PaneHeader({ sessionId, tabId }: PaneHeaderProps) {
  const { t } = useTranslation();
  const session = useSessionStore((s) => s.sessions.get(sessionId));
  const isActive = useSessionStore((s) => s.activeSessionId === sessionId);
  const isZoomed = useSessionStore((s) => s.zoomedPaneId === sessionId);
  const hasSplits = useSessionStore((s) => {
    const tabId = s.activeTerminalTabId;
    if (!tabId) return false;
    const tab = s.tabs.get(tabId);
    return tab ? tab.layout.type === "split" : false;
  });

  if (!session) return null;

  const status = session.status;
  const dotColor =
    status === "Connected"    ? "bg-status-connected" :
    status === "Connecting"   ? "bg-status-connecting motion-safe:animate-pulse" :
    status === "Error"        ? "bg-status-error" :
                                "bg-status-disconnected";

  const handleSplit = (direction: "horizontal" | "vertical") => {
    void (async () => {
      try {
        const newId = await duplicateTerminal(sessionId);
        useSessionStore.getState().splitPane(direction, sessionId, newId);
      } catch (err) {
        console.error("Split failed:", err);
      }
    })();
  };

  const handleClose = () => {
    void (async () => {
      // Kind-aware: term sessions (telnet/serial/local) go through term_close.
      await disconnectSession(sessionId);

      const store = useSessionStore.getState();
      if (hasSplits) {
        store.unsplitPane(sessionId);
      }
      store.removeSession(sessionId);

      // Defensive: if that emptied the owning tab's layout, drop the GUI tab
      // too so it can't be orphaned in the tab bar (issue #42). In the normal
      // split flow the close button is hidden once a single pane remains, so
      // the tab survives here — this only fires if the tab truly has no panes.
      if (!useSessionStore.getState().tabs.get(tabId)) {
        useTabStore.getState().removeTab(tabId);
      }
    })();
  };

  const handleZoom = () => {
    useSessionStore.getState().toggleZoom(sessionId);
  };

  const btnClass =
    "inline-flex items-center justify-center w-5 h-5 rounded disabled:opacity-30 disabled:pointer-events-none text-text-muted hover:text-text-primary hover:bg-bg-muted transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  return (
    <div
      className={[
        "flex items-center h-8 px-2.5 gap-2.5 shrink-0 no-select",
        "border-b transition-colors duration-[var(--duration-fast)]",
        isActive
          ? "bg-bg-surface/80 border-border/60"
          : "bg-bg-surface/40 border-border/30",
      ].join(" ")}
    >
      {/* Status dot */}
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />

      {/* Host label */}
      <span
        className={[
          "text-[11px] font-mono truncate flex-1 min-w-0 leading-none",
          isActive ? "text-text-primary" : "text-text-muted",
        ].join(" ")}
        title={session.label}
      >
        {session.hostConfig.host}
      </span>

      {/* Action buttons — visible on hover or when active */}
      <div
        className={[
          "flex items-center gap-0.5 transition-opacity duration-[var(--duration-fast)]",
          isActive ? "opacity-60 group-hover/pane:opacity-100" : "opacity-0 group-hover/pane:opacity-100",
        ].join(" ")}
      >
        {/* Split horizontal */}
        <button type="button" disabled={session.kind === "serial"} onClick={() => handleSplit("horizontal")} className={btnClass}
          aria-label={t("terminal.pane.splitRight")} title={t("terminal.pane.splitRightHint")}>
          <Columns2 size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>

        {/* Split vertical */}
        <button type="button" disabled={session.kind === "serial"} onClick={() => handleSplit("vertical")} className={btnClass}
          aria-label={t("terminal.pane.splitDown")} title={t("terminal.pane.splitDownHint")}>
          <Rows2 size={13} strokeWidth={1.8} aria-hidden="true" />
        </button>

        {/* Zoom toggle — only show when in a split */}
        {hasSplits && (
          <button
            type="button"
            onClick={handleZoom}
            className={[
              "inline-flex items-center justify-center w-5 h-5 rounded transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              isZoomed
                ? "text-accent hover:text-accent-hover hover:bg-accent/10"
                : "text-text-muted hover:text-text-primary hover:bg-bg-muted",
            ].join(" ")}
            aria-label={isZoomed ? t("terminal.pane.unzoom") : t("terminal.pane.zoom")}
            title={isZoomed ? t("terminal.pane.unzoomHint") : t("terminal.pane.zoomHint")}
          >
            {isZoomed ? (
              <Minimize2 size={12} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Maximize2 size={12} strokeWidth={2} aria-hidden="true" />
            )}
          </button>
        )}

        {/* Close pane */}
        {hasSplits && (
          <button type="button" onClick={handleClose}
            className="inline-flex items-center justify-center w-5 h-5 rounded disabled:opacity-30 disabled:pointer-events-none text-text-muted hover:text-status-error hover:bg-status-error/10 transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label={t("terminal.pane.close")} title={t("terminal.pane.closeHint")}>
            <X size={12} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
