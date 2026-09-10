# russh 0.46 → 0.63.3 升级：方案与实施记录（v4 · 已实施）

> 状态：**已实施完成**（3 个提交，未 push）
> 基线：`b634c49` = tag **v0.14.45**
> 实际落地的 3 个提交：
> - `3143925` `chore(deps): upgrade russh 0.46 -> 0.63.3, retire the vendored fork`
> - `a049518` `chore(deps): upgrade russh-sftp 2.1.1 -> 3.0.0`
> - `7d0cf44` `test(ssh): pin host-key fingerprint to an OpenSSH-verified vector`（指纹断言加固，见 §6.2）
>
> 本文在 v3 方案基础上，记录**实际实施结果**与**方案中 4 处需要修正的判断**（§1）。

---

## 0. 实施结果摘要

| 项 | 结果 |
|---|---|
| 改动文件 | 7 个源码文件 + `Cargo.toml` + `Cargo.lock`，删除 vendored russh **59 个文件** |
| 代码改动量 | 约 110 行（与预估一致） |
| `cargo check --all-targets` | 通过，零 warning |
| `cargo fmt --all --check` | 通过 |
| `cargo clippy --all-targets -- -D warnings` | 通过，零 warning |
| `cargo test --lib` | **303 passed / 0 failed** |
| 未 push、未打 tag | 是 |

`vendor/FreeRDP`（gitlink 160000）与根目录 `vendor/iron-remote-desktop-rdp/` **均未受影响** —— 删除后 `git status` 只显示 russh 文件消失。

---

## 1. 方案 vs 实际：4 处修正（重要）

实施过程中发现 v3 方案有 4 处判断与上游实际不符，均已修正落地：

### 1.1 版本号：0.63.2 → **0.63.3**

方案评估时 `max_stable_version = 0.63.2`；实施当日 crates.io 上 **0.63.3 已发布为最新稳定版**。caret 依赖 `0.63.2` 本就会解析到 0.63.3，但已把 `Cargo.toml` 显式写成 `0.63.3` 以免误导。

### 1.2 `HashAlg` **没有 `Sha1` 变体**（方案 3.4(d) 的写法无法编译）

v3 方案写的 RSA 回退链是 `HashAlg::{Sha512, Sha256, Sha1}`。实测 `ssh-key 0.7.0-rc.11` 的 `HashAlg` **只有 `Sha256` 和 `Sha512` 两个变体**：

```rust
pub enum HashAlg { Sha256, Sha512 }   // 无 Sha1
```

SHA-1（`ssh-rsa`）对 RSA 是用 **`None`** 表达的 —— `PrivateKeyWithHashAlg::new` 的文档明确写着「For RSA, passing `None` is mapped to the legacy `sha-rsa` (SHA-1)」，且其内部对非 RSA 直接把 `hash_alg` 置 `None`。

**最终实现**改为 `Option<HashAlg>` 三级链：

```rust
if key.algorithm().is_rsa() {
    attempts.push((Some(HashAlg::Sha512), "rsa-sha2-512"));
    attempts.push((Some(HashAlg::Sha256), "rsa-sha2-256"));
    attempts.push((None,              "ssh-rsa (SHA-1)"));  // None = 遗留 ssh-rsa
} else {
    attempts.push((None, key.algorithm().to_string()));      // 非 RSA 只有一次尝试
}
```

顺带修正了原实现的一处小瑕疵：升级前非 RSA 密钥失败时诊断文案恒为「publickey rsa-sha2-512 rejected」，现在显示真实算法名。

### 1.3 `AuthResult` 的导入位置

方案写 `use russh::client::AuthResult;`。实际 `AuthResult` **未在 crate 根导出**，只在 `russh::client` 下 re-export（`client/mod.rs:60`）。本文件已 `use russh::client`，直接用 `client::AuthResult` 即可，无需新增导入。

### 1.4 russh-sftp 目标版本：2.4.0 → **3.0.0**

方案定稿时 2.4.0 是最新稳定版；**3.0.0 于 2026-09-08 发布**。已逐版本 diff 源码后决策升 3.0.0（用户确认）。依据：

| 对比 | 结论 |
|---|---|
| `SftpSession::new` / `close` | 2.1.1 / 2.4.0 / 3.0.0 **签名完全一致** |
| `protocol::{FileAttributes, FileType, OpenFlags}` | 3.0.0 仍原样导出 |
| 2.4.0 → 3.0.0 客户端 `pub fn` 签名 | **零变化**；差异仅为 `io::Error` 超时映射 + 新增 `From<Error> for io::Error` + 协议模块内部重构 |
| 2.1.1 → 2.4.0 的签名变化（`set_limits` / `set_timeout` / `new_opts`→`new_with_config`） | **本仓库一个都没用到** |

> 另一个发现：**russh-sftp 2.4.0 / 3.0.0 已完全不依赖 russh**（`russh` 只出现在 dev-dependencies），它是 transport-agnostic 的，会话由任意 `AsyncRead + AsyncWrite` 流构造。所以 russh 版本与它互不约束。

---

## 2. 实际改动清单

| 文件 | 改动 |
|---|---|
| `src-tauri/Cargo.toml` | `russh` → `0.63.3` + `default-features=false` + `["ring","rsa","flate2","des"]`；删 `russh-keys`；删 `[patch.crates-io]` 整段；`russh-sftp` → `3.0.0`；dev-dep 加 `bytes = "1"` |
| `src-tauri/vendor/russh/**` | **删除 59 个文件**（vendored 补丁退役） |
| `src/ssh/handler.rs` | 删 `#[async_trait]`；`check_server_key` 收 `&PublicKeyOrCertificate`；指纹改 `public_key().fingerprint(HashAlg::Sha256).to_string()` |
| `src/types/error.rs` | `russh_keys::Error` → `russh::keys::Error` |
| `src/ssh/keys.rs` | `russh_keys::` → `russh::keys::`（2 处调用 + 2 处注释）；指纹不再手工拼 `SHA256:` 前缀 |
| `src/ssh/manager.rs` | `none` 探测改 `AuthResult::Failure { remaining_methods, .. }`；口令/公钥改 `.success()`；`Failure` 变体加 `{ .. }`；`auth_with_key_data` 重写 |
| `src/ssh/config.rs` | 算法表：`key` 改 `ssh_key::Algorithm` 且去重；新增 `LEGACY_MACS` 加回 SHA-1 MAC；补 `host_key_certificates`；单测重写 |
| `src/scp/exec.rs` | 测试构造 `ChannelMsg::Data` 改 `Bytes::from_static` |

保留项：`async-trait`（`term/local.rs`、`term/mod.rs`、`term/serial.rs`、`term/telnet.rs` 仍在用）。

---

## 3. 关键实现（最终态）

### 3.1 主机指纹 —— 本次升级的**头号兼容性风险**

`ssh_key 0.7` 的 `Fingerprint: Display` 自带 `SHA256:` 前缀，编码与 0.46 一致（`BASE64_NOPAD(SHA256(wire-encoding))`），**所以 SQLite 里已保存的受信主机指纹字符串不变，用户升级后不会重新弹确认**。

这条结论已由自动化测试钉死（见 §6.2），不再是纸面论证。

### 3.2 算法表（`src/ssh/config.rs`）

```rust
const LEGACY_MACS: &[mac::Name] = &[mac::HMAC_SHA1, mac::HMAC_SHA1_ETM];
```

不加回这两项的后果：CBC 密码必须有配套 MAC，而 0.63 的默认 MAC 表已剔除全部 SHA-1 变体 → 老设备 `aes256-cbc + hmac-sha1` 直接 `No common MAC algorithm`。

| 列表 | 0.46 | 0.63.3 | 处理 |
|---|---|---|---|
| kex | `curve25519-sha256` 首位 | **`mlkem768x25519-sha256` 首位**（PQ 混合） | 单测钉住首位 |
| key | 无 ssh-rsa | **末尾已含 `Algorithm::Rsa { hash: None }`** | 改为**条件 push** 去重（原无条件 push 会重复） |
| cipher | 无 CBC | 无 CBC | 继续追加 4 个 CBC |
| mac | 含 `hmac-sha1` | **已剔除 SHA-1** | **必须追加** `hmac-sha1`、`hmac-sha1-etm` |

### 3.3 加密后端：`ring`

与 `rustls` / `tokio-rustls` 统一为单一加密后端，且 Windows x64 发布链路免 NASM。`rsa` / `des` / `flate2` 三个 feature 必须显式开 —— 否则 `Algorithm::Rsa`、`cipher::TRIPLE_DES_CBC`、zlib 分别不可用。

---

## 4. 依赖变化（实测）

| 项 | 结果 |
|---|---|
| russh | `0.46.0` → `0.63.3`（lock 中**仅一份**） |
| ssh-key | `0.6.7` → `0.7.0-rc.11`（rc 传递依赖，**不可规避**，0.60 起皆如此） |
| russh-sftp | `2.1.1` → `3.0.0` |
| 新增 crate | 15 个（`ml-kem`、`kem`、`module-lattice`、`sha3`、`crypto-primes` 等，PQ + 密钥算法相关） |
| 移除 crate | 5 个（`russh-keys`、`num-bigint-dig`、`spin`、`libm`、`num-iter`） |
| 关键直接依赖 | `tauri` / `tokio` / `rustls` / `reqwest` / `rusqlite` / `keyring` / `notify` / `portable-pty` / `serialport` / `rust-s3` / `ironrdp-rdcleanpath` / `hostname` **全部版本未变** |

**并存的同名多版本**（非问题，仅记录）：`argon2 0.5.3`(我们的) + `0.6.0`(ssh-key 传递)、`aes-gcm 0.10.3`(我们的) + `0.11.1`(pkcs8/pkcs5 传递)。我们的直接依赖版本未变，后者来自加密私钥支持链路。

---

## 5. 提交序列（实际）

| # | commit | 内容 |
|---|---|---|
| 1 | `3143925` | russh 升级 + 删 vendored（59 文件）+ 全部代码改造 |
| 2 | `a049518` | russh-sftp 3.0.0（**零代码改动**，便于独立回退） |
| 3 | `6bff748` | 指纹断言加固（OpenSSH 权威向量） |

拆成独立 commit 的目的：russh 与 sftp 任一出问题都可单独 `git revert`。

---

## 6. 验证

### 6.1 自动化（已全绿）

| 检查 | 结果 |
|---|---|
| `cargo check --all-targets` | ✅ 零 warning |
| `cargo fmt --all --check` | ✅ |
| `cargo clippy --all-targets -- -D warnings` | ✅ 零 warning |
| `cargo test --lib` | ✅ **303 passed / 0 failed** |
| 算法表单测（`ssh::config`） | ✅ PQ kex 首位、ssh-rsa 不重复、hmac-sha1 已加回且排在现代 MAC 之后 |
| `scp::exec` 测试（`Bytes` 迁移） | ✅ 5 passed |

### 6.2 指纹兼容性 —— 已用 OpenSSH 权威值钉死

原测试只断言 `starts_with("SHA256:")`，无法发现编码变化。已改为断言**精确值**，与本机 `ssh-keygen -lf` 输出逐一比对：

```
ssh-keygen -lf id_ed25519.pub
256 SHA256:T7SvZ2cslqpPj6nKzitCBHHlpVF3r3MvLwmFL0fk0IE user@host (ED25519)
```

测试 `fingerprint_valid_pub_matches_openssh_ssh_keygen_lf` 断言 `get_key_fingerprint()` 必须等于
`SHA256:T7SvZ2cslqpPj6nKzitCBHHlpVF3r3MvLwmFL0fk0IE`，并在 0.63.3 下通过。

### 6.3 待人工验证（**本机 Docker 不可用，无法代跑**）

本机 `docker` 命令不存在，项目自带的 SSH 测试服务器（`tests/scp-server`、`tests/bastion-server`、`tests/sudo-server`，通过 `make start-ssh-pass` / `start-ssh-key` / `start-scp-*` 启动）无法拉起。以下各项需在有 Docker 的机器上人工执行：

| 场景 | 命令 | 通过标准 |
|---|---|---|
| 口令登录 | `make start-ssh-pass` → 连 `localhost:2222` | 终端可交互、SFTP 可列目录 |
| 密钥登录 | `make start-ssh-key` → 连 `localhost:2223` | ed25519 免密成功；**另造 RSA 私钥验证 rsa-sha2-512 → 256 → ssh-rsa 三级回退** |
| 堡垒机 ki | 空口令触发双因子 | 错误提示仍含 `server allows [...]`（现由 `remaining_methods` 提供） |
| 主机信任 | 用**升级前已受信**的主机连接 | 指纹一致、**不重复弹确认** |
| 遗留设备 | H3C / Huawei 等真实设备 | `aes256-cbc + hmac-sha1` 可协商（验证 MAC 加回生效） |
| SFTP 大文件 | ≥100MB 上下行 + 目录递归 + 中途取消 | 字节一致、进度正常、取消无残留（覆盖 sftp 3.0.0 的并发写入/limits 重构） |
| E2E | `make e2e` | 与升级前一致 |

> 注：`MethodSet` 解析时会**丢弃未知方法名**（`MethodKind::from_str` 失败即过滤），所以堡垒机若宣告私有认证方式，诊断文案会显示「server allows no further methods」而非真实方法名。不影响判定逻辑（未知方法本就不在我们的比对列表内），已在代码注释中标注。

### 6.4 发布前回归（建议）

```bash
cargo tree -p russh          # 确认仅 0.63.3 一份
cargo tree -i aws-lc-rs      # 确认未引入（应无输出或仅间接无）
```

---

## 7. 风险与回滚

| 风险 | 等级 | 现状 |
|---|---|---|
| 默认 MAC 表剔除 SHA-1 → 遗留设备失败 | 高 | 已加回并用单测锁定；**仍需 6.3 真实设备验证** |
| 默认 kex 首位变 PQ 混合 → 个别固件异常 | 中 | strict-kex + PQ，需真实设备验证；必要时显式重排 kex 列表 |
| russh-sftp 3.0.0 并发写入/limits 行为变化 | 中 | 独立 commit，异常时只 revert `a049518` |
| 指纹编码变化 → 已授信主机全部失效 | 高 | **已用 OpenSSH 权威向量钉死**，自动化可拦截 |
| rc 传递依赖进入发行包 | 低（不可规避） | 知悉即可 |
| 删除 vendor 误伤 FreeRDP gitlink | 中 | **已规避**（实测 `git status` 只显示 russh 文件） |

**回滚**
- 只退 sftp：`git revert a049518`
- 退 russh：`git revert 3143925`（自动恢复 `[patch.crates-io]` 与 vendored 文件）
- 整体回到升级前：`git reset --hard b634c49`（**当前尚未 push，安全**）

---

## 8. 复审记录

| 日期 | 事项 | 结论 |
|---|---|---|
| 2026-09-08 v1 | 首轮评估（基线 v0.14.39） | 可行，一次性直跳；识别 vendored 补丁可退役、算法表变化、指纹兼容 |
| 2026-09-08 v2 | 「使用最新稳定版」复核 | russh 0.63.2 即最新；rc 依赖无法规避；russh-sftp 改为同步升级 |
| 2026-09-08 v2 | ring vs aws-lc-rs | 选 **ring**（单一加密后端 / Windows 免 NASM / 无性能诉求） |
| 2026-09-10 v3 | 「以最新提交为准」复核 | 基线快进至 v0.14.45；新发现 FreeRDP gitlink 需避开；补齐逐文件代码级方案 |
| 2026-09-10 v4 | **实施完成** | 3 个提交全绿；**修正 4 处方案偏差**（0.63.3 / 无 `HashAlg::Sha1` / `AuthResult` 导入位置 / sftp 3.0.0）；指纹改用 OpenSSH 权威向量钉死；剩人工冒烟待 Docker 环境 |
