import { startVncFixture } from "../fixtures/vnc-server.js";
import { expect } from "chai";
import { createServer, type Server, type Socket } from "node:net";
import { resetApp } from "../helpers/reset.js";
import { waitForDashboard } from "../helpers/dashboard.js";
import { readTerminalText, typeIntoTerminal, waitForAnyTerminal, waitForTerminalText } from "../helpers/terminal.js";

async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    return browser.execute(async (cmd, payload) => {
        const ipc = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: Record<string, unknown>) => Promise<unknown> } }).__TAURI_INTERNALS__;
        return ipc.invoke(cmd, payload);
    }, command, args) as Promise<T>;
}

describe("new protocol connections", () => {
    let server: Server;
    let port: number;
    let authenticated = 0;
    const sockets = new Set<Socket>();
    before(async () => {
        server = createServer(socket => {
            sockets.add(socket);
            socket.on("close", () => sockets.delete(socket));
            socket.on("error", () => {});
            socket.write("FIRST_PROTOCOL_BANNER\r\nlogin: ");
            socket.on("data", data => {
                if (data.toString().includes("protocol-secret")) { authenticated++; socket.write("SCRIPT_AUTHENTICATED\r\n"); }
                else socket.write(`SERVER_RECEIVED:${data.toString()}\r\n`);
            });
        });
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        port = (server.address() as { port: number }).port;
    });
    after(async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });
    beforeEach(async () => { authenticated = 0; await resetApp(); await waitForDashboard(); });

    it("opens a real local PTY, sends input through xterm and routes logging/split/close commands", async () => {
        await (await $("[data-testid='new-local-terminal-button']")).click();
        const id = await waitForAnyTerminal();
        // Result differs from typed command, so this cannot pass on terminal echo.
        await typeIntoTerminal(id, "printf 'LOCAL_%s_OK\\n' TRANSPORT");
        await (await $(".xterm-helper-textarea")).click();
        await browser.keys(["Enter"]);
        await waitForTerminalText(id, "LOCAL_TRANSPORT_OK");
        const log = await invoke<{ active: boolean }>("term_session_log_status", { sessionId: id });
        expect(log.active).to.equal(false);
        const duplicate = await invoke<string>("term_duplicate", { sourceSessionId: id, reconnect: false });
        expect(duplicate).not.to.equal(id);
        await invoke("term_close", { sessionId: duplicate });
        const tab = await $("[data-tab-type='terminal']");
        await tab.moveTo();
        await (await $("[data-tab-type='terminal'] [data-testid$='-close']")).click();
        await browser.waitUntil(async () => {
            const terminal = await $(`[data-testid="terminal-${id}"]`);
            return !(await terminal.isExisting());
        });
    });

    it("retains the first Telnet banner and sends terminal input to the Telnet transport", async () => {
        await (await $("[data-testid='new-telnet-button']")).click();
        await (await $("[data-testid='telnet-host-input']")).setValue("127.0.0.1");
        await (await $("[data-testid='telnet-port-input']")).setValue(String(port));
        await (await $("[data-testid='telnet-connect-button']")).click();
        const id = await waitForAnyTerminal();
        await waitForTerminalText(id, "FIRST_PROTOCOL_BANNER");
        await typeIntoTerminal(id, "terminal-input\r");
        await waitForTerminalText(id, "SERVER_RECEIVED:terminal-input");
        expect(await readTerminalText(id)).to.include("FIRST_PROTOCOL_BANNER");
    });

    it("edits saved Telnet parameters through the shared editor and reconnects to the new address", async () => {
        await (await $("[data-testid='new-telnet-button']")).click();
        await (await $("[data-testid='telnet-host-input']")).setValue("old.invalid");
        await (await $("[data-testid='telnet-port-input']")).setValue("23");
        await (await $("[data-testid='protocol-save-button']")).click();
        await waitForDashboard();
        const hosts = await invoke<Array<{ id: string }>>("list_hosts");
        const id = hosts[0].id;
        await browser.execute((hostId: string) => {
            (window as unknown as { __e2eOpenHostEdit: (id: string) => void }).__e2eOpenHostEdit(hostId);
        }, id);
        await (await $("[data-testid='telnet-connect-modal']")).waitForDisplayed();
        await (await $("[data-testid='telnet-host-input']")).setValue("127.0.0.1");
        await (await $("[data-testid='telnet-port-input']")).setValue(String(port));
        await (await $("[data-testid='protocol-save-button']")).click();
        const saved = (await invoke<Array<{ id: string; host: string; params_json: string }>>("list_hosts"))[0];
        expect(saved.id).to.equal(id);
        expect(saved.host).to.equal("127.0.0.1");
        expect(JSON.parse(saved.params_json).port).to.equal(port);
        await (await $(`[data-testid="host-card-${id}-terminal"]`)).click();
        const sessionId = await waitForAnyTerminal();
        await waitForTerminalText(sessionId, "FIRST_PROTOCOL_BANNER");
    });

    it("renders real VNC framebuffer pixels and forwards keyboard input", async () => {
        const fixture = await startVncFixture();
        try {
            await (await $("[data-testid='new-vnc-button']")).click();
            await (await $("[data-testid='vnc-host-input']")).setValue("127.0.0.1");
            await (await $("[data-testid='vnc-port-input']")).setValue(String(fixture.port));
            await (await $("[data-testid='vnc-connect-button']")).click();
            await browser.waitUntil(async () => browser.execute(() => {
                const canvas = document.querySelector("canvas");
                if (!canvas || canvas.width !== 64) return false;
                const pixel = canvas.getContext("2d")?.getImageData(0, 0, 1, 1).data;
                return pixel?.[0] === 32 && pixel[1] === 96 && pixel[2] === 160;
            }), { timeout: 15000, timeoutMsg: "VNC framebuffer was not rendered" });
            await (await $("canvas")).click();
            await browser.keys(["a"]);
            await browser.waitUntil(async () => fixture.keyEvents() > 0, { timeout: 5000 });
        } finally { await fixture.close(); }
    });

    it("stores Telnet scripts outside host JSON and opens the saved credential reference", async () => {
        const id = `protocol-${Date.now()}`;
        const host = { id, label: "Script bookmark", host: "127.0.0.1", port, username: "", auth_type: "none", group_id: null,
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(), kind: "telnet",
            params_json: JSON.stringify({ kind: "telnet", host: "127.0.0.1", port, encoding: "utf-8", loginScript: [{ expect: "login:", send: "protocol-secret\\r" }] }) };
        await invoke("save_host", { host });
        const hosts = await invoke<Array<{ id: string; params_json: string }>>("list_hosts");
        const saved = hosts.find(item => item.id === id)!;
        expect(saved.params_json).not.to.include("protocol-secret");
        expect(saved.params_json).not.to.include("loginScript");
        expect(JSON.parse(saved.params_json).scriptCredentialId).to.equal(id);
        const sessionId = await invoke<string>("term_open", { params: JSON.parse(saved.params_json), cols: 80, rows: 24 });
        await invoke("term_start", { sessionId });
        await browser.waitUntil(async () => {
            // The socket receives the decrypted script; opening alone cannot satisfy this check.
            return authenticated > 0;
        }, { timeout: 5000 });
        await invoke("term_close", { sessionId });
    });
});
