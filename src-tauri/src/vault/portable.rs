//! Portable credential vault — an encrypted file that travels with the app.
//!
//! The installed build keeps secrets in the OS keychain, which is bound to a
//! single machine. A USB-stick install needs credentials to follow the folder,
//! so in portable mode the vault is instead a single encrypted file,
//! `vault.anyscp`, sealed with **AES-256-GCM**.
//!
//! ## Key handling
//!
//! The key comes from `vault.key` — 32 bytes from the OS CSPRNG, written once on
//! first launch next to the vault and never derived from anything the user
//! types. The AES key is *derived* from those bytes with **Argon2id** rather than
//! using them directly, so the on-disk file is not itself the AES key; the
//! parameters are deliberately modest (8 MiB, t=2) because every credential read
//! pays for them, and the resulting key is cached for the process lifetime.
//!
//! ## Threat model (be honest about it)
//!
//! This is obfuscation-grade protection against an attacker who already has the
//! file: the key sits in the same directory. It exists to stop secrets being
//! read by casual inspection, by backup tools, or by sync clients that copy the
//! vault without the key — and it is the only option available, since a
//! passphrase prompt on every connection would defeat the point of a portable
//! build. Anyone who copies the whole `anySCP-Data` folder gets everything.
//!
//! ## Container layout
//!
//! ```text
//! magic "ASCPVLT\x01" (8) | nonce_len u8 | nonce | ciphertext…
//! ```
//!
//! The whole header is fed to AES-GCM as associated data, so tampering with the
//! nonce (or a truncated write) fails the tag check instead of silently
//! decrypting to garbage. The plaintext is a JSON `BTreeMap<host_id,
//! StoredCredential>`, which keeps the file diff-friendly and independent of
//! hash ordering.
//!
//! Writes go to a sibling temp file and are then renamed, so a crash mid-write
//! cannot leave a half-written vault behind.

use std::collections::BTreeMap;
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;
#[cfg(not(test))]
use std::sync::OnceLock;

use crate::portable::PortablePaths;

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, Key, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};

use super::{StoredCredential, VaultError};

// ─── Constants ────────────────────────────────────────────────────────────────

/// Container magic + format version (last byte).
const MAGIC: &[u8; 8] = b"ASCPVLT\x01";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const SALT_LEN: usize = 16;
const HEADER_LEN: usize = MAGIC.len() + 1;

/// Fixed, non-secret salt. The key material is already a 256-bit CSPRNG value,
/// so Argon2 here provides domain separation (and a little extra work for an
/// attacker who grabs the key file alone) rather than entropy.
const KDF_SALT: &[u8; SALT_LEN] = b"anyscp-portable!";

/// Deliberately light: unlike a backup passphrase, this runs on every credential
/// read, so it has to stay well under the interactive threshold.
const ARGON2_M_KIB: u32 = 8 * 1024;
const ARGON2_T: u32 = 2;
const ARGON2_P: u32 = 1;

const VAULT_FILE: &str = "vault.anyscp";
const TEMP_SUFFIX: &str = ".tmp";

// ─── Caches & locking ─────────────────────────────────────────────────────────

/// Derived AES key, computed once per process.
///
/// Deliberately NOT compiled under `cfg(test)`: the cache is process-wide and
/// would leak one test's key into every other test, which each use their own
/// temp directory (and some swap the key file afterwards) — that made the
/// derivation and key-mismatch paths untestable.
#[cfg(not(test))]
static CACHED_KEY: OnceLock<[u8; KEY_LEN]> = OnceLock::new();

/// Serialises read-modify-write cycles on the vault file.
///
/// Two concurrent saves would otherwise both read the old map and the later
/// write would drop the earlier host. Vault traffic is rare (a save every few
/// minutes at worst), so a single lock is not a contention concern.
static FILE_LOCK: Mutex<()> = Mutex::new(());

// ─── Key management ───────────────────────────────────────────────────────────

/// Read the key material, generating and persisting it on first run.
fn read_or_create_key_file(path: &Path) -> Result<[u8; KEY_LEN], VaultError> {
    if let Ok(contents) = std::fs::read_to_string(path) {
        let hex = contents.trim();
        if let Some(bytes) = decode_hex(hex) {
            return Ok(bytes);
        }
        // Not valid hex — the file was truncated or hand-edited. Rather than
        // silently regenerating it (which would orphan every stored credential)
        // surface the problem; the vault is unreadable either way.
        return Err(VaultError::InvalidData(format!(
            "portable key file {} is corrupt — delete it to reset portable credentials",
            path.display()
        )));
    }

    let mut material = [0u8; KEY_LEN];
    getrandom::getrandom(&mut material).map_err(|e| VaultError::Crypto(e.to_string()))?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| VaultError::Io(e.to_string()))?;
    }
    std::fs::write(path, format!("{}\n", encode_hex(&material)))
        .map_err(|e| VaultError::Io(e.to_string()))?;
    restrict_permissions(path);

    Ok(material)
}

/// The AES-256 key for this portable install, cached after the first derivation.
fn master_key(paths: &PortablePaths) -> Result<[u8; KEY_LEN], VaultError> {
    #[cfg(not(test))]
    if let Some(key) = CACHED_KEY.get() {
        return Ok(*key);
    }

    let material = read_or_create_key_file(&paths.key_path())?;
    let params = Params::new(ARGON2_M_KIB, ARGON2_T, ARGON2_P, Some(KEY_LEN))
        .map_err(|e| VaultError::Crypto(e.to_string()))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = [0u8; KEY_LEN];
    argon2
        .hash_password_into(&material, KDF_SALT, &mut key)
        .map_err(|e| VaultError::Crypto(e.to_string()))?;

    // Already set by another thread? Their key is equally valid.
    #[cfg(not(test))]
    let _ = CACHED_KEY.set(key);
    Ok(key)
}

fn encode_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

fn decode_hex(s: &str) -> Option<[u8; KEY_LEN]> {
    if s.len() != KEY_LEN * 2 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; KEY_LEN];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

/// Best-effort `0600` so a shared machine (or a sync client) doesn't expose the
/// key to every other account. No-op on Windows, where the ACL is inherited.
#[cfg(unix)]
fn restrict_permissions(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

#[cfg(not(unix))]
fn restrict_permissions(_path: &Path) {}

// ─── Container read / write ──────────────────────────────────────────────────

/// Vault contents: host id → credential. `BTreeMap` keeps the JSON stable.
type Vault = BTreeMap<String, StoredCredential>;

/// One entry as stored on disk — lets the format carry per-entry metadata later.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct VaultEntry {
    credential: StoredCredential,
}

/// Load and decrypt the whole vault. A missing file is an empty vault, not an
/// error — the first save of a fresh portable install has nothing to read.
fn load(paths: &PortablePaths) -> Result<BTreeMap<String, StoredCredential>, VaultError> {
    let path = paths.vault_path();
    if !path.exists() {
        return Ok(BTreeMap::new());
    }

    let bytes = std::fs::read(&path).map_err(|e| VaultError::Io(e.to_string()))?;
    if bytes.len() < HEADER_LEN + NONCE_LEN || &bytes[..MAGIC.len()] != MAGIC {
        return Err(VaultError::InvalidData(
            "not an anySCP portable vault".into(),
        ));
    }

    let nonce_len = bytes[MAGIC.len()] as usize;
    if nonce_len != NONCE_LEN {
        return Err(VaultError::InvalidData(
            "unsupported vault nonce length".into(),
        ));
    }
    let header_end = HEADER_LEN + nonce_len;
    if bytes.len() < header_end {
        return Err(VaultError::InvalidData("truncated vault file".into()));
    }

    let (header, ciphertext) = bytes.split_at(header_end);
    let nonce = Nonce::from_slice(&bytes[HEADER_LEN..header_end]);

    let key = master_key(paths)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: header,
            },
        )
        .map_err(|_| {
            VaultError::InvalidData(
                "portable vault could not be decrypted — vault.key does not match".into(),
            )
        })?;

    // Accept both the current flat map and (forward-compat) an entry-wrapped
    // form, so a future format change can be read by an older binary.
    if let Ok(map) = serde_json::from_slice::<BTreeMap<String, StoredCredential>>(&plaintext) {
        return Ok(map);
    }
    let wrapped: BTreeMap<String, VaultEntry> =
        serde_json::from_slice(&plaintext).map_err(|e| VaultError::InvalidData(e.to_string()))?;
    Ok(wrapped
        .into_iter()
        .map(|(k, v)| (k, v.credential))
        .collect())
}

/// Encrypt and atomically replace the vault file.
fn save(paths: &PortablePaths, map: &Vault) -> Result<(), VaultError> {
    let json = serde_json::to_vec(map).map_err(|e| VaultError::InvalidData(e.to_string()))?;

    let mut nonce = [0u8; NONCE_LEN];
    getrandom::getrandom(&mut nonce).map_err(|e| VaultError::Crypto(e.to_string()))?;

    let mut header = Vec::with_capacity(HEADER_LEN + NONCE_LEN);
    header.extend_from_slice(MAGIC);
    header.push(NONCE_LEN as u8);
    header.extend_from_slice(&nonce);

    let key = master_key(paths)?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key));
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: &json,
                aad: &header,
            },
        )
        .map_err(|e| VaultError::Crypto(e.to_string()))?;

    let mut out = header;
    out.extend_from_slice(&ciphertext);

    let path = paths.vault_path();
    let temp = path.with_file_name(format!("{VAULT_FILE}{TEMP_SUFFIX}"));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| VaultError::Io(e.to_string()))?;
    }

    {
        let mut file = std::fs::File::create(&temp).map_err(|e| VaultError::Io(e.to_string()))?;
        file.write_all(&out)
            .map_err(|e| VaultError::Io(e.to_string()))?;
        // Flush before rename: a rename is atomic, but only for bytes the OS has
        // actually got — without this a crash can leave a valid-looking vault
        // that's missing its tail.
        file.sync_all().map_err(|e| VaultError::Io(e.to_string()))?;
    }
    restrict_permissions(&temp);
    std::fs::rename(&temp, &path).map_err(|e| VaultError::Io(e.to_string()))?;

    Ok(())
}

// ─── Public API ──────────────────────────────────────────────────────────────
//
// Mirrors the keychain-backed functions in the parent module so `vault/mod.rs`
// can pick a backend without any caller knowing which one is in play.

pub fn save_credential(
    paths: &PortablePaths,
    host_id: &str,
    credential: &StoredCredential,
) -> Result<(), VaultError> {
    let _guard = lock()?;
    let mut map = load(paths)?;
    map.insert(host_id.to_string(), credential.clone());
    save(paths, &map)
}

pub fn get_credential(
    paths: &PortablePaths,
    host_id: &str,
) -> Result<StoredCredential, VaultError> {
    let _guard = lock()?;
    load(paths)?
        .remove(host_id)
        .ok_or_else(|| VaultError::NotFound(host_id.to_string()))
}

pub fn delete_credential(paths: &PortablePaths, host_id: &str) -> Result<(), VaultError> {
    let _guard = lock()?;
    let mut map = load(paths)?;
    // A missing entry is already the desired end state.
    if map.remove(host_id).is_none() {
        return Ok(());
    }
    save(paths, &map)
}

pub fn has_credential(paths: &PortablePaths, host_id: &str) -> bool {
    let Ok(_guard) = lock() else {
        return false;
    };
    matches!(load(paths), Ok(map) if map.contains_key(host_id))
}

/// Locking is best-effort: a poisoned mutex means another thread panicked while
/// holding it, but the vault file itself is still consistent (writes are atomic),
/// so we report the error rather than silently proceeding unlocked.
fn lock() -> Result<std::sync::MutexGuard<'static, ()>, VaultError> {
    FILE_LOCK
        .lock()
        .map_err(|e| VaultError::Io(format!("vault lock poisoned: {e}")))
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::StoredCredential;

    /// Every test needs a *fresh* data dir: the derived key is cached
    /// process-wide, so two tests sharing a directory would share a key and
    /// stop exercising the derivation path.
    fn temp_dir(tag: &str) -> PortablePaths {
        let d = std::env::temp_dir().join(format!("anyscp-vault-test-{tag}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).expect("temp dir");
        PortablePaths::new(d)
    }

    fn pw(s: &str) -> StoredCredential {
        StoredCredential::Password {
            password: s.to_string(),
        }
    }

    fn read_pw(dir: &PortablePaths, host: &str) -> String {
        match get_credential(dir, host).expect("get") {
            StoredCredential::Password { password } => password,
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn round_trips_a_password_credential() {
        let dir = temp_dir("round-trip");
        save_credential(&dir, "host-a", &pw("hunter2")).expect("save");
        assert_eq!(read_pw(&dir, "host-a"), "hunter2");
    }

    #[test]
    fn round_trips_a_key_passphrase_credential() {
        let dir = temp_dir("passphrase");
        let cred = StoredCredential::KeyPassphrase {
            passphrase: "open-sesame".to_string(),
        };
        save_credential(&dir, "host-b", &cred).expect("save");
        match get_credential(&dir, "host-b").expect("get") {
            StoredCredential::KeyPassphrase { passphrase } => assert_eq!(passphrase, "open-sesame"),
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn missing_credential_is_not_found() {
        let dir = temp_dir("missing");
        let err = get_credential(&dir, "nope").expect_err("should be NotFound");
        assert!(
            matches!(err, VaultError::NotFound(_)),
            "expected NotFound, got {err:?}"
        );
    }

    #[test]
    fn has_credential_tracks_saves_and_deletes() {
        let dir = temp_dir("has");
        assert!(!has_credential(&dir, "host-c"));

        save_credential(&dir, "host-c", &pw("x")).expect("save");
        assert!(has_credential(&dir, "host-c"));

        delete_credential(&dir, "host-c").expect("delete");
        assert!(!has_credential(&dir, "host-c"));
    }

    #[test]
    fn deleting_an_absent_credential_succeeds() {
        let dir = temp_dir("delete-absent");
        // Deleting something that was never stored must not error — matching the
        // keychain backend, which treats a missing entry as success.
        delete_credential(&dir, "ghost").expect("delete of absent entry is Ok");
    }

    #[test]
    fn saving_overwrites_and_preserves_siblings() {
        let dir = temp_dir("overwrite");

        save_credential(&dir, "one", &pw("first")).expect("save one");
        save_credential(&dir, "two", &pw("keep")).expect("save two");
        save_credential(&dir, "one", &pw("second")).expect("overwrite one");

        assert_eq!(read_pw(&dir, "one"), "second");
        assert_eq!(
            read_pw(&dir, "two"),
            "keep",
            "overwriting one host must not evict another"
        );
    }

    #[test]
    fn multiple_hosts_coexist() {
        let dir = temp_dir("multi");
        for i in 0..10 {
            save_credential(&dir, &format!("host-{i}"), &pw(&format!("pw-{i}"))).expect("save");
        }
        for i in 0..10 {
            assert_eq!(read_pw(&dir, &format!("host-{i}")), format!("pw-{i}"));
        }
        assert!(!has_credential(&dir, "host-10"));
    }

    #[test]
    fn secrets_never_hit_the_disk_in_plaintext() {
        let dir = temp_dir("no-plaintext");
        save_credential(&dir, "host-d", &pw("top-secret-value")).expect("save");

        let raw = std::fs::read(dir.vault_path()).expect("read vault");
        let needle = b"top-secret-value";
        assert!(
            !raw.windows(needle.len()).any(|w| w == needle.as_slice()),
            "plaintext password found inside vault.anyscp"
        );
        // …and not in the key file either, which is hex-encoded key material.
        let key = std::fs::read_to_string(dir.key_path()).expect("read key");
        assert!(!key.contains("top-secret-value"));
    }

    #[test]
    fn key_file_is_created_with_256_bits_on_first_use() {
        let dir = temp_dir("keyfile");
        save_credential(&dir, "host-e", &pw("x")).expect("save");

        let key = std::fs::read_to_string(dir.key_path()).expect("key file exists");
        assert_eq!(
            key.trim().len(),
            64,
            "256-bit key should be 64 hex characters"
        );
        assert!(
            decode_hex(key.trim()).is_some(),
            "key file must be valid hex"
        );
    }

    #[test]
    fn vault_is_unreadable_with_a_foreign_key() {
        let dir = temp_dir("foreign-key");
        save_credential(&dir, "host-f", &pw("secret")).expect("save");

        // Simulate the folder being copied without vault.key, or a key file from
        // a different install: decryption must fail loudly, not return garbage.
        std::fs::write(dir.key_path(), format!("{}\n", "ab".repeat(32))).expect("swap key");
        let err = get_credential(&dir, "host-f").expect_err("decryption must fail");
        assert!(
            matches!(err, VaultError::InvalidData(_)),
            "expected InvalidData, got {err:?}"
        );
    }

    #[test]
    fn tampering_with_the_header_fails_the_tag_check() {
        let dir = temp_dir("tamper");
        save_credential(&dir, "host-g", &pw("secret")).expect("save");

        let path = dir.vault_path();
        let mut bytes = std::fs::read(&path).expect("read");
        // Flip a bit in the nonce — it is authenticated as associated data, so
        // this must be rejected rather than decrypting to something else.
        let last = bytes.len() - 1;
        bytes[MAGIC.len() + 1] ^= 0x01;
        bytes[last] ^= 0x01;
        std::fs::write(&path, &bytes).expect("write back");

        let err = get_credential(&dir, "host-g").expect_err("tamper must be detected");
        assert!(
            matches!(err, VaultError::InvalidData(_)),
            "expected InvalidData, got {err:?}"
        );
    }

    #[test]
    fn a_truncated_vault_is_rejected_not_misread() {
        let dir = temp_dir("truncated");
        save_credential(&dir, "host-h", &pw("secret")).expect("save");

        let path = dir.vault_path();
        let bytes = std::fs::read(&path).expect("read");
        std::fs::write(&path, &bytes[..bytes.len() / 2]).expect("truncate");

        let err = get_credential(&dir, "host-h").expect_err("truncation must be detected");
        assert!(
            matches!(err, VaultError::InvalidData(_)),
            "expected InvalidData, got {err:?}"
        );
    }

    #[test]
    fn a_corrupt_key_file_reports_instead_of_orphaning_credentials() {
        let dir = temp_dir("corrupt-key");
        save_credential(&dir, "host-i", &pw("secret")).expect("save");

        std::fs::write(dir.key_path(), "not-hex-at-all\n").expect("corrupt key");
        let err = get_credential(&dir, "host-i").expect_err("corrupt key must be reported");
        assert!(
            matches!(err, VaultError::InvalidData(_)),
            "expected InvalidData, got {err:?}"
        );
    }

    #[test]
    fn hex_helpers_round_trip() {
        let bytes = [0x5au8; KEY_LEN];
        assert_eq!(decode_hex(&encode_hex(&bytes)), Some(bytes));
        assert_eq!(decode_hex("short"), None);
        assert_eq!(decode_hex(&"z".repeat(64)), None);
    }

    #[test]
    fn no_temp_file_is_left_behind_after_a_save() {
        let dir = temp_dir("no-temp");
        save_credential(&dir, "host-j", &pw("secret")).expect("save");

        let leftovers: Vec<_> = std::fs::read_dir(&dir.data_dir)
            .expect("read dir")
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(TEMP_SUFFIX))
            .collect();
        assert!(leftovers.is_empty(), "stale temp files: {leftovers:?}");
    }
}
