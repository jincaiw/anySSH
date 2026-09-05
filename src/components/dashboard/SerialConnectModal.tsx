import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ModalBackdrop } from "../shared/ModalBackdrop";
import { useTranslation } from "../../i18n";
import { TERMINAL_ENCODINGS } from "../../stores/settings-store";
import { useSessionStore } from "../../stores/session-store";
import { useTabStore } from "../../stores/tab-store";
import { toast } from "../../stores/toast-store";
import { buildProtocolHost, persistProtocolHost } from "../../lib/protocol-hosts";

interface SerialConnectModalProps {
  onClose: () => void;
}

interface PortInfo {
  path: string;
  kind: string;
  vid: number | null;
  pid: number | null;
  manufacturer: string | null;
  product: string | null;
}

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;

/**
 * Serial quick-connect (P2): pick a port (live list with hotplug refresh),
 * baud rate and encoding. Line settings default to 8N1 no-flow — the
 * common console configuration; the backend params model carries the rest.
 */
export function SerialConnectModal({ onClose }: SerialConnectModalProps) {
  const { t } = useTranslation();
  const [ports, setPorts] = useState<PortInfo[]>([]);
  const [path, setPath] = useState("");
  const [baud, setBaud] = useState<number>(115200);
  const [encoding, setEncoding] = useState<string>("utf-8");
  const [connecting, setConnecting] = useState(false);

  const refreshPorts = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const list = await invoke<PortInfo[]>("serial_list_ports");
      setPorts(list);
      setPath((cur) => (list.some((p) => p.path === cur) ? cur : (list[0]?.path ?? "")));
    } catch {
      setPorts([]);
    }
  }, []);

  useEffect(() => {
    void refreshPorts();
    // Start (once per process) the 2 s hotplug poller, then refresh the
    // list whenever it reports a change while this dialog is open.
    let unlisten: (() => void) | undefined;
    (async () => {
      const [{ invoke }, { listen }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
      ]);
      try {
        await invoke("serial_start_hotplug");
        unlisten = await listen("serial:ports-changed", () => void refreshPorts());
      } catch {
        /* hotplug optional — manual refresh still works */
      }
    })();
    return () => unlisten?.();
  }, [refreshPorts]);

  const portLabel = (p: PortInfo) => {
    const id = [p.manufacturer, p.product].filter(Boolean).join(" ");
    const usb = p.vid != null ? ` (USB ${p.vid.toString(16)}:${(p.pid ?? 0).toString(16)})` : "";
    return id || usb ? `${p.path} — ${id}${usb}` : p.path;
  };

  const submit = async () => {
    if (!path || connecting) return;
    setConnecting(true);
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const sessionId = await invoke<string>("term_open", {
        params: {
          kind: "serial",
          port: path,
          baud,
          encoding: encoding === "utf-8" ? null : encoding,
        },
        cols: 80,
        rows: 24,
      });
      const label = `${path} @ ${baud}`;
      useSessionStore.getState().addSession(
        sessionId,
        {
          host: path,
          port: 0,
          username: "",
          auth_method: { type: "password", password: "" },
          label,
          terminal_encoding: encoding === "utf-8" ? undefined : encoding,
        },
        "serial",
      );
      useTabStore.getState().addTab({ type: "terminal", id: sessionId, label });
      // Persist as a saved host card so it can be reopened with one click.
      void persistProtocolHost(buildProtocolHost(
        "serial",
        label,
        path,
        0,
        { kind: "serial", port: path, baud, encoding: encoding === "utf-8" ? null : encoding },
      ));
      onClose();
    } catch (err) {
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : t("dashboard.serial.fallback");
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
          {t("dashboard.serial.title")}
        </h2>

        <div className="flex items-center gap-2 mb-3">
          <select
            value={path}
            onChange={(e) => setPath(e.target.value)}
            data-testid="serial-port-select"
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg-surface border border-border text-[length:var(--text-sm)] text-text-primary focus:outline-none focus:border-border-focus"
          >
            {ports.length === 0 && <option value="">{t("dashboard.serial.noPorts")}</option>}
            {ports.map((p) => (
              <option key={p.path} value={p.path}>
                {portLabel(p)}
              </option>
            ))}
          </select>
          <button
            onClick={() => void refreshPorts()}
            aria-label={t("dashboard.serial.refresh")}
            className="p-2 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:bg-bg-surface transition-colors shrink-0"
          >
            <RefreshCw size={14} strokeWidth={2} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <select
            value={baud}
            onChange={(e) => setBaud(Number(e.target.value))}
            data-testid="serial-baud-select"
            className="px-3 py-2 rounded-lg bg-bg-surface border border-border text-[length:var(--text-sm)] text-text-primary focus:outline-none focus:border-border-focus"
          >
            {BAUD_RATES.map((b) => (
              <option key={b} value={b}>
                {b} baud
              </option>
            ))}
          </select>
          <select
            value={encoding}
            onChange={(e) => setEncoding(e.target.value)}
            data-testid="serial-encoding-select"
            className="px-3 py-2 rounded-lg bg-bg-surface border border-border text-[length:var(--text-sm)] text-text-primary focus:outline-none focus:border-border-focus"
          >
            {TERMINAL_ENCODINGS.map((e) => (
              <option key={e.value} value={e.value}>
                {t("dashboard.serial.encoding")}：{e.label}
              </option>
            ))}
          </select>
        </div>

        <p className="text-[length:var(--text-xs)] text-text-muted mb-4">
          {t("dashboard.serial.lineHint")}
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={connecting}
            className="px-4 py-2 text-[length:var(--text-sm)] text-text-secondary hover:text-text-primary rounded-lg transition-colors disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void submit()}
            disabled={!path || connecting}
            data-testid="serial-connect-button"
            className="px-4 py-2 text-[length:var(--text-sm)] font-medium text-text-inverse bg-accent hover:bg-accent-hover rounded-lg transition-colors disabled:opacity-50 disabled:hover:bg-accent"
          >
            {connecting ? t("dashboard.connect.connecting") : t("dashboard.serial.connect")}
          </button>
        </div>
      </div>
    </ModalBackdrop>
  );
}
