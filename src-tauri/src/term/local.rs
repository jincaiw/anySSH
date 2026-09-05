//! Local PTY backend (P1a) — the `Local` arm of the term layer.
//!
//! Uses `portable-pty` (ConPTY on Windows 10 1809+, forkpty on Unix) so one
//! implementation covers all three platforms. The PTY reader is a blocking
//! `std::io::Read`, so it runs on a dedicated OS thread feeding an async
//! mpsc channel; the session loop (`spawn_session`) only ever awaits the
//! channel, mirroring how the SSH layer's russh reader task works.

use std::io::{Read, Write};
use std::path::Path;

use async_trait::async_trait;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tokio::sync::mpsc;

use super::{TermError, TermIo};

/// A local shell attached to a PTY. One instance per session, owned by the
/// session loop via the `TermIo` trait object.
pub struct LocalPtyIo {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    /// Output from the blocking reader thread. `None`-terminates when the
    /// child exits (EOF) or the thread dies.
    rx: mpsc::Receiver<Vec<u8>>,
    /// Kept so `shutdown` can kill the shell; `None` after shutdown.
    child: Option<Box<dyn Child + Send + Sync>>,
}

impl LocalPtyIo {
    /// Spawn the shell on a fresh PTY of the given size.
    pub fn open(
        shell: Option<&str>,
        start_directory: Option<&str>,
        cols: u16,
        rows: u16,
        term: &str,
    ) -> Result<Self, TermError> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TermError::Io(e.to_string()))?;

        let shell_path = resolve_shell(shell)?;
        let mut cmd = CommandBuilder::new(&shell_path);
        cmd.env("TERM", term);
        // No `-i`/login flags: stdin/stdout are a PTY, which is what makes
        // every major shell (zsh/bash/powershell/cmd) go interactive on its
        // own. Keep the spawn minimal and portable.
        if let Some(dir) = start_directory.filter(|s| !s.is_empty()) {
            if !Path::new(dir).is_dir() {
                return Err(TermError::InvalidParams(format!(
                    "directory does not exist: {dir}"
                )));
            }
            cmd.cwd(dir);
        } else if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| TermError::Io(format!("spawn {shell_path}: {e}")))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| TermError::Io(e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| TermError::Io(e.to_string()))?;

        // Drop the slave end so the master sees EOF when the shell exits.
        drop(pair.slave);
        let master = pair.master;

        // Blocking reader → async channel. Capacity 64 chunks (~512 KiB) is
        // plenty of burst buffer for prompt/MOTD output.
        let (tx, rx) = mpsc::channel::<Vec<u8>>(64);
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.blocking_send(buf[..n].to_vec()).is_err() {
                            break; // session loop gone — stop reading
                        }
                    }
                }
            }
        });

        Ok(Self {
            writer,
            master,
            rx,
            child: Some(child),
        })
    }
}

#[async_trait]
impl TermIo for LocalPtyIo {
    async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        match self.rx.recv().await {
            Some(chunk) => {
                let n = chunk.len().min(buf.len());
                buf[..n].copy_from_slice(&chunk[..n]);
                Ok(n)
            }
            // Reader thread ended: child exited or channel closed.
            None => Ok(0),
        }
    }

    async fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        self.writer.write_all(data)?;
        self.writer.flush()?;
        Ok(data.len())
    }

    async fn resize(&mut self, cols: u32, rows: u32) {
        let _ = self.master.resize(PtySize {
            rows: rows as u16,
            cols: cols as u16,
            pixel_width: 0,
            pixel_height: 0,
        });
    }

    async fn shutdown(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = tokio::task::spawn_blocking(move || child.wait()).await;
        }
        // Dropping `self` drops the master, which closes the PTY and ends
        // the reader thread.
    }
}

/// Shell resolution (plan §5.3): explicit override → `$SHELL` → zsh → bash →
/// sh on Unix; pwsh → powershell → cmd (resolved against PATH) on Windows.
pub fn resolve_shell(explicit: Option<&str>) -> Result<String, TermError> {
    if let Some(s) = explicit {
        if !s.trim().is_empty() {
            return Ok(s.to_string());
        }
    }
    #[cfg(unix)]
    {
        let mut candidates: Vec<String> = Vec::new();
        if let Ok(s) = std::env::var("SHELL") {
            if !s.trim().is_empty() {
                candidates.push(s);
            }
        }
        candidates.push("/bin/zsh".to_string());
        candidates.push("/bin/bash".to_string());
        candidates.push("/bin/sh".to_string());
        candidates
            .into_iter()
            .find(|c| Path::new(c).exists())
            .ok_or_else(|| TermError::InvalidParams("no shell binary found".to_string()))
    }
    #[cfg(windows)]
    {
        for name in ["pwsh.exe", "powershell.exe", "cmd.exe"] {
            if let Some(p) = find_in_path(name) {
                return Ok(p);
            }
        }
        // Last resort: let CreateProcess resolve it from PATH.
        Ok("cmd.exe".to_string())
    }
}

#[cfg(windows)]
fn find_in_path(name: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn explicit_override_wins() {
        assert_eq!(resolve_shell(Some("/bin/echo")).unwrap(), "/bin/echo");
    }

    #[test]
    fn empty_fallback_falls_through_to_system_resolution() {
        // Just prove it resolves *something* executable-shaped on this box.
        let s = resolve_shell(Some("  ")).unwrap();
        assert!(s.starts_with('/'));
        assert!(Path::new(&s).exists());
    }
}
