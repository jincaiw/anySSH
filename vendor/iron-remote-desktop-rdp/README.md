# Patched `@devolutions/iron-remote-desktop-rdp` WASM

`@devolutions/iron-remote-desktop-rdp@0.7.0` builds the RDP client WASM with
`X.224 Connection Request` only offering `PROTOCOL_SSL` (0x0000_0001) when
NLA is disabled. Some RDP servers — notably the bastion at
`29.1.0.122:33890` mstsc handles correctly — interpret that as "client
won't accept downgrade from NLA to TLS" and respond with `RDP_NEG_FAILURE`
(RST the TCP connection). mstsc ships `RDP | SSL | HYBRID` (0x0000_0003) on
the no-cred path so the server can pick whichever protocol it actually
supports.

The wasm-bindgen ABI is unchanged — the patch touches two files, neither of
which adds/removes any `#[wasm_bindgen]` export/import. So we can splice the
rebuilt WASM into the published bundle without touching the JS glue layer.

1. `crates/ironrdp-connector/src/connection.rs` — advertise `PROTOCOL_HYBRID`
   in the NLA-off branch (see below).
2. `crates/ironrdp-web/src/session.rs` (`build_config`) — set
   `request_data = Some(NegoRequestData::cookie("anyssh"))` when the username
   is empty. Bastion proxies route/validate the X.224 Connection Request by
   the `Cookie: mstshash=` negotiable data (mstsc always sends it) and
   silently close cookie-less requests (field failure on `29.1.0.122:33890`,
   fixed in v0.14.41).

## How it's applied

`package.json` has a `postinstall` step that calls `node patch.mjs`. The
script:

1. Reads `ironrdp_web_bg.wasm` from this directory (4.1 MiB).
2. Locates the inlined `data:application/wasm;base64,…` payload inside
   `node_modules/@devolutions/iron-remote-desktop-rdp/iron-remote-desktop-rdp.js`.
3. Replaces the old base64 with the new one.
4. Fails loudly (exit code 1/2) if the bundle layout has changed upstream,
   so a future upstream release that moves the WASM doesn't silently drop
   the patch.

## Rebuilding the WASM

When upgrading `@devolutions/iron-remote-desktop-rdp` to a newer version:

```sh
# 1. Clone the matching tag
git clone --depth 1 --branch npm-iron-remote-desktop-rdp-vX.Y.Z \
    https://github.com/Devolutions/IronRDP.git \
    vendor/iron-remote-desktop-rdp-src

# 2. Apply the anySSH patch (the file content is in the commit message of
#    v0.14.40; 8 lines in ironrdp-connector/src/connection.rs).

# 3. Build the WASM
cd vendor/iron-remote-desktop-rdp-src/crates/ironrdp-web
wasm-pack build --target web --release

# 4. Drop the new WASM into this directory
cp pkg/ironrdp_web_bg.wasm ../../../vendor/iron-remote-desktop-rdp/ironrdp_web_bg.wasm
```

The 8-line patch is reproduced here for reference (added inside the
existing `if self.config.enable_credssp { … } else { … }` branch):

```rust
} else {
    // [anySSH vendor patch — issue #327 workaround]
    // NLA is off (mstsc-style "no NLA" path, typically with empty creds so the
    // server's logon screen shows inside the session). Advertise every modern
    // protocol (PROTOCOL_RDP is implicit when no flag is set, so the bitmask
    // `SSL | HYBRID` = 0x0000_0003 effectively means "RDP | SSL | HYBRID") so
    // the server can negotiate down to whatever it accepts.
    security_protocol.insert(nego::SecurityProtocol::HYBRID);
}
```
