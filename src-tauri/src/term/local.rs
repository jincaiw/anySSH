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
    /// Output from the blocking reader thread. `Ok(..)` carries a chunk,
    /// `Err(..)` the reader's terminal failure (distinct from a clean EOF,
    /// which the session loop must be able to tell apart for the UI), and a
    /// closed channel means "child exited / thread gone".
    rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    /// Bytes left over when a chunk was larger than the caller's buffer.
    /// Without this the tail would be dropped (see `read`).
    pending: Vec<u8>,
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
        let (tx, rx) = mpsc::channel::<std::io::Result<Vec<u8>>>(64);
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF: closing the channel signals it
                    Ok(n) => {
                        if tx.blocking_send(Ok(buf[..n].to_vec())).is_err() {
                            break; // session loop gone — stop reading
                        }
                    }
                    // Report *why* the PTY died instead of collapsing it into
                    // a clean EOF (EIO is what a closed slave / pty collapse
                    // actually looks like).
                    Err(e) => {
                        let _ = tx.blocking_send(Err(e));
                        break;
                    }
                }
            }
        });

        Ok(Self {
            writer,
            master,
            rx,
            pending: Vec::new(),
            child: Some(child),
        })
    }
}

#[async_trait]
impl TermIo for LocalPtyIo {
    async fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        // Drain whatever the previous call could not fit — the loop reuses an
        // 8 KiB buffer, but a caller is free to pass a smaller one.
        if !self.pending.is_empty() {
            let n = self.pending.len().min(buf.len());
            buf[..n].copy_from_slice(&self.pending[..n]);
            self.pending.drain(..n);
            return Ok(n);
        }
        match self.rx.recv().await {
            Some(Ok(chunk)) => {
                let n = chunk.len().min(buf.len());
                buf[..n].copy_from_slice(&chunk[..n]);
                // Keep the tail; dropping it silently corrupted output for
                // any buffer smaller than the chunk.
                if n < chunk.len() {
                    self.pending.extend_from_slice(&chunk[n..]);
                }
                Ok(n)
            }
            // Reader thread reported the PTY failure (EIO / device gone).
            Some(Err(e)) => Err(e),
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
        let Some(mut child) = self.child.take() else {
            return;
        };
        // Unblock the reader thread even if the child somehow survives: a
        // closed receiver makes `blocking_send` fail and the thread exit.
        self.rx.close();

        let pid = child.process_id();
        // portable-pty's `kill()` sends SIGHUP on Unix — a shell that traps it
        // (or one with a stopped job) survives, and the master never sees EOF.
        let _ = child.kill();

        // Poll instead of blocking on `wait()`: the old code awaited
        // `spawn_blocking(child.wait())` with no timeout, so an unkillable
        // shell pinned `term_close` (and one blocking thread) forever.
        const GRACE: std::time::Duration = std::time::Duration::from_millis(100);
        let mut exited = false;
        for _ in 0..20 {
            match child.try_wait() {
                Ok(Some(_)) => {
                    exited = true;
                    break;
                }
                Ok(None) => tokio::time::sleep(GRACE).await,
                Err(_) => break,
            }
        }

        if !exited {
            // Escalate. Foreground jobs (top, vim, an editor's shell-out) hold
            // the PTY's slave end open, so killing only the shell leaves the
            // master — and the reader thread — alive after the tab is closed.
            // portable-pty's spawn calls `setsid()`, so pid == pgid == sid and
            // a negative pid reaches the whole group.
            kill_process_group(pid);
            let _ = tokio::task::spawn_blocking(move || child.wait()).await;
        }
        // Dropping `self` drops the master, which closes the PTY and ends
        // the reader thread.
    }
}

/// SIGKILL the child's whole process group. No-op off Unix (Windows'
/// `TerminateProcess` already kills the job, and ConPTY tracks it).
#[cfg(unix)]
fn kill_process_group(pid: Option<u32>) {
    if let Some(pid) = pid {
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
}

#[cfg(not(unix))]
fn kill_process_group(_pid: Option<u32>) {}

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

    /// Open descriptors for this process. `/proc/self/fd` on Linux, `/dev/fd`
    /// on macOS. Both include the directory handle used to list them, which
    /// cancels out of a before/after comparison.
    fn open_fd_count() -> usize {
        let dir = if cfg!(target_os = "linux") {
            "/proc/self/fd"
        } else {
            "/dev/fd"
        };
        std::fs::read_dir(dir).map(|d| d.count()).unwrap_or(0)
    }

    /// Lowest descriptor count seen over a short window.
    ///
    /// `open_fd_count` is process-wide and the rest of the suite runs in
    /// parallel in this same process (the bridge tests bind listeners and open
    /// websockets), so a single sample is meaningless. Concurrent activity can
    /// only ever *add* descriptors to this process — never remove one this
    /// process holds — so the minimum over a window is the honest estimate of
    /// this process's own floor.
    async fn fd_floor(samples: usize) -> usize {
        let mut floor = open_fd_count();
        for _ in 0..samples {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            floor = floor.min(open_fd_count());
        }
        floor
    }

    /// One PTY session owns a master fd, a slave fd and a reader OS thread, and
    /// `shutdown` is where all three are supposed to be retired — including the
    /// SIGHUP-then-process-group-SIGKILL escalation that exists precisely for
    /// shells which trap SIGHUP or hold a foreground job open.
    ///
    /// A single session can look fine while leaking: the shell exits, the tab
    /// closes, everything "works" — but if the master never sees EOF the reader
    /// thread and its descriptors live on, and the process only notices after a
    /// few hundred tab open/close cycles as `EMFILE`.
    ///
    /// The check is deliberately **differential** (two equal batches back to
    /// back) rather than against a single baseline taken up front: neighbour
    /// tests perturb the process-wide count, and two measurements taken under
    /// comparable conditions cancel that systematic noise, while a genuine
    /// per-cycle leak still shows up as a step between the batches.
    #[tokio::test]
    async fn repeated_pty_lifecycle_does_not_leak_descriptors() {
        // A shell guaranteed to exist on both CI (Linux) and macOS.
        let shell = "/bin/sh";
        if !Path::new(shell).exists() {
            return;
        }

        // Warm up once so anything the runtime creates lazily on first use (the
        // kqueue/epoll fd, timer fd, …) is already counted in both batches.
        {
            let mut io =
                LocalPtyIo::open(Some(shell), None, 80, 24, "xterm-256color").expect("warm-up pty");
            io.shutdown().await;
        }

        const BATCH: usize = 6;

        /// Run `BATCH` full open → shutdown → drop cycles and return the
        /// process's descriptor floor afterwards.
        async fn run_batch(shell: &str) -> usize {
            for cycle in 0..BATCH {
                let mut io = LocalPtyIo::open(Some(shell), None, 80, 24, "xterm-256color")
                    .unwrap_or_else(|e| panic!("cycle {cycle}: pty open failed: {e}"));
                // `shutdown` must always make progress: the escalation loop is
                // bounded, so a shell that ignores SIGHUP cannot pin this await.
                tokio::time::timeout(std::time::Duration::from_secs(10), io.shutdown())
                    .await
                    .expect("pty shutdown must not hang");
                // The session loop must observe the end of the session instead
                // of blocking on a PTY that is still open.
                let mut buf = [0u8; 64];
                let eof =
                    tokio::time::timeout(std::time::Duration::from_secs(5), io.read(&mut buf))
                        .await
                        .expect("read after shutdown must not block")
                        .expect("read after shutdown must not fail");
                assert_eq!(
                    eof, 0,
                    "a torn-down session must report EOF, got {eof} bytes"
                );
                // The descriptor is only released when the struct — and with it
                // the master — is dropped, so this scope must end each cycle.
            }
            fd_floor(24).await
        }

        let first = run_batch(shell).await;
        let second = run_batch(shell).await;

        // Each batch is BATCH cycles, so a leak of even one descriptor per
        // session raises the floor by 6. The allowance covers the pty bookkeeping
        // slack that is not a leak; it is far below what a real leak produces.
        assert!(
            second <= first + 3,
            "{BATCH} pty open/close cycles leaked descriptors: \
             floor after first batch={first}, after second batch={second} (allowance 3)"
        );
    }

    /// Long-run measurement harness — **not** part of the default suite.
    ///
    /// ```text
    /// cargo test --release --lib -- --ignored --nocapture soak_pty_churn
    /// ```
    ///
    /// Exists because the pre-release review had no data at all on two
    /// questions the short differential test above cannot answer: how the
    /// process's descriptor count and RSS behave over hundreds of session
    /// cycles (a per-cycle cost too small to show up in 6 cycles adds up over a
    /// working day), and whether teardown latency drifts as the process ages.
    ///
    /// `#[ignore]` is deliberate. Its primary product is the printed curve; the
    /// bound asserted at the end is intentionally loose so that running it on a
    /// loaded developer box reports drift rather than flaking. The tight,
    /// always-run invariant lives in
    /// `repeated_pty_lifecycle_does_not_leak_descriptors`.
    ///
    /// Run it from a **normal terminal**: RSS is sampled by shelling out to
    /// `ps`, which restricted sandboxes deny — and a sandboxed run then reports
    /// the RSS column as unavailable rather than as zero, because "0 KiB of
    /// growth" and "never measured" must not print the same way.
    #[tokio::test]
    #[ignore = "long-running soak; run explicitly and read the printed curve"]
    async fn soak_pty_churn_reports_descriptor_and_rss_drift() {
        let shell = "/bin/sh";
        if !Path::new(shell).exists() {
            eprintln!("soak: {shell} is absent, nothing to measure on this host");
            return;
        }

        const CYCLES: usize = 400;
        const REPORT_EVERY: usize = 50;

        /// Resident set size of this process, in KiB.
        ///
        /// Shelled out to `ps` instead of a platform API so the harness stays
        /// identical on Linux and macOS — `ps -o rss=` is the one spelling both
        /// accept. `None` means "could not sample", which is deliberately
        /// distinct from `Some(0)`.
        fn rss_kib() -> Option<u64> {
            let pid = std::process::id().to_string();
            let out = std::process::Command::new("ps")
                .args(["-o", "rss=", "-p", &pid])
                .output()
                .ok()?;
            if !out.status.success() {
                return None;
            }
            String::from_utf8_lossy(&out.stdout).trim().parse().ok()
        }

        /// `rss=NNNN KiB (+N)` or an explicit refusal to claim a number.
        fn rss_note(now: Option<u64>, base: Option<u64>) -> String {
            match (now, base) {
                (Some(now), Some(base)) => {
                    format!("rss={now} KiB ({:+} KiB)", now as i64 - base as i64)
                }
                _ => "rss=unavailable (`ps` is not runnable in this environment)".to_string(),
            }
        }

        // Warm up so lazily-created runtime descriptors (kqueue/epoll, timer fd)
        // are already in the baseline rather than counted as growth.
        {
            let mut io =
                LocalPtyIo::open(Some(shell), None, 80, 24, "xterm-256color").expect("warm-up pty");
            io.shutdown().await;
        }

        let base_fd = fd_floor(8).await;
        let base_rss = rss_kib();
        let started = std::time::Instant::now();
        eprintln!(
            "soak: baseline fd={base_fd} {}",
            rss_note(base_rss, base_rss)
        );

        let mut slowest = std::time::Duration::ZERO;

        for cycle in 1..=CYCLES {
            let mut io = LocalPtyIo::open(Some(shell), None, 80, 24, "xterm-256color")
                .unwrap_or_else(|e| panic!("cycle {cycle}: pty open failed: {e}"));
            let cycle_started = std::time::Instant::now();
            tokio::time::timeout(std::time::Duration::from_secs(10), io.shutdown())
                .await
                .expect("pty shutdown must not hang");
            let elapsed = cycle_started.elapsed();
            slowest = slowest.max(elapsed);
            let mut buf = [0u8; 64];
            let eof = tokio::time::timeout(std::time::Duration::from_secs(5), io.read(&mut buf))
                .await
                .expect("read after shutdown must not block")
                .expect("read after shutdown must not fail");
            assert_eq!(eof, 0, "cycle {cycle}: a torn-down session must report EOF");
            drop(io);

            if cycle % REPORT_EVERY == 0 {
                let fd = fd_floor(4).await;
                eprintln!(
                    "soak: cycles={cycle} fd={fd} ({:+}) {} slowest_teardown={slowest:?} \
                     elapsed={:?}",
                    fd as i64 - base_fd as i64,
                    rss_note(rss_kib(), base_rss),
                    started.elapsed()
                );
            }
        }

        let end_fd = fd_floor(8).await;
        let end_rss = rss_kib();
        eprintln!(
            "soak: done — {CYCLES} cycles in {:?}, fd {base_fd}→{end_fd} ({:+}), {}, \
             slowest teardown {slowest:?}",
            started.elapsed(),
            end_fd as i64 - base_fd as i64,
            rss_note(end_rss, base_rss)
        );

        // Loose sanity bound only — this is a measurement, not a gate. One
        // descriptor per cycle would put the drift far above this, so even after
        // allowing for bookkeeping slack a genuine per-session leak cannot pass.
        assert!(
            end_fd <= base_fd + 10,
            "descriptor drift over {CYCLES} cycles: {base_fd} → {end_fd}"
        );

        // Only asserted when it was actually sampled; a missing measurement is
        // reported, never silently treated as healthy.
        if let (Some(base), Some(end)) = (base_rss, end_rss) {
            assert!(
                end <= base + 64 * 1024,
                "rss drift over {CYCLES} cycles: {base} → {end} KiB"
            );
        } else {
            eprintln!(
                "soak: memory drift NOT measured here — re-run from a normal terminal so `ps` works"
            );
        }
    }
}
