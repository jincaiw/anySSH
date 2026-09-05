//! Remote graphics layer (VNC / RDP): the shared WebSocket bridge.
//!
//! The webview renders noVNC (and later ironrdp-web) directly; the backend
//! only provides a local byte-pipe (§3.7):
//!
//! * one lazily-started `TcpListener` bound to **127.0.0.1** only;
//! * URL paths carry a one-time CSPRNG token (`/vnc/<token>`,
//!   `/rdp/<token>` later) — consumed on first use, never reusable;
//! * `/vnc/<token>` is a plain byte passthrough to the target VNC server
//!   (websockify semantics — no protocol parsing);
//! * when the last pending token and active session are gone, the listener
//!   shuts itself down after 30 s of idleness.

pub mod bridge;
pub mod commands;
pub mod rdp;
