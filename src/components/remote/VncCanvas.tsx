import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, Unplug } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../../i18n";
import type { SavedHost } from "../../types";
import { persistProtocolHost } from "../../lib/protocol-hosts";
import { useHostsStore } from "../../stores/hosts-store";
import { cancelDeferredClose, deferClose } from "./deferred-close";

// RFB type comes from src/types/novnc.d.ts (noVNC ships no types).
type RfbInstance = import("@novnc/novnc").default;

interface VncCanvasProps {
  /** VNC session id — the one-time bridge token handed out by `vnc_open`. */
  sessionId: string;
  /** Loopback WebSocket endpoint: ws://127.0.0.1:<port>/vnc/<token> */
  wsUrl: string;
  isActive: boolean;
  savedHost?: SavedHost;
}

type VncStatus = "connecting" | "connected" | "disconnected" | "error";

/**
 * P3 VNC viewer. Mounts a noVNC RFB client that connects to the Rust
 * WebSocket bridge (`/vnc/<token>`, websockify semantics — raw VNC bytes
 * passthrough). Rendered persistently per tab (visibility toggled by the
 * parent) so the remote desktop survives tab switches.
 *
 * Lifecycle: on unmount the RFB session is disconnected and `vnc_close`
 * revokes the one-time token, tearing down bridge pumps.
 *
 * Clipboard: remote → local via RFB `clipboard` events written through
 * tauri-plugin-clipboard-manager (navigator.clipboard.readText is blocked in
 * the macOS WKWebView); local → remote pushed to the server on window focus.
 */
export function VncCanvas({ sessionId, wsUrl, isActive, savedHost }: VncCanvasProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const [status, setStatus] = useState<VncStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const savedHostRef = useRef(savedHost);
  const [credentialTypes, setCredentialTypes] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<Record<string, string>>({});

  // Connect once per (token, endpoint).
  useEffect(() => {
    // StrictMode double-mount: cancel a pending teardown from the previous
    // mount before (re)connecting, so the one-time token stays valid.
    cancelDeferredClose(`vnc:${sessionId}`);
    let rfb: RfbInstance | null = null;
    let cancelled = false;

    void (async () => {
      const { default: RFB } = await import("@novnc/novnc");
      if (cancelled || !containerRef.current) return;

      rfb = new RFB(containerRef.current, wsUrl);
      rfbRef.current = rfb;
      // Scale the remote framebuffer to the window; don't send resize
      // requests (many VNC servers ignore or mishandle them).
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.background = "transparent";

      rfb.addEventListener("connect", () => {
        if (cancelled) return;
        setCredentialTypes([]);
        setStatus("connected");
        const bookmark = savedHostRef.current;
        if (bookmark) {
          savedHostRef.current = undefined;
          void persistProtocolHost(bookmark).then(() => useHostsStore.getState().recordConnection(bookmark.id));
        }
      });

      rfb.addEventListener("credentialsrequired", (event) => {
        if (!cancelled) setCredentialTypes((event.detail as { types?: string[] }).types ?? ["password"]);
      });

      rfb.addEventListener("disconnect", (e) => {
        if (cancelled) return;
        setCredentialTypes([]);
        const clean = (e.detail as { clean?: boolean } | undefined)?.clean ?? true;
        setStatus(clean ? "disconnected" : "error");
      });

      rfb.addEventListener("securityfailure", (e) => {
        const reason =
          (e.detail as { reason?: string } | undefined)?.reason ?? "";
        if (reason) setErrorMsg(reason);
        setStatus("error");
      });

      // Remote → local clipboard.
      rfb.addEventListener("clipboard", (e) => {
        const text = (e.detail as { text?: string } | undefined)?.text;
        if (cancelled || !activeRef.current || text === undefined) return;
        void import("@tauri-apps/plugin-clipboard-manager").then(
          ({ writeText }) => writeText(text),
        ).catch(() => {/* clipboard unavailable */});
      });
    })().catch((error: unknown) => {
      if (!cancelled) { setErrorMsg(String(error)); setStatus("error"); }
    });

    return () => {
      cancelled = true;
      try {
        rfb?.disconnect();
      } catch {
        /* already gone */
      }
      rfbRef.current = null;
      // Revoke the one-time token; tears down pending route or live pumps.
      // Deferred (see deferred-close.ts) so a StrictMode remount that runs
      // this effect again doesn't revoke the token the new mount needs.
      deferClose(`vnc:${sessionId}`, () =>
        invoke("vnc_close", { token: sessionId }).catch(() => {
          /* bridge already cleaned it up */
        }),
      );
    };
  }, [wsUrl, sessionId]);

  // Local → remote clipboard on window focus (VNC has no push mechanism;
  // re-announcing the local clipboard when the window regains focus is the
  // same approach noVNC's own UI uses).
  useEffect(() => {
    const pushClipboard = async () => {
      const rfb = rfbRef.current;
      if (!rfb || !activeRef.current || status !== "connected") return;
      try {
        const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
        const text = await readText();
        if (activeRef.current && rfbRef.current === rfb) rfb.clipboardPasteFrom(text);
      } catch {
        /* clipboard unavailable */
      }
    };
    window.addEventListener("focus", pushClipboard);
    return () => window.removeEventListener("focus", pushClipboard);
  }, [status]);

  // Focus the RFB keyboard sink when the tab becomes active, so keystrokes
  // land in the remote desktop immediately after a tab switch.
  useEffect(() => {
    if (isActive && status === "connected") rfbRef.current?.focus();
    else rfbRef.current?.blur();
  }, [isActive, status]);

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-base">
      <div ref={containerRef} className="flex-1 min-h-0 relative" />

      {status !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-base/85 backdrop-blur-sm">
          {status === "connecting" && credentialTypes.length === 0 && (
            <>
              <Loader2 size={28} strokeWidth={2} className="text-text-muted motion-safe:animate-spin" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {t("dashboard.vnc.statusConnecting")}
              </p>
            </>
          )}
          {credentialTypes.length > 0 && <form className="w-72 space-y-3" onSubmit={(event) => {
            event.preventDefault();
            rfbRef.current?.sendCredentials(credentials);
            setCredentials({});
            setCredentialTypes([]);
          }}>
            {credentialTypes.map((type) => <label key={type} className="block text-sm text-text-secondary">
              {type === "password" ? t("dashboard.protocol.password") : type === "username" ? t("dashboard.protocol.username") : type}
              <input autoFocus={type === credentialTypes[0]} required type={type === "password" ? "password" : "text"} autoComplete="off"
                className="mt-1 w-full rounded-md border border-border bg-bg-base p-2" value={credentials[type] ?? ""}
                onChange={(event) => setCredentials(previous => ({ ...previous, [type]: event.target.value }))} />
            </label>)}
            <button type="submit" className="w-full rounded-md bg-accent p-2 text-white">{t("dashboard.protocol.connect")}</button>
          </form>}
          {status === "disconnected" && (
            <>
              <Unplug size={28} strokeWidth={2} className="text-text-muted" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {t("dashboard.vnc.statusDisconnected")}
              </p>
            </>
          )}
          {status === "error" && (
            <>
              <AlertTriangle size={28} strokeWidth={2} className="text-status-error" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {t("dashboard.vnc.statusError")}
              </p>
              {errorMsg && (
                <p className="max-w-md px-4 text-center text-[length:var(--text-xs)] text-text-muted font-mono break-all">
                  {errorMsg}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
