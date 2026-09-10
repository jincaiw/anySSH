import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, Unplug, RefreshCw, Pencil } from "lucide-react";
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
  onReconnect?: () => Promise<void>;
  onEdit?: () => void;
}

type VncStatus = "connecting" | "connected" | "disconnected" | "error";

/**
 * Tauri rejects commands with an object (`BridgeError` serialises to
 * `{ kind, message }`), so `String(err)` would render "[object Object]".
 */
function messageOf(err: unknown): string {
  return err && typeof err === "object" && "message" in err
    ? String((err as { message: unknown }).message)
    : String(err);
}

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
export function VncCanvas({ sessionId, wsUrl, isActive, savedHost, onReconnect, onEdit }: VncCanvasProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RfbInstance | null>(null);
  const [status, setStatus] = useState<VncStatus>("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [serverFingerprint, setServerFingerprint] = useState<string>("");

  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const savedHostRef = useRef(savedHost);
  const [credentialTypes, setCredentialTypes] = useState<string[]>([]);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const statusRef = useRef(status);
  statusRef.current = status;
  // `t` is rebuilt whenever the locale changes (useTranslation memoises on
  // [locale]). Holding it in a ref keeps the connect effect below from
  // re-running — and tearing down a live VNC session — on a language switch.
  const tRef = useRef(t);
  tRef.current = t;
  // Credential types last requested by the server — restored after a
  // `securityfailure` so a typo'd password can be corrected in place.
  const lastCredentialTypesRef = useRef<string[]>([]);

  const pushClipboard = useCallback(async () => {
    const rfb = rfbRef.current;
    if (!rfb || !activeRef.current || statusRef.current !== "connected") return;
    try {
      const { readText } = await import("@tauri-apps/plugin-clipboard-manager");
      const text = await readText();
      if (activeRef.current && rfbRef.current === rfb && statusRef.current === "connected") {
        rfb.clipboardPasteFrom(text);
      }
    } catch {
      /* clipboard unavailable */
    }
  }, []);

  const reconnect = async () => {
    if (!onReconnect) return;
    setErrorMsg("");
    setStatus("connecting");
    try { await onReconnect(); }
    catch (error) { setErrorMsg(messageOf(error)); setStatus("error"); }
  };

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
        statusRef.current = "connected";
        setServerFingerprint("");
        void pushClipboard();
        const bookmark = savedHostRef.current;
        if (bookmark) {
          savedHostRef.current = undefined;
          void persistProtocolHost(bookmark).then(() => useHostsStore.getState().recordConnection(bookmark.id));
        }
      });

      rfb.addEventListener("credentialsrequired", (event) => {
        if (!cancelled) setCredentialTypes((event.detail as { types?: string[] }).types ?? ["password"]);
      });

      rfb.addEventListener("serververification", (event) => {
        const publickey = (event.detail as { publickey?: Uint8Array }).publickey;
        if (!publickey) {
          setErrorMsg(tRef.current("dashboard.vnc.verificationUnavailable"));
          setStatus("error");
          return;
        }
        void crypto.subtle.digest("SHA-256", publickey).then(digest => {
          if (cancelled) return;
          const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(":");
          setServerFingerprint(fingerprint);
        }).catch(error => {
          if (!cancelled) { setErrorMsg(messageOf(error)); setStatus("error"); }
        });
      });

      rfb.addEventListener("disconnect", (e) => {
        if (cancelled) return;
        setCredentialTypes([]);
        const detail = e.detail as { clean?: boolean; reason?: string } | undefined;
        // noVNC reports *why* it dropped (protocol mismatch, server closed,
        // unsupported security type…). Defaulting to `true` collapsed every
        // one of those into a bare "disconnected" with nothing to act on.
        const clean = detail?.clean ?? false;
        if (!clean) {
          setErrorMsg(detail?.reason || tRef.current("dashboard.vnc.statusError"));
        }
        setStatus(clean ? "disconnected" : "error");
      });

      rfb.addEventListener("securityfailure", (e) => {
        const detail = e.detail as { reason?: string } | undefined;
        const reason = detail?.reason ?? "";
        if (reason) setErrorMsg(reason);
        // Re-offer the prompt (e.g. a wrong password) instead of leaving the
        // user with a dead session and a manual reconnect.
        if (lastCredentialTypesRef.current.length > 0) {
          setCredentialTypes(lastCredentialTypesRef.current);
        }
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
      if (!cancelled) { setErrorMsg(messageOf(error)); setStatus("error"); }
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
  }, [wsUrl, sessionId, pushClipboard]);

  // Local → remote clipboard on window focus (VNC has no push mechanism;
  // re-announcing the local clipboard when the window regains focus is the
  // same approach noVNC's own UI uses).
  useEffect(() => {
    window.addEventListener("focus", pushClipboard);
    return () => window.removeEventListener("focus", pushClipboard);
  }, [pushClipboard]);

  // Focus the RFB keyboard sink when the tab becomes active, so keystrokes
  // land in the remote desktop immediately after a tab switch.
  useEffect(() => {
    if (isActive && status === "connected") {
      rfbRef.current?.focus();
      void pushClipboard();
    }
    else rfbRef.current?.blur();
  }, [isActive, status, pushClipboard]);

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-base">
      {status === "connected" && <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-xs text-text-secondary">
        <button className="rounded px-2 py-1 hover:bg-bg-subtle" onClick={() => void pushClipboard()}>{t("dashboard.protocol.pasteClipboard")}</button>
      </div>}
      <div ref={containerRef} className="flex-1 min-h-0 relative" />

      {status !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-base/85 backdrop-blur-sm">
          {status === "connecting" && credentialTypes.length === 0 && !serverFingerprint && (
            <>
              <Loader2 size={28} strokeWidth={2} className="text-text-muted motion-safe:animate-spin" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {t("dashboard.vnc.statusConnecting")}
              </p>
            </>
          )}
          {credentialTypes.length > 0 && !serverFingerprint && <form className="w-72 space-y-3" onSubmit={(event) => {
            event.preventDefault();
            rfbRef.current?.sendCredentials(credentials);
            // Remember what was asked for: a rejected password must be
            // retryable in place, not require tearing the session down.
            lastCredentialTypesRef.current = credentialTypes;
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
          {serverFingerprint && <div role="alert" className="w-[32rem] max-w-[calc(100%-2rem)] space-y-3 rounded-lg border border-border bg-bg-surface p-4 text-sm">
            <p className="text-text-primary">{t("dashboard.vnc.verifyServer")}</p>
            <p className="break-all font-mono text-xs text-text-muted">SHA-256 {serverFingerprint}</p>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded px-3 py-1.5 text-text-secondary hover:bg-bg-subtle" onClick={() => { rfbRef.current?.disconnect(); setServerFingerprint(""); setStatus("error"); }}>{t("common.cancel")}</button>
              <button type="button" className="rounded bg-accent px-3 py-1.5 text-white" onClick={() => { rfbRef.current?.approveServer(); setServerFingerprint(""); }}>{t("dashboard.vnc.trustServer")}</button>
            </div>
          </div>}
          {status === "disconnected" && (
            <>
              <Unplug size={28} strokeWidth={2} className="text-text-muted" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {t("dashboard.vnc.statusDisconnected")}
              </p>
              <div className="flex gap-2">{onReconnect && <button className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-sm text-white" onClick={() => void reconnect()}><RefreshCw size={14} />{t("common.retry")}</button>}{onEdit && <button className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle" onClick={onEdit}><Pencil size={14} />{t("common.edit")}</button>}</div>
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
              <div className="flex gap-2">{onReconnect && <button className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-sm text-white" onClick={() => void reconnect()}><RefreshCw size={14} />{t("common.retry")}</button>}{onEdit && <button className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle" onClick={onEdit}><Pencil size={14} />{t("common.edit")}</button>}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
