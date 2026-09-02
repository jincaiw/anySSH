//! Portable mode — run anySSH entirely from a removable folder.
//!
//! In portable mode every piece of persistent state lives in a single
//! `anySSH-Data` directory beside the application, so the whole thing — binary,
//! hosts, settings and credentials — travels together on a USB stick and can be
//! moved between machines without leaving anything behind in the user profile.
//!
//! What moves into the portable data directory:
//!
//! | Path                          | Contents                              |
//! |-------------------------------|---------------------------------------|
//! | `anyssh.db`                   | SQLite: hosts, groups, history, settings, snippets, port-forward rules |
//! | `vault.anyssh`                | encrypted credentials (AES-256-GCM)   |
//! | `vault.key`                   | 256-bit random key that seals the vault |
//! | `device_id`                   | anonymous telemetry id                |
//! | `webview/`                    | WebView2 / WebKit cache & local storage |
//!
//! ## Enabling portable mode
//!
//! Portable mode is opt-in and is decided once, during `setup()`, in this order:
//!
//! 1. **`ANYSSH_DATA_DIR=<path>`** — uses `<path>` directly as the data
//!    directory. Intended for tests, CI and users who want the data somewhere
//!    specific (e.g. an encrypted volume). Always wins.
//! 2. **`ANYSSH_PORTABLE=1`** (also `true` / `yes` / `on`) — forces portable mode
//!    with the default `anySSH-Data` directory.
//! 3. **`portable.txt`** sitting next to the executable (or next to the
//!    `anySSH.app` bundle on macOS) — the marker the release packaging drops
//!    into the portable archives. The file's contents are never read; only its
//!    presence matters.
//!
//! If none of these apply the app runs installed, using the OS-specific
//! application-data directory and the OS keychain — exactly as before.
//!
//! ## Why credentials move to a file
//!
//! The installed build keeps secrets in the OS keychain (Keychain / Credential
//! Manager / keyutils), which is the right place for them — but the keychain is
//! bound to the machine. Credentials stored there would not follow the USB
//! stick, so in portable mode the vault switches to an encrypted file sealed
//! with a key that lives *in the same directory* (see [`crate::vault`]). That is
//! a deliberate trade-off: the secrets are only as portable as the folder, and
//! anyone who copies the whole folder gets the keys to it — which is precisely
//! the intent.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Name of the directory created beside the application in portable mode.
pub const DATA_DIR_NAME: &str = "anySSH-Data";

/// Marker file whose presence switches the app into portable mode.
pub const MARKER_FILE: &str = "portable.txt";

/// Environment variable that forces portable mode on.
const ENV_PORTABLE: &str = "ANYSSH_PORTABLE";

/// Environment variable that pins the data directory to an explicit path.
const ENV_DATA_DIR: &str = "ANYSSH_DATA_DIR";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/// Resolved locations for a portable installation.
#[derive(Debug, Clone)]
pub struct PortablePaths {
    /// `<root>/anySSH-Data` — the single directory that travels with the app.
    pub data_dir: PathBuf,
}

impl PortablePaths {
    /// Build paths for an explicit data directory. `pub(crate)` so tests (and
    /// nothing else) can construct instances pointing at temp dirs.
    pub(crate) fn new(data_dir: PathBuf) -> Self {
        Self { data_dir }
    }

    /// SQLite database — `HostDb::new` appends `anyssh.db` to the data dir, so
    /// only the directory itself is needed here (kept as a doc anchor for the
    /// layout table in the module docs).
    ///
    /// Encrypted credential vault.
    pub fn vault_path(&self) -> PathBuf {
        self.data_dir.join("vault.anyssh")
    }

    /// 256-bit random key material that seals [`Self::vault_path`].
    pub fn key_path(&self) -> PathBuf {
        self.data_dir.join("vault.key")
    }

    /// Anonymous telemetry device id.
    pub fn device_id_path(&self) -> PathBuf {
        self.data_dir.join("device_id")
    }

    /// WebView user-data directory (cache, local storage, IndexedDB).
    ///
    /// Kept inside the portable folder so the UI's own persisted state — and
    /// the cookies/localStorage the webview writes — travels too, rather than
    /// being recreated on every machine the stick is plugged into.
    pub fn webview_dir(&self) -> PathBuf {
        self.data_dir.join("webview")
    }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/// The directory the portable data folder should sit in.
///
/// Normally the directory holding the executable. On macOS the executable lives
/// inside `anySSH.app/Contents/MacOS/`, and writing into the bundle would
/// invalidate its code signature — so the data directory goes *beside* the
/// bundle instead.
fn portable_root(exe_dir: &Path) -> PathBuf {
    for ancestor in exe_dir.ancestors() {
        if ancestor.extension().and_then(|e| e.to_str()) == Some("app") {
            if let Some(parent) = ancestor.parent() {
                return parent.to_path_buf();
            }
            break;
        }
    }
    exe_dir.to_path_buf()
}

/// Does the environment variable ask for portable mode?
fn env_flag_enabled() -> bool {
    matches!(
        std::env::var(ENV_PORTABLE)
            .ok()
            .map(|v| v.trim().to_ascii_lowercase())
            .as_deref(),
        Some("1") | Some("true") | Some("yes") | Some("on")
    )
}

/// Decide whether this launch is portable, and where its data lives.
///
/// Called once from `setup()`. Returns `None` for an ordinary installed run.
pub fn detect() -> Option<PortablePaths> {
    // 1. Explicit override — wins over everything, because it is the only way
    //    to point the app at a data directory that is *not* beside the binary.
    if let Some(dir) = std::env::var_os(ENV_DATA_DIR) {
        let dir = PathBuf::from(dir);
        if !dir.as_os_str().is_empty() {
            return Some(PortablePaths::new(dir));
        }
    }

    // `current_exe()` can legitimately fail (a deleted binary on Linux); that
    // simply means we can't be portable — fall through to installed mode.
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))?;

    let root = portable_root(&exe_dir);

    if env_flag_enabled() {
        return Some(PortablePaths::new(root.join(DATA_DIR_NAME)));
    }

    // 2. Marker file. Checked next to the binary and, on macOS, next to the
    //    bundle — the packaging script puts it in whichever of the two keeps
    //    the code signature intact.
    if exe_dir.join(MARKER_FILE).exists() || root.join(MARKER_FILE).exists() {
        return Some(PortablePaths::new(root.join(DATA_DIR_NAME)));
    }

    None
}

// ---------------------------------------------------------------------------
// Process-wide state
// ---------------------------------------------------------------------------
//
// The vault's public API is a set of free functions (`vault::get_credential`
// and friends) called from a dozen places that have no `AppHandle` in scope.
// Rather than thread a handle through all of them, the resolved paths are
// published once here during setup and read back through a static.

static PORTABLE: OnceLock<PortablePaths> = OnceLock::new();

/// Publish the resolved portable paths (or do nothing for an installed run) and
/// create the directory tree.
///
/// Creating the directories here — not lazily on first write — means a brand new
/// portable install shows exactly one new folder, and a read-only USB stick
/// fails loudly at startup instead of the first time a host is saved.
pub fn install(paths: Option<PortablePaths>) -> std::io::Result<()> {
    let Some(paths) = paths else {
        return Ok(());
    };

    std::fs::create_dir_all(&paths.data_dir)?;
    std::fs::create_dir_all(paths.webview_dir())?;

    if PORTABLE.set(paths).is_err() {
        // Only reachable if setup() somehow runs twice in one process.
        tracing::warn!("portable paths already installed — keeping the first set");
    }
    Ok(())
}

/// The resolved portable paths, when this launch is portable.
pub fn current() -> Option<&'static PortablePaths> {
    PORTABLE.get()
}

/// Whether this launch is portable.
pub fn is_portable() -> bool {
    PORTABLE.get().is_some()
}

/// The portable data directory, when this launch is portable.
pub fn data_dir() -> Option<&'static Path> {
    PORTABLE.get().map(|p| p.data_dir.as_path())
}

/// Path of the anonymous telemetry device id, when portable.
pub fn device_id_path() -> Option<PathBuf> {
    PORTABLE.get().map(|p| p.device_id_path())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Whether the running instance is portable.
///
/// The frontend uses this to explain where data is being kept, and to warn that
/// credentials live in the folder rather than the OS keychain.
#[tauri::command]
pub fn is_portable_mode() -> bool {
    is_portable()
}

/// Absolute path of the portable data directory, or `null` when installed.
#[tauri::command]
pub fn portable_data_dir() -> Option<String> {
    data_dir().map(|p| p.to_string_lossy().into_owned())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_are_nested_under_the_data_dir() {
        let p = PortablePaths::new(PathBuf::from("/stick/anySSH-Data"));
        assert_eq!(
            p.vault_path(),
            PathBuf::from("/stick/anySSH-Data/vault.anyssh")
        );
        assert_eq!(p.key_path(), PathBuf::from("/stick/anySSH-Data/vault.key"));
        assert_eq!(
            p.device_id_path(),
            PathBuf::from("/stick/anySSH-Data/device_id")
        );
        assert_eq!(p.webview_dir(), PathBuf::from("/stick/anySSH-Data/webview"));
    }

    #[test]
    fn macos_bundle_root_is_the_bundles_parent() {
        // The binary sits at anySSH.app/Contents/MacOS/anyssh, but writing into
        // the bundle would break its signature — so the data dir goes beside it.
        let exe_dir = Path::new("/Users/me/anySSH/anySSH.app/Contents/MacOS");
        assert_eq!(
            portable_root(exe_dir),
            PathBuf::from("/Users/me/anySSH"),
            "macOS: data dir must sit beside the .app bundle"
        );
    }

    #[test]
    fn non_bundle_root_is_the_exe_dir_itself() {
        let exe_dir = Path::new("C:\\anySSH");
        assert_eq!(portable_root(exe_dir), PathBuf::from("C:\\anySSH"));

        let exe_dir = Path::new("/opt/anyssh");
        assert_eq!(portable_root(exe_dir), PathBuf::from("/opt/anyssh"));
    }
}
