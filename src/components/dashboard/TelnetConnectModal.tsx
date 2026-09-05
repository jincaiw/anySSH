import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { ModalBackdrop } from "../shared/ModalBackdrop";
import { useTranslation } from "../../i18n";
import { TERMINAL_ENCODINGS } from "../../stores/settings-store";
import { useSessionStore } from "../../stores/session-store";
import { useTabStore } from "../../stores/tab-store";
import { toast } from "../../stores/toast-store";
import { buildProtocolHost, persistProtocolHost } from "../../lib/protocol-hosts";

interface TelnetConnectModalProps {
  onClose: () => void;
}

interface ScriptStepDraft {
  expect: string;
  send: string;
}

/**
 * Telnet quick-connect (P1b): host/port/encoding plus an optional
 * expect/send auto-login script. On success the terminal tab opens with
 * `kind: "telnet"` so Terminal.tsx reads the generic `term:output` channel.
 */
export function TelnetConnectModal({ onClose }: TelnetConnectModalProps) {
  const { t } = useTranslation();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("23");
  const [encoding, setEncoding] = useState<string>("utf-8");
  const [steps, setSteps] = useState<ScriptStepDraft[]>([]);
  const [connecting, setConnecting] = useState(false);

  const canSubmit = host.trim().length > 0 && !connecting;

  const addStep = () => setSteps((s) => [...s, { expect: "", send: "" }]);
  const removeStep = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));
  const updateStep = (i: number, patch: Partial<ScriptStepDraft>) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, ...patch } : st)));

  const submit = async () => {
    if (!canSubmit) return;
    setConnecting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const portNum = Math.max(1, Math.min(65535, parseInt(port, 10) || 23));
      // Skip fully-empty draft rows; empty `send` is allowed (wake-up Enter).
      const loginScript = steps
        .filter((s) => s.expect.trim() !== "" || s.send.trim() !== "")
        .map((s) => ({ expect: s.expect, send: s.send }));
      const sessionId = await invoke<string>("term_open", {
        params: {
          kind: "telnet",
          host: host.trim(),
          port: portNum,
          encoding: encoding === "utf-8" ? null : encoding,
          ...(loginScript.length > 0 ? { loginScript } : {}),
        },
        cols: 80,
        rows: 24,
      });
      const label = `telnet://${host.trim()}:${portNum}`;
      useSessionStore.getState().addSession(
        sessionId,
        {
          host: host.trim(),
          port: portNum,
          username: "",
          auth_method: { type: "password", password: "" },
          label,
          terminal_encoding: encoding === "utf-8" ? undefined : encoding,
        },
        "telnet",
      );
      useTabStore.getState().addTab({ type: "terminal", id: sessionId, label });
      // Persist as a saved host card so it can be reopened with one click.
      void persistProtocolHost(buildProtocolHost(
        "telnet",
        label,
        host.trim(),
        portNum,
        {
          kind: "telnet",
          host: host.trim(),
          port: portNum,
          encoding: encoding === "utf-8" ? null : encoding,
          ...(loginScript.length > 0 ? { loginScript } : {}),
        },
      ));
      onClose();
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : t("dashboard.telnet.fallback");
      toast.error(msg);
      setConnecting(false);
    }
  };

  return (
    <ModalBackdrop
      onClose={connecting ? () => {} : onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-md mx-4 rounded-xl bg-bg-overlay border border-border p-6 shadow-[var(--shadow-lg)] animate-[fadeIn_120ms_var(--ease-expo-out)_both]">
        <h2 className="text-[length:var(--text-sm)] font-semibold text-text-primary mb-4">
          {t("dashboard.telnet.title")}
        </h2>

        <div className="grid grid-cols-[1fr_5rem] gap-2 mb-3">
          <input
            autoFocus
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder={t("dashboard.telnet.hostPlaceholder")}
            data-testid="telnet-host-input"
            className="px-3 py-2 rounded-lg bg-bg-surface border border-border text-[length:var(--text-sm)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus"
          />
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            data-testid="telnet-port-input"
            className="px-3 py-2 rounded-lg bg-bg-surface border border-border text-[length:var(--text-sm)] text-text-primary focus:outline-none focus:border-border-focus"
          />
        </div>

        <select
          value={encoding}
          onChange={(e) => setEncoding(e.target.value)}
          data-testid="telnet-encoding-select"
          className="w-full mb-3 px-3 py-2 rounded-lg bg-bg-surface border border-border text-[length:var(--text-sm)] text-text-primary focus:outline-none focus:border-border-focus"
        >
          {TERMINAL_ENCODINGS.map((e) => (
            <option key={e.value} value={e.value}>
              {t("dashboard.telnet.encoding")}：{e.label}
            </option>
          ))}
        </select>

        {/* Auto-login script (optional) */}
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[length:var(--text-xs)] text-text-secondary">
            {t("dashboard.telnet.scriptTitle")}
          </span>
          <button
            onClick={addStep}
            data-testid="telnet-add-step"
            className="flex items-center gap-1 text-[length:var(--text-xs)] text-text-secondary hover:text-text-primary transition-colors"
          >
            <Plus size={13} strokeWidth={2} />
            {t("dashboard.telnet.addStep")}
          </button>
        </div>
        {steps.length === 0 && (
          <p className="text-[length:var(--text-xs)] text-text-muted mb-2">
            {t("dashboard.telnet.scriptHint")}
          </p>
        )}
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-1.5 mb-2">
            <input
              value={step.expect}
              onChange={(e) => updateStep(i, { expect: e.target.value })}
              placeholder={t("dashboard.telnet.expectPlaceholder")}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-bg-surface border border-border text-[length:var(--text-xs)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus font-mono"
            />
            <input
              value={step.send}
              onChange={(e) => updateStep(i, { send: e.target.value })}
              placeholder={t("dashboard.telnet.sendPlaceholder")}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-bg-surface border border-border text-[length:var(--text-xs)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus font-mono"
            />
            <button
              onClick={() => removeStep(i)}
              aria-label={t("common.delete")}
              className="p-1.5 rounded-md text-text-muted hover:text-status-error transition-colors shrink-0"
            >
              <Trash2 size={14} strokeWidth={2} />
            </button>
          </div>
        ))}

        <div className="flex justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            disabled={connecting}
            className="px-4 py-2 text-[length:var(--text-sm)] text-text-secondary hover:text-text-primary rounded-lg transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            data-testid="telnet-connect-button"
            className="px-4 py-2 text-[length:var(--text-sm)] font-medium text-text-inverse bg-accent hover:bg-accent-hover rounded-lg transition-colors disabled:opacity-50 disabled:hover:bg-accent"
          >
            {connecting ? t("dashboard.connect.connecting") : t("dashboard.telnet.connect")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
