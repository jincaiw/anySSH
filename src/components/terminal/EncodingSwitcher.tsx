import { invoke } from "@tauri-apps/api/core";
import { CustomSelect } from "../shared/CustomSelect";
import { useSessionStore } from "../../stores/session-store";
import { TERMINAL_ENCODINGS } from "../../stores/settings-store";
import { useTranslation } from "../../i18n";

/**
 * Runtime per-session encoding switcher, anchored to the bottom-right corner
 * of a terminal pane. Switching rebuilds the backend stream converters via
 * `ssh_set_session_encoding` and mirrors the new label into the session
 * store. Runtime-only by design: nothing is persisted, and a reconnect (or a
 * new session) falls back to the global encoding setting.
 *
 * Split panes inherit the source session's runtime encoding — both the
 * backend (`SshManager::split_session`) and the frontend store mirror that.
 */
export function EncodingSwitcher({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const session = useSessionStore((s) => s.sessions.get(sessionId));
  const setSessionEncoding = useSessionStore((s) => s.setSessionEncoding);

  // Only meaningful on a live PTY — hide on disconnected/error panes (the
  // reconnect overlay covers that state anyway).
  if (!session || session.status !== "Connected") return null;

  const value = session.encoding ?? "utf-8";

  const handleChange = (next: string) => {
    void (async () => {
      try {
        await invoke("ssh_set_session_encoding", { sessionId, encoding: next });
        // Only commit on success so a failed switch keeps the old label
        // (and therefore the old value shown in the selector).
        setSessionEncoding(sessionId, next);
      } catch {
        // Backend rejected the label or the session is gone — keep as-is.
      }
    })();
  };

  return (
    <div
      className={[
        "absolute bottom-2 right-2 z-20 w-[132px]",
        "opacity-40 transition-opacity duration-[var(--duration-fast)]",
        "hover:opacity-100 focus-within:opacity-100",
      ].join(" ")}
      title={t("terminal.encoding.title")}
    >
      <CustomSelect
        value={value}
        options={TERMINAL_ENCODINGS.map((e) => ({ value: e.value, label: e.label }))}
        onChange={handleChange}
        aria-label={t("terminal.encoding.ariaLabel")}
        data-testid={`encoding-switcher-${sessionId}`}
      />
    </div>
  );
}
