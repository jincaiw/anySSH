import { t } from "../i18n";
import { useUiStore } from "../stores/ui-store";

/**
 * Front-end helpers for the terminal session log feature. All heavy lifting
 * (writing, rotation, retention, masking) lives in the Rust module
 * `src-tauri/src/ssh/sessionlog.rs` — these wrappers only talk to its commands.
 */

/** Mirrors the Rust `SessionLogStatus` (serde camelCase). */
export interface SessionLogStatus {
  active: boolean;
  path: string | null;
  host: string;
  user: string;
}

/** Mirrors the Rust `LogFileInfo` (serde camelCase). */
export interface LogFileInfo {
  fileName: string;
  /** Path relative to the log root — pass back to read/export commands. */
  relative: string;
  date: string;
  size: number;
  /** Unix epoch seconds of the last modification. */
  modified: number;
}

/** Mirrors the Rust `LogReadResult`. */
export interface LogReadResult {
  content: string;
  truncated: boolean;
}

/** Query the live log status of a session. Null when the session is gone. */
export async function getSessionLogStatus(
  sessionId: string,
): Promise<SessionLogStatus | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<SessionLogStatus>("ssh_session_log_status", { sessionId });
  } catch {
    return null;
  }
}

/**
 * Toggle logging for a live session (right-click menu / ⌘⇧L). When no
 * explicit options are sent the backend falls back to the persisted settings.
 * `path` (Xshell-style "Save As…") starts logging to a user-chosen file;
 * it is only meaningful when starting. Returns the fresh status, or null
 * when the session disappeared.
 */
export async function toggleSessionLog(
  sessionId: string,
  path?: string,
): Promise<SessionLogStatus | null> {
  const before = await getSessionLogStatus(sessionId);
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    if (before?.active) {
      await invoke("ssh_stop_session_log", { sessionId });
    } else {
      await invoke("ssh_start_session_log", { sessionId, path: path ?? null });
    }
  } catch {
    /* session gone or command unavailable */
  }
  return getSessionLogStatus(sessionId);
}

/**
 * Xshell-style start: ask the user where to put the log with a save
 * dialog (default: the session-log root, `<host>_<timestamp>.log`), then
 * start recording there. Returns the fresh status, or null when the
 * dialog was cancelled or the session disappeared.
 */
export async function startSessionLogWithSaveDialog(
  sessionId: string,
): Promise<SessionLogStatus | null> {
  const status = await getSessionLogStatus(sessionId);
  if (!status) return null;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace("T", "_")
    .replace(/:/g, "-");
  const suggested = `${status.host || "session"}_${stamp}.log`;
  let dir: string | null = null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    dir = await invoke<string>("ssh_logs_dir");
  } catch {
    /* fall back to the dialog's default location */
  }
  const chosen = (await save({
    defaultPath: dir ? `${dir}/${suggested}` : suggested,
    title: t("terminal.menu.startTitle"),
    filters: [{ name: "Log", extensions: ["log", "cast"] }],
  })) as string | null;
  if (!chosen) return null;
  return toggleSessionLog(sessionId, chosen);
}

/** Reveal the session's current log file in Finder / Explorer. */
export async function revealActiveLogFile(sessionId: string): Promise<void> {
  try {
    const status = await getSessionLogStatus(sessionId);
    if (!status?.path) return;
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(status.path);
  } catch {
    /* opener unavailable */
  }
}

/** Open the built-in log viewer for a session (or the plain log browser). */
export function openSessionLogViewer(sessionId: string | null = null): void {
  useUiStore.getState().openSessionLogViewer(sessionId);
}

/** List every log file under the root, newest first. */
export async function listSessionLogs(): Promise<LogFileInfo[]> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<LogFileInfo[]>("ssh_list_session_logs");
  } catch {
    return [];
  }
}

/** Read the tail of a log file (defaults to 512 KB, capped at 4 MB). */
export async function readLog(
  relative: string,
  maxBytes?: number,
): Promise<LogReadResult> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<LogReadResult>("ssh_read_log", { relative, maxBytes });
}

/** Copy a log file to an arbitrary destination, optionally stripping ANSI. */
export async function exportLog(
  relative: string,
  dest: string,
  stripAnsi: boolean,
): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("ssh_export_log", { relative, dest, stripAnsi });
}

/** Reveal the session-log root directory in Finder / Explorer. */
export async function revealLogsDirectory(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const dir = await invoke<string>("ssh_logs_dir");
    const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
    await revealItemInDir(dir);
  } catch {
    /* opener unavailable */
  }
}
