import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { VncCanvas } from "./VncCanvas";
import { RdpCanvas, safeRemotePath } from "./RdpCanvas";
import { buildProtocolHost } from "../../lib/protocol-hosts";

const mocks = vi.hoisted(() => ({
  clients: [] as Array<EventTarget & { clipboardPasteFrom: ReturnType<typeof vi.fn>; sendCredentials: ReturnType<typeof vi.fn>; approveServer: ReturnType<typeof vi.fn> }>,
  invoke: vi.fn(), write: vi.fn(), read: vi.fn(async () => "local clipboard"),
  save: vi.fn(async () => {}), record: vi.fn(async () => {}),
  visibility: vi.fn(), shutdown: vi.fn(), connect: vi.fn(), init: vi.fn(async () => {}), extension: vi.fn(), withUsername: vi.fn(), withPassword: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: mocks.write, readText: mocks.read }));
vi.mock("../../lib/protocol-hosts", async original => ({ ...await original<typeof import("../../lib/protocol-hosts")>(), persistProtocolHost: mocks.save }));
vi.mock("../../stores/hosts-store", () => ({ useHostsStore: { getState: () => ({ recordConnection: mocks.record }) } }));
vi.mock("./deferred-close", () => ({ cancelDeferredClose: vi.fn(), deferClose: vi.fn() }));
vi.mock("@novnc/novnc", () => ({ default: class extends EventTarget {
  clipboardPasteFrom = vi.fn(); sendCredentials = vi.fn(); approveServer = vi.fn(); disconnect = vi.fn(); focus = vi.fn(); blur = vi.fn();
  constructor() { super(); mocks.clients.push(this); }
} }));
vi.mock("@devolutions/iron-remote-desktop-rdp", () => ({
  init: mocks.init,
  enableCredssp: vi.fn((enable: boolean) => ({ kind: "credssp", enable })),
  Backend: { SessionBuilder: class {}, DesktopSize: class { constructor(public width: number, public height: number) {} } },
  RdpFileTransferProvider: class {
    on = vi.fn();
    dispose = vi.fn();
    showFilePicker = vi.fn();
    uploadFiles = vi.fn();
    downloadFilesConcurrent = vi.fn(async () => new Map());
  },
}));
vi.mock("@devolutions/iron-remote-desktop", () => ({}));

beforeAll(() => {
  customElements.define("iron-remote-desktop", class extends HTMLElement {
    connectedCallback() {
      const builder = { withUsername: (u: string) => { mocks.withUsername(u); return builder; }, withPassword: (p: string) => { mocks.withPassword(p); return builder; }, withDestination: () => builder,
        withProxyAddress: () => builder, withAuthToken: () => builder, withServerDomain: () => builder,
        withDesktopSize: () => builder, withExtension: (ext: unknown) => { mocks.extension(ext); return builder; }, build: () => ({}) };
      this.dispatchEvent(new CustomEvent("ready", { detail: { irgUserInteraction: {
        setEnableClipboard: vi.fn(), ctrlAltDel: vi.fn(), configBuilder: () => builder, connect: mocks.connect, shutdown: mocks.shutdown, setVisibility: mocks.visibility,
        enableFileTransfer: vi.fn(),
      } } }));
    }
  });
});
beforeEach(() => {
  vi.clearAllMocks(); mocks.clients.length = 0;
  mocks.invoke.mockResolvedValue(undefined);
  mocks.connect.mockResolvedValue({ run: () => new Promise(() => {}) });
});

describe("VNC connection lifecycle", () => {
  it("requests credentials and saves only after the server authenticates", async () => {
    const bookmark = buildProtocolHost("vnc", "Test", "localhost", 5900, {});
    render(<VncCanvas sessionId="vnc-test" wsUrl="ws://localhost" isActive savedHost={bookmark} />);
    await waitFor(() => expect(mocks.clients).toHaveLength(1));
    expect(mocks.save).not.toHaveBeenCalled();
    const client = mocks.clients[0];
    act(() => client.dispatchEvent(new CustomEvent("credentialsrequired", { detail: { types: ["username", "password"] } })));
    const inputs = document.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "alice" } });
    fireEvent.change(inputs[1], { target: { value: "secret" } });
    fireEvent.submit(document.querySelector("form")!);
    expect(client.sendCredentials).toHaveBeenCalledWith({ username: "alice", password: "secret" });
    act(() => client.dispatchEvent(new CustomEvent("connect")));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(bookmark));
    expect(mocks.record).toHaveBeenCalledWith(bookmark.id);
  });
  it("uses noVNC's real clipboard API and ignores clipboard events in inactive tabs", async () => {
    const { rerender } = render(<VncCanvas sessionId="vnc-clip" wsUrl="ws://localhost" isActive />);
    await waitFor(() => expect(mocks.clients).toHaveLength(1));
    const client = mocks.clients[0];
    act(() => client.dispatchEvent(new CustomEvent("connect")));
    fireEvent.focus(window);
    await waitFor(() => expect(client.clipboardPasteFrom).toHaveBeenCalledWith("local clipboard"));
    act(() => client.dispatchEvent(new CustomEvent("clipboard", { detail: { text: "remote" } })));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledWith("remote"));
    rerender(<VncCanvas sessionId="vnc-clip" wsUrl="ws://localhost" isActive={false} />);
    mocks.write.mockClear(); mocks.read.mockClear();
    act(() => client.dispatchEvent(new CustomEvent("clipboard", { detail: { text: "inactive" } })));
    fireEvent.focus(window);
    await act(async () => {});
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("requires explicit approval for an RSA server key", async () => {
    render(<VncCanvas sessionId="vnc-verify" wsUrl="ws://localhost" isActive />);
    await waitFor(() => expect(mocks.clients).toHaveLength(1));
    const client = mocks.clients[0];
    act(() => client.dispatchEvent(new CustomEvent("serververification", { detail: { publickey: new Uint8Array([1, 2, 3]) } })));
    const approve = await screen.findByText("Trust and continue");
    expect(client.approveServer).not.toHaveBeenCalled();
    fireEvent.click(approve);
    expect(client.approveServer).toHaveBeenCalledTimes(1);
  });
});

describe("RDP remote clipboard file paths", () => {
  it("drops traversal and drive-prefix segments from server-controlled names", () => {
    expect(safeRemotePath("report.pdf", "docs")).toBe("docs/report.pdf");
    expect(safeRemotePath("report.pdf", "docs\\sub")).toBe("docs/sub/report.pdf");
    expect(safeRemotePath("../../../../tmp/evil.sh")).toBe("tmp/evil.sh");
    expect(safeRemotePath("..\\..\\evil.txt", "..")).toBe("evil.txt");
    expect(safeRemotePath("C:\\Windows\\evil.exe")).toBe("Windows/evil.exe");
    // Windows trims trailing dots, so "..." would become "..".
    expect(safeRemotePath("...")).toBe("unnamed");
    expect(safeRemotePath("..")).toBe("unnamed");
  });
});

describe("RDP component lifecycle", () => {
  it("handles a synchronous ready event and reveals the connected screen, following active tab changes", async () => {
    const bookmark = buildProtocolHost("rdp", "Test", "localhost", 3389, {});
    const props = { sessionId: "rdp-test", wsUrl: "ws://localhost", destination: "localhost:3389", username: "alice", password: "secret", savedHost: bookmark };
    const { rerender, unmount } = render(<RdpCanvas {...props} isActive />);
    await waitFor(() => expect(mocks.visibility).toHaveBeenCalledWith(true));
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(bookmark));
    rerender(<RdpCanvas {...props} isActive={false} />);
    expect(mocks.visibility).toHaveBeenLastCalledWith(false);
    unmount(); expect(mocks.shutdown).toHaveBeenCalled();
  });
  it("does not save a host when authentication fails", async () => {
    mocks.connect.mockRejectedValueOnce(new Error("Authentication failed"));
    render(<RdpCanvas sessionId="rdp-error" wsUrl="ws://localhost" destination="localhost:3389" username="alice" password="bad" isActive
      savedHost={buildProtocolHost("rdp", "Test", "localhost", 3389, {})} />);
    await screen.findByText("Authentication failed");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("connects without credentials and disables CredSSP when username and password are empty", async () => {
    const { enableCredssp } = await import("@devolutions/iron-remote-desktop-rdp") as { enableCredssp: (enable: boolean) => unknown };
    render(<RdpCanvas sessionId="rdp-anon" wsUrl="ws://localhost" destination="localhost:3389" username="" password="" isActive />);
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(1));
    expect(mocks.extension).toHaveBeenCalledWith(enableCredssp(false));
    // Empty credentials must still reach the WASM session builder (it
    // requires both fields; the connector derives the mstshash cookie path).
    expect(mocks.withUsername).toHaveBeenCalledWith("");
    expect(mocks.withPassword).toHaveBeenCalledWith("");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
