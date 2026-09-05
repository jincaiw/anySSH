//! Telnet backend (P1b) — the `Telnet` arm of the term layer.
//!
//! Self-contained RFC 854/855 client (~600 lines planned; the actual
//! surface is smaller because the generic `spawn_session` loop owns
//! everything except the wire):
//!
//! * [`TelnetParser`] — incremental IAC state machine. Feed raw TCP bytes,
//!   get back user data plus DO/WILL/subnegotiation events. Handles partial
//!   sequences split across TCP reads.
//! * Negotiation policy (plan §5.1): `DO NAWS/TTYPE/SGA` → `WILL` (NAWS
//!   immediately followed by the current size); `DO LINEMODE` → `WONT`
//!   (character mode — required by network devices); server `WILL ECHO/SGA`
//!   → `DO`. Unknown options refused (`WONT`/`DONT`).
//! * [`LoginRunner`] — optional auto-login script: each step waits for a
//!   byte-regex (`regex::bytes`) then sends literal bytes (`\r \n \t \xNN`
//!   escapes). Steps with an empty expect fire immediately. Output seen
//!   while the script runs is still surfaced to the terminal scrollback.
//!
//! resize → `IAC SB NAWS <cols> <rows> IAC SE` (255 bytes IAC-escaped);
//! user input → 0xFF doubled per the protocol.

use std::time::{Duration, Instant};

use regex::bytes::Regex;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::TcpStream;

use super::{LoginScriptStep, TermError, TermIo};

// ---------------------------------------------------------------------------
// Protocol constants
// ---------------------------------------------------------------------------

const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;

const OPT_ECHO: u8 = 1;
const OPT_SGA: u8 = 3;
const OPT_TTYPE: u8 = 24;
const OPT_NAWS: u8 = 31;
const OPT_LINEMODE: u8 = 34;

/// Terminal type reported in TTYPE subnegotiation. Plain `xterm` is the
/// safest bet across network devices (H3C/Huawei consoles probe it).
const TTYPE_VALUE: &[u8] = b"xterm";

/// Hard cap on the auto-login script: if the expected prompt never shows up
/// the session degrades to plain pass-through instead of hanging forever.
const LOGIN_SCRIPT_TIMEOUT: Duration = Duration::from_secs(60);

// ---------------------------------------------------------------------------
// IAC parser
// ---------------------------------------------------------------------------

/// Events produced by feeding one byte at a time.
#[derive(Debug, PartialEq, Eq)]
pub enum TelnetEvent {
    /// A byte of user-facing data (IAC sequences already stripped).
    Data(u8),
    /// `DO`/`DONT`/`WILL`/`WONT` for an option.
    Command { cmd: u8, opt: u8 },
    /// Completed `IAC SB <opt> <params> IAC SE`.
    Subneg { opt: u8, params: Vec<u8> },
}

#[derive(Debug, Default)]
enum ParserState {
    /// Plain data.
    #[default]
    Data,
    /// Saw IAC, waiting for the command byte.
    GotIac,
    /// Saw IAC + cmd (DO/DONT/WILL/WONT), waiting for the option byte.
    GotCmd(u8),
    /// Saw IAC SB, waiting for the option id byte.
    SubnegOpt,
    /// Inside subnegotiation payload until IAC SE.
    SubnegBody,
    /// Inside subnegotiation, saw IAC (either SE terminator or escaped 255).
    SubnegIac,
}

/// Incremental, allocation-light IAC state machine. State survives across
/// TCP reads, so sequences split over multiple packets parse correctly.
#[derive(Debug, Default)]
pub struct TelnetParser {
    state: ParserState,
    subneg_opt: u8,
    subneg_params: Vec<u8>,
}

impl TelnetParser {
    pub fn feed(&mut self, b: u8) -> Option<TelnetEvent> {
        match self.state {
            ParserState::Data => match b {
                IAC => {
                    self.state = ParserState::GotIac;
                    None
                }
                d => Some(TelnetEvent::Data(d)),
            },
            ParserState::GotIac => match b {
                IAC => {
                    // IAC IAC = literal 255 in the data stream.
                    self.state = ParserState::Data;
                    Some(TelnetEvent::Data(IAC))
                }
                SB => {
                    self.state = ParserState::SubnegOpt;
                    self.subneg_params.clear();
                    None
                }
                DO | DONT | WILL | WONT => {
                    self.state = ParserState::GotCmd(b);
                    None
                }
                // GA/NOP/AYT/… single-byte commands: ignore, back to data.
                _ => {
                    self.state = ParserState::Data;
                    None
                }
            },
            ParserState::GotCmd(cmd) => {
                self.state = ParserState::Data;
                Some(TelnetEvent::Command { cmd, opt: b })
            }
            ParserState::SubnegOpt => {
                // First byte after SB is the option id.
                self.subneg_opt = b;
                self.state = ParserState::SubnegBody;
                None
            }
            ParserState::SubnegBody => match b {
                IAC => {
                    self.state = ParserState::SubnegIac;
                    None
                }
                d => {
                    self.subneg_params.push(d);
                    None
                }
            },
            ParserState::SubnegIac => match b {
                IAC => {
                    // Escaped 255 inside subnegotiation payload.
                    self.state = ParserState::SubnegBody;
                    self.subneg_params.push(IAC);
                    None
                }
                SE => {
                    self.state = ParserState::Data;
                    let opt = self.subneg_opt;
                    let params = std::mem::take(&mut self.subneg_params);
                    Some(TelnetEvent::Subneg { opt, params })
                }
                // Malformed (IAC <other> inside subneg) — resync to data.
                _ => {
                    self.state = ParserState::Data;
                    self.subneg_params.clear();
                    None
                }
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Escapes & NAWS encoding
// ---------------------------------------------------------------------------

/// Decode the literal-send escape syntax: `\r` `\n` `\t` `\\` `\xNN`
/// (hex byte). Unknown escapes fall through as the literal character.
pub fn parse_escapes(s: &str) -> Vec<u8> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 1 < b.len() {
            match b[i + 1] {
                b'r' => {
                    out.push(0x0D);
                    i += 2;
                }
                b'n' => {
                    out.push(0x0A);
                    i += 2;
                }
                b't' => {
                    out.push(0x09);
                    i += 2;
                }
                b'\\' => {
                    out.push(0x5C);
                    i += 2;
                }
                b'x' | b'X' if i + 3 < b.len() => {
                    let hex = std::str::from_utf8(&b[i + 2..i + 4]).unwrap_or("");
                    match u8::from_str_radix(hex, 16) {
                        Ok(v) => {
                            out.push(v);
                            i += 4;
                        }
                        Err(_) => {
                            out.push(b[i + 1]);
                            i += 2;
                        }
                    }
                }
                c => {
                    out.push(c);
                    i += 2;
                }
            }
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    out
}

/// Double every 0xFF (IAC IAC) so user data never hijacks the command
/// channel.
pub fn iac_escape(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 8);
    for &b in data {
        if b == IAC {
            out.push(IAC);
        }
        out.push(b);
    }
    out
}

/// Encode a NAWS subnegotiation payload (16-bit BE, 255 doubled).
fn naws_payload(cols: u16, rows: u16) -> Vec<u8> {
    iac_escape(&[
        (cols >> 8) as u8,
        (cols & 0xFF) as u8,
        (rows >> 8) as u8,
        (rows & 0xFF) as u8,
    ])
}

fn subneg(opt: u8, params: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(params.len() + 5);
    out.extend_from_slice(&[IAC, SB, opt]);
    out.extend_from_slice(params);
    out.extend_from_slice(&[IAC, SE]);
    out
}

fn command(cmd: u8, opt: u8) -> Vec<u8> {
    vec![IAC, cmd, opt]
}

// ---------------------------------------------------------------------------
// Login script
// ---------------------------------------------------------------------------

#[derive(Debug)]
enum LoginAction {
    /// Keep consuming output until the next expect matches.
    Wait,
    /// Send these bytes now (fire-and-forget; matching continues next step).
    Send(Vec<u8>),
}

/// One compiled auto-login script. `expect` patterns are byte-regexes run
/// against a sliding buffer so prompts split across TCP chunks still match.
#[derive(Debug)]
struct LoginRunner {
    steps: Vec<(Option<Regex>, Vec<u8>)>,
    index: usize,
    buffer: Vec<u8>,
    started: Instant,
}

impl LoginRunner {
    fn new(steps: Vec<LoginScriptStep>) -> Result<Self, TermError> {
        let compiled = steps
            .into_iter()
            .map(|s| {
                let expect = if s.expect.trim().is_empty() {
                    None
                } else {
                    Some(
                        Regex::new(&s.expect)
                            .map_err(|e| TermError::InvalidParams(format!("login script: {e}")))?,
                    )
                };
                Ok((expect, parse_escapes(&s.send)))
            })
            .collect::<Result<Vec<_>, TermError>>()?;
        if compiled.is_empty() {
            return Err(TermError::InvalidParams(
                "login script has no steps".to_string(),
            ));
        }
        Ok(Self {
            steps: compiled,
            index: 0,
            buffer: Vec::new(),
            started: Instant::now(),
        })
    }

    /// Feed one chunk of output; returns bytes to send when a step fires.
    /// Empty `expect` steps fire immediately (chained by the caller).
    fn step(&mut self, data: &[u8]) -> LoginAction {
        if self.index >= self.steps.len() {
            return LoginAction::Wait;
        }
        if self.started.elapsed() > LOGIN_SCRIPT_TIMEOUT {
            // Degrade to interactive rather than swallowing output forever.
            self.index = self.steps.len();
            return LoginAction::Wait;
        }
        self.buffer.extend_from_slice(data);
        let (expect, send) = &self.steps[self.index];
        match expect {
            None => {
                self.index += 1;
                LoginAction::Send(send.clone())
            }
            Some(re) => {
                if re.is_match(&self.buffer) {
                    self.index += 1;
                    self.buffer.clear();
                    LoginAction::Send(send.clone())
                } else {
                    LoginAction::Wait
                }
            }
        }
    }

    /// True while steps remain (immediate-send steps are drained by the
    /// caller until it sees `Wait`).
    fn pending(&self) -> bool {
        self.index < self.steps.len()
    }

    fn expired(&self) -> bool {
        self.started.elapsed() > LOGIN_SCRIPT_TIMEOUT
    }
}

// ---------------------------------------------------------------------------
// TelnetIo
// ---------------------------------------------------------------------------

/// Telnet transport implementing [`TermIo`]. Read half parses IAC and
/// applies the negotiation policy; write half sends user data (0xFF
/// escaped) and control sequences.
pub struct TelnetIo {
    read_half: OwnedReadHalf,
    write_half: OwnedWriteHalf,
    parser: TelnetParser,
    /// Output captured while the login script runs, replayed to the user on
    /// the next read so prompts/banners land in the scrollback.
    pending: Vec<u8>,
    login: Option<LoginRunner>,
    naws_negotiated: bool,
    cols: u16,
    rows: u16,
}

impl TelnetIo {
    /// Connect, then run the optional auto-login script before the session
    /// loop takes over. Data seen during login is buffered and replayed.
    pub async fn connect(
        host: &str,
        port: u16,
        login_script: Option<Vec<LoginScriptStep>>,
        cols: u16,
        rows: u16,
    ) -> Result<Self, TermError> {
        let stream =
            tokio::time::timeout(Duration::from_secs(10), TcpStream::connect((host, port)))
                .await
                .map_err(|_| TermError::Io(format!("connect {host}:{port}: timeout after 10s")))?
                .map_err(|e| TermError::Io(format!("connect {host}:{port}: {e}")))?;
        let (read_half, write_half) = stream.into_split();

        let login = match login_script {
            Some(steps) if !steps.is_empty() => Some(LoginRunner::new(steps)?),
            _ => None,
        };

        let mut io = Self {
            read_half,
            write_half,
            parser: TelnetParser::default(),
            pending: Vec::new(),
            login,
            naws_negotiated: false,
            cols,
            rows,
        };

        // Drain immediate-send steps (empty expect) right after connect.
        if io.login.is_some() {
            io.drain_immediate_sends().await;
        }
        Ok(io)
    }

    /// Fire steps whose `expect` is empty (chained, e.g. a leading "send
    /// newline to wake the console" step).
    async fn drain_immediate_sends(&mut self) {
        while let Some(action) = self.login.as_mut().map(|login| login.step(&[])) {
            match action {
                LoginAction::Send(bytes) => {
                    let _ = self.write_half.write_all(&bytes).await;
                    let _ = self.write_half.write_all(b"\r").await;
                }
                LoginAction::Wait => break,
            }
            if !self.login.as_ref().is_some_and(LoginRunner::pending) {
                self.login = None;
                break;
            }
        }
    }

    /// Apply the negotiation policy; returns the bytes to send (if any).
    fn reply_for_command(&mut self, cmd: u8, opt: u8) -> Option<Vec<u8>> {
        if cmd == DO && opt == OPT_NAWS {
            // Acknowledge and push the current size right away — many
            // devices only start layout correctly after this first NAWS.
            self.naws_negotiated = true;
            let mut out = command(WILL, opt);
            out.extend_from_slice(&subneg(OPT_NAWS, &naws_payload(self.cols, self.rows)));
            return Some(out);
        }
        policy_reply(cmd, opt).map(|(c, o)| command(c, o))
    }

    async fn handle_subneg(&mut self, opt: u8, params: Vec<u8>) {
        // TTYPE: server asks (SB TTYPE SEND IAC SE) — answer IS "xterm".
        if opt == OPT_TTYPE && params.first() == Some(&1) {
            let mut answer = vec![0u8]; // IS
            answer.extend_from_slice(TTYPE_VALUE);
            let _ = self.write_half.write_all(&subneg(OPT_TTYPE, &answer)).await;
        }
        // Everything else (LINEMODE hints, NEW-ENVIRON probes, …) ignored.
    }
}

#[async_trait::async_trait]
impl TermIo for TelnetIo {
    async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        // Replay buffered login-phase output first.
        if !self.pending.is_empty() {
            let n = buf.len().min(self.pending.len());
            buf[..n].copy_from_slice(&self.pending[..n]);
            self.pending.drain(..n);
            return Ok(n);
        }

        loop {
            // Login script expired: degrade to interactive.
            if let Some(login) = &self.login {
                if login.expired() {
                    self.login = None;
                }
            }

            let mut raw = [0u8; 4096];
            let n = self.read_half.read(&mut raw).await?;
            if n == 0 {
                return Ok(0);
            }

            let mut data = Vec::with_capacity(n);
            for &b in &raw[..n] {
                match self.parser.feed(b) {
                    Some(TelnetEvent::Data(d)) => data.push(d),
                    Some(TelnetEvent::Command { cmd, opt }) => {
                        if let Some(reply) = self.reply_for_command(cmd, opt) {
                            let _ = self.write_half.write_all(&reply).await;
                        }
                    }
                    Some(TelnetEvent::Subneg { opt, params }) => {
                        self.handle_subneg(opt, params).await;
                    }
                    None => {}
                }
            }

            if data.is_empty() {
                continue; // pure negotiation — keep reading
            }

            match &mut self.login {
                Some(login) => {
                    match login.step(&data) {
                        LoginAction::Send(bytes) => {
                            let _ = self.write_half.write_all(&bytes).await;
                            let _ = self.write_half.write_all(b"\r").await;
                            let still = login.pending();
                            if !still {
                                self.login = None;
                            }
                        }
                        LoginAction::Wait => {}
                    }
                    // User still sees everything the device prints during
                    // login (prompts, banners, MOTD).
                    self.pending.extend_from_slice(&data);
                    let n = buf.len().min(self.pending.len());
                    buf[..n].copy_from_slice(&self.pending[..n]);
                    self.pending.drain(..n);
                    return Ok(n);
                }
                None => {
                    let c = buf.len().min(data.len());
                    buf[..c].copy_from_slice(&data[..c]);
                    return Ok(c);
                }
            }
        }
    }

    async fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        let escaped = iac_escape(data);
        self.write_half.write_all(&escaped).await?;
        Ok(data.len())
    }

    async fn resize(&mut self, cols: u32, rows: u32) {
        let (cols, rows) = (cols as u16, rows as u16);
        self.cols = cols;
        self.rows = rows;
        if self.naws_negotiated {
            let _ = self
                .write_half
                .write_all(&subneg(OPT_NAWS, &naws_payload(cols, rows)))
                .await;
        }
    }

    async fn shutdown(&mut self) {
        // Dropping the halves closes the TCP connection.
    }
}

// ---------------------------------------------------------------------------
// Negotiation policy
// ---------------------------------------------------------------------------

/// Pure negotiation policy (plan §5.1): what to answer to a `DO`/`WILL`.
/// * `DO NAWS/TTYPE/SGA` → `WILL` (terminal size, terminal type, suppress
///   go-ahead are all things a character-mode client provides);
/// * `DO` anything else (incl. `LINEMODE`, `ECHO`) → `WONT` — character
///   mode is required by network-device consoles;
/// * server `WILL SGA/ECHO` (it suppresses go-ahead / does the echoing) →
///   `DO`; server `WILL` anything else → `DONT`.
///
/// `WONT`/`DONT` from the peer: silence is consent, no reply.
pub fn policy_reply(cmd: u8, opt: u8) -> Option<(u8, u8)> {
    match cmd {
        DO => match opt {
            OPT_NAWS | OPT_TTYPE | OPT_SGA => Some((WILL, opt)),
            _ => Some((WONT, opt)),
        },
        WILL => match opt {
            OPT_SGA | OPT_ECHO => Some((DO, opt)),
            _ => Some((DONT, opt)),
        },
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn feed_all(parser: &mut TelnetParser, bytes: &[u8]) -> Vec<TelnetEvent> {
        bytes.iter().filter_map(|&b| parser.feed(b)).collect()
    }

    #[test]
    fn plain_data_passes_through() {
        let mut p = TelnetParser::default();
        let events = feed_all(&mut p, b"login: ");
        let text: Vec<u8> = events
            .into_iter()
            .filter_map(|e| match e {
                TelnetEvent::Data(d) => Some(d),
                _ => None,
            })
            .collect();
        assert_eq!(text, b"login: ");
    }

    #[test]
    fn iac_iac_is_literal_255() {
        let mut p = TelnetParser::default();
        let events = feed_all(&mut p, &[b'a', IAC, IAC, b'b']);
        assert_eq!(
            events,
            vec![
                TelnetEvent::Data(b'a'),
                TelnetEvent::Data(255),
                TelnetEvent::Data(b'b'),
            ]
        );
    }

    #[test]
    fn command_split_across_reads() {
        let mut p = TelnetParser::default();
        assert_eq!(
            feed_all(&mut p, &[b'x', IAC]),
            vec![TelnetEvent::Data(b'x')]
        );
        assert_eq!(
            feed_all(&mut p, &[DO, OPT_NAWS]),
            vec![TelnetEvent::Command {
                cmd: DO,
                opt: OPT_NAWS
            }]
        );
    }

    #[test]
    fn subnegotiation_parsed() {
        let mut p = TelnetParser::default();
        let events = feed_all(&mut p, &[IAC, SB, OPT_TTYPE, 1, IAC, SE]);
        assert_eq!(
            events,
            vec![TelnetEvent::Subneg {
                opt: OPT_TTYPE,
                params: vec![1],
            }]
        );
    }

    #[test]
    fn subneg_escaped_255() {
        // Payload 0x00 0xFF 0x00 with 0xFF written as the IAC IAC pair.
        let mut p = TelnetParser::default();
        let events = feed_all(&mut p, &[IAC, SB, OPT_NAWS, 0, 255, 255, 0, IAC, SE]);
        assert_eq!(
            events,
            vec![TelnetEvent::Subneg {
                opt: OPT_NAWS,
                params: vec![0, 255, 0],
            }]
        );
    }

    #[test]
    fn escapes_decode() {
        assert_eq!(parse_escapes(r"a\rb\nc\td\\"), b"a\rb\nc\td\\");
        assert_eq!(parse_escapes(r"\x41\x42"), b"AB");
        // Unknown escape: literal passthrough of the escaped char.
        assert_eq!(parse_escapes(r"\q"), b"q");
    }

    #[test]
    fn iac_doubling_on_send() {
        assert_eq!(
            iac_escape(&[0x01, 0xFF, 0x02]),
            vec![0x01, 0xFF, 0xFF, 0x02]
        );
    }

    #[test]
    fn naws_encodes_size() {
        // 80x24 → 00 50 00 18 (no 255 bytes to double).
        assert_eq!(naws_payload(80, 24), vec![0x00, 0x50, 0x00, 0x18]);
    }

    #[test]
    fn login_script_matches_password_prompt_across_chunks() {
        let runner = || {
            LoginRunner::new(vec![LoginScriptStep {
                expect: r"Password:".to_string(),
                send: "s3cret".to_string(),
            }])
            .unwrap()
        };
        // Prompt split across two TCP reads.
        let mut r = runner();
        assert!(matches!(
            r.step(b"User Access Verification\nPass"),
            LoginAction::Wait
        ));
        let action = r.step(b"word: ");
        match action {
            LoginAction::Send(bytes) => assert_eq!(bytes, b"s3cret"),
            other => panic!("expected Send, got {other:?}"),
        }
        assert!(!r.pending());
    }

    #[test]
    fn login_script_empty_expect_sends_immediately() {
        let mut r = LoginRunner::new(vec![LoginScriptStep {
            expect: String::new(),
            send: r"\r".to_string(),
        }])
        .unwrap();
        assert!(matches!(r.step(&[]), LoginAction::Send(ref bytes) if bytes == b"\r"));
    }

    #[test]
    fn login_script_bad_regex_rejected() {
        let err = LoginRunner::new(vec![LoginScriptStep {
            expect: "(unclosed".to_string(),
            send: String::new(),
        }])
        .unwrap_err();
        assert!(matches!(err, TermError::InvalidParams(_)));
    }

    #[test]
    fn negotiation_policy_character_mode() {
        // DO the three supported options → WILL.
        assert_eq!(policy_reply(DO, OPT_NAWS), Some((WILL, OPT_NAWS)));
        assert_eq!(policy_reply(DO, OPT_TTYPE), Some((WILL, OPT_TTYPE)));
        assert_eq!(policy_reply(DO, OPT_SGA), Some((WILL, OPT_SGA)));
        // Character mode: refuse LINEMODE / ECHO / unknown.
        assert_eq!(policy_reply(DO, OPT_LINEMODE), Some((WONT, OPT_LINEMODE)));
        assert_eq!(policy_reply(DO, OPT_ECHO), Some((WONT, OPT_ECHO)));
        assert_eq!(policy_reply(DO, 42), Some((WONT, 42)));
        // Server announces SGA/ECHO → DO; anything else → DONT.
        assert_eq!(policy_reply(WILL, OPT_SGA), Some((DO, OPT_SGA)));
        assert_eq!(policy_reply(WILL, OPT_ECHO), Some((DO, OPT_ECHO)));
        assert_eq!(policy_reply(WILL, OPT_TTYPE), Some((DONT, OPT_TTYPE)));
        // WONT/DONT: silence.
        assert_eq!(policy_reply(WONT, OPT_SGA), None);
        assert_eq!(policy_reply(DONT, OPT_ECHO), None);
    }
}
