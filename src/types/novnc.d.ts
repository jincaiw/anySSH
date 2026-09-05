// @novnc/novnc ships no TypeScript types — declare the minimal surface the
// VNC canvas uses (P3). Events use `any` payloads because noVNC dispatches
// CustomEvents with `detail` (e.g. { clean: boolean }, { text: string }).
declare module "@novnc/novnc" {
  export default class RFB {
    constructor(
      target: HTMLElement,
      urlOrChannel: string | WebSocket,
      options?: Record<string, unknown>,
    );
    disconnect(): void;
    clipboardPasteFrom(text: string): void;
    sendCredentials(credentials: Record<string, string>): void;
    sendCtrlAltDel(): void;
    focus(options?: { preventScroll?: boolean }): void;
    blur(): void;
    scaleViewport: boolean;
    resizeSession: boolean;
    viewOnly: boolean;
    background: string;
    addEventListener(type: string, listener: (event: CustomEvent) => void): void;
    removeEventListener(
      type: string,
      listener: (event: CustomEvent) => void,
    ): void;
  }
}
