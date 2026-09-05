import { invoke } from "@tauri-apps/api/core";
import { useSessionStore } from "../stores/session-store";
import { t } from "../i18n";

export function isTermSession(id: string): boolean {
  const kind = useSessionStore.getState().sessions.get(id)?.kind;
  return kind === "local" || kind === "telnet" || kind === "serial";
}

export function terminalCommand(id: string, ssh: string, term: string): string {
  return isTermSession(id) ? term : ssh;
}

export function duplicateTerminal(id: string, reconnect = false): Promise<string> {
  if (isTermSession(id)) {
    if (!reconnect && useSessionStore.getState().sessions.get(id)?.kind === "serial") {
      return Promise.reject(new Error(t("dashboard.protocol.serialExclusive")));
    }
    return invoke("term_duplicate", { sourceSessionId: id, reconnect });
  }
  return invoke("ssh_split_session", { sourceSessionId: id });
}
