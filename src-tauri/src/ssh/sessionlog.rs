//! Terminal session local logging ("session log").
//!
//! Records everything a terminal session sends and receives into a local
//! `.log` (or Asciicast v2 `.cast`) file so users can audit commands, review
//! output, and replay sessions with third-party tools (e.g. `asciinema`).
//!
//! Design notes
//! ------------
//! * **Async, never blocking the terminal loop.** All writes go through an
//!   unbounded `std::sync::mpsc` channel drained by a dedicated writer
//!   thread. The SSH reader task only does a lossy UTF-8 conversion and a
//!   channel send per chunk — a `cat` of a huge file can never stall the
//!   terminal. When logging is off, the hot path is a single `AtomicBool`
//!   load.
//! * **File naming** follows `host_user_YYYYMMDD_HHMMSS.log`, filed under a
//!   per-day directory: `<data>/session-logs/YYYY-MM-DD/…`. Size-based
//!   rotation appends `_part2`, `_part3`, … before the extension.
//! * **Retention / quota**: every logger start sweeps the log root and
//!   deletes files older than `retention_days`, then enforces a total
//!   `quota_mb` by deleting the oldest files first. Runs on the writer
//!   thread, off the connection path.
//! * **Permissions**: on Unix, log files are created with `0600` so only the
//!   current user can read/write them.
//! * **Sensitive input masking**: a heuristic state machine watches the
//!   output stream for password/OTP-style prompts (English + Chinese —
//!   bastion hosts commonly prompt "密码：" / "验证码："). While armed, any
//!   output characters that merely echo back what the user typed are
//!   replaced with `*`, and input keystrokes are not recorded at all
//!   (Asciicast `i` events). Hidden prompts (servers that echo nothing)
//!   never reach the log in the first place, because the text format records
//!   the output stream only.
//! * **ANSI handling**: escape sequences may be kept verbatim (faithful
//!   replay) or stripped (clean grep-able text).

use serde::{Deserialize, Serialize};
use serde_json::json;
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::db::HostDb;

// ---------------------------------------------------------------------------
// Root directory
// ---------------------------------------------------------------------------

static LOG_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Per-process counter baked into every log file name. Millisecond timestamps
/// alone still collide when two loggers for the same host/user start within
/// the same millisecond (e.g. a reconnect storm) — the sequence suffix makes
/// in-process file names collision-proof. Must be captured ONCE per `start()`
/// and reused for every rotation of that log.
static LOG_SEQ: AtomicU64 = AtomicU64::new(0);

/// Install the session-log root directory (`<app_data_dir>/session-logs`).
/// Called once from the app setup hook before any session can connect.
pub fn install_root(app_data_dir: &Path) {
    let _ = LOG_ROOT.set(app_data_dir.join("session-logs"));
}

/// The session-log root directory. Falls back to a temp dir when the app
/// setup hook has not run (unit tests) so the module still functions.
fn log_root() -> PathBuf {
    LOG_ROOT
        .get()
        .cloned()
        .unwrap_or_else(|| std::env::temp_dir().join("anyssh-session-logs"))
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/// How ANSI escape sequences are written to the log file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AnsiMode {
    /// Write the stream verbatim — faithful replay in capable tools.
    Keep,
    /// Remove CSI/OSC/escape sequences — clean, grep-able text.
    Strip,
}

/// Log file container format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogFormat {
    /// Plain text (output stream only — echoed commands included).
    Text,
    /// Asciicast v2 (`.cast`) — input + output events, replayable with
    /// `asciinema` and other standard tools.
    Asciicast,
}

/// Options captured when a logger starts. Resolved from the persisted app
/// settings (plus per-host overrides) at connect time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionLogOptions {
    pub ansi: AnsiMode,
    pub format: LogFormat,
    /// Prefix each log line with `[HH:MM:SS]` (text format only).
    pub timestamps: bool,
    /// Rotate to a new file when the current one exceeds this size (MB).
    pub max_file_mb: u32,
    /// Delete log files older than this many days (0 = keep forever).
    pub retention_days: u32,
    /// Keep the total log volume under this cap (MB, 0 = unlimited).
    pub quota_mb: u32,
}

impl Default for SessionLogOptions {
    fn default() -> Self {
        Self {
            ansi: AnsiMode::Strip,
            format: LogFormat::Text,
            timestamps: false,
            max_file_mb: 10,
            retention_days: 30,
            quota_mb: 500,
        }
    }
}

/// Parse the persisted options from the app settings table. Missing or
/// out-of-range values fall back to the defaults, so a hand-corrupted row
/// cannot break logging. The keys mirror `settings-store.ts`.
pub fn session_log_options_from_db(db: &HostDb) -> SessionLogOptions {
    let mut o = SessionLogOptions::default();
    let get = |key: &str| db.get_setting(key).ok().flatten();

    if let Some(v) = get("session_log_ansi") {
        if v == "keep" {
            o.ansi = AnsiMode::Keep;
        }
    }
    if let Some(v) = get("session_log_format") {
        if v == "asciicast" {
            o.format = LogFormat::Asciicast;
        }
    }
    if let Some(v) = get("session_log_timestamps") {
        o.timestamps = v == "true";
    }
    if let Some(v) = get("session_log_max_size_mb") {
        if let Ok(n) = v.trim().parse::<u32>() {
            o.max_file_mb = n.clamp(1, 1024);
        }
    }
    if let Some(v) = get("session_log_retention_days") {
        if let Ok(n) = v.trim().parse::<u32>() {
            o.retention_days = n.clamp(0, 3650);
        }
    }
    if let Some(v) = get("session_log_quota_mb") {
        if let Ok(n) = v.trim().parse::<u32>() {
            o.quota_mb = n.clamp(0, 1024 * 100);
        }
    }
    o
}

/// Whether global auto-recording is enabled (the "session_log_enabled"
/// setting). Per-host forced logging is decided separately by the caller.
pub fn session_log_enabled_from_db(db: &HostDb) -> bool {
    db.get_setting("session_log_enabled")
        .ok()
        .flatten()
        .map(|v| v == "true")
        .unwrap_or(false)
}

// ---------------------------------------------------------------------------
// Sensitive-input masking (heuristic)
// ---------------------------------------------------------------------------

/// Output substrings (lower-cased for latin) that arm the mask. English
/// keywords plus the Chinese prompts used by bastion hosts (堡垒机) and
/// domestic network devices — mirroring `SshManager::prompt_asks_password`.
const PROMPT_KEYWORDS: &[&str] = &[
    "password",
    "passphrase",
    "passcode",
    "pass word",
    "verification code",
    "one-time",
    "otp",
    "2fa",
    "mfa",
    "token:",
    "密码",
    "口令",
    "验证码",
    "动态码",
    "令牌",
];

fn looks_like_secret_prompt(chunk: &str) -> bool {
    let lower = chunk.to_lowercase();
    PROMPT_KEYWORDS.iter().any(|k| lower.contains(k))
}

/// State machine tracking whether the last output looked like a secret
/// prompt, and how much of the user's typed line the server has echoed
/// since. Both streams are fed exclusively from the SSH reader task, so no
/// extra synchronisation beyond the Mutex is required.
#[derive(Default)]
struct MaskState {
    /// Armed by a secret prompt; disarmed when the response line ends
    /// (a CR/LF arrives in the output stream).
    active: bool,
    /// What the user typed since their last Enter (echo comparison).
    pending_input: String,
    /// How many chars of `pending_input` the server has echoed so far.
    echo_pos: usize,
}

impl MaskState {
    /// Feed an input chunk. Returns whether the input may be recorded
    /// (false while the mask is armed — the keystrokes are suppressed).
    fn on_input(&mut self, text: &str) -> bool {
        for c in text.chars() {
            if c == '\r' || c == '\n' {
                self.pending_input.clear();
                self.echo_pos = 0;
            } else {
                self.pending_input.push(c);
            }
        }
        !self.active
    }

    /// Feed an output chunk, returning the text to log: characters that
    /// merely echo the user's typed secret become `*`, everything else
    /// passes through. The mask disarms once the response line ends.
    fn on_output(&mut self, text: &str) -> String {
        if !self.active {
            if looks_like_secret_prompt(text) {
                self.active = true;
            }
            return text.to_string();
        }

        let mut out = String::with_capacity(text.len());
        for c in text.chars() {
            if c == '\r' || c == '\n' {
                // End of the (possibly echoed) response line — disarm.
                self.active = false;
                self.pending_input.clear();
                self.echo_pos = 0;
                out.push(c);
            } else if self.echo_pos < self.pending_input.chars().count()
                && self.pending_input.chars().nth(self.echo_pos) == Some(c)
            {
                // The server is echoing back the typed secret → mask it.
                self.echo_pos += 1;
                out.push('*');
            } else {
                out.push(c);
            }
        }
        out
    }
}

// ---------------------------------------------------------------------------
// ANSI stripping
// ---------------------------------------------------------------------------

/// Remove ANSI escape sequences (CSI, OSC/DCS with BEL or ST terminators,
/// and two/three-byte ESC sequences) from a terminal stream chunk.
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        if c != '\x1b' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            Some('[') => {
                // CSI: ESC [ params intermediates final(0x40-0x7E)
                chars.next();
                while let Some(&n) = chars.peek() {
                    chars.next();
                    if ('\u{40}'..='\u{7e}').contains(&n) {
                        break;
                    }
                }
            }
            Some(']') | Some('P') | Some('X') | Some('^') | Some('_') => {
                // String sequences (OSC/DCS/SOS/PM/APC): terminated by BEL or ST.
                chars.next();
                loop {
                    match chars.next() {
                        Some('\x07') => break,
                        Some('\x1b') => {
                            if chars.peek() == Some(&'\\') {
                                chars.next();
                            }
                            break;
                        }
                        Some(_) => {}
                        None => break,
                    }
                }
            }
            Some(_) => {
                // ESC <intermediates 0x20–0x2F> <final 0x30–0x7E>: two-byte
                // sequences (ESC 7, ESC M) and multi-byte ones like ESC ( B.
                // Consume intermediates first, then the final byte.
                while let Some(&n) = chars.peek() {
                    if ('\u{20}'..='\u{2f}').contains(&n) {
                        chars.next();
                    } else {
                        break;
                    }
                }
                if chars.peek().is_some() {
                    chars.next(); // final byte
                }
            }
            None => {} // trailing ESC — drop
        }
    }
    out
}

// ---------------------------------------------------------------------------
// File naming helpers
// ---------------------------------------------------------------------------

/// Sanitise a host/username for use in a file name: only alphanumerics,
/// `-_.` survive; everything else (path separators, shell-hostile bytes,
/// non-ASCII labels) becomes `_`. Length-capped so pathological labels
/// cannot produce oversized names.
fn sanitize_component(name: &str) -> String {
    // A `.` is only safe when it is flanked by alphanumerics ("prod.web").
    // Leading dots, ".." runs and dots adjacent to separators become "_", so
    // no path traversal ("..") or hidden-file trickery survives sanitising.
    let chars: Vec<char> = name.chars().collect();
    let mut s: String = chars
        .iter()
        .enumerate()
        .map(|(i, &c)| {
            let prev_alnum = i > 0 && chars[i - 1].is_ascii_alphanumeric();
            let next_alnum = i + 1 < chars.len() && chars[i + 1].is_ascii_alphanumeric();
            if c.is_ascii_alphanumeric()
                || c == '-'
                || c == '_'
                || (c == '.' && prev_alnum && next_alnum)
            {
                c
            } else {
                '_'
            }
        })
        .collect();
    s.truncate(60);
    if s.is_empty() {
        s.push_str("host");
    }
    s
}

/// `host_user_YYYYMMDD_HHMMSSmmm_NN` from the start instant. The date is
/// compact (no dashes) — it must not be confused with the `YYYY-MM-DD`
/// directory. `seq` (captured once per `start()`) disambiguates
/// same-millisecond starts of two loggers for the same host/user.
fn file_stem(host: &str, user: &str, started: SystemTime, seq: u64) -> String {
    let (date, time) = datetime_parts(started);
    format!(
        "{}_{}_{}_{}_{seq:02}",
        sanitize_component(host),
        sanitize_component(user),
        date.replace('-', ""),
        time
    )
}

/// Local date `YYYY-MM-DD` and time `HHMMSSmmm` for a given instant. The
/// time carries millisecond precision so two sessions for the same host/user
/// started within the same second never collide on a file name.
fn datetime_parts(t: SystemTime) -> (String, String) {
    let d = t.duration_since(UNIX_EPOCH).unwrap_or(Duration::ZERO);
    let secs = d.as_secs() as i64;
    let millis = d.subsec_millis();
    let dt = chrono::DateTime::from_timestamp(secs, 0)
        .unwrap_or(chrono::DateTime::<chrono::Utc>::UNIX_EPOCH)
        .with_timezone(&chrono::Local);
    (
        dt.format("%Y-%m-%d").to_string(),
        format!("{}{:03}", dt.format("%H%M%S"), millis),
    )
}

/// Local `HH:MM:SS` for inline line timestamps.
fn clock_stamp() -> String {
    chrono::Local::now().format("%H:%M:%S").to_string()
}

// ---------------------------------------------------------------------------
// Writer thread
// ---------------------------------------------------------------------------

enum LogEvent {
    /// Processed output chunk (text format) or raw output (asciicast).
    Output(String),
    /// Raw input chunk (asciicast only).
    Input(String),
    /// Flush + exit. `done` is signalled so `stop()` can return after the
    /// file is flushed (relevant on app exit / session close).
    Stop { done: Option<mpsc::Sender<()>> },
}

struct ActiveLog {
    writer: BufWriter<File>,
    /// Current file path (changes on rotation). Kept for future use by the
    /// pane UI (e.g. "current log file" display); rotation only rewrites it.
    #[allow(dead_code)]
    path: PathBuf,
    /// Size of the current file in bytes.
    size: u64,
    /// Rotation suffix counter (part 1 = none).
    part: u32,
}

/// Spawn the background writer thread and hand back its command channel.
/// `custom` overrides the auto-named log file (Xshell-style "Save As…"
/// start); rotation still applies, with `_partN` inserted before the
/// extension of the chosen path.
fn spawn_writer(
    options: SessionLogOptions,
    host: &str,
    user: &str,
    started: SystemTime,
    seq: u64,
    custom: Option<PathBuf>,
) -> mpsc::Sender<LogEvent> {
    let host = host.to_string();
    let user = user.to_string();
    let (tx, rx) = mpsc::channel::<LogEvent>();
    std::thread::Builder::new()
        .name("session-log-writer".to_string())
        .spawn(move || writer_loop(rx, options, &host, &user, started, seq, custom))
        .expect("failed to spawn session log writer thread");
    tx
}

/// Open (or rotate to) a log file with 0600 permissions and write the
/// format-appropriate header. `custom` replaces the auto-generated path for
/// part 1; later parts suffix the chosen stem with `_partN`.
fn open_log_file(
    options: &SessionLogOptions,
    host: &str,
    user: &str,
    started: SystemTime,
    part: u32,
    seq: u64,
    custom: Option<&Path>,
) -> std::io::Result<ActiveLog> {
    let ext = ext_for(options.format);
    let path = match custom {
        Some(p) => {
            if let Some(parent) = p.parent() {
                if !parent.as_os_str().is_empty() {
                    std::fs::create_dir_all(parent)?;
                }
            }
            if part <= 1 {
                p.to_path_buf()
            } else {
                with_part_suffix(p, part)
            }
        }
        None => {
            let stem = file_stem(host, user, started, seq);
            let (date, _) = datetime_parts(started);
            let dir = log_root().join(&date);
            std::fs::create_dir_all(&dir)?;

            let file_name = if part <= 1 {
                format!("{stem}.{ext}")
            } else {
                format!("{stem}_part{part}.{ext}")
            };
            dir.join(file_name)
        }
    };

    let file = OpenOptions::new().create(true).append(true).open(&path)?;
    restrict_permissions(&file, &path)?;

    let mut writer = BufWriter::new(file);
    let existing = writer.get_ref().metadata().map(|m| m.len()).unwrap_or(0);
    if existing == 0 {
        write_header(&mut writer, options, host, user, started)?;
    }
    Ok(ActiveLog {
        size: existing,
        writer,
        path,
        part,
    })
}

fn ext_for(format: LogFormat) -> &'static str {
    match format {
        LogFormat::Text => "log",
        LogFormat::Asciicast => "cast",
    }
}

/// `name_part2.ext` — inserts the rotation suffix before the extension of a
/// (possibly custom, user-chosen) log file path.
fn with_part_suffix(path: &Path, part: u32) -> PathBuf {
    let stem = path.file_stem().map_or_else(
        || std::ffi::OsString::from("session"),
        std::ffi::OsStr::to_os_string,
    );
    let ext = path.extension().map(std::ffi::OsStr::to_os_string);
    let mut name: std::ffi::OsString = stem;
    name.push(format!("_part{part}"));
    if let Some(ext) = ext {
        name.push(".");
        name.push(ext);
    }
    path.with_file_name(name)
}

/// Best-effort 0600 on Unix. Windows ACLs default to the creating user's
/// profile directory permissions, which already excludes other users.
fn restrict_permissions(file: &File, path: &Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = file.metadata()?.permissions();
        perms.set_mode(0o600);
        file.set_permissions(perms)?;
        let _ = path;
    }
    #[cfg(not(unix))]
    {
        let _ = (file, path);
    }
    Ok(())
}

fn write_header(
    writer: &mut BufWriter<File>,
    options: &SessionLogOptions,
    host: &str,
    user: &str,
    started: SystemTime,
) -> std::io::Result<()> {
    match options.format {
        LogFormat::Text => {
            let (date, time) = datetime_parts(started);
            writeln!(writer, "# AnySSH session log")?;
            writeln!(writer, "# host: {host}")?;
            writeln!(writer, "# user: {user}")?;
            writeln!(writer, "# started: {date} {time}")?;
            writeln!(
                writer,
                "# ansi: {} timestamps: {}",
                match options.ansi {
                    AnsiMode::Keep => "keep",
                    AnsiMode::Strip => "strip",
                },
                options.timestamps
            )?;
        }
        LogFormat::Asciicast => {
            let header = json!({
                "version": 2,
                "width": 80,
                "height": 24,
                "timestamp": started
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or(Duration::ZERO)
                    .as_secs(),
                "env": { "SHELL": "anyssh", "TERM": "xterm-256color" },
                "title": format!("{host} ({user})"),
            });
            writeln!(writer, "{header}")?;
        }
    }
    writer.flush()
}

fn writer_loop(
    rx: mpsc::Receiver<LogEvent>,
    options: SessionLogOptions,
    host: &str,
    user: &str,
    started: SystemTime,
    seq: u64,
    custom: Option<PathBuf>,
) {
    // Retention / quota sweep runs here, off the connection path. Best-effort.
    cleanup_logs(&log_root(), options.retention_days, options.quota_mb);

    let mut active = match open_log_file(&options, host, user, started, 1, seq, custom.as_deref()) {
        Ok(a) => Some(a),
        Err(e) => {
            tracing::warn!(host, user, error = %e, "failed to open session log file — logging disabled for this session");
            None
        }
    };
    let max_bytes = u64::from(options.max_file_mb) * 1024 * 1024;
    let mut at_line_start = true;

    while let Ok(event) = rx.recv() {
        match event {
            LogEvent::Stop { done } => {
                if let Some(a) = active.as_mut() {
                    let _ = a.writer.flush();
                }
                drop(active);
                if let Some(done) = done {
                    let _ = done.send(());
                }
                return;
            }
            LogEvent::Output(text) => {
                let Some(a) = active.as_mut() else { continue };
                match options.format {
                    LogFormat::Text => {
                        let mut text = text;
                        if options.ansi == AnsiMode::Strip {
                            text = strip_ansi(&text);
                        }
                        if options.timestamps {
                            // Stamp every line start: a chunk may carry several
                            // lines ("a\nb\n") or a partial line across chunks.
                            let mut prefixed = String::with_capacity(text.len() + 32);
                            let mut rest = text.as_str();
                            loop {
                                if at_line_start && !rest.is_empty() {
                                    prefixed.push('[');
                                    prefixed.push_str(&clock_stamp());
                                    prefixed.push_str("] ");
                                }
                                match rest.find('\n') {
                                    Some(pos) => {
                                        let (line, tail) = rest.split_at(pos + 1);
                                        prefixed.push_str(line);
                                        rest = tail;
                                        at_line_start = true;
                                    }
                                    None => {
                                        prefixed.push_str(rest);
                                        if !rest.is_empty() {
                                            at_line_start = false;
                                        }
                                        break;
                                    }
                                }
                            }
                            text = prefixed;
                        }
                        write_chunk(
                            a,
                            text.as_bytes(),
                            max_bytes,
                            &options,
                            host,
                            user,
                            started,
                            seq,
                            custom.as_deref(),
                        );
                    }
                    LogFormat::Asciicast => {
                        let line = json!({
                            "timestamp": elapsed_secs(started),
                            "event_type": "o",
                            "event_data": text,
                        });
                        write_chunk(
                            a,
                            format!("{line}\n").as_bytes(),
                            max_bytes,
                            &options,
                            host,
                            user,
                            started,
                            seq,
                            custom.as_deref(),
                        );
                    }
                }
            }
            LogEvent::Input(text) => {
                let Some(a) = active.as_mut() else { continue };
                if options.format == LogFormat::Asciicast {
                    let line = json!({
                        "timestamp": elapsed_secs(started),
                        "event_type": "i",
                        "event_data": text,
                    });
                    write_chunk(
                        a,
                        format!("{line}\n").as_bytes(),
                        max_bytes,
                        &options,
                        host,
                        user,
                        started,
                        seq,
                        custom.as_deref(),
                    );
                }
            }
        }
    }
}

/// Seconds since the log started, as f64 (asciicast event timestamps).
fn elapsed_secs(started: SystemTime) -> f64 {
    SystemTime::now()
        .duration_since(started)
        .unwrap_or(Duration::ZERO)
        .as_secs_f64()
}

/// Write bytes, rotating first when the size cap would be exceeded.
#[allow(clippy::too_many_arguments)]
fn write_chunk(
    active: &mut ActiveLog,
    bytes: &[u8],
    max_bytes: u64,
    options: &SessionLogOptions,
    host: &str,
    user: &str,
    started: SystemTime,
    seq: u64,
    custom: Option<&Path>,
) {
    if active.size.saturating_add(bytes.len() as u64) > max_bytes {
        let next_part = active.part + 1;
        // Flush + drop the old file before opening its successor.
        let _ = active.writer.flush();
        match open_log_file(options, host, user, started, next_part, seq, custom) {
            Ok(new_active) => {
                *active = new_active;
            }
            Err(e) => {
                tracing::warn!(error = %e, "session log rotation failed — chunk dropped");
                return;
            }
        }
    }
    if active.writer.write_all(bytes).is_ok() {
        active.size += bytes.len() as u64;
    }
}

// ---------------------------------------------------------------------------
// Retention / quota cleanup
// ---------------------------------------------------------------------------

/// Delete log files older than `retention_days`, then enforce `quota_mb`
/// total volume by removing the oldest files first. Empty day directories
/// are pruned. All failures are logged and ignored — cleanup must never
/// break logging.
pub fn cleanup_logs(root: &Path, retention_days: u32, quota_mb: u32) {
    let cutoff = SystemTime::now() - Duration::from_secs(u64::from(retention_days) * 86_400);
    let quota = u64::from(quota_mb) * 1024 * 1024;

    let mut files: Vec<(PathBuf, SystemTime, u64)> = Vec::new();
    let day_dirs = match std::fs::read_dir(root) {
        Ok(rd) => rd,
        Err(_) => return, // nothing logged yet
    };
    for day in day_dirs.flatten() {
        let day_path = day.path();
        if !day_path.is_dir() {
            continue;
        }
        let mut dir_empty = true;
        if let Ok(entries) = std::fs::read_dir(&day_path) {
            for entry in entries.flatten() {
                let p = entry.path();
                let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext != "log" && ext != "cast" {
                    if p.is_file() {
                        dir_empty = false;
                    }
                    continue;
                }
                match entry.metadata() {
                    Ok(meta) => {
                        let mtime = meta.modified().unwrap_or(SystemTime::now());
                        if retention_days > 0 && mtime < cutoff {
                            if std::fs::remove_file(&p).is_err() {
                                dir_empty = false;
                            }
                        } else {
                            files.push((p, mtime, meta.len()));
                            dir_empty = false;
                        }
                    }
                    Err(_) => dir_empty = false,
                }
            }
        }
        if dir_empty {
            let _ = std::fs::remove_dir(&day_path);
        }
    }

    if quota == 0 || files.is_empty() {
        return;
    }
    let mut total: u64 = files.iter().map(|f| f.2).sum();
    if total <= quota {
        return;
    }
    files.sort_by_key(|f| f.1);
    for (path, _mtime, size) in files {
        if total <= quota {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

// ---------------------------------------------------------------------------
// SessionLogger — the per-session handle
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
#[allow(dead_code)] // host/user/format mirror SessionLogStatus for future pane UI use
pub struct LogInfo {
    pub path: PathBuf,
    pub host: String,
    pub user: String,
    pub format: LogFormat,
}

struct LoggerInner {
    active: AtomicBool,
    tx: Mutex<Option<mpsc::Sender<LogEvent>>>,
    info: Mutex<Option<LogInfo>>,
    /// The options the logger was started with (kept so a split pane can
    /// inherit the same format/ANSI/rotation settings as its source pane).
    options: Mutex<Option<SessionLogOptions>>,
    mask: Mutex<MaskState>,
}

/// Cheaply cloneable handle wired into an `SshSession`'s reader/writer task.
/// Inactive loggers cost one `AtomicBool` load per chunk — logging can be
/// toggled mid-session with zero overhead when off.
#[derive(Clone)]
pub struct SessionLogger {
    inner: Arc<LoggerInner>,
}

impl Default for SessionLogger {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionLogger {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(LoggerInner {
                active: AtomicBool::new(false),
                tx: Mutex::new(None),
                info: Mutex::new(None),
                options: Mutex::new(None),
                mask: Mutex::new(MaskState::default()),
            }),
        }
    }

    pub fn is_active(&self) -> bool {
        self.inner.active.load(Ordering::Relaxed)
    }

    /// The options this logger was started with, while it is active.
    pub fn active_options(&self) -> Option<SessionLogOptions> {
        if !self.is_active() {
            return None;
        }
        self.inner.options.lock().ok().and_then(|g| g.clone())
    }

    pub fn info(&self) -> Option<LogInfo> {
        self.inner.info.lock().ok().and_then(|g| g.clone())
    }

    /// Start logging. Returns the path of the (first) log file. A second
    /// `start` while already active is a no-op. `custom` (Xshell-style
    /// "Save As…") overrides the auto-generated path — parent directories
    /// are created as needed, and rotation suffixes the chosen stem.
    pub fn start(
        &self,
        options: SessionLogOptions,
        host: &str,
        user: &str,
        custom: Option<PathBuf>,
    ) -> Result<PathBuf, String> {
        if self.is_active() {
            return Ok(self.info().map(|i| i.path).unwrap_or_else(log_root));
        }
        let started = SystemTime::now();
        // Captured once so every rotation of this log reuses the same name.
        let seq = LOG_SEQ.fetch_add(1, Ordering::Relaxed);
        let format = options.format;
        let tx = spawn_writer(options.clone(), host, user, started, seq, custom.clone());
        let path = match &custom {
            Some(p) => p.clone(),
            None => {
                let stem = file_stem(host, user, started, seq);
                let (date, _) = datetime_parts(started);
                log_root()
                    .join(&date)
                    .join(format!("{stem}.{}", ext_for(format)))
            }
        };

        {
            let mut tx_guard = self.inner.tx.lock().map_err(|_| "logger poisoned")?;
            *tx_guard = Some(tx);
        }
        *self.inner.info.lock().map_err(|_| "logger poisoned")? = Some(LogInfo {
            path: path.clone(),
            host: host.to_string(),
            user: user.to_string(),
            format,
        });
        *self.inner.options.lock().map_err(|_| "logger poisoned")? = Some(options);
        self.inner
            .mask
            .lock()
            .map_err(|_| "logger poisoned")?
            .active = false;
        self.inner.active.store(true, Ordering::Relaxed);
        tracing::info!(host, user, "session logging started");
        Ok(path)
    }

    /// Stop logging and flush. Safe to call when not active.
    pub fn stop(&self) {
        if !self.is_active() {
            return;
        }
        self.inner.active.store(false, Ordering::Relaxed);
        let tx = self.inner.tx.lock().ok().and_then(|mut g| g.take());
        if let Some(tx) = tx {
            let (done_tx, done_rx) = mpsc::channel();
            if tx
                .send(LogEvent::Stop {
                    done: Some(done_tx),
                })
                .is_ok()
            {
                // Wait briefly for the writer to flush — bounded so a stuck
                // disk can never hang a disconnect.
                let _ = done_rx.recv_timeout(Duration::from_secs(3));
            }
        }
        if let Ok(mut info) = self.inner.info.lock() {
            *info = None;
        }
        tracing::info!("session logging stopped");
    }

    /// Feed an output chunk from the SSH reader task. No-op when inactive.
    pub fn on_output(&self, text: &str) {
        if !self.is_active() {
            return;
        }
        // Mask first (echo-of-secret → `*`), then hand the processed text on.
        let processed = self
            .inner
            .mask
            .lock()
            .map(|mut m| m.on_output(text))
            .unwrap_or_else(|_| text.to_string());
        self.send(LogEvent::Output(processed));
    }

    /// Feed an input chunk from the SSH reader task. No-op when inactive.
    /// Input is only recorded in Asciicast format, and suppressed entirely
    /// while the secret mask is armed.
    pub fn on_input(&self, text: &str) {
        if !self.is_active() {
            return;
        }
        let recordable = self
            .inner
            .mask
            .lock()
            .map(|mut m| m.on_input(text))
            .unwrap_or(false);
        if recordable {
            self.send(LogEvent::Input(text.to_string()));
        }
    }

    fn send(&self, event: LogEvent) {
        if let Ok(guard) = self.inner.tx.lock() {
            if let Some(tx) = guard.as_ref() {
                // Unbounded channel — never blocks the terminal loop. A
                // closed channel means the writer already exited (stop/drop).
                let _ = tx.send(event);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Log listing / reading / export (used by the frontend viewer commands)
// ---------------------------------------------------------------------------

/// One log file in the viewer list. `relative` is the path relative to the
/// log root — the frontend passes it back for read/export operations.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileInfo {
    pub file_name: String,
    pub relative: String,
    pub date: String,
    pub size: u64,
    /// Unix epoch seconds of the last modification.
    pub modified: u64,
}

/// The payload of the log-read command: a (possibly truncated) tail of the
/// file plus whether content was cut off at the front.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogReadResult {
    pub content: String,
    pub truncated: bool,
}

/// List every log file under the root, newest first.
pub fn list_logs() -> Vec<LogFileInfo> {
    let root = log_root();
    let mut out = Vec::new();
    let Ok(day_dirs) = std::fs::read_dir(&root) else {
        return out;
    };
    for day in day_dirs.flatten() {
        let day_path = day.path();
        if !day_path.is_dir() {
            continue;
        }
        let date = day.file_name().to_string_lossy().to_string();
        if let Ok(entries) = std::fs::read_dir(&day_path) {
            for entry in entries.flatten() {
                let p = entry.path();
                let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
                if ext != "log" && ext != "cast" {
                    continue;
                }
                let Ok(meta) = entry.metadata() else { continue };
                let rel = p
                    .strip_prefix(&root)
                    .map(|r| r.to_string_lossy().to_string())
                    .unwrap_or_default();
                out.push(LogFileInfo {
                    file_name: p
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    relative: rel,
                    date: date.clone(),
                    size: meta.len(),
                    modified: meta
                        .modified()
                        .ok()
                        .and_then(|m| m.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0),
                });
            }
        }
    }
    out.sort_by_key(|f| std::cmp::Reverse(f.modified));
    out
}

/// Validate that `relative` stays inside the log root (no `..` escapes) and
/// resolve it to an absolute path.
fn resolve_log_path(relative: &str) -> Result<PathBuf, String> {
    let root = log_root();
    let candidate = PathBuf::from(relative);
    if candidate.is_absolute()
        || candidate
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("log path must be relative to the log directory".to_string());
    }
    let full = root.join(&candidate);
    let canonical = full
        .canonicalize()
        .map_err(|e| format!("log file not found: {e}"))?;
    let canonical_root = root
        .canonicalize()
        .map_err(|e| format!("log root unavailable: {e}"))?;
    if !canonical.starts_with(&canonical_root) {
        return Err("log path escapes the log directory".to_string());
    }
    Ok(canonical)
}

/// Read a log file (capped), optionally keeping only the tail. Returns
/// lossy UTF-8 — a truncated multi-byte char at a chunk boundary must not
/// fail the read.
pub fn read_log(relative: &str, max_bytes: u64) -> Result<(String, bool), String> {
    let path = resolve_log_path(relative)?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let size = meta.len();
    let start = size.saturating_sub(max_bytes);
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let slice = &bytes[start as usize..];
    let truncated = start > 0;
    Ok((String::from_utf8_lossy(slice).into_owned(), truncated))
}

/// Export a log file to `dest`, optionally stripping ANSI sequences for a
/// clean text copy.
pub fn export_log(relative: &str, dest: &str, strip: bool) -> Result<(), String> {
    let path = resolve_log_path(relative)?;
    let content = std::fs::read_to_string(&path).map_err(|e| format!("failed to read log: {e}"))?;
    let out = if strip { strip_ansi(&content) } else { content };
    std::fs::write(dest, out).map_err(|e| format!("failed to write export: {e}"))
}

/// The absolute log root, for the "open log directory" action.
pub fn logs_dir_string() -> String {
    log_root().to_string_lossy().to_string()
}

// ---------------------------------------------------------------------------
// Session wiring
// ---------------------------------------------------------------------------

/// Everything an `SshSession` needs to wire logging into its reader/writer
/// task: the per-session logger handle, plus the host/user metadata used for
/// file naming and the auto-start decision resolved at connect time.
#[derive(Clone)]
pub struct SessionLogContext {
    pub logger: SessionLogger,
    /// Hostname as written in the connection config (file-name component).
    pub host: String,
    /// SSH username (file-name component).
    pub user: String,
    /// `Some(options)` starts logging the moment the PTY opens (global
    /// auto-record or a bookmark preset forcing it on).
    pub auto_start: Option<SessionLogOptions>,
}

impl SessionLogContext {
    /// A logging-capable but inactive context (manual toggle still possible).
    pub fn inactive(host: String, user: String) -> Self {
        Self {
            logger: SessionLogger::new(),
            host,
            user,
            auto_start: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ── strip_ansi ──────────────────────────────────────────────────────

    #[test]
    fn strip_ansi_removes_csi_osc_and_keeps_text() {
        assert_eq!(strip_ansi("\x1b[31mred\x1b[0m"), "red");
        assert_eq!(strip_ansi("\x1b[1;32;42mok\x1b[m"), "ok");
        // OSC 8 hyperlink with BEL terminator
        assert_eq!(strip_ansi("\x1b]8;;https://x\x07link\x1b]8;;\x07"), "link");
        // OSC with ST terminator
        assert_eq!(strip_ansi("\x1b]0;title\x1b\\body"), "body");
        // Cursor movement + two-byte ESC sequences
        assert_eq!(strip_ansi("a\x1b[2K\x1b[1;5Hb\x1bMc"), "abc");
        // Charset designator ESC ( B
        assert_eq!(strip_ansi("\x1b(Bx"), "x");
        // No escapes → unchanged
        assert_eq!(strip_ansi("plain 中文"), "plain 中文");
        // Trailing ESC is dropped, not emitted
        assert_eq!(strip_ansi("text\x1b"), "text");
    }

    // ── File naming ─────────────────────────────────────────────────────

    #[test]
    fn sanitize_component_blocks_path_and_shell_hostile_chars() {
        assert_eq!(sanitize_component("web-01"), "web-01");
        assert_eq!(sanitize_component("../../etc"), "______etc");
        assert_eq!(sanitize_component("生产环境"), "____");
        assert_eq!(sanitize_component("a/b\\c:d"), "a_b_c_d");
        assert_eq!(sanitize_component(""), "host");
        assert_eq!(sanitize_component(&"x".repeat(100)).len(), 60);
    }

    #[test]
    fn file_stem_has_expected_shape() {
        let t = UNIX_EPOCH + Duration::from_secs(0);
        let stem = file_stem("prod.web", "root", t, 7);
        assert!(stem.starts_with("prod.web_root_19700101_"), "{stem}");
        assert!(stem.ends_with("_07"), "{stem}");
        // No path separators can survive.
        assert!(!stem.contains('/'));
    }

    #[test]
    fn file_stem_seq_disambiguates_same_instant_starts() {
        let t = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
        let a = file_stem("h", "u", t, 0);
        let b = file_stem("h", "u", t, 1);
        assert_ne!(a, b, "same-ms starts must not share a file name");
        // The stem must be a pure function of (host, user, started, seq):
        // start() captures the seq once and every rotation reuses it, so the
        // same inputs must reproduce the identical stem.
        assert_eq!(a, file_stem("h", "u", t, 0));
    }

    // ── Masking state machine ───────────────────────────────────────────

    #[test]
    fn mask_armed_by_password_prompt_masks_echo() {
        let mut m = MaskState::default();

        // Normal command line is untouched.
        assert_eq!(m.on_output("user@host:~$ "), "user@host:~$ ");
        assert!(m.on_input("ls -la\r"));

        // Password prompt arms the mask.
        assert_eq!(m.on_output("Password: "), "Password: ");

        // Typed chars are recorded as pending input…
        assert!(!m.on_input("s3cret")); // suppressed (asciicast)
                                        // …and the server's echo of them is masked.
        assert_eq!(m.on_output("s3c"), "***");
        assert_eq!(m.on_output("ret"), "***");
        // Enter ends the line and disarms the mask.
        assert_eq!(m.on_output("\r\n"), "\r\n");
        // Subsequent output is unmasked again.
        assert_eq!(m.on_output("user@host:~$ "), "user@host:~$ ");
    }

    #[test]
    fn mask_handles_chinese_bastion_prompts() {
        let mut m = MaskState::default();
        assert_eq!(m.on_output("请输入密码："), "请输入密码：");
        assert!(!m.on_input("p@ssw0rd"));
        assert_eq!(m.on_output("p@"), "**");
        assert_eq!(m.on_output("ssw0rd"), "******");
        assert_eq!(m.on_output("\n"), "\n");
        assert!(m.on_input("ls\r"));
    }

    #[test]
    fn mask_disarms_on_hidden_prompt_without_echo() {
        let mut m = MaskState::default();
        assert_eq!(m.on_output("Password:"), "Password:");
        assert!(!m.on_input("hidden"));
        // Server echoes nothing — the next output is the failure/prompt line.
        assert_eq!(m.on_output("\r\nLogin incorrect"), "\r\nLogin incorrect");
        assert!(m.on_input("ls\r"));
    }

    #[test]
    fn mask_resets_pending_input_between_lines() {
        let mut m = MaskState::default();
        assert_eq!(m.on_output("Password:"), "Password:");
        assert!(!m.on_input("abc"));
        assert!(!m.on_input("\r")); // enter: pending reset
                                    // "abc" is NOT the password anymore — the new line's echo passes through.
        assert_eq!(m.on_output("abc"), "abc");
    }

    #[test]
    fn mask_armed_by_otp_and_dynamic_code_prompts() {
        let mut m = MaskState::default();
        assert_eq!(
            m.on_output("Please enter your OTP:"),
            "Please enter your OTP:"
        );
        assert_eq!(m.on_output("动态码:"), "动态码:");
        // Still armed: no newline has been seen since the prompt.
        assert!(!m.on_input("123456"));
    }

    // ── Logger lifecycle (real files, in a temp root) ───────────────────

    struct TempRoot(PathBuf);
    impl TempRoot {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "anyssh-logtest-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    // `install_root` is OnceLock-based — it can only take effect once per
    // process, so per-test roots are impossible. Instead: one shared root,
    // created lazily and never dropped, plus a mutex so the file-system
    // tests (which sweep/clean the whole root) run serially.
    static FS_TEST_GUARD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    static FS_TEST_ROOT: OnceLock<PathBuf> = OnceLock::new();

    /// Serialise against the other fs tests and point LOG_ROOT at a shared
    /// per-process directory. The returned guard must be held for the whole
    /// test body.
    fn with_test_root() -> std::sync::MutexGuard<'static, ()> {
        let guard = FS_TEST_GUARD.lock().unwrap_or_else(|p| p.into_inner());
        let root = FS_TEST_ROOT.get_or_init(|| {
            TempRoot::new().0 // intentionally leaked for the process lifetime
        });
        install_root(root);
        guard
    }

    #[test]
    fn logger_start_writes_header_and_output() {
        let _root = with_test_root();
        let logger = SessionLogger::new();
        let path = logger
            .start(SessionLogOptions::default(), "prod.web", "root", None)
            .unwrap();

        logger.on_output("user@host:~$ ");
        logger.on_input("ls\r");
        logger.on_output("-rw-r--r-- file\n");
        logger.stop();

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("# AnySSH session log"));
        assert!(content.contains("# host: prod.web"));
        assert!(content.contains("user@host:~$ -rw-r--r-- file"));
        // Text format records output only — input is not duplicated.
        assert!(!content.contains("event_type"));
    }

    #[test]
    fn logger_inactive_is_a_noop() {
        let _root = with_test_root();
        let logger = SessionLogger::new();
        logger.on_output("ignored");
        logger.on_input("ignored");
        logger.stop(); // no-op
        assert!(logger.info().is_none());
    }

    #[test]
    fn logger_stop_flushes_pending_writes() {
        let _root = with_test_root();
        let logger = SessionLogger::new();
        let path = logger
            .start(SessionLogOptions::default(), "hstop", "u", None)
            .unwrap();
        // Multiple rapid chunks then immediate stop — stop must flush.
        for i in 0..100 {
            logger.on_output(&format!("line {i}\n"));
        }
        logger.stop();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("line 99"));
    }

    #[test]
    fn logger_rotates_on_size_cap() {
        let _root = with_test_root();
        // Verify the rotation naming rule directly: part 2 gets the _part2
        // suffix in the same day directory.
        let started = SystemTime::now();
        let a = open_log_file(
            &SessionLogOptions::default(),
            "hrot",
            "u",
            started,
            1,
            0,
            None,
        )
        .unwrap();
        let b = open_log_file(
            &SessionLogOptions::default(),
            "hrot",
            "u",
            started,
            2,
            0,
            None,
        )
        .unwrap();
        assert!(a.path.to_string_lossy().ends_with(".log"));
        assert!(b
            .path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with("_part2.log"));
        assert_ne!(a.path, b.path);
    }

    #[test]
    fn logger_asciicast_records_io_events() {
        let _root = with_test_root();
        let logger = SessionLogger::new();
        let options = SessionLogOptions {
            format: LogFormat::Asciicast,
            ..Default::default()
        };
        let path = logger.start(options, "hcast", "u", None).unwrap();
        logger.on_output("hello\n");
        logger.on_input("ls\r");
        logger.stop();

        let content = std::fs::read_to_string(&path).unwrap();
        let mut lines = content.lines();
        let header: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
        assert_eq!(header["version"], 2);
        let events: Vec<serde_json::Value> =
            lines.map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(events[0]["event_type"], "o");
        assert_eq!(events[0]["event_data"], "hello\n");
        assert_eq!(events[1]["event_type"], "i");
        assert_eq!(events[1]["event_data"], "ls\r");
    }

    #[test]
    fn logger_masks_echoed_secrets_in_text_log() {
        let _root = with_test_root();
        let logger = SessionLogger::new();
        let path = logger
            .start(SessionLogOptions::default(), "hmask", "u", None)
            .unwrap();
        logger.on_output("Password: ");
        logger.on_input("hunter2");
        logger.on_output("hunter2\r\n"); // server echo
        logger.stop();

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("Password: "), "prompt itself is logged");
        assert!(content.contains("*******"), "echo is masked");
        assert!(!content.contains("hunter2"), "secret must not appear");
    }

    #[test]
    fn logger_strip_ansi_option_produces_clean_text() {
        let _root = with_test_root();
        let logger = SessionLogger::new();
        let path = logger
            .start(SessionLogOptions::default(), "hstrip", "u", None)
            .unwrap();
        logger.on_output("\x1b[31mred\x1b[0m\n");
        logger.stop();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("red\n"));
        assert!(
            !content.contains('\x1b'),
            "escape sequences must be stripped"
        );
    }

    #[test]
    fn logger_keep_ansi_option_preserves_escapes() {
        let _root = with_test_root();
        let logger = SessionLogger::new();
        let options = SessionLogOptions {
            ansi: AnsiMode::Keep,
            ..Default::default()
        };
        let path = logger.start(options, "hkeep", "u", None).unwrap();
        logger.on_output("\x1b[31mred\x1b[0m\n");
        logger.stop();
        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("\x1b[31m"));
    }

    #[test]
    fn logger_timestamps_prefix_line_starts() {
        let _root = with_test_root();
        let logger = SessionLogger::new();
        let options = SessionLogOptions {
            timestamps: true,
            ..Default::default()
        };
        let path = logger.start(options, "hts", "u", None).unwrap();
        logger.on_output("first\n");
        logger.on_output("second\n");
        logger.stop();
        let content = std::fs::read_to_string(&path).unwrap();
        // Two lines, two stamps.
        let stamps = content.matches("] ").count();
        assert!(stamps >= 2, "expected line stamps, got: {content}");
        // The second chunk continued on a fresh line → got its own stamp.
        assert!(content.contains("second"), "{content}");
    }

    #[test]
    fn logger_start_with_custom_path_writes_there() {
        let _root = with_test_root();
        // Xshell-style "Save As…": the user picks an arbitrary location; the
        // writer must create parent dirs and land exactly there.
        let custom = log_root().join("custom-dir").join("picked.log");
        let logger = SessionLogger::new();
        let path = logger
            .start(
                SessionLogOptions::default(),
                "hcust",
                "u",
                Some(custom.clone()),
            )
            .unwrap();
        assert_eq!(path, custom);
        logger.on_output("custom-location\n");
        logger.stop();

        let content = std::fs::read_to_string(&custom).unwrap();
        assert!(content.contains("# AnySSH session log"));
        assert!(content.contains("custom-location"));
        // 0600 on the user-chosen file too.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&custom).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn with_part_suffix_inserts_before_extension() {
        let p = PathBuf::from("/tmp/picked.log");
        assert_eq!(
            with_part_suffix(&p, 2),
            PathBuf::from("/tmp/picked_part2.log")
        );
        let no_ext = PathBuf::from("/tmp/picked");
        assert_eq!(
            with_part_suffix(&no_ext, 3),
            PathBuf::from("/tmp/picked_part3")
        );
    }

    #[test]
    fn cleanup_respects_retention_and_quota() {
        let _root = with_test_root();

        // Retention: a file whose mtime is 20 years back must be deleted,
        // while fresh files survive the same sweep.
        let old_dir = log_root().join("2020-01-01");
        std::fs::create_dir_all(&old_dir).unwrap();
        let old_file = old_dir.join("h_u_20200101_000000.log");
        std::fs::write(&old_file, "old").unwrap();
        let f = std::fs::File::options()
            .append(true)
            .open(&old_file)
            .unwrap();
        f.set_times(
            std::fs::FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(1_577_836_800)),
        )
        .unwrap();
        drop(f);

        let fresh_dir = log_root().join("2099-01-01");
        std::fs::create_dir_all(&fresh_dir).unwrap();
        let f1 = fresh_dir.join("h_u_20990101_000001.log");
        let f2 = fresh_dir.join("h_u_20990101_000002.log");
        // ~600 KB each — 1.2 MB total, above the 1 MB quota used below.
        std::fs::write(&f1, "x".repeat(600_000)).unwrap();
        std::fs::write(&f2, "x".repeat(600_000)).unwrap();
        // Guarantee distinct mtimes so "oldest first" is deterministic.
        std::thread::sleep(Duration::from_millis(20));

        // Retention sweep: 30 days keeps the fresh pair, deletes the old one.
        cleanup_logs(&log_root(), 30, 0);
        assert!(!old_file.exists(), "stale file must be removed");
        assert!(f1.exists() && f2.exists(), "fresh files survive");

        // Quota 0 = unlimited — nothing further removed.
        cleanup_logs(&log_root(), 0, 0);
        assert!(f1.exists() && f2.exists());

        // Quota (1 MB) below the ~1.2 MB total → the oldest file goes first.
        cleanup_logs(&log_root(), 0, 1);
        let remaining: Vec<String> = std::fs::read_dir(&fresh_dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();
        assert_eq!(remaining.len(), 1, "quota must remove the oldest file");
        assert!(
            remaining[0].contains("000002"),
            "newest file survives: {remaining:?}"
        );
    }
}
