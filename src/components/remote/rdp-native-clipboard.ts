import type { Backend } from "@devolutions/iron-remote-desktop-rdp";

type RdpSession = Awaited<ReturnType<InstanceType<typeof Backend.SessionBuilder>["connect"]>>;

/** Use the OS clipboard in WKWebView without patching browser globals.
 *  Remote → local handles both text and PNG images (mstsc copies often
 *  carry both formats; text wins so pasting a cell keeps it textual). */
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
        const text = data.items().find(item => item.mimeType() === "text/plain");
        if (text) {
          const value = String(text.value());
          void import("@tauri-apps/plugin-clipboard-manager").then(({ writeText }) => {
            if (isActive()) return writeText(value);
          }).catch(onError);
          return;
        }
        const image = data.items().find(item => item.mimeType() === "image/png" && item.value() instanceof Uint8Array);
        if (image) {
          const bytes = image.value() as Uint8Array;
          void import("@tauri-apps/plugin-clipboard-manager").then(async ({ writeImage }) => {
            if (!isActive()) return;
            const { Image } = await import("@tauri-apps/api/image");
            const decoded = await Image.fromBytes(bytes);
            return writeImage(decoded);
          }).catch(onError);
        }
      });
      const session = await super.connect();
      onSession(session);
      return session;
    }
  } };
}

/** Encode raw RGBA pixels as PNG bytes via an off-screen canvas (used to push
 *  a locally copied screenshot into the RDP clipboard). Returns null when the
 *  environment can't encode (tests). */
export async function encodeRgbaAsPng(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
  if (typeof document === "undefined" || width <= 0 || height <= 0) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return new Uint8Array(await blob.arrayBuffer());
}
