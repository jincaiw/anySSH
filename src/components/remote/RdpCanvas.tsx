import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, Unplug, RefreshCw, Pencil, Maximize2, FileUp, FolderDown } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "../../i18n";
import type { SavedHost } from "../../types";
import { persistProtocolHost } from "../../lib/protocol-hosts";
import { useHostsStore } from "../../stores/hosts-store";
import { withNativeClipboard, encodeRgbaAsPng } from "./rdp-native-clipboard";
import { cancelDeferredClose, deferClose } from "./deferred-close";

interface RdpCanvasProps {
  /** RDP session id — the one-time bridge token handed out by `rd_open`. */
  sessionId: string;
  /** Loopback WebSocket endpoint: ws://127.0.0.1:<port>/rdp/<token> */
  wsUrl: string;
  destination: string;
  username: string;
  password: string;
  /** Windows domain for NLA (optional; maps to `withServerDomain`). */
  domain?: string;
  isActive: boolean;
  savedHost?: SavedHost;
  onReconnect?: () => Promise<void>;
  onEdit?: () => void;
}

/** Minimal shape of the component's PublicAPI (config builder chains). */
interface RdpPublicApi {
  setVisibility: (visible: boolean) => void;
  setEnableClipboard: (enable: boolean) => void;
  ctrlAltDel: () => void;
  shutdown: () => void;
  connect: (config: unknown) => Promise<{ run: () => Promise<unknown> }>;
  /** Registers a file-transfer provider: its builder extensions go onto the
   *  SessionBuilder and `setSession` runs once the session is live. */
  enableFileTransfer: (provider: unknown) => unknown;
  configBuilder: () => {
    withUsername: (u: string) => RdpConfigBuilder;
    withPassword: (p: string) => RdpConfigBuilder;
    withDestination: (d: string) => RdpConfigBuilder;
    withProxyAddress: (a: string) => RdpConfigBuilder;
    withAuthToken: (t: string) => RdpConfigBuilder;
    build: () => unknown;
  };
}
interface RdpConfigBuilder {
  withUsername: (u: string) => RdpConfigBuilder;
  withPassword: (p: string) => RdpConfigBuilder;
  withDestination: (d: string) => RdpConfigBuilder;
  withProxyAddress: (a: string) => RdpConfigBuilder;
  withAuthToken: (t: string) => RdpConfigBuilder;
  withServerDomain: (d: string) => RdpConfigBuilder;
  withDesktopSize: (size: unknown) => RdpConfigBuilder;
  withExtension: (ext: unknown) => RdpConfigBuilder;
  build: () => unknown;
}

type RdpStatus = "loading" | "connecting" | "connected" | "disconnected" | "error";

/** Build a safe relative path from a server-supplied clipboard entry.
 *  MS-RDPECLIP file lists are controlled by the remote peer: `..`, absolute
 *  paths and drive letters must never reach the filesystem join below
 *  (a hostile server could otherwise escape the chosen save directory). */
export function safeRemotePath(name: string, dir?: string): string {
  const segments: string[] = [];
  for (const raw of [dir ?? "", name].flatMap(v => v.split(/[/\\]/))) {
    const s = raw.trim();
    // Empty, "." / ".." and dot-only segments: Windows trims trailing dots,
    // so "..." would normalise to ".." there.
    if (!s || /^\.+$/.test(s)) continue;
    if (/^[A-Za-z]:$/.test(s)) continue; // "C:" drive prefix
    segments.push(s);
  }
  return segments.length ? segments.join("/") : "unnamed";
}

/** Server-offered clipboard file entry (MS-RDPECLIP file list); mirrors the
 *  WASM `FileInfo` shape (`path` is a `\`-separated relative dir). */
interface RdpRemoteFile {
  name: string;
  path?: string;
  size: number;
  lastModified: number;
  isDirectory?: boolean;
}

/** mstsc-style auto-reconnect: retry a dropped session this many times with
 *  exponential backoff (1s/2s/4s) before falling back to the manual button. */
const MAX_AUTO_RECONNECT = 3;

/**
 * P4 RDP viewer — embeds the official `<iron-remote-desktop>` web component
 * backed by `@devolutions/iron-remote-desktop-rdp` (ironrdp-web WASM, base64
 * embedded in the JS bundle — no extra asset fetch, no CSP change needed
 * since Tauri CSP is null).
 *
 * Flow: `init()` loads the WASM → the component gets the `Backend` module via
 * its `module` property → the `ready` event exposes the PublicAPI surface →
 * we build a Config (proxy = our /rdp/<token> bridge, authToken = token) and
 * `connect()`. The WASM performs the RDCleanPath handshake against our
 * bridge, then CredSSP/NLA and the whole RDP state machine; rendering and
 * input stay inside the component. `await sessionInfo.run()` resolves when
 * the session terminates.
 *
 * Cleanup: `shutdown()` the session and `rd_close(token)` to tear down the
 * bridge tunnel.
 */
let backendInitialization: Promise<unknown> | undefined;

export function RdpCanvas({
  sessionId,
  wsUrl,
  destination,
  username,
  password,
  domain,
  isActive,
  savedHost,
  onReconnect,
  onEdit,
}: RdpCanvasProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const apiRef = useRef<RdpPublicApi | null>(null);
  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const savedHostRef = useRef(savedHost);
  const pasteRef = useRef<(() => Promise<void>) | null>(null);
  const fileTransferRef = useRef<
    import("@devolutions/iron-remote-desktop-rdp").RdpFileTransferProvider | null
  >(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [remoteFiles, setRemoteFiles] = useState<RdpRemoteFile[]>([]);
  const [transferNote, setTransferNote] = useState("");
  // Auto-reconnect bookkeeping: only a session that reached "connected" and
  // then dropped is retried automatically; initial failures stay manual.
  const wasConnectedRef = useRef(false);
  const attemptRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const [autoReconnectAttempt, setAutoReconnectAttempt] = useState(0);
  useEffect(() => { apiRef.current?.setVisibility(isActive); }, [isActive]);
  const [status, setStatus] = useState<RdpStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const reconnect = async () => {
    if (!onReconnect) return;
    setErrorMsg("");
    setStatus("loading");
    try { await onReconnect(); }
    catch (error) { setErrorMsg(String(error)); setStatus("error"); }
  };
  /** Schedule the next auto-reconnect; returns false when retries are
   *  exhausted, the session never connected, or no handler exists. */
  const maybeAutoReconnect = (cancelled: () => boolean) => {
    if (cancelled() || !onReconnect || !wasConnectedRef.current) return false;
    if (attemptRef.current >= MAX_AUTO_RECONNECT) return false;
    const next = attemptRef.current + 1;
    attemptRef.current = next;
    setAutoReconnectAttempt(next);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void reconnect();
    }, Math.min(1000 * 2 ** (next - 1), 4000));
    return true;
  };

  /** Send local files to the remote clipboard (paste them over there). */
  const sendFiles = async () => {
    const provider = fileTransferRef.current;
    if (!provider) return;
    try {
      const files = await provider.showFilePicker({ multiple: true });
      if (!files?.length) return;
      setTransferNote(t("dashboard.rdp.sendFiles"));
      provider.uploadFiles(files);
    } catch { /* picker cancelled */ }
  };

  /** Save server-offered clipboard files to a local directory. */
  const saveRemoteFiles = async () => {
    const provider = fileTransferRef.current;
    if (!provider || !remoteFiles.length) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const dir = await open({ directory: true, title: t("dashboard.rdp.saveFiles"), multiple: false });
      if (typeof dir !== "string" || !dir) return;
      const blobs = await provider.downloadFilesConcurrent(remoteFiles);
      let written = 0;
      for (const [index, blob] of blobs) {
        const file = remoteFiles[index];
        if (!file || file.isDirectory) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const rel = safeRemotePath(file.name, file.path);
        const sep = dir.endsWith("/") || dir.endsWith("\\") ? "" : "/";
        await invoke("save_dialog_file", { path: `${dir}${sep}${rel}`, contents: bytes });
        written += 1;
      }
      setTransferNote(`${t("dashboard.rdp.fileTransferDone")} (${written})`);
    } catch (error) {
      setErrorMsg(t("dashboard.rdp.fileTransferFailed", { error: String(error) }));
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await containerRef.current?.requestFullscreen();
    } catch (error) {
      setErrorMsg(String(error));
    }
  };

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    // StrictMode double-mount: cancel a pending teardown from the previous
    // mount before (re)connecting, so the one-time token stays valid.
    cancelDeferredClose(`rdp:${sessionId}`);
    const host = containerRef.current;
    if (!host) return;

    let cancelled = false;

    void (async () => {
      try {
        setStatus("loading");
        const rdp = await import("@devolutions/iron-remote-desktop-rdp");
        // Registers the <iron-remote-desktop> custom element (side effect).
        await import("@devolutions/iron-remote-desktop");
        await (backendInitialization ??= rdp.init("warn").catch((error: unknown) => { backendInitialization = undefined; throw error; }));
        if (cancelled) return;

        const el = document.createElement(
          "iron-remote-desktop",
        ) as HTMLElement & { module?: unknown };
        el.style.width = "100%";
        el.style.height = "100%";
        el.module = withNativeClipboard(rdp.Backend, session => {
          pasteRef.current = async () => {
            const clipboard = await import("@tauri-apps/plugin-clipboard-manager");
            const data = new rdp.Backend.ClipboardData();
            let hasContent = false;
            // Text first — spreadsheet cells often also carry a bitmap.
            try {
              const text = await clipboard.readText();
              if (text) { data.addText("text/plain", text); hasContent = true; }
            } catch { /* clipboard has no text */ }
            if (!hasContent) {
              try {
                const img = await clipboard.readImage();
                const { width, height } = await img.size();
                const rgba = await img.rgba();
                const png = await encodeRgbaAsPng(new Uint8Array(rgba), width, height);
                if (png) { data.addBinary("image/png", png); hasContent = true; }
              } catch { /* clipboard has no image */ }
            }
            if (!hasContent || cancelled || !activeRef.current) return;
            await session.onClipboardPaste(data);
          };
        }, () => !cancelled && activeRef.current, error => {
          if (!cancelled) setErrorMsg(String(error));
        });
        elementRef.current = el;

        // RDP file clipboard (drive-style copy/paste over the virtual
        // channel): the provider registers its own builder extensions and
        // attaches to the session once connected.
        const provider = new rdp.RdpFileTransferProvider();
        fileTransferRef.current = provider;
        provider.on("files-available", (files: RdpRemoteFile[]) => {
          if (!cancelled) setRemoteFiles(files ?? []);
        });
        provider.on("download-progress", (p: { fileName?: string; percentage?: number }) => {
          if (!cancelled) setTransferNote(`${p.fileName ?? ""} ${Math.round(p.percentage ?? 0)}%`);
        });
        provider.on("upload-progress", (p: { fileName?: string; percentage?: number }) => {
          if (!cancelled) setTransferNote(`${p.fileName ?? ""} ${Math.round(p.percentage ?? 0)}%`);
        });
        provider.on("error", (e: { message?: string }) => {
          if (!cancelled) setTransferNote(e.message ?? "transfer error");
        });

        el.addEventListener("ready", (event) => {
          if (cancelled) return;
          const api = (
            event as CustomEvent<{ irgUserInteraction: RdpPublicApi }>
          ).detail.irgUserInteraction;
          apiRef.current = api;
          api.setEnableClipboard(false);
          api.enableFileTransfer(provider);

          const config = api
            .configBuilder()
            .withDestination(destination)
            .withProxyAddress(wsUrl)
            .withAuthToken(sessionId);
          // Always set username/password (empty strings are valid): the WASM
          // session builder requires both fields to be present, and an empty
          // username selects the mstsc-style "logon screen inside the session"
          // flow below. Bastion proxies need the mstshash cookie the connector
          // derives from these fields even when NLA is off.
          config.withUsername(username).withPassword(password);
          if (username || password) {
            // NLA path: credentials in the connection request (mstsc "remember
            // me" style). Domain applies only here — there is no logon screen
            // to type it into when CredSSP is off.
            if (domain) config.withServerDomain(domain);
          } else {
            // No credentials → disable NLA (CredSSP) so the server's own
            // logon screen appears inside the session, like mstsc. Servers
            // that mandate NLA reject the handshake; the error surfaces in
            // the overlay.
            config.withExtension(rdp.enableCredssp(false));
          }
          // Request a desktop sized to the viewer pane (mstsc-style fit);
          // the WASM backend letterboxes inside the canvas afterwards.
          const rect = host.getBoundingClientRect();
          const width = Math.max(640, Math.floor(rect.width) - (Math.floor(rect.width) % 2));
          const height = Math.max(480, Math.floor(rect.height) - (Math.floor(rect.height) % 2));
          config.withDesktopSize(new rdp.Backend.DesktopSize(width, height));
          const built = config.build();

          setStatus("connecting");
          void api
            .connect(built)
            .then((sessionInfo) => {
              if (cancelled) { api.shutdown(); return; }
              api.setVisibility(activeRef.current);
              wasConnectedRef.current = true;
              attemptRef.current = 0;
              setAutoReconnectAttempt(0);
              setStatus("connected");
              const bookmark = savedHostRef.current;
              if (bookmark) {
                savedHostRef.current = undefined;
                void persistProtocolHost(bookmark).then(() => useHostsStore.getState().recordConnection(bookmark.id));
              }
              // Resolves when the RDP session terminates.
              return sessionInfo.run();
            })
            .then(() => {
              if (cancelled) return;
              // Session dropped mid-flight → mstsc-style auto-reconnect.
              if (maybeAutoReconnect(() => cancelled)) return;
              setStatus("disconnected");
            })
            .catch((err: unknown) => {
              if (cancelled) return;
              if (maybeAutoReconnect(() => cancelled)) return;
              setErrorMsg(
                err instanceof Error ? err.message : String(err ?? ""),
              );
              setStatus("error");
            });
        });
        host.appendChild(el);
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err ?? ""));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      try {
        apiRef.current?.shutdown();
      } catch {
        /* already gone */
      }
      try {
        fileTransferRef.current?.dispose();
      } catch {
        /* already gone */
      }
      fileTransferRef.current = null;
      setRemoteFiles([]);
      setTransferNote("");
      elementRef.current?.remove();
      elementRef.current = null;
      apiRef.current = null;
      pasteRef.current = null;
      // Deferred (see deferred-close.ts) so a StrictMode remount that runs
      // this effect again doesn't revoke the token the new mount needs.
      deferClose(`rdp:${sessionId}`, () =>
        invoke("rd_close", { token: sessionId }).catch(() => {
          /* bridge already cleaned it up */
        }),
      );
    };
  }, [wsUrl, destination, username, password, domain, sessionId]);

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-base">
      {status === "connected" && <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1 text-xs text-text-secondary">
        <button className="rounded px-2 py-1 hover:bg-bg-subtle" onClick={() => apiRef.current?.ctrlAltDel()}>Ctrl+Alt+Del</button>
        <button className="rounded px-2 py-1 hover:bg-bg-subtle" onClick={() => void pasteRef.current?.().catch(error => setErrorMsg(String(error)))}>{t("dashboard.protocol.pasteClipboard")}</button>
        <button className="flex items-center gap-1 rounded px-2 py-1 hover:bg-bg-subtle" onClick={() => void sendFiles()} title={t("dashboard.rdp.sendFiles")}><FileUp size={13} />{t("dashboard.rdp.sendFiles")}</button>
        {remoteFiles.length > 0 && isActive && <button className="flex items-center gap-1 rounded px-2 py-1 text-status-warning hover:bg-bg-subtle" onClick={() => void saveRemoteFiles()} title={t("dashboard.rdp.saveFiles")}>
          <FolderDown size={13} />{t("dashboard.rdp.filesOffered", { count: remoteFiles.length })}
        </button>}
        <button className="rounded px-2 py-1 hover:bg-bg-subtle" onClick={() => void toggleFullscreen()} title={isFullscreen ? t("dashboard.rdp.exitFullscreen") : t("dashboard.rdp.fullscreen")}><Maximize2 size={13} /></button>
        {transferNote && <span className="truncate text-text-muted">{transferNote}</span>}
        {errorMsg && <span role="alert" className="truncate text-status-error">{errorMsg}</span>}
      </div>}
      <div ref={containerRef} className="flex-1 min-h-0 relative" />

      {status !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-base/85 backdrop-blur-sm">
          {(status === "loading" || status === "connecting") && (
            <>
              <Loader2 size={28} strokeWidth={2} className="text-text-muted motion-safe:animate-spin" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {autoReconnectAttempt > 0
                  ? t("dashboard.rdp.reconnecting", { attempt: autoReconnectAttempt, max: MAX_AUTO_RECONNECT })
                  : status === "loading"
                    ? t("dashboard.rdp.statusLoading")
                    : t("dashboard.rdp.statusConnecting")}
              </p>
            </>
          )}
          {status === "disconnected" && (
            <>
              <Unplug size={28} strokeWidth={2} className="text-text-muted" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {t("dashboard.rdp.statusDisconnected")}
              </p>
              <div className="flex gap-2">{onReconnect && <button className="flex items-center gap-1 rounded bg-accent px-3 py-1.5 text-sm text-white" onClick={() => void reconnect()}><RefreshCw size={14} />{t("common.retry")}</button>}{onEdit && <button className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-text-secondary hover:bg-bg-subtle" onClick={onEdit}><Pencil size={14} />{t("common.edit")}</button>}</div>
            </>
          )}
          {status === "error" && (
            <>
              <AlertTriangle size={28} strokeWidth={2} className="text-status-error" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {t("dashboard.rdp.statusError")}
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
