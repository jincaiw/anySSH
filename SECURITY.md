# Security Policy

anySSH is a desktop client that stores SSH credentials and establishes
trusted connections to remote hosts, so we take reports about its security
seriously and appreciate responsible disclosure.

## Supported versions

Security fixes are issued against the **latest published release** only.
Please reproduce on the newest version from
[Releases](https://github.com/jincaiw/anySSH/releases/latest) before reporting —
older builds are not patched.

| Version | Supported |
|---|---|
| Latest release | :white_check_mark: |
| Older releases | :x: |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use either private channel:

1. **GitHub private advisory (preferred)** —
   [Report a vulnerability](https://github.com/jincaiw/anySSH/security/advisories/new).
   This keeps the discussion private and lets us publish a coordinated advisory.
2. **Email** — `jincaiw@users.noreply.github.com`.

Please include, as far as you can:

- affected version and platform (macOS / Windows / Linux),
- a description of the impact and the attack scenario,
- reproduction steps or a proof of concept,
- any suggested remediation.

## What to expect

- Acknowledgement of your report.
- An assessment of severity and affected versions.
- Credit in the published advisory once a fix ships, unless you prefer to
  remain anonymous.

Please give us a reasonable window to release a fix before any public
disclosure.

## Scope

In scope:

- the anySSH desktop application (Rust backend in `src-tauri/`, React frontend
  in `src/`),
- credential storage (`src-tauri/src/vault/`) and the OS-keychain integration,
- the SSH / SFTP / SCP / Telnet / serial / RDP / VNC protocol implementations
  and the local-terminal PTY handling,
- the WebSocket bridges used for RDP and VNC (`src-tauri/src/remote/bridge.rs`),
- the auto-updater signing and verification path.

Out of scope:

- vulnerabilities in the remote hosts or services anySSH connects to,
- issues that require an already-compromised local machine or physical access,
- findings that depend on a user deliberately connecting to a malicious
  server, unless they cross a trust boundary anySSH is expected to enforce,
- missing hardening that has no demonstrated impact.

## Telemetry

anySSH sends anonymous usage counters to PostHog. The user-facing description
lives in the README's "Telemetry" section; for anyone auditing the app's
network surface, the facts that matter are:

- Exactly one kind of outbound request: an HTTPS `POST` to
  `https://us.i.posthog.com/capture/` per event, fire-and-forget. The
  application itself makes no other outbound request.
- Payload: an event name, coarse counters and flags, the app version, OS and
  CPU architecture, plus a per-install random UUID persisted as `.device_id`.
  Fifty-one events are defined, none of which carries a hostname, username,
  file path, file name, bucket or object name, snippet body, or credential.
- The endpoint observes the source IP address and records coarse IP-based
  geolocation.
- Suppressed entirely when `ANYSSH_DISABLE_TELEMETRY` is set -- the HTTP client
  is then never constructed (`src-tauri/src/telemetry.rs`).
- There is currently **no in-app switch**; the environment variable is the only
  opt-out.

A telemetry payload that ever includes a credential, hostname, path or file
name is a security bug -- please report it as one.

## Known accepted advisories

These are knowingly carried and documented rather than silently ignored. See
`deny.toml` at the repository root for the machine-readable list.

- `RUSTSEC-2026-0194` / `RUSTSEC-2026-0195` (`quick-xml`, denial of service).
  Reached through `aws-creds` → `rust-s3` when parsing S3 XML responses. The
  fixed release (`quick-xml >= 0.41`) is outside the version range pinned by
  the newest published `aws-creds` (`0.39.1`) and `rust-s3` (`0.37.2`), so it
  cannot be upgraded without forking or replacing the S3 client. Impact is
  limited to a client-side denial of service when a user connects to a
  malicious or compromised S3 endpoint; there is no confidentiality or
  integrity impact.
- `RUSTSEC-2023-0071` (`rsa`, Marvin timing sidechannel). Reached through
  `russh`'s `rsa` feature and `ssh-key`. There is no upstream fix. Disabling
  the feature would also drop RSA host-key verification and RSA key
  authentication, which many servers still require, so the feature is kept.
  The advisory targets RSA *decryption* oracles; anySSH performs signature
  verification and client-side signing, which is not the attack surface
  described.

## Dependency auditing

`deny.toml` configures [`cargo-deny`](https://embarkstudios.github.io/cargo-deny/)
and is enforced in CI (`Dependency audit (cargo-deny)` job in
`.github/workflows/ci.yml`), so a newly published advisory against any
dependency fails the build unless it is explicitly accepted with a documented
reason.

The same job also gates **licences**. `deny.toml`'s `[licenses]` allow-list is
permissive-only, so a dependency that is copyleft-only stops the release
instead of shipping unnoticed. Copyleft licences do appear in the resolved
graph -- `unescaper` is `MIT OR GPL-3.0-only`, `r-efi` is
`MIT OR Apache-2.0 OR LGPL-2.1-or-later` -- but only as unused alternatives,
which cargo-deny satisfies through the MIT/Apache branch. `MPL-2.0`
(`attohttpc`, `cssparser`, `option-ext`, `selectors`, `serialport`,
`dtoa-short`) is file-level copyleft and imposes no obligation on anySSH as an
unmodified consumer.
