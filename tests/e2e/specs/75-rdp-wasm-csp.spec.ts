// RDP WASM boot under the app Content-Security-Policy.
//
// `tauri.conf.json` sets a real CSP (`app.security.csp`). Three of its
// directives exist solely for the RDP viewer — see the comment block at the top
// of `src/components/remote/RdpCanvas.tsx`:
//
//   script-src  'wasm-unsafe-eval'      compile the ironrdp WASM module
//   connect-src data:                   `fetch()` the inline `data:…wasm` blob
//   connect-src ws://127.0.0.1:*        our loopback /rdp/<token> bridge
//
// The `data:` one is the easy one to lose: `fetch()` on a `data:` URL is
// checked against `connect-src`, and neither `'self'` nor `*` covers that
// scheme — it has to be listed by name. Drop it and `rdp.init()` rejects before
// `host.appendChild(el)`, so the viewer never mounts at all.
//
// Why the runtime checks and not just a static read of the config: on WebKit
// the CSP `'wasm-unsafe-eval'` gate was historically only enforced at *instance
// creation*, so a config typo can hide behind one particular engine. The probes
// below exercise the exact call shapes the package uses and read the resulting
// `securitypolicyviolation` events, so a failure says which directive bit.
//
// The `ws://` half of `connect-src` is deliberately NOT re-tested here:
// `73-protocol-connections.spec.ts` drives a real VNC session through that same
// loopback bridge, and every spec in the suite proves the app boots at all under
// this policy (`Tauri IPC` → `ipc:`/`http://ipc.localhost`).

import { expect } from "chai";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { waitForDashboard } from "../helpers/dashboard.js";

/** Repo root — found by walking up, so this works from `tests/e2e` (CI) or the
 *  repo root (local `pnpm wdio`), and without depending on the module system. */
function repoRoot(): string {
    let dir = process.cwd();
    for (let depth = 0; depth < 5; depth += 1) {
        if (existsSync(join(dir, "src-tauri", "tauri.conf.json"))) return dir;
        dir = dirname(dir);
    }
    throw new Error(`could not find src-tauri/tauri.conf.json above ${process.cwd()}`);
}

/** `"a x y; b z"` → `{"a": ["x","y"], "b": ["z"]}`. */
function parseCsp(policy: string): Map<string, string[]> {
    const directives = new Map<string, string[]>();
    for (const part of policy.split(";")) {
        const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean);
        if (name) directives.set(name.toLowerCase(), sources);
    }
    return directives;
}

const config = JSON.parse(
    readFileSync(join(repoRoot(), "src-tauri", "tauri.conf.json"), "utf8"),
) as { app?: { security?: { csp?: string | null } } };
const csp = config.app?.security?.csp ?? null;

/** Minimal valid module: `\0asm` magic + version 1, no sections. */
const EMPTY_MODULE = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

interface WasmProbe {
    state: "pending" | "ok" | "failed";
    detail: string;
    violations: string[];
}

describe("RDP WASM under the Content-Security-Policy", () => {
    it("keeps the three directives the RDP viewer depends on", () => {
        expect(csp, "app.security.csp must not be null — the app would ship with no policy").to.be.a("string");
        const directives = parseCsp(csp as string);

        expect(directives.get("script-src"), "script-src").to.include("'wasm-unsafe-eval'");
        expect(directives.get("connect-src"), "connect-src").to.include("data:");
        expect(directives.get("connect-src"), "connect-src").to.include("ws://127.0.0.1:*");
        // Not RDP-specific, but the app is a local-only client: widening these
        // would mean something crept into the bundle that does not belong there.
        expect(directives.get("object-src"), "object-src").to.deep.equal(["'none'"]);
        expect(directives.get("base-uri"), "base-uri").to.include("'self'");
    });

    it("instantiates the RDP WASM in the real webview (fetch data: + compile)", async () => {
        await waitForDashboard();

        await browser.execute((bytes: number[]) => {
            const scope = window as unknown as { __cspWasmProbe?: WasmProbe };
            const probe: WasmProbe = { state: "pending", detail: "", violations: [] };
            scope.__cspWasmProbe = probe;

            // Any blocked directive lands here, which makes the failure message
            // name the offending one instead of just "it threw".
            document.addEventListener("securitypolicyviolation", (event) => {
                const violation = event as SecurityPolicyViolationEvent;
                probe.violations.push(
                    `${violation.violatedDirective} blocked '${violation.blockedURI}'`,
                );
            });

            const module = new Uint8Array(bytes);
            const dataUrl = `data:application/wasm;base64,${btoa(String.fromCharCode(...module))}`;

            void (async () => {
                // 1. connect-src: this is literally how wasm-bindgen's
                //    `__wbg_init` loads ironrdp — `fetch()` on an inline data URL.
                const response = await fetch(dataUrl);
                // 2. script-src: compile + instantiate from the raw bytes.
                await WebAssembly.instantiate(module);
                // 3. The production call shape (streaming off the fetch above).
                const streamed = await WebAssembly.instantiateStreaming(response, {});
                if (!streamed.instance) throw new Error("instantiateStreaming produced no instance");
                probe.state = "ok";
            })().catch((error: unknown) => {
                probe.state = "failed";
                probe.detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
            });
        }, EMPTY_MODULE);

        await browser.waitUntil(
            async () => {
                const state = (await browser.execute(
                    () => (window as unknown as { __cspWasmProbe?: WasmProbe }).__cspWasmProbe?.state,
                )) as WasmProbe["state"] | undefined;
                return state !== "pending";
            },
            { timeout: 20_000, timeoutMsg: "the WASM probe never settled" },
        );

        const probe = (await browser.execute(
            () => (window as unknown as { __cspWasmProbe?: WasmProbe }).__cspWasmProbe,
        )) as WasmProbe;

        expect(
            probe.state,
            `WASM blocked under the app CSP — ${probe.detail || "no error"}${probe.violations.length ? ` | violations: ${probe.violations.join(", ")}` : ""}`,
        ).to.equal("ok");
        expect(probe.violations, "CSP violations reported while probing WASM").to.deep.equal([]);
    });
});
