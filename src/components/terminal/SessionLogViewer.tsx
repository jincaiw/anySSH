import { useCallback, useEffect, useMemo, useState } from "react";
import { FolderOpen, RefreshCw, Save, ScrollText, Search } from "lucide-react";
import { ModalBackdrop } from "../shared/ModalBackdrop";
import { BTN_GHOST, BTN_SECONDARY } from "../shared/ModalShell";
import { useUiStore } from "../../stores/ui-store";
import { useTranslation } from "../../i18n";
import {
  exportLog,
  getSessionLogStatus,
  listSessionLogs,
  readLog,
  revealLogsDirectory,
  type LogFileInfo,
} from "../../lib/session-log";

/**
 * Built-in session log viewer: a file list on the left, a (tail) preview of
 * the selected log with search highlighting on the right, plus export and
 * "reveal in Finder" actions. Reading is capped by the backend (512 KB tail,
 * 4 MB max) so even multi-megabyte logs open instantly.
 */
export function SessionLogViewer() {
  const { t } = useTranslation();
  const sessionId = useUiStore((s) => s.sessionLogViewerSessionId);
  const close = useUiStore((s) => s.closeSessionLogViewer);
  const open = sessionId !== null;

  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Path of the session's live log file (highlighted in the list). */
  const [liveRelative, setLiveRelative] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadingList(true);
    const list = await listSessionLogs();
    setFiles(list);
    setLoadingList(false);
    return list;
  }, []);

  // Load the list each time the dialog opens; preselect the session's live
  // log file when the viewer was opened from a terminal pane.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelected(null);
    setContent("");
    setQuery("");
    void (async () => {
      const [list, status] = await Promise.all([
        refresh(),
        sessionId ? getSessionLogStatus(sessionId) : Promise.resolve(null),
      ]);
      const live = status?.path
        ? (list.find((f) => status.path!.endsWith(f.relative.replace(/\//g, "/")))?.relative ??
           list.find((f) => status.path!.endsWith(f.fileName))?.relative ??
           null)
        : null;
      setLiveRelative(live);
      if (live) setSelected(live);
      else if (list.length > 0) setSelected(list[0].relative);
    })();
  }, [open, sessionId, refresh]);

  // Load the selected file's tail.
  useEffect(() => {
    if (!open || !selected) return;
    setLoadingContent(true);
    void readLog(selected)
      .then((r) => {
        setContent(r.content);
        setTruncated(r.truncated);
      })
      .catch(() => {
        setContent("");
        setTruncated(false);
        setError(t("terminal.logViewer.readError"));
      })
      .finally(() => setLoadingContent(false));
  }, [open, selected, t]);

  const selectedFile = useMemo(
    () => files.find((f) => f.relative === selected) ?? null,
    [files, selected],
  );

  const exportFile = useCallback(async () => {
    if (!selectedFile) return;
    setExporting(true);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const dest = (await save({
        defaultPath: selectedFile.fileName,
        title: t("terminal.logViewer.exportTitle"),
      })) as string | null;
      if (dest) {
        // Asciicast files are a structured format — export verbatim so
        // asciinema can replay them; text logs export ANSI-stripped.
        const strip = !selectedFile.fileName.endsWith(".cast");
        await exportLog(selectedFile.relative, dest, strip);
      }
    } catch {
      setError(t("terminal.logViewer.exportError"));
    } finally {
      setExporting(false);
    }
  }, [selectedFile, t]);

  if (!open) return null;

  const q = query.trim().toLowerCase();

  return (
    <ModalBackdrop
      onClose={close}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div
        data-testid="session-log-viewer"
        role="dialog"
        aria-modal="true"
        className="w-[min(1100px,92vw)] h-[min(720px,86vh)] flex flex-col rounded-xl bg-bg-overlay border border-border shadow-[var(--shadow-lg)] overflow-hidden"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0 gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 shrink-0">
              <ScrollText size={16} strokeWidth={1.8} className="text-accent" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[length:var(--text-lg)] font-semibold text-text-primary truncate">
                {t("terminal.logViewer.title")}
              </h2>
              <p className="text-[length:var(--text-xs)] text-text-muted truncate font-mono">
                {selectedFile ? `${selectedFile.date} · ${selectedFile.fileName}` : t("terminal.logViewer.empty")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <Search size={13} strokeWidth={1.8} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("terminal.logViewer.searchPlaceholder")}
                data-testid="log-viewer-search"
                className="w-52 pl-8 pr-2 py-1.5 text-[length:var(--text-sm)] rounded-lg bg-bg-subtle border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loadingList}
              aria-label={t("terminal.logViewer.refresh")}
              className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-subtle transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              <RefreshCw size={15} strokeWidth={1.8} aria-hidden="true" className={loadingList ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              onClick={() => void exportFile()}
              disabled={!selectedFile || exporting}
              className={BTN_SECONDARY}
            >
              <Save size={14} strokeWidth={1.8} aria-hidden="true" className="mr-1.5 inline-block -mt-0.5" />
              {t("terminal.logViewer.export")}
            </button>
            <button
              type="button"
              onClick={() => void revealLogsDirectory()}
              className={BTN_SECONDARY}
            >
              <FolderOpen size={14} strokeWidth={1.8} aria-hidden="true" className="mr-1.5 inline-block -mt-0.5" />
              {t("terminal.logViewer.openDir")}
            </button>
            <button type="button" onClick={close} className={BTN_GHOST}>
              {t("common.close")}
            </button>
          </div>
        </div>

        {error && (
          <div className="px-5 py-2 text-[length:var(--text-sm)] text-status-error border-b border-border">
            {error}
          </div>
        )}

        {/* ── Body: file list + preview ── */}
        <div className="flex flex-1 min-h-0">
          {/* File list */}
          <div className="w-72 shrink-0 border-r border-border overflow-y-auto py-1">
            {files.length === 0 && !loadingList && (
              <p className="px-4 py-6 text-[length:var(--text-sm)] text-text-muted">
                {t("terminal.logViewer.noFiles")}
              </p>
            )}
            {files.map((f) => {
              const isLive = f.relative === liveRelative;
              return (
                <button
                  key={f.relative}
                  type="button"
                  onClick={() => setSelected(f.relative)}
                  data-testid="log-viewer-file"
                  className={[
                    "w-full text-left px-4 py-2 transition-colors duration-[var(--duration-fast)]",
                    f.relative === selected
                      ? "bg-accent/10 text-text-primary"
                      : "text-text-secondary hover:bg-bg-subtle",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    {isLive && (
                      <span
                        aria-label={t("terminal.logViewer.live")}
                        title={t("terminal.logViewer.live")}
                        className="w-1.5 h-1.5 rounded-full bg-status-error shrink-0 animate-pulse"
                      />
                    )}
                    <span className="text-[length:var(--text-sm)] font-mono truncate">{f.fileName}</span>
                  </div>
                  <div className="text-[length:var(--text-xs)] text-text-muted pl-0">
                    {f.date} · {formatSize(f.size)}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Content preview */}
          <div className="flex-1 min-w-0 overflow-auto bg-bg-base">
            {loadingContent ? (
              <p className="p-4 text-[length:var(--text-sm)] text-text-muted">{t("terminal.logViewer.loading")}</p>
            ) : content === "" ? (
              <p className="p-4 text-[length:var(--text-sm)] text-text-muted">{t("terminal.logViewer.emptyContent")}</p>
            ) : (
              <>
                {truncated && (
                  <p className="sticky top-0 z-10 px-4 py-1.5 text-[length:var(--text-xs)] text-text-muted bg-bg-subtle border-b border-border">
                    {t("terminal.logViewer.truncated")}
                  </p>
                )}
                <pre className="p-4 text-[length:var(--text-xs)] leading-relaxed font-mono text-text-primary whitespace-pre-wrap break-all select-text">
                  {q === "" ? content : <Highlighted text={content} query={q} />}
                </pre>
              </>
            )}
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

/** Highlight every (case-insensitive) occurrence of `query` in `text`. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const parts: React.ReactNode[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let i = 0;
  let key = 0;
  while (true) {
    const hit = lower.indexOf(q, i);
    if (hit === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(
      <mark key={key++} className="bg-accent-muted text-text-primary rounded-sm">
        {text.slice(hit, hit + q.length)}
      </mark>,
    );
    i = hit + q.length;
  }
  return <>{parts}</>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
