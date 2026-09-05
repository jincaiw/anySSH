import type { Backend } from "@devolutions/iron-remote-desktop-rdp";

type RdpSession = Awaited<ReturnType<InstanceType<typeof Backend.SessionBuilder>["connect"]>>;

/** Use the OS clipboard in WKWebView without patching browser globals. */
export function withNativeClipboard(
  backend: typeof Backend,
  onSession: (session: RdpSession) => void,
  isActive: () => boolean,
  onError: (error: unknown) => void,
): typeof Backend {
  return { ...backend, SessionBuilder: class extends backend.SessionBuilder {
    async connect() {
      this.remoteClipboardChangedCallback((data: InstanceType<typeof Backend.ClipboardData>) => {
        if (!isActive()) return;
        const item = data.items().find(item => item.mimeType() === "text/plain");
        if (!item) return;
        const text = String(item.value());
        void import("@tauri-apps/plugin-clipboard-manager").then(({ writeText }) => {
          if (isActive()) return writeText(text);
        }).catch(onError);
      });
      const session = await super.connect();
      onSession(session);
      return session;
    }
  } };
}
