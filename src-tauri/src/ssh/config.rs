//! Shared russh client configuration.
//!
//! Every SSH connection in the app (terminal, SFTP, SCP, health checks) goes
//! through [`russh_client_config`], which widens the stock russh 0.63
//! algorithm lists with legacy algorithms so older SSH servers can still be
//! reached.

use std::borrow::Cow;

use russh::cipher;
use russh::client;
use russh::kex;
use russh::keys::Algorithm;
use russh::mac;
use russh::Preferred;

/// Legacy key-exchange algorithms appended after the modern defaults.
///
/// Many older servers — vintage OpenSSH (< 6.5), network appliances, embedded
/// SSH daemons — only offer the NIST ECDH curves and
/// `diffie-hellman-group14-sha1` / `diffie-hellman-group1-sha1`, none of which
/// appear in russh's default list.
const LEGACY_KEX: &[kex::Name] = &[
    kex::ECDH_SHA2_NISTP256,
    kex::ECDH_SHA2_NISTP384,
    kex::ECDH_SHA2_NISTP521,
    kex::DH_G14_SHA1,
    kex::DH_G1_SHA1,
];

/// Legacy ciphers appended after the modern defaults.
///
/// CBC mode is required by the same class of old servers; russh's defaults
/// only offer CTR / GCM / ChaCha20. When a CBC cipher is negotiated, MAC
/// integrity protection kicks in — the default MAC list already includes the
/// HMAC-SHA1 variants those servers need.
const LEGACY_CIPHERS: &[cipher::Name] = &[
    cipher::AES_256_CBC,
    cipher::AES_192_CBC,
    cipher::AES_128_CBC,
    cipher::TRIPLE_DES_CBC,
];

/// Legacy MACs appended after the modern defaults.
///
/// russh 0.63 removed every SHA-1 MAC from `Preferred::DEFAULT` — the stock
/// list is now hmac-sha2-{256,512} (± ETM) only. A CBC cipher *requires* a
/// MAC (there is no AEAD tag), so without these an old server that can only
/// do `hmac-sha1` fails with "No common MAC algorithm" instead of
/// connecting. Added explicitly and unconditionally: the list is append-only
/// and de-duplicated, so a future russh that restores them is a no-op.
const LEGACY_MACS: &[mac::Name] = &[mac::HMAC_SHA1, mac::HMAC_SHA1_ETM];

/// Build the client config used for every SSH connection.
///
/// The algorithm lists start from russh's defaults and append legacy
/// algorithms at the end, so a modern server negotiates exactly as before,
/// while a legacy-only server can now find a mutually supported set instead of
/// failing with `No common algorithm`.
pub(crate) fn russh_client_config() -> client::Config {
    let default = Preferred::DEFAULT;

    let mut kex_list: Vec<kex::Name> = default.kex.into_owned();
    kex_list.extend_from_slice(LEGACY_KEX);

    let mut key_list: Vec<Algorithm> = default.key.into_owned();
    // `ssh-rsa` (SHA-1 host-key signatures) — the only host-key algorithm many
    // legacy servers with RSA host keys advertise. russh 0.63's default list
    // already ends with it, so only push when it is actually missing.
    let ssh_rsa = Algorithm::Rsa { hash: None };
    if !key_list.contains(&ssh_rsa) {
        key_list.push(ssh_rsa);
    }

    let mut cipher_list: Vec<cipher::Name> = default.cipher.into_owned();
    cipher_list.extend_from_slice(LEGACY_CIPHERS);

    let mut mac_list: Vec<mac::Name> = default.mac.into_owned();
    for name in LEGACY_MACS {
        if !mac_list.contains(name) {
            mac_list.push(*name);
        }
    }

    client::Config {
        preferred: Preferred {
            kex: Cow::Owned(kex_list),
            // No OpenSSH certificate support: we never present or request one.
            host_key_certificates: default.host_key_certificates,
            key: Cow::Owned(key_list),
            cipher: Cow::Owned(cipher_list),
            mac: Cow::Owned(mac_list),
            compression: default.compression,
        },
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Modern algorithms must stay ahead of the legacy additions so a
    /// contemporary server picks the same algorithms as with stock defaults.
    #[test]
    fn legacy_algorithms_are_appended_after_modern_defaults() {
        let cfg = russh_client_config();

        let kex_names: Vec<&str> = cfg.preferred.kex.iter().map(|n| n.as_ref()).collect();
        // russh 0.63 leads with the post-quantum hybrid `mlkem768x25519-sha256`.
        // Pinned so a future default-table change is noticed, not silently
        // inherited.
        assert_eq!(kex_names.first(), Some(&"mlkem768x25519-sha256"));
        assert!(kex_names.contains(&"curve25519-sha256"));
        assert!(kex_names.contains(&"diffie-hellman-group14-sha256"));
        assert!(kex_names.contains(&"diffie-hellman-group14-sha1"));
        assert!(kex_names.contains(&"diffie-hellman-group1-sha1"));
        assert!(kex_names.contains(&"ecdh-sha2-nistp256"));
        let g1 = kex_names
            .iter()
            .position(|n| *n == "diffie-hellman-group1-sha1")
            .expect("legacy kex present");
        let c25519 = kex_names
            .iter()
            .position(|n| *n == "curve25519-sha256")
            .expect("modern kex present");
        assert!(c25519 < g1, "modern kex must precede legacy kex");

        // `Preferred::key` is `&[ssh_key::Algorithm]` since 0.48, so names
        // come from `Algorithm`'s `Display` rather than a `Name` constant.
        let key_names: Vec<String> = cfg.preferred.key.iter().map(ToString::to_string).collect();
        assert_eq!(key_names.first(), Some(&"ssh-ed25519".to_string()));
        assert_eq!(key_names.last(), Some(&"ssh-rsa".to_string()));
        // No duplicates: 0.63's default list already ends with `ssh-rsa`.
        assert_eq!(
            key_names.iter().filter(|n| *n == "ssh-rsa").count(),
            1,
            "ssh-rsa must appear exactly once"
        );

        let cipher_names: Vec<&str> = cfg.preferred.cipher.iter().map(|n| n.as_ref()).collect();
        assert_eq!(cipher_names.first(), Some(&"chacha20-poly1305@openssh.com"));
        assert!(cipher_names.contains(&"aes256-cbc"));
        assert!(cipher_names.contains(&"3des-cbc"));

        // SHA-1 MACs are no longer in russh's defaults (0.63 dropped them),
        // so they must be added back explicitly for CBC-mode legacy servers.
        let mac_names: Vec<&str> = cfg.preferred.mac.iter().map(|n| n.as_ref()).collect();
        assert!(mac_names.contains(&"hmac-sha1"));
        assert!(mac_names.contains(&"hmac-sha1-etm@openssh.com"));
        let sha1 = mac_names
            .iter()
            .position(|n| *n == "hmac-sha1")
            .expect("legacy MAC present");
        let sha2_etm = mac_names
            .iter()
            .position(|n| *n == "hmac-sha2-512-etm@openssh.com")
            .expect("modern MAC present");
        assert!(sha2_etm < sha1, "modern MAC must precede legacy MAC");
    }
}
