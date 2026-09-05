import { useState } from "react";
import { ModalBackdrop } from "../shared/ModalBackdrop";
import { useTranslation } from "../../i18n";
import { useTabStore } from "../../stores/tab-store";
import { toast } from "../../stores/toast-store";
import { buildProtocolHost, persistProtocolHost } from "../../lib/protocol-hosts";

interface VncConnectModalProps {
  onClose: () => void;
}

/**
 * VNC quick connect (P3): host/port only — the Rust bridge hands back a
 * one-time `ws://127.0.0.1:<port>/vnc/<token>` endpoint and the VNC canvas
 * tab (kind "vnc") takes it from there. Authentication happens inside the
 * RFB handshake; noVNC prompts for credentials itself if the server
 * requires them (credentialsrequired event).
 */
export function VncConnectModal({ onClose }: VncConnectModalProps) {
  const { t } = useTranslation();
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5900");
  const [connecting, setConnecting] = useState(false);

  const canSubmit = host.trim().length > 0 && !connecting;

  const submit = async () => {
    if (!canSubmit) return;
    setConnecting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const portNum = Math.max(1, Math.min(65535, parseInt(port, 10) || 5900));
      const { wsUrl, token } = await invoke<{ wsUrl: string; token: string }>(
        "vnc_open",
        { host: host.trim(), port: portNum },
      );
      const label = `vnc://${host.trim()}:${portNum}`;
      // Tab id = token so the bridge route is uniquely addressable.
      useTabStore.getState().addTab({ type: "vnc", id: token, label, wsUrl });
      // Persist as a saved host card (one-click reconnect).
      void persistProtocolHost(buildProtocolHost(
        "vnc",
        label,
        host.trim(),
        portNum,
        { host: host.trim(), port: portNum },
      ));
      onClose();
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : t("dashboard.vnc.fallback");
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
          {t("dashboard.vnc.title")}
        </h2>

        <div className="grid grid-cols-[1fr_5rem] gap-2 mb-3">
          <input
            autoFocus
            value={host}
            onChange={(e) => setHost(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder={t("dashboard.vnc.hostPlaceholder")}
            data-testid="vnc-host-input"
            className="px-3 py-2 rounded-lg bg-bg-surface border border-border text-[length:var(--text-sm)] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-focus"
          />
          <input
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            data-testid="vnc-port-input"
            className="px-3 py-2 rounded-lg bg-bg-surface border border-border text-[length:var(--text-sm)] text-text-primary focus:outline-none focus:border-border-focus"
          />
        </div>

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
            data-testid="vnc-connect-button"
            className="px-4 py-2 text-[length:var(--text-sm)] font-medium text-text-inverse bg-accent hover:bg-accent-hover rounded-lg transition-colors disabled:opacity-50 disabled:hover:bg-accent"
          >
            {connecting ? t("dashboard.connect.connecting") : t("dashboard.vnc.connect")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
