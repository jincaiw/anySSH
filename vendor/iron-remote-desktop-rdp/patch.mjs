#!/usr/bin/env node
// postinstall: splice the patched WASM (built from a vendored copy of
// @devolutions/iron-remote-desktop-rdp with the anySSH "advertise every
// protocol when NLA is off" patch — see vendor/iron-remote-desktop-rdp-src
// and crates/ironrdp-connector/src/connection.rs) into the npm-installed
// iron-remote-desktop-rdp.js, which inlines the WASM as a base64 data URL.
//
// Why a postinstall instead of a fork package: pnpm in CI re-fetches the
// upstream package from the registry, which would clobber any local fork
// unless we use `file:`. The postinstall approach keeps the upstream
// package.json / .d.ts intact and only swaps the WASM bytes (the
// wasm-bindgen ABI is unchanged because the patch doesn't add or remove
// any #[wasm_bindgen] export/import).
//
// Failures here are loud: a mismatch would mean the connector X.224 still
// only advertises PROTOCOL_SSL, and the bastion would keep RST-ing.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const wasmPath = resolve(here, "ironrdp_web_bg.wasm");
const bundlePath = resolve(
  repoRoot,
  "node_modules/@devolutions/iron-remote-desktop-rdp/iron-remote-desktop-rdp.js",
);

if (!existsSync(wasmPath)) {
  console.error(`[anySSH rdp patch] vendored WASM not found at ${wasmPath}`);
  process.exit(1);
}
if (!existsSync(bundlePath)) {
  console.warn(
    `[anySSH rdp patch] upstream bundle not present at ${bundlePath} — skipping (probably installed in a different shape).`,
  );
  process.exit(0);
}

const newB64 = readFileSync(wasmPath).toString("base64");
let js = readFileSync(bundlePath, "utf8");
const re = /data:application\/wasm;base64,[A-Za-z0-9+/=]+/g;
const matches = js.match(re);
if (!matches || matches.length !== 1) {
  console.error(
    `[anySSH rdp patch] expected exactly 1 inline WASM, found ${matches?.length ?? 0} — bundle layout changed?`,
  );
  process.exit(2);
}
const oldMarker = matches[0];
const newMarker = `data:application/wasm;base64,${newB64}`;
js = js.replace(oldMarker, newMarker);
writeFileSync(bundlePath, js);
console.log(
  `[anySSH rdp patch] spliced patched WASM into iron-remote-desktop-rdp.js (${oldMarker.length} → ${newMarker.length} base64 chars)`,
);
