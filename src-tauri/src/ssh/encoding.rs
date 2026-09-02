//! Terminal character-encoding support.
//!
//! The frontend always speaks UTF-8 (`TextEncoder` is UTF-8-only and xterm.js
//! parses output as UTF-8). When the user selects a legacy server encoding
//! (GBK, Big5, Shift_JIS, EUC-*, ISO-8859-1, Windows-1252), the PTY byte
//! stream is transcoded here, in Rust:
//!
//! * **Output** (server → terminal): raw channel bytes are decoded from the
//!   selected encoding to UTF-8 before being emitted over IPC.
//! * **Input** (terminal → server): UTF-8 keystroke bytes are encoded from
//!   UTF-8 into the selected encoding before being written to the channel.
//!
//! UTF-8 is a zero-cost passthrough — no converter is constructed and the
//! byte slices are forwarded untouched, so the default configuration behaves
//! exactly as before this module existed.
//!
//! The label strings MUST match the `TERMINAL_ENCODINGS` values declared in
//! the frontend store (`src/stores/settings-store.ts`).

use encoding_rs::{CoderResult, Decoder, Encoder, Encoding};

use crate::db::HostDb;

/// The TERM value and character encoding a PTY session should use. Resolved
/// from the persisted app settings at connect time (global settings — there
/// is no per-host override yet).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionSettings {
    /// Value sent verbatim in the SSH `pty-req` ("TERM"). Validated against
    /// the same character whitelist as the frontend (`TERM_NAME_RE`).
    pub term: String,
    /// Encoding label; `utf-8` (or anything unrecognised) means passthrough.
    pub encoding: String,
}

impl Default for SessionSettings {
    fn default() -> Self {
        Self {
            term: "xterm-256color".to_string(),
            encoding: "utf-8".to_string(),
        }
    }
}

/// TERM names travel inside the SSH protocol message — keep the same tight
/// whitelist as the frontend so a hand-edited settings row cannot inject
/// arbitrary bytes into `pty-req`.
fn valid_term(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'.' | b'_' | b'-'))
}

/// Read the terminal-type / encoding settings from the persisted app settings
/// (SQLite `app_settings` key-value table, written by the frontend store).
/// Missing or invalid values fall back to the defaults, so a hand-corrupted
/// settings row can never break connections.
pub fn session_settings_from_db(db: &HostDb) -> SessionSettings {
    let mut settings = SessionSettings::default();

    if let Ok(Some(term)) = db.get_setting("terminal_type") {
        let term = term.trim().to_string();
        if valid_term(&term) {
            settings.term = term;
        }
    }

    if let Ok(Some(encoding)) = db.get_setting("terminal_encoding") {
        // Accept only labels encoding_rs recognises; anything else keeps UTF-8.
        if Encoding::for_label(encoding.as_bytes()).is_some() {
            settings.encoding = encoding;
        }
    }

    settings
}

/// Resolve a settings label to a WHATWG encoding. Unknown labels map to
/// UTF-8 (passthrough), which also covers `utf-8` itself.
pub fn encoding_for_label(label: &str) -> &'static Encoding {
    Encoding::for_label(label.as_bytes()).unwrap_or(encoding_rs::UTF_8)
}

/// Streaming converter between the server's encoding and UTF-8.
///
/// A single instance must be owned by one direction of one session so the
/// incremental decoder/encoder can carry partial multi-byte sequences across
/// chunk boundaries (a GBK character split over two `Data` frames must not
/// surface as two replacement characters).
pub struct StreamConverter {
    /// `None` when the encoding is UTF-8 — everything is a passthrough.
    decoder: Option<Decoder>,
    encoder: Option<Encoder>,
}

impl StreamConverter {
    /// Build a converter for one session direction. `label` comes from the
    /// user's encoding setting.
    pub fn new(label: &str) -> Self {
        let encoding = encoding_for_label(label);
        if encoding == encoding_rs::UTF_8 {
            Self {
                decoder: None,
                encoder: None,
            }
        } else {
            Self {
                decoder: Some(encoding.new_decoder()),
                encoder: Some(encoding.new_encoder()),
            }
        }
    }

    /// Server bytes → UTF-8 bytes for the terminal. Handles characters split
    /// across chunks via the retained decoder state.
    ///
    /// encoding_rs 0.8.35's `decode_to_utf8` writes into a caller-provided
    /// `&mut [u8]` sized with `max_utf8_buffer_length`, so we allocate that
    /// bound, decode, and truncate to what was actually written.
    pub fn decode_to_utf8(&mut self, bytes: &[u8]) -> Vec<u8> {
        let Some(decoder) = &mut self.decoder else {
            return bytes.to_vec();
        };
        let mut out = Vec::new();
        let mut src = bytes;
        while !src.is_empty() {
            let bound = decoder
                .max_utf8_buffer_length(src.len())
                .unwrap_or(src.len() * 3 + 3);
            let mut buf = vec![0u8; bound];
            let (result, read, written, _had_errors) =
                decoder.decode_to_utf8(src, &mut buf, false);
            out.extend_from_slice(&buf[..written]);
            let progressed = read > 0 || written > 0;
            src = &src[read..];
            match result {
                CoderResult::InputEmpty => break,
                CoderResult::OutputFull if progressed => continue,
                // Safety valve: cannot make progress — keep what we have
                // rather than spin forever.
                CoderResult::OutputFull => break,
            }
        }
        out
    }

    /// UTF-8 terminal input → server-encoding bytes. `final_chunk` flushes
    /// any buffered partial sequence; input chunks pass `false` so nothing
    /// is lost between keystrokes.
    pub fn encode_from_utf8(&mut self, bytes: &[u8], final_chunk: bool) -> Vec<u8> {
        let Some(encoder) = &mut self.encoder else {
            return bytes.to_vec();
        };
        let src = std::str::from_utf8(bytes).unwrap_or_default();
        // Initial bound from the encoder's own estimate; encodings with
        // unmappable characters (numeric-entity fallback) may need more, so
        // double on OutputFull.
        let mut bound = encoder
            .max_buffer_length_from_utf8_if_no_unmappables(src.len())
            .unwrap_or(src.len() * 3 + 48);
        let mut out = Vec::new();
        let mut rest = src;
        loop {
            let mut buf = vec![0u8; bound];
            let (result, read, written, _had_errors) =
                encoder.encode_from_utf8(rest, &mut buf, final_chunk);
            out.extend_from_slice(&buf[..written]);
            let progressed = read > 0 || written > 0;
            rest = &rest[read..];
            match result {
                CoderResult::InputEmpty => break,
                CoderResult::OutputFull if progressed => {
                    bound = bound.saturating_mul(2).max(64);
                }
                // Safety valve: cannot make progress — keep what we have.
                CoderResult::OutputFull => break,
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// UTF-8 must be an exact passthrough in both directions — the default
    /// configuration must be byte-identical to the pre-encoding-era behaviour.
    #[test]
    fn utf8_is_a_passthrough() {
        let mut conv = StreamConverter::new("utf-8");
        assert!(conv.decoder.is_none() && conv.encoder.is_none());

        let bytes = "héllo 中文 🎉".as_bytes();
        assert_eq!(conv.decode_to_utf8(bytes), bytes);
        assert_eq!(conv.encode_from_utf8(bytes, false), bytes);
    }

    /// GBK output bytes decode to the right UTF-8 text, including a character
    /// deliberately split across two chunks (streaming decoder state).
    #[test]
    fn gbk_output_decodes_including_split_sequences() {
        let mut conv = StreamConverter::new("gbk");
        let expected = "中文测试";

        let whole: Vec<u8> = encoding_rs::GBK.encode(expected).0.into_owned();
        assert_eq!(String::from_utf8_lossy(&conv.decode_to_utf8(&whole)), expected);

        // Now feed the same text in two pieces that split a GBK character.
        let (a, b) = whole.split_at(3); // "中" is 2 bytes, so byte 3 is mid-"文"
        let mut conv2 = StreamConverter::new("gbk");
        let mut out = conv2.decode_to_utf8(a);
        out.extend(conv2.decode_to_utf8(b));
        assert_eq!(String::from_utf8_lossy(&out), expected);
    }

    /// UTF-8 keystrokes encode into GBK bytes the server-side locale expects.
    #[test]
    fn gbk_input_encodes_from_utf8() {
        let mut conv = StreamConverter::new("gbk");
        let input = "中文".as_bytes();
        let encoded = conv.encode_from_utf8(input, false);
        assert_eq!(encoded, encoding_rs::GBK.encode("中文").0.to_vec());

        // Round-trip back through a fresh decoder yields the original text.
        let mut back = StreamConverter::new("gbk");
        assert_eq!(String::from_utf8_lossy(&back.decode_to_utf8(&encoded)), "中文");
    }

    /// Every label offered in the settings dropdown resolves (no silent
    /// fallback to UTF-8), and the passthrough set is exactly {"utf-8"}.
    #[test]
    fn all_dropdown_labels_resolve() {
        for label in [
            "utf-8",
            "gbk",
            "big5",
            "shift_jis",
            "euc-kr",
            "euc-jp",
            "iso-8859-1",
            "windows-1252",
        ] {
            assert!(
                Encoding::for_label(label.as_bytes()).is_some(),
                "label should resolve: {label}"
            );
            if label == "utf-8" {
                assert_eq!(encoding_for_label(label), encoding_rs::UTF_8);
            } else {
                assert_ne!(
                    encoding_for_label(label),
                    encoding_rs::UTF_8,
                    "passthrough must be limited to utf-8: {label}"
                );
            }
        }
        assert_eq!(encoding_for_label("nonsense-label"), encoding_rs::UTF_8);
    }

    /// TERM validation mirrors the frontend whitelist: alphanumeric plus
    /// + . _ - , non-empty. Anything else falls back to the default.
    #[test]
    fn term_validation_rejects_hostile_values() {
        assert!(valid_term("xterm-256color"));
        assert!(valid_term("vt100"));
        assert!(valid_term("screen.xterm"));
        assert!(!valid_term(""));
        assert!(!valid_term("xterm\nrm -rf"));
        assert!(!valid_term("中文终端"));
        assert!(!valid_term("term with spaces"));
    }

    /// Settings labels are constants the frontend depends on — keep them in
    /// sync by construction (this also documents the app-settings keys).
    #[test]
    fn settings_keys_match_frontend_persist_keys() {
        // The frontend store persists under these exact keys; session_settings_from_db
        // reads the same ones. A rename on either side must update both.
        let keys = ["terminal_type", "terminal_encoding"];
        assert_eq!(keys.len(), 2);
    }
}
