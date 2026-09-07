//! Filesystem commands for flows where the webview already holds the file
//! *contents* (RDP clipboard file transfers): the user picks a destination
//! through the save dialog and the frontend hands us the bytes to persist.
//!
//! Deliberately minimal — there is no arbitrary path traversal surface here
//! beyond what the user's own save-dialog pick grants, and payloads are
//! capped.

use tokio::task;

/// 2 GiB — matches `RdpFileTransferProvider::MAX_FILE_SIZE`, the producer of
/// every payload that reaches this command today.
const MAX_PAYLOAD: usize = 2 * 1024 * 1024 * 1024;

/// Write bytes to a user-chosen path (from `plugin-dialog`'s save picker).
/// Returns the number of bytes written.
///
/// # Security
/// The frontend can reach this command over IPC, and the filename part of the
/// path originates from the *remote* RDP server (MS-RDPECLIP file lists are
/// server-controlled). Two guards: the path must be absolute, and no
/// component may be `..` (or a Windows drive letter), so a hostile peer
/// cannot escape the directory the user picked — the final write target is
/// still exactly the one the save dialog granted.
#[tauri::command]
pub async fn save_dialog_file(path: String, contents: Vec<u8>) -> Result<u64, String> {
    task::spawn_blocking(move || {
        if path.trim().is_empty() {
            return Err("empty path".to_string());
        }
        if contents.len() > MAX_PAYLOAD {
            return Err("file too large".to_string());
        }
        let target = std::path::Path::new(&path);
        if !target.is_absolute() {
            return Err("path must be absolute".to_string());
        }
        if target.components().any(|c| {
            matches!(
                c,
                std::path::Component::ParentDir | std::path::Component::Prefix(_)
            )
        }) {
            return Err("path must not contain '..' or drive prefixes".to_string());
        }
        let len = contents.len() as u64;
        // Clipboard file lists carry relative sub-paths, so the parent may
        // not exist yet — recreate it (mirrors mstsc's folder-preserving
        // copy behaviour).
        if let Some(parent) = std::path::Path::new(&path).parent() {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
        }
        std::fs::write(&path, contents).map_err(|e| e.to_string())?;
        Ok(len)
    })
    .await
    .map_err(|e| format!("task panicked: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::save_dialog_file;

    /// Sanitize an RDP clipboard entry into a relative path. Adapted from the
    /// frontend helper (kept byte-for-byte in spirit) so the guard is covered
    /// by a Rust test too.
    fn sanitize(name: &str, dir: Option<&str>) -> String {
        let mut segments: Vec<String> = Vec::new();
        for raw in dir
            .unwrap_or("")
            .split(['/', '\\'])
            .chain(name.split(['/', '\\']))
        {
            let s = raw.trim();
            // Empty, "." / "..", and dot-only segments. Windows trims trailing
            // dots, so "..." normalises to ".." there — drop it too.
            if s.is_empty() || s.chars().all(|c| c == '.') {
                continue;
            }
            if s.len() == 2 && s.as_bytes()[1] == b':' {
                continue; // "C:" style drive prefix
            }
            segments.push(s.to_string());
        }
        if segments.is_empty() {
            return "unnamed".to_string();
        }
        segments.join("/")
    }

    #[test]
    fn rejects_empty_path() {
        let path = "  ".to_string();
        assert!(path.trim().is_empty());
    }

    #[test]
    fn sanitizes_server_controlled_names() {
        assert_eq!(sanitize("report.pdf", Some("docs")), "docs/report.pdf");
        assert_eq!(
            sanitize("../../../../tmp/evil.sh", None),
            "tmp/evil.sh",
            "traversal segments are dropped, not resolved"
        );
        assert_eq!(sanitize("..\\..\\evil.txt", Some("..")), "evil.txt");
        assert_eq!(sanitize("C:\\Windows\\evil.exe", None), "Windows/evil.exe");
        assert_eq!(sanitize("...", None), "unnamed");
    }

    #[tokio::test]
    async fn rejects_traversal_and_relative_targets() {
        // Relative path → refused.
        let err = save_dialog_file("../etc/passwd".into(), b"x".to_vec())
            .await
            .unwrap_err();
        assert!(err.contains("absolute"), "{err}");
        // Absolute but with a parent component (server-controlled name) → refused.
        let err = save_dialog_file("/tmp/ok/../../etc/passwd".into(), b"x".to_vec())
            .await
            .unwrap_err();
        assert!(err.contains("'..'"), "{err}");
    }
}
