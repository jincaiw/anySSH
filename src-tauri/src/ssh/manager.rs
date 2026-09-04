use crate::types::{
    AuthMethod, ConnectionStatus, HostConfig, SessionId, SshError, SshStatusPayload,
};
use dashmap::DashMap;
use russh::client;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;
use tracing::info;

use super::encoding::{valid_lang, SessionSettings};
use super::handler::SshClientHandler;
use super::session::SshSession;
use super::sessionlog::{SessionLogContext, SessionLogOptions};

/// The target handle plus the chain of jump-host handles that must outlive it
/// (deepest hop first, empty for a direct connection).
type EstablishedConn = (
    client::Handle<SshClientHandler>,
    Vec<client::Handle<SshClientHandler>>,
);

/// Boxed, `Send` future for the recursive [`SshManager::establish`]. Boxing is
/// required because the recursion makes the future type self-referential.
type EstablishFuture<'a> =
    Pin<Box<dyn Future<Output = Result<EstablishedConn, SshError>> + Send + 'a>>;

/// A bare (PTY-less) SSH connection used by the SFTP layer.
struct BareConn {
    /// The authenticated target handle, shared with the SFTP layer.
    handle: Arc<tokio::sync::Mutex<client::Handle<SshClientHandler>>>,
    /// When the target is reached through a ProxyJump chain, the jump-host
    /// handles (one per hop) are stored here so the tunnel underneath stays
    /// open. They are never locked — merely keeping them alive prevents russh
    /// from tearing down the tunnel.
    _jump_handles: Vec<client::Handle<SshClientHandler>>,
}

/// Manages all active SSH sessions. Stored as Tauri managed state.
pub struct SshManager {
    sessions: DashMap<String, SshSession>,
    /// Bare SSH handles for SFTP-only connections (no PTY).
    bare_handles: DashMap<String, BareConn>,
    /// In-flight connection attempts, keyed by the frontend-supplied attempt ID.
    /// A handle exists here only while a `connect`/`connect_no_pty` call is
    /// running; cancelling its token aborts the attempt before any session is
    /// registered, so no ghost session or lingering handle is left behind.
    pending_connects: DashMap<String, CancellationToken>,
}

/// Result of one authentication pass: whether it succeeded, plus a short
/// trail of what was attempted. The trail is user-facing — it goes into the
/// AuthenticationFailed error message verbatim, because the server itself only
/// reports a bare success/failure and field machines often have no `ssh -v`.
struct AuthOutcome {
    authenticated: bool,
    trail: Vec<String>,
    /// True once the dual-factor KI strategy (strategy B) ran. When the
    /// connect then fails with an empty password, the trigger answer has
    /// been delivered and the bastion has likely dispatched the SMS / OTP —
    /// the failure dialog should say so instead of reporting a bare error.
    dual_factor_attempted: bool,
}

impl AuthOutcome {
    fn not_authenticated() -> Self {
        Self {
            authenticated: false,
            trail: Vec::new(),
            dual_factor_attempted: false,
        }
    }

    fn push(&mut self, step: impl Into<String>) {
        self.trail.push(step.into());
    }
}

/// Terminal state of one keyboard-interactive attempt.
enum KiAttemptResult {
    /// Server accepted the credentials mid-challenge.
    Authenticated,
    /// Server explicitly rejected (USERAUTH_FAILURE) — another strategy may
    /// still be tried on the same connection.
    Rejected,
    /// Start timed out, mid-round timed out, or the round budget ran out —
    /// no point continuing keyboard-interactive on this connection.
    Exhausted,
}

/// Max keyboard-interactive challenge rounds per attempt. Dual-factor
/// bastions use 2-3; 8 leaves headroom for multi-prompt appliances.
const MAX_KI_ROUNDS: usize = 8;

/// Non-empty placeholder answered to the dual-factor TRIGGER prompt when the
/// user connects with an empty password. Bastions commonly gate the SMS /
/// OTP challenge on receiving a NON-EMPTY password response (any value —
/// even a deliberately wrong one — fires the code), so an empty answer
/// would silently never trigger the SMS. Only used under strategy B where
/// strategy A already sent the empty string, keeping the two attempts
/// distinct.
const EMPTY_PASSWORD_TRIGGER: &str = "anyssh";

/// Trail entry pushed when the server's auth-method list does not include
/// keyboard-interactive — strategy B (the dual-factor trigger) never runs
/// in that case.
const KI_NOT_OFFERED_TRAIL: &str = "keyboard-interactive not offered by server, skipped";

impl SshManager {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            bare_handles: DashMap::new(),
            pending_connects: DashMap::new(),
        }
    }

    /// Register a cancellation token for an in-flight connection attempt and
    /// return a clone the connect path can await on. Re-registering the same
    /// attempt ID replaces (and orphans) the previous token.
    fn register_pending(&self, attempt_id: String) -> CancellationToken {
        let token = CancellationToken::new();
        self.pending_connects.insert(attempt_id, token.clone());
        token
    }

    /// Drop the pending registration for `attempt_id` once the attempt settles
    /// (succeeded, failed, or was cancelled).
    fn clear_pending(&self, attempt_id: &str) {
        self.pending_connects.remove(attempt_id);
    }

    /// Abort an in-flight connection attempt by its attempt ID. Returns `true`
    /// if a matching attempt was found and signalled. The connect path observes
    /// the cancellation, unwinds its partial state, and removes the registration.
    pub fn cancel_connect(&self, attempt_id: &str) -> bool {
        if let Some(entry) = self.pending_connects.get(attempt_id) {
            entry.cancel();
            true
        } else {
            false
        }
    }

    /// Establish a new SSH connection and return its SessionId.
    ///
    /// `log_options` carries the resolved session-log settings: `Some` means
    /// logging starts the moment the PTY opens (global auto-record enabled
    /// or the host preset forces it); `None` leaves logging off until the
    /// user toggles it manually for this session.
    pub async fn connect(
        &self,
        config: HostConfig,
        app_handle: AppHandle,
        attempt_id: Option<String>,
        settings: SessionSettings,
        log_options: Option<SessionLogOptions>,
    ) -> Result<SessionId, SshError> {
        let session_id = SessionId::new();
        let sid = session_id.0.clone();

        // Arm cancellation for this attempt (if the frontend supplied an ID) so
        // `cancel_connect` can abort it mid-handshake.
        let cancel_token = attempt_id
            .as_ref()
            .map(|id| self.register_pending(id.clone()));

        let _ = app_handle.emit(
            "ssh:status",
            &SshStatusPayload {
                session_id: sid.clone(),
                status: ConnectionStatus::Connecting,
            },
        );

        // Apply per-host overrides on top of the global settings: the host's
        // terminal encoding and LANG win when set (validated — a hand-edited
        // DB row must not inject into `env` requests or shell input).
        let mut settings = settings;
        if let Some(encoding) = config
            .terminal_encoding
            .as_deref()
            .map(str::trim)
            .filter(|e| !e.is_empty())
        {
            if super::encoding::encoding_for_label(encoding) != encoding_rs::UTF_8
                || encoding.eq_ignore_ascii_case("utf-8")
            {
                settings.encoding = encoding.to_string();
            }
        }
        if let Some(lang) = config
            .lang
            .as_deref()
            .map(str::trim)
            .filter(|l| !l.is_empty())
        {
            if valid_lang(lang) {
                settings.lang = lang.to_string();
            } else {
                info!(host = %config.host, lang, "ignoring invalid per-host LANG value");
            }
        }

        let keepalive_secs = config.keep_alive_interval.unwrap_or(0) as u64;
        let russh_config = Arc::new(client::Config {
            // Send SSH keepalive probes rather than arming an inactivity GC timer.
            // `inactivity_timeout` only tears the session down after a quiet
            // window (and sends nothing to prevent it), which would also collapse
            // any ProxyJump tunnel beneath an idle session. `keepalive_interval`
            // proactively keeps the connection — and the tunnel — alive, while
            // `keepalive_max` unanswered probes still detect a genuinely dead peer.
            keepalive_interval: if keepalive_secs > 0 {
                Some(std::time::Duration::from_secs(keepalive_secs))
            } else {
                None // No keepalive — connection stays alive until explicitly closed
            },
            keepalive_max: 3,
            ..super::config::russh_client_config()
        });

        // Establish the connection — directly or tunnelled through a ProxyJump
        // chain. The jump handles must outlive the target session, so they are
        // handed (shared) to the SshSession to keep alive; sharing via Arc lets
        // split panes on the same connection hold the tunnel open too.
        //
        // The whole establish + PTY-open is raced against the cancellation token:
        // if the user cancels, the future is dropped mid-await, which drops any
        // partially-established handles and lets russh tear the connection down.
        // Nothing is inserted into `sessions` until this succeeds, so a cancel
        // leaves no ghost session behind.
        // Session-log context: a fresh logger plus the resolved auto-start
        // options. `open_split_pty` shares the source session's logger so all
        // panes on one connection append to the same log file.
        let log_ctx = super::sessionlog::SessionLogContext {
            logger: super::sessionlog::SessionLogger::new(),
            host: config.host.clone(),
            user: config.username.clone(),
            auto_start: log_options,
        };

        let connect_fut = async {
            let (handle, jump_handles) = Self::establish(&config, russh_config).await?;

            info!(session_id = %sid, host = %config.host, "SSH authenticated");

            SshSession::open_pty(
                handle,
                Arc::new(jump_handles),
                sid.clone(),
                80,
                24,
                app_handle,
                config.default_shell.clone(),
                config.startup_command.clone(),
                settings,
                log_ctx,
            )
            .await
        };

        let outcome = match &cancel_token {
            Some(token) => tokio::select! {
                biased;
                _ = token.cancelled() => Err(SshError::Cancelled),
                r = connect_fut => r,
            },
            None => connect_fut.await,
        };

        if let Some(id) = &attempt_id {
            self.clear_pending(id);
        }

        let session = outcome?;
        self.sessions.insert(sid.clone(), session);

        Ok(session_id)
    }

    /// Establish an SSH connection without opening a PTY.
    /// Used for SFTP-only sessions where no terminal is needed.
    /// Returns a session ID that can be used with `get_handle`.
    pub async fn connect_no_pty(
        &self,
        config: HostConfig,
        attempt_id: Option<String>,
    ) -> Result<SessionId, SshError> {
        let session_id = SessionId::new();
        let sid = session_id.0.clone();

        let cancel_token = attempt_id
            .as_ref()
            .map(|id| self.register_pending(id.clone()));

        let russh_config = Arc::new(client::Config {
            inactivity_timeout: None, // SFTP connections stay alive indefinitely
            ..super::config::russh_client_config()
        });

        // Establish the connection — directly or tunnelled through a ProxyJump —
        // racing against the cancellation token so the user can abort mid-handshake.
        let establish_fut = Self::establish(&config, russh_config);
        let established = match &cancel_token {
            Some(token) => tokio::select! {
                biased;
                _ = token.cancelled() => Err(SshError::Cancelled),
                r = establish_fut => r,
            },
            None => establish_fut.await,
        };

        if let Some(id) = &attempt_id {
            self.clear_pending(id);
        }

        let (handle, jump_handles) = established?;

        info!(session_id = %sid, host = %config.host, "SSH authenticated (no PTY, for SFTP)");

        self.bare_handles.insert(
            sid.clone(),
            BareConn {
                handle: Arc::new(tokio::sync::Mutex::new(handle)),
                _jump_handles: jump_handles,
            },
        );

        Ok(session_id)
    }

    /// Establish a connected + authenticated russh handle for `config`, returning
    /// the target handle plus the chain of jump-host handles that must be kept
    /// alive beneath it (empty for a direct connection).
    ///
    /// When `config.jump_host` is set the connection is tunnelled, and because a
    /// jump host may itself be reached through its own ProxyJump this recurses to
    /// build the *entire* chain (`ssh -J a,b,c target`): each hop opens a
    /// `direct-tcpip` channel to the next over the already-authenticated handle
    /// below it. Every returned jump handle MUST outlive the target session —
    /// dropping one tears down the tunnel above it. Recursion depth is bounded by
    /// the cyclic-reference guard in `build_host_config_blocking`, which resolves
    /// the chain before this runs.
    ///
    /// Returns a boxed future because the recursion makes the future type
    /// self-referential (an `async fn` calling itself cannot size its own future).
    pub(crate) fn establish(
        config: &HostConfig,
        russh_config: Arc<client::Config>,
    ) -> EstablishFuture<'_> {
        Box::pin(async move {
            let Some(jump) = config.jump_host.as_deref() else {
                // Direct connection — no tunnel.
                let addr = format!("{}:{}", config.host, config.port);
                let mut handle = client::connect(russh_config, &addr, SshClientHandler)
                    .await
                    .map_err(|e| SshError::ConnectionFailed(e.to_string()))?;
                Self::authenticate_handle(&mut handle, config).await?;
                return Ok((handle, Vec::new()));
            };

            // 1. Recursively establish the jump connection (it may itself be
            //    tunnelled through its own ProxyJump). Reaching/auth errors are
            //    re-labelled so the failing hop is identifiable.
            let (jump_handle, mut chain) = Self::establish(jump, russh_config.clone())
                .await
                .map_err(|e| match e {
                    SshError::ConnectionFailed(m) => {
                        SshError::ConnectionFailed(format!("tunnel host {}: {m}", jump.host))
                    }
                    SshError::AuthenticationFailed(m) => {
                        SshError::AuthenticationFailed(format!("tunnel host {}: {m}", jump.host))
                    }
                    other => other,
                })?;

            // 2. Open a direct-tcpip channel through the jump host to the target.
            let channel = jump_handle
                .channel_open_direct_tcpip(
                    config.host.clone(),
                    config.port as u32,
                    "127.0.0.1".to_string(),
                    0,
                )
                .await
                .map_err(|e| {
                    SshError::ConnectionFailed(format!(
                        "failed to open tunnel to {}:{}: {e}",
                        config.host, config.port
                    ))
                })?;

            // 3. Run the target SSH session over the tunnelled channel.
            let mut handle =
                client::connect_stream(russh_config, channel.into_stream(), SshClientHandler)
                    .await
                    .map_err(|e| SshError::ConnectionFailed(e.to_string()))?;
            Self::authenticate_handle(&mut handle, config).await?;

            // Keep this hop's handle and everything beneath it alive under the
            // target session.
            chain.push(jump_handle);
            Ok((handle, chain))
        })
    }

    /// Authenticate an already-connected handle using the config's auth method.
    /// Shared by direct and tunnelled connection paths (and the health-check
    /// probe, which authenticates the jump host before tunnelling to the target).
    pub(crate) async fn authenticate_handle(
        handle: &mut client::Handle<SshClientHandler>,
        config: &HostConfig,
    ) -> Result<(), SshError> {
        let outcome = match &config.auth_method {
            AuthMethod::Password { password } => {
                Self::auth_with_password(handle, &config.username, password).await?
            }
            AuthMethod::PrivateKey {
                key_path,
                passphrase,
            } => {
                let key_data = tokio::fs::read_to_string(key_path)
                    .await
                    .map_err(|e| SshError::IoError(e.to_string()))?;

                // Auto-convert PPK to OpenSSH if detected
                let key_data = if super::keys::is_ppk_format(&key_data) {
                    let kp = key_path.clone();
                    let pp = passphrase.clone();
                    tokio::task::spawn_blocking(move || {
                        super::keys::convert_ppk_to_openssh(&kp, pp.as_deref())
                    })
                    .await
                    .map_err(|e| SshError::IoError(format!("task panicked: {e}")))??
                } else {
                    key_data
                };

                Self::auth_with_key_data(handle, &config.username, &key_data, passphrase.as_deref())
                    .await?
            }
            AuthMethod::PrivateKeyData {
                key_data,
                passphrase,
            } => {
                Self::auth_with_key_data(handle, &config.username, key_data, passphrase.as_deref())
                    .await?
            }
        };

        if !outcome.authenticated {
            // The server only returns a bare failure, which is indistinguishable
            // between "wrong password" and "we never got to try the right
            // method". Append the attempt trail so the error dialog itself
            // carries the diagnostics — field machines often have no ssh -v.
            let mut msg = format!(
                "server rejected credentials [username: {}; tried: {}]",
                config.username,
                if outcome.trail.is_empty() {
                    "nothing".to_string()
                } else {
                    outcome.trail.join("; ")
                },
            );
            if let AuthMethod::Password { password } = &config.auth_method {
                if password.is_empty() {
                    // When the empty-password connect was the deliberate
                    // dual-factor SMS trigger and the trigger actually went
                    // out, the appended guidance is the real message.
                    msg.push_str(&Self::empty_password_suffix(&outcome));
                }
            }
            tracing::warn!(host = %config.host, "{msg}");
            return Err(SshError::AuthenticationFailed(msg));
        }
        Ok(())
    }

    /// Truncate a prompt string for the diagnostics trail — bastion banners can
    /// be long, and the error dialog should stay readable.
    fn brief(text: &str) -> String {
        let one_line = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let mut s: String = one_line.chars().take(40).collect();
        if one_line.chars().count() > 40 {
            s.push('…');
        }
        s
    }

    /// Password authentication with a keyboard-interactive fallback.
    ///
    /// Attempt order mirrors PuTTY: keyboard-interactive FIRST, plain
    /// `password` second. Network devices commonly disable the `password`
    /// method outright and/or set a very low `MaxAuthTries` (sometimes 1), so
    /// burning the first attempt on plain `password` can get the connection
    /// disconnected before the working method is ever tried. On standard
    /// OpenSSH servers that don't offer keyboard-interactive, the KI attempt
    /// is rejected instantly and the plain-password attempt follows — only
    /// costing one extra failure against the (generous) default MaxAuthTries.
    ///
    /// Prompts are answered heuristically: a prompt that asks for a
    /// user/login name gets the username, anything else gets the password.
    /// Devices such as H3C/Huawei present *two* prompts ("Username:" /
    /// "Password:") over keyboard-interactive; answering both with the
    /// password fails even with correct credentials.
    ///
    /// Dual-factor bastions (堡垒机) invert the flow: the first password-ish
    /// prompt is a TRIGGER — the bastion fires the dynamic-code challenge
    /// (SMS / OTP / 企业微信) off that answer, and the user then answers the
    /// code prompt with "<static password><dynamic code>" concatenated.
    /// Strategy B answers the trigger with a value that DIFFERS from what
    /// strategy A sent (empty when a password is set, a non-empty dummy
    /// when the password is empty — many bastions only fire the SMS on a
    /// non-empty response), so connecting with an empty password still
    /// triggers the SMS for the next attempt. KI is restarted once with
    /// strategy B before falling back to plain `password`.
    ///
    /// A genuinely wrong password still terminates in `Failure`, so this
    /// cannot mask a bad credential.
    async fn auth_with_password(
        handle: &mut client::Handle<SshClientHandler>,
        username: &str,
        password: &str,
    ) -> Result<AuthOutcome, SshError> {
        let send_err = |e: russh::Error| SshError::AuthenticationFailed(e.to_string());
        let mut outcome = AuthOutcome::not_authenticated();

        // Bound every auth round-trip: a server that silently drops the
        // connection mid-authentication would otherwise hang the await
        // forever (russh's KI reply loop has no terminal None arm).
        const AUTH_STEP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

        // ── 0. `none` probe — exactly what OpenSSH and PuTTY send before
        // their first real attempt. Custom SSH servers (bastion appliances
        // especially) often key their auth state machine off this probe, and
        // its USERAUTH_FAILURE reply carries the methods the server is
        // willing to continue with — the single most useful diagnostic
        // available, since russh otherwise discards it (vendored patch
        // exposes it via `take_last_auth_methods`).
        outcome.push("none probe (OpenSSH-style)");
        let server_methods: Option<Vec<String>> =
            match tokio::time::timeout(AUTH_STEP_TIMEOUT, handle.authenticate_none(username)).await
            {
                Ok(Ok(true)) => {
                    // Server authenticated us without any credential (must be a
                    // wide-open host) — nothing else to do.
                    outcome.authenticated = true;
                    return Ok(outcome);
                }
                Ok(Ok(false)) => handle.take_last_auth_methods(),
                Ok(Err(e)) => return Err(send_err(e)),
                Err(_) => {
                    outcome.push("none probe timed out");
                    None
                }
            };
        match &server_methods {
            Some(methods) if !methods.is_empty() => {
                outcome.push(format!("server allows [{}]", methods.join(", ")))
            }
            Some(_) => outcome.push("server allows no further methods"),
            None => outcome.push("server method list unavailable"),
        }
        let server_allows = |method: &str| match &server_methods {
            Some(methods) => methods.iter().any(|m| m == method),
            None => true, // unknown — try anyway
        };

        // ── 1. keyboard-interactive (preferred by network devices) ──────────
        //
        // Two strategies, tried in order:
        //   A. every prompt answered heuristically with the real password —
        //      standard password KI and two-prompt devices (H3C/Huawei).
        //   B. the FIRST password-ish prompt is answered with a value that
        //      DIFFERS from A's answer (empty with a password set, a
        //      non-empty dummy with an empty password) — the dual-factor
        //      bastion trigger. The bastion fires its dynamic-code challenge
        //      (SMS / OTP / 企业微信) off that response, which the user then
        //      answers with "<static password><dynamic code>" typed as one
        //      string. Only tried after A is rejected. Running it even with
        //      an empty password matters: bastions that gate the SMS on a
        //      non-empty response must still see the trigger so the user's
        //      phone receives the code for the next attempt.
        let ki_allowed = server_allows("keyboard-interactive");
        if !ki_allowed {
            outcome.push(KI_NOT_OFFERED_TRAIL);
        } else {
            let mut authenticated = false;
            for empty_first in [false, true] {
                if empty_first {
                    outcome.dual_factor_attempted = true;
                    outcome.push(
                        "ki retry: first password prompt answered with the dual-factor trigger",
                    );
                }
                match Self::ki_attempt(handle, username, password, empty_first, &mut outcome)
                    .await?
                {
                    KiAttemptResult::Authenticated => {
                        authenticated = true;
                        break;
                    }
                    KiAttemptResult::Rejected => {
                        if !empty_first {
                            continue; // try the dual-factor strategy before giving up on KI
                        }
                        break; // both KI strategies rejected — plain password next
                    }
                    KiAttemptResult::Exhausted => break,
                }
            }
            if authenticated {
                outcome.authenticated = true;
                return Ok(outcome);
            }
        }

        // ── 2. plain password fallback ──────────────────────────────────────
        // Let the user compare what was sent with what works in PuTTY: the
        // length and charset fingerprint catches IME full-width characters,
        // stale vault entries and copy-paste truncation without exposing the
        // secret itself.
        outcome.push(format!(
            "password fingerprint: {} chars, ascii={}",
            password.chars().count(),
            password.is_ascii()
        ));
        if !server_allows("password") {
            outcome.push("password not offered by server, skipped");
            return Ok(outcome);
        }
        Self::auth_password_plain(handle, username, password, outcome).await
    }

    /// Single plain `password` method attempt (bounded).
    async fn auth_password_plain(
        handle: &mut client::Handle<SshClientHandler>,
        username: &str,
        password: &str,
        mut outcome: AuthOutcome,
    ) -> Result<AuthOutcome, SshError> {
        let send_err = |e: russh::Error| SshError::AuthenticationFailed(e.to_string());
        match tokio::time::timeout(
            std::time::Duration::from_secs(30),
            handle.authenticate_password(username, password),
        )
        .await
        {
            Ok(r) => {
                if r.map_err(send_err)? {
                    outcome.authenticated = true;
                    Ok(outcome)
                } else {
                    outcome.push(if password.is_empty() {
                        "password rejected (sent EMPTY password)"
                    } else {
                        "password rejected"
                    });
                    Ok(outcome)
                }
            }
            Err(_) => {
                outcome.push("password attempt timed out");
                Ok(outcome)
            }
        }
    }

    /// One keyboard-interactive attempt: start the method and answer up to
    /// `MAX_KI_ROUNDS` challenge rounds.
    ///
    /// With `empty_first_prompt = false` every prompt is answered
    /// heuristically (`answer_auth_prompt`). With `true`, the FIRST
    /// password-ish prompt of the attempt gets the dual-factor trigger
    /// answer (`dual_factor_trigger_answer`) — every later prompt gets the
    /// password (which, for such bastions, the user types as "<static
    /// password><dynamic code>" concatenated).
    async fn ki_attempt(
        handle: &mut client::Handle<SshClientHandler>,
        username: &str,
        password: &str,
        empty_first_prompt: bool,
        outcome: &mut AuthOutcome,
    ) -> Result<KiAttemptResult, SshError> {
        const AUTH_STEP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
        let send_err = |e: russh::Error| SshError::AuthenticationFailed(e.to_string());

        let started = tokio::time::timeout(
            AUTH_STEP_TIMEOUT,
            handle.authenticate_keyboard_interactive_start(username, None),
        )
        .await;
        let mut response = match started {
            Ok(r) => Some(r.map_err(send_err)?),
            Err(_) => {
                outcome.push("keyboard-interactive timed out");
                return Ok(KiAttemptResult::Exhausted);
            }
        };

        // `None` means the first password-ish prompt has already been
        // answered (with the dual-factor trigger).
        let mut first_password_answered = false;
        for _ in 0..MAX_KI_ROUNDS {
            let Some(resp) = response.take() else {
                break;
            };
            match resp {
                client::KeyboardInteractiveAuthResponse::Success => {
                    return Ok(KiAttemptResult::Authenticated);
                }
                client::KeyboardInteractiveAuthResponse::Failure => {
                    outcome.push("keyboard-interactive rejected");
                    return Ok(KiAttemptResult::Rejected);
                }
                client::KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                    let asked: Vec<String> =
                        prompts.iter().map(|p| Self::brief(&p.prompt)).collect();
                    outcome.push(format!(
                        "keyboard-interactive prompts [{}] (answered {})",
                        asked.join(", "),
                        if empty_first_prompt && !first_password_answered {
                            "trigger + password"
                        } else if password.is_empty() {
                            "EMPTY password"
                        } else {
                            "saved password/username"
                        },
                    ));
                    let responses = prompts
                        .iter()
                        .map(|p| {
                            if empty_first_prompt
                                && !first_password_answered
                                && Self::prompt_asks_password(&p.prompt)
                            {
                                first_password_answered = true;
                                Self::dual_factor_trigger_answer(password)
                            } else {
                                Self::answer_auth_prompt(&p.prompt, username, password)
                            }
                        })
                        .collect();
                    response = Some(
                        match tokio::time::timeout(
                            AUTH_STEP_TIMEOUT,
                            handle.authenticate_keyboard_interactive_respond(responses),
                        )
                        .await
                        {
                            Ok(r) => r.map_err(send_err)?,
                            Err(_) => {
                                outcome.push("keyboard-interactive timed out mid-round");
                                return Ok(KiAttemptResult::Exhausted);
                            }
                        },
                    );
                }
            }
        }
        Ok(KiAttemptResult::Exhausted)
    }

    /// Heuristically answer a keyboard-interactive prompt: prompts asking for
    /// a user/login name get the username, everything else (password, passcode,
    /// verification code, ...) gets the password.
    ///
    /// Chinese prompts are matched explicitly — bastion hosts (堡垒机) and
    /// domestic network devices commonly prompt "用户名：" / "密码：", and no
    /// latin keyword overlaps them. Password-ish keywords are checked FIRST so
    /// a mixed prompt like "用户密码" (user password) is answered with the
    /// password, not the username.
    fn answer_auth_prompt(prompt: &str, username: &str, password: &str) -> String {
        if Self::prompt_asks_password(prompt) {
            return password.to_string();
        }

        let p = prompt.to_lowercase();
        let asks_user = p.contains("user")
            || p.contains("login")
            || p.contains("name")
            || prompt.contains("用户")
            || prompt.contains("账号")
            || prompt.contains("帐号")
            || prompt.contains("账户")
            || prompt.contains("登录名");
        if asks_user {
            username.to_string()
        } else {
            password.to_string()
        }
    }

    /// Whether a keyboard-interactive prompt asks for a secret (password,
    /// passcode, verification code, token). Latin and Chinese keywords —
    /// bastion hosts and domestic devices prompt in both.
    fn prompt_asks_password(prompt: &str) -> bool {
        let p = prompt.to_lowercase();
        p.contains("pass")
            || prompt.contains("密码")
            || prompt.contains("口令")
            || prompt.contains("验证码")
            || prompt.contains("令牌")
    }

    /// The answer for the dual-factor TRIGGER prompt (the first password-ish
    /// prompt under strategy B). It must differ from what strategy A sent so
    /// the bastion's state machine takes the second path:
    ///
    /// - with a static password the trigger is EMPTY (some bastions start
    ///   the code challenge on an empty response);
    /// - with an EMPTY password the trigger is a non-empty dummy — many
    ///   bastions only fire the SMS / OTP after receiving a non-empty
    ///   password response (any value, even a deliberately wrong one), so
    ///   answering empty again would silently never trigger the SMS and the
    ///   user's phone stays silent.
    fn dual_factor_trigger_answer(password: &str) -> String {
        if password.is_empty() {
            EMPTY_PASSWORD_TRIGGER.to_string()
        } else {
            String::new()
        }
    }

    /// Suffix appended to the auth-failure message when the connect used an
    /// EMPTY password. Three flavours depending on what actually happened:
    /// - strategy B ran → the dual-factor trigger WAS sent; the failure is
    ///   the expected SMS trigger and the guidance is the real message.
    /// - the server never offered keyboard-interactive → the trigger could
    ///   not be sent at all; don't blame a missing saved credential, since
    ///   the empty password may be the deliberate bastion trigger.
    /// - anything else → most likely the saved credential really is missing.
    fn empty_password_suffix(outcome: &AuthOutcome) -> String {
        if outcome.dual_factor_attempted {
            return " — dual-factor trigger sent: if the SMS / OTP code arrived, reconnect and type <static password><dynamic code> as one string".to_string();
        }
        if outcome
            .trail
            .iter()
            .any(|step| step == KI_NOT_OFFERED_TRAIL)
        {
            return " — the password sent was EMPTY and the dual-factor trigger was NOT sent: this server does not offer keyboard-interactive".to_string();
        }
        " — the password sent was EMPTY, the saved credential is missing".to_string()
    }

    async fn auth_with_key_data(
        handle: &mut client::Handle<SshClientHandler>,
        username: &str,
        key_data: &str,
        passphrase: Option<&str>,
    ) -> Result<AuthOutcome, SshError> {
        let key_pair = russh_keys::decode_secret_key(key_data, passphrase)
            .map_err(|e| SshError::KeyParseError(e.to_string()))?;
        let key = Arc::new(key_pair);

        let send_err = |e: russh::Error| SshError::AuthenticationFailed(e.to_string());
        let mut outcome = AuthOutcome::not_authenticated();

        // First attempt: the key as decoded. russh-keys gives RSA keys the
        // modern rsa-sha2-512 signature hash.
        if handle
            .authenticate_publickey(username, Arc::clone(&key))
            .await
            .map_err(send_err)?
        {
            outcome.authenticated = true;
            return Ok(outcome);
        }
        outcome.push("publickey rsa-sha2-512 rejected");

        // Legacy fallback for RSA keys: older servers commonly reject the
        // rsa-sha2-512 signature algorithm outright and only accept
        // rsa-sha2-256 — or, on vintage OpenSSH (< 7.2) and network
        // appliances, only the original `ssh-rsa` (SHA-1). Retry down the
        // chain. Non-RSA keys have no hash variants; `with_signature_hash`
        // returns None for them.
        if matches!(key.as_ref(), russh_keys::key::KeyPair::RSA { .. }) {
            for (hash, label) in [
                (russh_keys::key::SignatureHash::SHA2_256, "rsa-sha2-256"),
                (russh_keys::key::SignatureHash::SHA1, "ssh-rsa (SHA-1)"),
            ] {
                if let Some(rekey) = key.with_signature_hash(hash) {
                    if handle
                        .authenticate_publickey(username, Arc::new(rekey))
                        .await
                        .map_err(send_err)?
                    {
                        outcome.authenticated = true;
                        return Ok(outcome);
                    }
                    outcome.push(format!("publickey {label} rejected"));
                }
            }
        }

        Ok(outcome)
    }

    /// Return the shared Handle for an active session.  Used by the SFTP layer
    /// to open an independent SFTP channel on the same connection.
    ///
    /// The caller must lock the handle only long enough to call
    /// `channel_open_session()`, then drop the guard.
    pub fn get_handle(
        &self,
        session_id: &str,
    ) -> Result<std::sync::Arc<tokio::sync::Mutex<russh::client::Handle<SshClientHandler>>>, SshError>
    {
        // Check PTY sessions first, then bare handles (SFTP-only)
        if let Some(entry) = self.sessions.get(session_id) {
            return Ok(entry.value().ssh_handle());
        }
        if let Some(entry) = self.bare_handles.get(session_id) {
            return Ok(entry.value().handle.clone());
        }
        Err(SshError::SessionNotFound(session_id.to_string()))
    }

    /// Open a new PTY channel on the same connection as an existing session.
    /// Returns the new session ID.
    pub async fn split_session(
        &self,
        source_session_id: &str,
        app_handle: AppHandle,
        settings: SessionSettings,
    ) -> Result<SessionId, SshError> {
        // Get the shared handle, host config, the ProxyJump tunnel chain, and
        // the *runtime* encoding from the source session. The jump handles are
        // shared (Arc) so the tunnel stays open as long as the parent OR any
        // split pane is alive — closing the parent tab no longer tears the
        // tunnel out from under its children. The encoding overrides the
        // global default so a split pane speaks the same encoding the user
        // may have switched the source pane to at runtime. Session logging
        // follows the source pane: a logging source starts a fresh log file
        // for the new pane with the same options.
        let (handle, host_config, jump_handles, source_encoding, source_log) = {
            let entry = self
                .sessions
                .get(source_session_id)
                .ok_or_else(|| SshError::SessionNotFound(source_session_id.to_string()))?;
            let log = entry.value().log();
            (
                entry.value().ssh_handle(),
                entry.value().host_config(),
                entry.value().jump_handles(),
                entry.value().encoding(),
                (
                    log.host.clone(),
                    log.user.clone(),
                    log.logger.active_options(),
                ),
            )
        };

        let new_id = SessionId::new();
        let sid = new_id.0.clone();

        let (log_host, log_user, log_auto_start) = source_log;
        let log_ctx = SessionLogContext::inactive(log_host, log_user);
        let log_ctx = SessionLogContext {
            auto_start: log_auto_start,
            ..log_ctx
        };

        let session = SshSession::open_split_pty(
            handle,
            jump_handles,
            sid.clone(),
            80,
            24,
            app_handle,
            host_config.default_shell,
            SessionSettings {
                encoding: source_encoding,
                ..settings
            },
            log_ctx,
        )
        .await?;

        self.sessions.insert(sid, session);
        Ok(new_id)
    }

    /// Send bytes to a session's PTY channel.
    pub async fn send_input(&self, session_id: &str, data: &[u8]) -> Result<(), SshError> {
        let entry = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SshError::SessionNotFound(session_id.to_string()))?;
        entry.value().send_input(data).await
    }

    /// Resize a session's PTY.
    pub async fn resize_pty(&self, session_id: &str, cols: u32, rows: u32) -> Result<(), SshError> {
        let entry = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SshError::SessionNotFound(session_id.to_string()))?;
        entry.value().resize_pty(cols, rows).await
    }

    /// Switch a session's character encoding at runtime (per-session only —
    /// nothing is persisted; reconnecting falls back to the global setting).
    pub fn set_encoding(&self, session_id: &str, encoding: &str) -> Result<(), SshError> {
        let entry = self
            .sessions
            .get(session_id)
            .ok_or_else(|| SshError::SessionNotFound(session_id.to_string()))?;
        entry.value().set_encoding(encoding)
    }

    /// Clone a session's session-log context (logger handle + naming
    /// metadata) for the manual start/stop/status commands. `None` when the
    /// session does not exist.
    pub fn session_log_context(&self, session_id: &str) -> Option<SessionLogContext> {
        self.sessions
            .get(session_id)
            .map(|e| e.value().log().clone())
    }

    /// Disconnect and remove a session.
    pub async fn disconnect(
        &self,
        session_id: &str,
        app_handle: AppHandle,
    ) -> Result<(), SshError> {
        let _ = app_handle.emit(
            "ssh:status",
            &SshStatusPayload {
                session_id: session_id.to_string(),
                status: ConnectionStatus::Disconnecting,
            },
        );

        // PTY sessions and bare (SFTP-only) handles live in separate maps —
        // check both so a no-PTY connection (e.g. an explorer connect whose
        // cancel landed after the handshake settled) can be torn down through
        // this same command instead of lingering in `bare_handles` forever.
        if let Some((_, session)) = self.sessions.remove(session_id) {
            session.disconnect().await?;
        } else if let Some((_, bare)) = self.bare_handles.remove(session_id) {
            // Best-effort goodbye — dropping the handles closes the connection
            // (and any ProxyJump tunnel beneath it) even if the server is gone.
            let _ = bare
                .handle
                .lock()
                .await
                .disconnect(russh::Disconnect::ByApplication, "", "en")
                .await;
        } else {
            return Err(SshError::SessionNotFound(session_id.to_string()));
        }

        let _ = app_handle.emit(
            "ssh:status",
            &SshStatusPayload {
                session_id: session_id.to_string(),
                status: ConnectionStatus::Disconnected,
            },
        );

        info!(session_id = %session_id, "SSH disconnected");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Device-style prompts: username/login prompts get the username, all
    /// other prompts (password, passcode, verification code) get the password.
    /// Chinese prompts — the norm on bastion hosts (堡垒机) — must resolve too.
    #[test]
    fn answer_auth_prompt_targets_user_vs_secret() {
        let u = "420102-7";
        let p = "s3cret";

        assert_eq!(SshManager::answer_auth_prompt("Username:", u, p), u);
        assert_eq!(SshManager::answer_auth_prompt("User Name:", u, p), u);
        assert_eq!(SshManager::answer_auth_prompt("login:", u, p), u);
        assert_eq!(SshManager::answer_auth_prompt("Password:", u, p), p);
        assert_eq!(
            SshManager::answer_auth_prompt("Please enter verification code", u, p),
            p
        );
        assert_eq!(SshManager::answer_auth_prompt("", u, p), p);

        // Chinese bastion-host prompts.
        assert_eq!(SshManager::answer_auth_prompt("用户名：", u, p), u);
        assert_eq!(SshManager::answer_auth_prompt("请输入账号", u, p), u);
        assert_eq!(SshManager::answer_auth_prompt("登录名:", u, p), u);
        assert_eq!(SshManager::answer_auth_prompt("密码：", u, p), p);
        assert_eq!(SshManager::answer_auth_prompt("请输入密码", u, p), p);
        assert_eq!(SshManager::answer_auth_prompt("口令", u, p), p);
        // A mixed prompt mentioning both user and password must resolve to the
        // password ("用户密码" = user's password).
        assert_eq!(SshManager::answer_auth_prompt("用户密码", u, p), p);
    }

    /// Dual-factor bastion strategy: the FIRST password-ish prompt of a
    /// strategy-B attempt gets the trigger answer, while username prompts
    /// and every later password prompt get the real credential (static
    /// password + dynamic code, concatenated by the user into one string).
    #[test]
    fn empty_first_strategy_triggers_then_answers_password() {
        let u = "420102-7";
        let p = "Abc@123883921";

        // Strategy B, round 1: the password prompt is the trigger -> EMPTY
        // (differs from strategy A's real password).
        let mut first_password_answered = false;
        let prompts = ["Username:", "Password:", "动态码:", "请输入动态口令"];
        let answers: Vec<String> = prompts
            .iter()
            .map(|prompt| {
                if !first_password_answered && SshManager::prompt_asks_password(prompt) {
                    first_password_answered = true;
                    SshManager::dual_factor_trigger_answer(p)
                } else {
                    SshManager::answer_auth_prompt(prompt, u, p)
                }
            })
            .collect();

        assert_eq!(answers[0], u); // username prompt unaffected
        assert_eq!(answers[1], ""); // first password prompt = empty trigger
        assert_eq!(answers[2], p); // dynamic-code round gets pw+OTP
        assert_eq!(answers[3], p);
        assert!(first_password_answered);

        // Without the strategy-B flag (strategy A) the same trigger prompt
        // gets the real password — regular hosts keep working.
        assert_eq!(SshManager::answer_auth_prompt("Password:", u, p), p);
    }

    /// With an EMPTY password the trigger answer must be NON-EMPTY: bastions
    /// that gate the SMS / OTP challenge on a non-empty password response
    /// (any wrong value fires the code) would otherwise never send it, and
    /// strategy A already exhausted the empty answer.
    #[test]
    fn empty_password_trigger_is_a_non_empty_dummy() {
        let trigger = SshManager::dual_factor_trigger_answer("");
        assert!(!trigger.is_empty());
        assert_eq!(trigger, EMPTY_PASSWORD_TRIGGER);

        // With a password set the trigger stays empty — it must differ from
        // strategy A's answer (the password itself).
        assert!(SshManager::dual_factor_trigger_answer("secret").is_empty());

        // End-to-end answer walk for the empty-password connect: trigger
        // prompt gets the dummy, the dynamic-code prompt still gets whatever
        // the (empty) password is — the SMS is what this attempt is for.
        let u = "420102-7";
        let mut first_password_answered = false;
        let prompts = ["Password:", "请输入短信验证码:"];
        let answers: Vec<String> = prompts
            .iter()
            .map(|prompt| {
                if !first_password_answered && SshManager::prompt_asks_password(prompt) {
                    first_password_answered = true;
                    SshManager::dual_factor_trigger_answer("")
                } else {
                    SshManager::answer_auth_prompt(prompt, u, "")
                }
            })
            .collect();
        assert_eq!(answers[0], EMPTY_PASSWORD_TRIGGER);
        assert_eq!(answers[1], "");
    }

    /// The empty-password failure suffix must reflect what actually happened:
    /// trigger sent → guidance; KI never offered → say so instead of blaming
    /// a missing credential; otherwise → missing-credential claim stands.
    #[test]
    fn empty_password_error_suffix_reflects_what_happened() {
        // Strategy B ran — the trigger went out, guidance is the message.
        let mut sent = AuthOutcome::not_authenticated();
        sent.dual_factor_attempted = true;
        let s = SshManager::empty_password_suffix(&sent);
        assert!(s.contains("dual-factor trigger sent: if the SMS"));

        // Server never offered keyboard-interactive — the trigger could not
        // be sent, and the empty password may be the deliberate bastion
        // trigger, so the message must not claim a missing credential.
        let mut no_ki = AuthOutcome::not_authenticated();
        no_ki.push(KI_NOT_OFFERED_TRAIL);
        let s = SshManager::empty_password_suffix(&no_ki);
        assert!(s.contains("was NOT sent"));
        assert!(s.contains("does not offer keyboard-interactive"));
        assert!(!s.contains("saved credential is missing"));
        // Must not collide with the frontend's "trigger sent" hint marker.
        assert!(!s.contains("dual-factor trigger sent"));

        // KI offered but strategy B never ran (prompt flow ended early) —
        // the missing-credential claim is the best available explanation.
        let plain = AuthOutcome::not_authenticated();
        let s = SshManager::empty_password_suffix(&plain);
        assert!(s.contains("the saved credential is missing"));
    }

    /// Cancelling an attempt ID that was never registered (or whose attempt
    /// already settled) must report that nothing was found.
    #[test]
    fn cancel_connect_returns_false_for_unknown_attempt() {
        let manager = SshManager::new();
        assert!(!manager.cancel_connect("no-such-attempt"));
    }

    /// The token handed to the connect path observes a cancel issued through
    /// the manager by attempt ID.
    #[test]
    fn cancel_connect_signals_the_registered_token() {
        let manager = SshManager::new();
        let token = manager.register_pending("attempt-1".to_string());
        assert!(!token.is_cancelled());

        assert!(manager.cancel_connect("attempt-1"));
        assert!(token.is_cancelled());
    }

    /// Once an attempt settles and clears its registration, a late cancel is a
    /// no-op: the settled attempt's token must not be signalled.
    #[test]
    fn clear_pending_makes_a_late_cancel_a_no_op() {
        let manager = SshManager::new();
        let token = manager.register_pending("attempt-1".to_string());
        manager.clear_pending("attempt-1");

        assert!(!manager.cancel_connect("attempt-1"));
        assert!(!token.is_cancelled());
    }

    /// Re-registering an attempt ID replaces the token: a cancel reaches the
    /// new attempt, never the orphaned one.
    #[test]
    fn reregistering_an_attempt_id_replaces_the_token() {
        let manager = SshManager::new();
        let orphaned = manager.register_pending("attempt-1".to_string());
        let active = manager.register_pending("attempt-1".to_string());

        assert!(manager.cancel_connect("attempt-1"));
        assert!(active.is_cancelled());
        assert!(!orphaned.is_cancelled());
    }
}
