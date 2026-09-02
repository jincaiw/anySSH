/**
 * Portable-mode detection.
 *
 * A portable build keeps every byte of state — the SQLite database, the
 * encrypted credential vault and the WebView cache — in a single `anySSH-Data`
 * directory beside the executable, so the application can be carried on a USB
 * stick and moved between machines without leaving anything behind.
 *
 * Mode is decided by the Rust side at startup (see `src-tauri/src/portable.rs`)
 * from `ANYSSH_DATA_DIR` / `ANYSSH_PORTABLE` / a `portable.txt` marker, and is
 * fixed for the lifetime of the process — hence the module-level cache.
 *
 * Outside Tauri (unit tests, `vite preview` in a plain browser) both probes fail
 * and we report "installed", which is the safe answer: portable-only behaviour
 * is an *addition* to the normal flow, never a requirement of it.
 */

export interface PortableInfo {
  /** True when this launch is running from a portable folder. */
  portable: boolean;
  /** Absolute path of the portable data directory, when portable. */
  dataDir: string | null;
}

let cached: Promise<PortableInfo> | null = null;

/** Resolve (and memoise) whether this is a portable launch. */
export function portableInfo(): Promise<PortableInfo> {
  cached ??= probe();
  return cached;
}

/** Convenience wrapper for call sites that only need the boolean. */
export async function isPortable(): Promise<boolean> {
  return (await portableInfo()).portable;
}

async function probe(): Promise<PortableInfo> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const [portable, dataDir] = await Promise.all([
      invoke<boolean>("is_portable_mode"),
      invoke<string | null>("portable_data_dir"),
    ]);
    return { portable: !!portable, dataDir: dataDir ?? null };
  } catch {
    // Not running under Tauri (tests / plain browser preview).
    return { portable: false, dataDir: null };
  }
}

/**
 * Test-only escape hatch: every `portableInfo()` call is memoised, so a test
 * that wants to exercise both branches has to clear the cache first.
 */
export function __resetPortableInfoForTests(): void {
  cached = null;
}
