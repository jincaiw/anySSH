import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildProtocolHost, protocolParams } from "./protocol-hosts";
import { duplicateTerminal, terminalCommand } from "./terminal-transport";
import { useSessionStore } from "../stores/session-store";

const invoke = vi.hoisted(() => vi.fn(async () => "new-session"));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => { invoke.mockClear(); useSessionStore.setState({ sessions: new Map(), tabs: new Map() }); });
describe("protocol bookmark parameters", () => {
  it("uses edited address/port and explicit UTF-8 over stale serialized settings", () => {
    const host = buildProtocolHost("telnet", "edited", "new.example", 2323, { host: "old.example", port: 23, encoding: "gbk", scriptCredentialId: "vault-id" });
    host.terminal_encoding = "utf-8";
    expect(protocolParams(host)).toMatchObject({ host: "new.example", port: 2323, encoding: "utf-8", scriptCredentialId: "vault-id" });
    expect(host.force_session_log).toBe(false);
  });
  it("preserves advanced serial parameters while using the edited device", () => {
    const host = buildProtocolHost("serial", "serial", "/dev/ttyUSB1", 0, { port: "/dev/ttyUSB0", baud: 9600, dataBits: 7, parity: "even" });
    expect(protocolParams(host)).toMatchObject({ port: "/dev/ttyUSB1", baud: 9600, dataBits: 7, parity: "even" });
  });
  it("rejects corrupt parameters", () => {
    const host = buildProtocolHost("telnet", "bad", "localhost", 23, []);
    expect(() => protocolParams(host)).toThrow();
  });
});
describe("terminal transport routing", () => {
  for (const kind of ["local", "telnet", "serial", "ssh"] as const) {
    it(`routes ${kind} input and resize to its owning manager`, () => {
      useSessionStore.getState().addSession("session", { host: "localhost", port: 23, username: "", auth_method: { type: "password", password: "" } }, kind);
      expect(terminalCommand("session", "ssh_send_input", "term_send")).toBe(kind === "ssh" ? "ssh_send_input" : "term_send");
      expect(terminalCommand("session", "ssh_resize_pty", "term_resize")).toBe(kind === "ssh" ? "ssh_resize_pty" : "term_resize");
    });
  }
  it("rejects serial splits but permits serial reconnect", async () => {
    useSessionStore.getState().addSession("serial", { host: "COM3", port: 0, username: "", auth_method: { type: "password", password: "" } }, "serial");
    await expect(duplicateTerminal("serial")).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
    await duplicateTerminal("serial", true);
    expect(invoke).toHaveBeenCalledWith("term_duplicate", { sourceSessionId: "serial", reconnect: true });
  });
});
