//! Shared russh client configuration.
//!
//! Every SSH connection in the app (terminal, SFTP, SCP, health checks) goes
//! through [`russh_client_config`], which widens the stock russh 0.46
//! algorithm lists with legacy algorithms so older SSH servers can still be
//! reached.

use std::borrow::Cow;

use russh::cipher;
use russh::client;
use russh::kex;
use russh::keys::key;
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

    let mut key_list: Vec<key::Name> = default.key.into_owned();
    // `ssh-rsa` (SHA-1 host-key signatures) — the only host-key algorithm many
    // legacy servers with RSA host keys advertise.
    key_list.push(key::SSH_RSA);

    let mut cipher_list: Vec<cipher::Name> = default.cipher.into_owned();
    cipher_list.extend_from_slice(LEGACY_CIPHERS);

    client::Config {
        preferred: Preferred {
            kex: Cow::Owned(kex_list),
            key: Cow::Owned(key_list),
            cipher: Cow::Owned(cipher_list),
            mac: default.mac,
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
        assert_eq!(kex_names.first(), Some(&"curve25519-sha256"));
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

        let key_names: Vec<&str> = cfg.preferred.key.iter().map(|n| n.as_ref()).collect();
        assert_eq!(key_names.first(), Some(&"ssh-ed25519"));
        assert_eq!(key_names.last(), Some(&"ssh-rsa"));

        let cipher_names: Vec<&str> = cfg.preferred.cipher.iter().map(|n| n.as_ref()).collect();
        assert_eq!(cipher_names.first(), Some(&"chacha20-poly1305@openssh.com"));
        assert!(cipher_names.contains(&"aes256-cbc"));
        assert!(cipher_names.contains(&"3des-cbc"));

        // MAC list already contains the SHA-1 variants legacy servers require.
        let mac_names: Vec<&str> = cfg.preferred.mac.iter().map(|n| n.as_ref()).collect();
        assert!(mac_names.contains(&"hmac-sha1"));
    }
}
