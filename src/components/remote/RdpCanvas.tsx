import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, Unplug } from "lucide-react";
import { useTranslation } from "../../i18n";

interface RdpCanvasProps {
  /** RDP session id — the one-time bridge token handed out by `rd_open`. */
  sessionId: string;
  /** Loopback WebSocket endpoint: ws://127.0.0.1:<port>/rdp/<token> */
  wsUrl: string;
  destination: string;
  username: string;
  password: string;
  isActive: boolean;
}

/** Minimal shape of the component's PublicAPI (config builder chains). */
interface RdpPublicApi {
  shutdown: () => void;
  connect: (config: unknown) => Promise<{ run: () => Promise<unknown> }>;
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
  build: () => unknown;
}

type RdpStatus = "loading" | "connecting" | "connected" | "disconnected" | "error";

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
export function RdpCanvas({
  sessionId,
  wsUrl,
  destination,
  username,
  password,
}: RdpCanvasProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const apiRef = useRef<{
    shutdown: () => void;
  } | null>(null);
  const [status, setStatus] = useState<RdpStatus>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    let cancelled = false;

    void (async () => {
      try {
        setStatus("loading");
        const rdp = await import("@devolutions/iron-remote-desktop-rdp");
        // Registers the <iron-remote-desktop> custom element (side effect).
        await import("@devolutions/iron-remote-desktop");
        await rdp.init("warn");
        if (cancelled) return;

        const el = document.createElement(
          "iron-remote-desktop",
        ) as HTMLElement & { module?: unknown };
        el.style.width = "100%";
        el.style.height = "100%";
        el.module = rdp.Backend;
        elementRef.current = el;
        host.appendChild(el);

        el.addEventListener("ready", (event) => {
          if (cancelled) return;
          const api = (
            event as CustomEvent<{ irgUserInteraction: RdpPublicApi }>
          ).detail.irgUserInteraction;
          apiRef.current = api;

          const config = api
            .configBuilder()
            .withUsername(username)
            .withPassword(password)
            .withDestination(destination)
            .withProxyAddress(wsUrl)
            .withAuthToken(sessionId)
            .build();

          setStatus("connecting");
          void api
            .connect(config)
            .then((sessionInfo) => {
              if (cancelled) return;
              setStatus("connected");
              // Resolves when the RDP session terminates.
              return sessionInfo.run();
            })
            .then(() => {
              if (!cancelled) setStatus("disconnected");
            })
            .catch((err: unknown) => {
              if (cancelled) return;
              setErrorMsg(
                err instanceof Error ? err.message : String(err ?? ""),
              );
              setStatus("error");
            });
        });
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : String(err ?? ""));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      try {
        apiRef.current?.shutdown();
      } catch {
        /* already gone */
      }
      elementRef.current?.remove();
      elementRef.current = null;
      apiRef.current = null;
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("rd_close", { token: sessionId });
        } catch {
          /* bridge already cleaned it up */
        }
      })();
    };
  }, [wsUrl, destination, username, password, sessionId]);

  return (
    <div className="absolute inset-0 flex flex-col bg-bg-base">
      <div ref={containerRef} className="flex-1 min-h-0 relative" />

      {status !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-base/85 backdrop-blur-sm">
          {status === "loading" && (
            <>
              <Loader2 size={28} strokeWidth={2} className="text-text-muted motion-safe:animate-spin" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {t("dashboard.rdp.statusLoading")}
              </p>
            </>
          )}
          {status === "connecting" && (
            <>
              <Loader2 size={28} strokeWidth={2} className="text-text-muted motion-safe:animate-spin" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {t("dashboard.rdp.statusConnecting")}
              </p>
            </>
          )}
          {status === "disconnected" && (
            <>
              <Unplug size={28} strokeWidth={2} className="text-text-muted" aria-hidden="true" />
              <p className="text-[length:var(--text-sm)] text-text-secondary">
                {t("dashboard.rdp.statusDisconnected")}
              </p>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
