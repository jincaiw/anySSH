import { useState } from "react";
import { ModalBackdrop } from "../shared/ModalBackdrop";
import { useTranslation } from "../../i18n";
import { useTabStore } from "../../stores/tab-store";
import { toast } from "../../stores/toast-store";
import { buildProtocolHost, persistProtocolHost } from "../../lib/protocol-hosts";

interface RdpConnectModalProps {
  onClose: () => void;
  /** Prefill from a saved RDP host card (password is never persisted). */
  initial?: { host?: string; port?: string; username?: string };
}

/**
 * RDP quick connect (P4): host/port + NLA credentials. The Rust bridge hands
 * back a one-time `ws://127.0.0.1:<port>/rdp/<token>` endpoint; the RDP
 * canvas tab (kind "rdp") runs ironrdp-web WASM against it. Credentials are
 * used by CredSSP/NLA inside the WASM client.
 */
export function RdpConnectModal({ onClose, initial }: RdpConnectModalProps) {
  const { t } = useTranslation();
  const [host, setHost] = useState(initial?.host ?? "");
  const [port, setPort] = useState(initial?.port ?? "3389");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);

  const canSubmit = host.trim().length > 0 && !connecting;

  const submit = async () => {
    if (!canSubmit) return;
    setConnecting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const portNum = Math.max(1, Math.min(65535, parseInt(port, 10) || 3389));
      const { wsUrl, token } = await invoke<{ wsUrl: string; token: string }>(
        "rd_open",
        { host: host.trim(), port: portNum },
      );
      const label = `rdp://${host.trim()}:${portNum}`;
      // Tab id = token so the bridge route is uniquely addressable.
      useTabStore.getState().addTab({
        type: "rdp",
        id: token,
        label,
        wsUrl,
        destination: `${host.trim()}:${portNum}`,
        username: username.trim(),
        password,
      });
      // Persist as a saved host card; reconnect re-prompts for the password
      // (credentials are never written to saved_hosts).
      void persistProtocolHost(buildProtocolHost(
        "rdp",
        label,
        host.trim(),
        portNum,
        { host: host.trim(), port: portNum, username: username.trim() },
        username.trim(),
      ));
      onClose();
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : t("dashboard.rdp.fallback");
      toast.error(msg);
      setConnecting(false);
    }
  };

  const inputCls =
    "px-3 py-2 rounded-lg bg-bg-surface border border-border text-[length:var(--text-sm)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus";

  return (
    <ModalBackdrop
      onClose={connecting ? () => {} : onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg-base/60 backdrop-blur-sm"
    >
      <div className="w-full max-w-md mx-4 rounded-xl bg-bg-overlay border border-border p-6 shadow-[var(--shadow-lg)] animate-[fadeIn_120ms_var(--ease-expo-out)_both]">
        <h2 className="text-[length:var(--text-sm)] font-semibold text-text-primary mb-4">
          {t("dashboard.rdp.title")}
        </h2>

        <div className="grid grid-cols-[1fr_5rem] gap-2 mb-3">
          <input
            autoFocus
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder={t("dashboard.rdp.hostPlaceholder")}
            data-testid="rdp-host-input"
            className={inputCls}
          />
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            data-testid="rdp-port-input"
            className={inputCls}
          />
        </div>

        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder={t("dashboard.rdp.usernamePlaceholder")}
          data-testid="rdp-username-input"
          className={`${inputCls} w-full mb-3`}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          placeholder={t("dashboard.rdp.passwordPlaceholder")}
          data-testid="rdp-password-input"
          className={`${inputCls} w-full`}
        />

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
            data-testid="rdp-connect-button"
            className="px-4 py-2 text-[length:var(--text-sm)] font-medium text-text-inverse bg-accent hover:bg-accent-hover rounded-lg transition-colors disabled:opacity-50 disabled:hover:bg-accent"
          >
            {connecting ? t("dashboard.connect.connecting") : t("dashboard.rdp.connect")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
