# anySSH 上线前测试报告

**日期**：2026-09-11
**被测基线**：`main` @ `0fc493d`（已推送 `jincaiw/anySSH`）
**本轮改动**：8 个提交，全部已推送（清单见 §10）
**CI**：
- run `34609578512` @ `0fc493d` —— **8/8 job success**（attempt 1 即绿，代码基线）
- run `34613427870` @ `2c31fd2`（本轮末提交）—— attempt 1 有 3 个 E2E shard 失败，**attempt 2 重跑同一二进制后 8/8 success**、75 spec PASSED。详见 §3.4：两次失败均为**环境性**，且**未通过放宽超时/加重试掩盖**
**范围**：基础质量 / 自动化测试 / 功能验收 / 安全 / 性能与稳定性 / 数据与部署 / 兼容性 / 可运维性

---

## 1. 汇总

| 检查维度 | 结论 | 关键依据 |
|---|---|---|
| 1. 基础质量 | **PASS** | 构建 / fmt / clippy / `cargo deny check` 四段全 ok |
| 2. 自动化测试 | **PASS** | 311 单测 × 多种时序一致；E2E 75 spec 全绿；覆盖率实测；400 轮 PTY 实测无句柄漂移 |
| 3. 功能验收 | **PASS**（1 WARN） | 核心链路单测 + E2E 双覆盖；`*:file-edited` 死事件（低危） |
| 4. 安全检查 | **PASS**（2 WARN） | 无注入/XSS 路径；`unsafe` 0；凭据加密存储；遥测已披露 |
| 5. 性能与稳定性 | **WARN**（已收窄） | 新增资源泄漏回归 + 400 轮句柄/延迟实测；仍**无应用层基准、无 4 小时长跑与内存曲线** |
| 6. 数据与部署 | **PASS** | schema 保护 + 迁移幂等 + 备份往返；实机安装待人工 |
| 7. 兼容性 | **WARN** | 3 平台 × 4 目标由 CI 构建；DPI 与实机仅部分覆盖 |
| 8. 可运维性 | **WARN** | 无日志落盘、无 panic hook、级别硬编码 |

**无 FAIL 项**（无阻塞级缺陷、无高危安全问题）。
**CI 已达全绿**，但需知悉两点：① E2E 存在**环境性抖动**（§3.4），末次全绿是**重跑失败 job 后**取得的；② 因此判绿时务必分清「一次即绿」与「重跑才绿」。

---

## 2. 基础质量 —— PASS

| 项目 | 结果 |
|---|---|
| 完整构建 | `cargo build --locked --release` 成功（3m05s，exit 0） |
| 格式 | `cargo fmt --all --check` 通过 |
| 静态检查 | `cargo clippy --all-targets -- -D warnings` 零告警 |
| 依赖审计 | `cargo deny check` → `advisories ok, bans ok, licenses ok, sources ok`（exit 0） |
| 依赖锁定 | `Cargo.toml` / `Cargo.lock` 一致；`rusqlite` 用 `bundled`（自包含 SQLite，无外部依赖） |
| 产物体积 | release 二进制 35 MB（macOS arm64）；`.dmg` 17.0 MB ～ `.msi` 229 MB（内含 WebView2 离线安装包） |

**已修复缺口**：`deny.toml` 此前**完全没有 `[licenses]` 段**。cargo-deny 默认许可白名单为空，`cargo deny check licenses` 报 **776 条 `error[rejected]`**，该检查从未具备门禁能力；CI 又只跑 `check advisories`，问题被完全掩盖。已补 permissive-only 白名单（16 项）并把 CI 命令扩为 `check advisories licenses`。

`bans` / `sources` 未纳入 CI：二者在 cargo-deny 默认配置下（`multiple-versions = "warn"`、`unknown-registry = "warn"`）本就 pass 且不阻断，纳入只增加噪音而不增加门禁。

---

## 3. 自动化测试 —— PASS

### 3.1 单元 / 集成测试

**311 passed / 0 failed**（本轮由 308 增至 311；另有 1 个 `#[ignore]` 的长跑测量工装，见 §3.3，不计入门禁）。同一代码在多种时序下结果完全一致：

| 运行方式 | 结果 |
|---|---|
| 默认（并行）× 5 次 | 311 / 0，12.77–13.78 s，五次一致 |
| `--test-threads=1` | 311 / 0 |
| `--test-threads=32` | 311 / 0 |
| `--release` | 311 / 0 |

⇒ **无顺序依赖、无并发抖动**。CI 侧对同一提交独立复核通过。

### 3.2 本轮新增的自动化覆盖（3 个用例）

前一轮报告点出两处「零自动化覆盖」的资源归属问题，均为**泄漏型**故障（不会立刻报错，要几百次循环后才表现为 `EMFILE` 或挂起）。已补齐：

| 新增用例 | 断言内容 | 为何有价值 |
|---|---|---|
| `term::local::tests::repeated_pty_lifecycle_does_not_leak_descriptors` | 12 次 `open → shutdown → drop`；`shutdown` 必须在有界 await 内完成；关闭后读取必须返回 EOF 而非阻塞；进程**描述符下界**不得在两批之间台阶式上升 | `term/local.rs`、`term/mod.rs` 此前**没有任何测试**（0% 覆盖）。每个 PTY 会话持有 master fd、slave fd 与一个 OS 读线程，`shutdown` 里的「SIGHUP → 轮询 → 进程组 SIGKILL」升级路径正是为「shell 捕获 SIGHUP 就会永久挂起 teardown」而存在 |
| `remote::bridge::tests::session_registry_accounting_returns_to_empty` | 2000 次交错 VNC/RDP 注册 → `pending == 2000`；逐个关闭 → 两表归零；二次关闭必须报错 | 非空表**不是外观问题**：空闲看门狗只在两表都空时才关停监听器，残留项会把 loopback 端口钉住整个进程生命周期 |
| `remote::bridge::tests::tokens_are_unique_and_full_length_across_many_draws` | 20000 次抽样：均 64 位 hex、全部互异 | 该令牌是 loopback 端点的**唯一**防护（端点不校验 `Origin`），重复即跨会话访问 |

**一处必须记录的返工**：泄漏断言的初版**是抖动的**，曾真实失败过一次（`baseline=38, open=35`）——因为 `open_fd_count` 是进程级计数，而 `cargo test` 让其余用例在同一进程内并行，邻居测试关闭描述符会污染采样。最终改为**差分设计**（两批等量循环、比较批间下界），使系统性噪声在两次测量中抵消，而每循环 1 个 fd 的真泄漏仍会表现为 +6 的台阶。**抖动本身即门禁缺陷**，故同时以「五连跑全绿」验证其稳定性。

### 3.3 长跑测量工装（`#[ignore]`，非门禁）

门禁用例每批只跑 6 轮，形态正确但**太短**——每会话成本若小于一个 fd，6 轮看不出来，攒一整天就不是「看不出来」了。故另加一个**显式忽略**的测量工装（`soak_pty_churn_reports_descriptor_and_rss_drift`），跑 400 轮 `open → shutdown → EOF`，每 50 轮打印一次句柄下界与关闭延迟：

```bash
cd src-tauri && cargo test --release --lib -- --ignored --nocapture soak_pty_churn
```

本次在 macOS arm64 / release 下的实测结果：

| 指标 | 结果 |
|---|---|
| 句柄下界 | **14 → 14（+0）**，全部 8 个检查点均为 14（无台阶） |
| 最慢单轮关闭 | **55.5 ms** |
| 400 轮总耗时 | **23.9 s**（约 60 ms / 轮） |
| 常驻内存（RSS） | **未采到** —— 见下 |

**RSS 一列必须标为「未测」而不是 0**：采样走 `ps -o rss= -p <pid>`，而本次审计所在的受限沙箱用 seatbelt 拒绝执行 `ps`（`Operation not permitted`）。工装首版把失败静默折叠成 `0`，读数就成了「内存零增长」——**「没测到」与「没增长」绝不能长得一样**。已改为返回 `Option`：采不到时打印 `rss=unavailable`、明确输出「内存漂移未测量」并**跳过**该断言，而不是用一个伪造的 0 去满足断言。故内存维度仍留在人工项（§12 第 8 项），其采样命令见手册 6.1。

### 3.4 端到端测试（含一项独立风险）

**75 个 spec**（`tests/e2e/specs/`），分 4 shard 跑在 Docker 内；覆盖主机 CRUD、口令/密钥连接、SFTP 全流程（导航/上传/下载/递归/复制/移动/chmod/属性/软链接）、SCP 回退、S3、端口转发与跳板链、片段与变量、导入 ssh_config、备份恢复、多标签/分屏/缩放、i18n、协议连接面板、RDP WASM CSP。

**最终 CI：4 个 shard 全部 success。但必须记录：E2E 存在环境性抖动。** 本轮累计观察 **8 次失败，分属 7 个不同 spec、3 个不同 shard**，无一次指向 anySSH 行为错误：

| 失败 spec | 现象 | 实际等待 | 性质 |
|---|---|---|---|
| `04-connect-key`（shard 4，该 shard 首个用例） | `publickey ssh-ed25519 rejected` | TCP 探活即放行 | **已修**：`entrypoint.sh` 只做 TCP 探活，而 `sshd-key` 需要 `authorized_keys` 已装入；端口可连 ≠ 可用 |
| `04-connect-key`（同上，另一次） | `Temporary failure in name resolution` | — | 容器 DNS 瞬时故障 |
| `02-host-crud`（shard 2，该 shard 首个用例） | host card 未出现（同 spec 后续两用例通过） | **固定 10 s** | 冷容器首次启动/首次写库超过固定等待 |
| `26-split-pane`（shard 2） | xterm 未在分屏后重挂载 | **固定 10 s** | 同上 |
| `61-sftp-properties-chmod`（shard 3） | `explorer did not open` | **30 s 条件轮询** | 见下 |
| `19-sftp-refresh`（shard 3） | `explorer did not open` | **30 s 条件轮询** | 见下 |
| `16-sftp-navigate`（shard 4） | `explorer did not open` | **30 s 条件轮询** | 见下 |
| `22-snippet-palette-run`（shard 2） | `[data-snippet-name='Echo Sentinel']` 5 s 内不可点击 | **5 s** | 见下 |
| shard 2（一次） | `failed to fetch oauth token … connection reset by peer` | — | **Docker Hub 注册表鉴权失败**，连测试都没跑起来 |

**三处必须说清的事实**（此前一轮的表述不够准确，已按日志更正）：

1. `waitForExplorer()` **不是固定短超时**：它是 30 秒的**条件轮询**（每 200 ms 检查 `explorer-refresh` 是否存在且可见，并自动点击主机密钥信任弹窗）。所以 `explorer did not open` 的含义是「30 秒内 SFTP 浏览器根本没渲染出来」，**不能**与固定 10 s 的用例混为一谈——把两者合并会低估该类失败的严重程度。
2. 有 **1 次发生在零代码改动的纯文档提交（`25b2a92`）上**（失败 spec `19-sftp-refresh`）：该提交只改 `docs/` 与 `.workbuddy/memory/`，产物与上一次全绿提交逐字节相同。同 shard 紧随其后的 4 个 spec（`23-settings-persist`、`27-pane-zoom`、`31-reconnect-after-disconnect`、`35-sftp-large-listing`）全部 PASS，环境在数秒内即恢复。
3. **最强的一条证据**：本轮末提交 `2c31fd2` 的 run `34613427870` 在 **attempt 1 有 3 个 shard 同时失败**（`22-snippet-palette-run` / `19-sftp-refresh` / `16-sftp-navigate`），随后**只重跑失败 job（attempt 2，二进制与配置完全相同）→ 8/8 success、75 spec 全过**。同一产物、同一套测试，一次红一次绿，唯一变量是 runner 当时的负载。

**最可能的机制（有日志支撑，非猜测）**：容器内 `libEGL warning: DRI3 error: Could not get DRI3 device` 反复出现 ⇒ WebKitGTK 退回**软件渲染**；同一 runner 上多个 worker 并行各起一个 GUI 实例，CPU 争用下首次渲染偶发超过 30 s。这解释了「换一个 spec 失败、下次又全绿、重跑即过」的随机性。

**一条必须澄清的误读**：shard 4 日志里出现 `Incorrect password, or the backup file is corrupt` 与 `Not a valid anySSH backup file` 的 `ERROR webdriver` 行，**不是失败**——那是 `62-data-backup-restore` 的负向用例，该 spec 最终 **6 passing**。应用在这两条路径上正确地拒绝了错误口令与非法文件。

**因此产出一条对用户可见的结论**：E2E **不能**作为「首屏 / 首次打开耗时」的门禁——它在冷容器里对首屏的等待是固定值，而首屏恰恰是用户第一印象。该量至今未测，列入人工项（§12 第 4、6 项）。

**判定**：以上**均非产品缺陷**——证据是同一 spec 在其它轮次通过、其中两类带明确的基础设施错误信息（容器 DNS、Docker Hub oauth）、一类在**零代码改动**的提交上复现、且**同一产物重跑即全绿**。其中**唯一可复现**的一类（`sshd-key` 就绪）已修复（修复前 2/2 失败、修复后转绿）。

**保留的不确定性（不粉饰）**：自动化只能证明「这些失败与本次代码改动无关」，**不能**排除「存在仅在负载下才触发的竞态」。要在实机上排除，靠的是 §12 第 6 项（真实安装 + 首次启动）与第 8 项（4 小时长跑）——这正是剩下的最后一道闸门。

**未采取的手段**：未放宽任何超时、未加重试、未屏蔽断言来「消除」这些失败——它们是环境特征，改测试只会把证据藏起来。

### 3.5 覆盖率（实测）

`cargo llvm-cov --lib`：

| 指标 | 本轮 | 上轮 |
|---|---|---|
| 行 | **47.66%**（8755 / 18370） | 47.18% |
| 函数 | **34.44%**（878 / 2549） | 34.02% |
| 区域 | **53.26%**（14630 / 27469） | 52.85% |

关键文件：`term/local.rs` **77.38% 行**（新增测试前近乎未覆盖）、`remote/bridge.rs` **83.12%**、`ssh/config.rs` 98.70%、`scp/listing.rs` 91.93%、`vault/portable.rs` 89.19%、`remote/rdp.rs` 88.85%、`db/mod.rs` 87.31%、`term/telnet.rs` 85.96%。

**仍有 20 个文件 0%**，全部是命令层与传输编排（`*/commands.rs`、`s3/transfer_manager.rs`、`ssh/session.rs`、`term/mod.rs` 等）。这是**口径限制而非未测试**：命令层由 75 个 E2E spec 驱动**成品二进制**，llvm-cov 无法对其插桩；要覆盖需改用 E2E 侧覆盖率（未做）。

### 3.6 并发与数据竞争

`cargo-miri` 不适用（`rusqlite` 链接 C SQLite、`ring` 含汇编、`portable-pty` 为 FFI，均无法在 Miri 下执行）。改用组合证据：

- 四种线程/时序组合结果完全一致（§3.1）；
- `src-tauri/src` 下 **`unsafe` 零处** ⇒ 不存在手工数据竞争的前提；
- 共享状态均为 `Mutex` / `DashMap` / `OnceLock` / `Semaphore`，无裸共享可变；
- 传输并发硬上限 **3**（三个 transfer manager 各 `Semaphore::new(3)`）；终端命令通道为每会话独立队列，消费端受 5s I/O 超时保护；
- `remote/bridge.rs` 的 `expire_pending()` 按 TTL 清理待连令牌，`ActiveSessionGuard::drop` 保证活跃表不泄漏；本轮新增的记账类回归用例对此加以固定。

---

## 4. 功能验收 —— PASS（1 WARN）

核心链路（SSH / SFTP / SCP / S3 / 端口转发 / 本地终端）均由单测 + E2E 双覆盖且通过。异常与边界已覆盖：错误凭据、连接拒绝、坏密钥路径、错误横幅自动清除、重连、目录保持、大量文件列举、多选删除、复制粘贴冲突、无效端口（`/^\d+$/` + 1..65535 校验）。

**WARN-1：外部编辑器「保存即回传」完成后前端不刷新。**
后端在回传成功后 emit `sftp:file-edited` / `scp:file-edited` / `s3:file-edited`，但前端**从未订阅过这三个事件名**（前端只 `listen` `term:status` / `ssh:status` / `${channel}:output` / `sftp|scp|s3:transfer` / `pf:status` / `serial:ports-changed`）。`git log -S` 追溯：事件自**初始提交**即存在，前端**全历史从未有过监听** ⇒ 上游长期遗留的死事件，非本项目引入的回归。影响：回传成功后远端列表不自动刷新（需手动刷新）；**不影响数据正确性**。**未修复**——前端改动在本机无法验证（`node_modules` 为空，无 tsc / vitest / vite），只应在有 CI 校验的窗口内处理。

---

## 5. 安全检查 —— PASS（2 WARN）

### 5.1 逐项结论

| 检查项 | 结果 |
|---|---|
| 认证 / 授权 / 权限绕过 | 无服务端会话概念；权限由 OS keychain 与文件权限承载 |
| 注入（SQL） | **无注入路径**。`COPYABLE_TABLES` 是硬编码 `&[&str]` 常量，`format!("DELETE FROM main.{table}")` / `PRAGMA table_info({table})` 的表名只来自该常量，且注释明确「`table` is always a trusted constant」 |
| 注入（命令） | **无注入路径**。外部进程一律 `.arg()` / `.args()` 传参、不经 shell：`open -a`、用户配置的编辑器 `exec_path`、`which puttygen`、`puttygen`。PPK 口令经 `tempfile::NamedTempFile`（0600）传递，不落共享临时目录 |
| XSS | 前端 `dangerouslySetInnerHTML` / `innerHTML` / `eval(` / `new Function` **均 0 处** |
| CSRF | **不适用**：无 Cookie、无浏览器会话、无 HTTP 服务端口；前后端仅经 Tauri IPC |
| SSRF | Rust 侧 `reqwest` **仅出现在 `telemetry.rs`**，目标为硬编码 `https://us.i.posthog.com`。S3 走 `attohttpc`（经 `rust-s3`），端点是用户自填的存储端点——客户端连自己的存储，属设计内行为。更新器清单地址固定为 GitHub `latest.json`，更新包 URL 取自该清单，但**必须通过配置的 minisign 公钥验签** ⇒ 篡改下载源无法投递未签名包 |
| 路径穿越 | `fsio::sanitize` 处理 `..`、`.`、点段、Windows 尾点（`...` → `unnamed`），测试覆盖 `../../../../tmp/evil.sh`、`..\..\evil.txt`、`C:\Windows\evil.exe`；各 transfer manager 另有 `name == ".."` / 分隔符 / 绝对路径过滤 |
| 凭据存储 | 已安装版写 **OS keychain**（`keyring`）；便携版为 **AES-256-GCM** 文件，密钥取自 256-bit CSPRNG 材料并过 **Argon2id**（m=8 MiB, t=2, p=1；固定 salt 已在代码中注明仅作域分隔，密钥本身为 CSPRNG）。Telnet 登录脚本按凭据处理整体入加密 vault，SQLite 与备份只存引用 |
| 备份加密 | **AES-256-GCM + Argon2id（m=64 MiB, t=3, p=1）**，含全库快照与全部凭据，gzip 后加密；头部作 AEAD 关联数据，改参数即校验失败；`#[instrument(skip(password, …))]` 确保口令不入日志 |
| 密钥 / Token 泄露 | 仓库内**无** `.env` / `.pem` / 真实私钥：`keys.rs` 中 `PRIVATE KEY` 全部为测试夹具（正文为 `MIIEpAIBAAKCAQEA...` 占位）或格式判定字符串。`.gitignore` 覆盖日志、`.test-ssh/`、e2e 缓存 |
| 第三方依赖漏洞 | 见 5.2，全部已登记并按设计接受 |
| 崩溃面 | 生产 `unwrap/expect` 由 **20 处降至 13 处**（本轮修 7 处，§10）；`unsafe` 0 处；生产代码 `println!/eprintln!/dbg!` 0 处（唯一例外是 `#[ignore]` 长跑工装用 `eprintln!` 打印曲线，属 test-only，见 §3.3） |

### 5.2 依赖公告（已登记于 `deny.toml`）

- `RUSTSEC-2026-0194` / `0195`（quick-xml DoS ×2）：经 `aws-creds 0.39.1` → `rust-s3 0.37.1`。**两者均为当前最新版**，仍写 `quick-xml = "^0.38"`，修复需 `>=0.41`，跨 semver 大版本 ⇒ `cargo update --precise` 必冲突、`[patch]` 会撞破坏性 API 变更。**已定案不可修**；触发条件是恶意 S3 端点返回畸形 XML。
- `RUSTSEC-2023-0071`（RSA Marvin 时序侧信道）：经 russh 的 `rsa` feature，上游 `patched: []`（无修复版本）。需精确计时测量，对本地 SSH 客户端威胁有限。
- 8 条 transitive `unmaintained`（构建期或已停维护的传递依赖）。

### 5.3 WARN

**WARN-2：遥测披露缺失（已修复，保留说明）。** 两个 README 原称「Fully offline — no internet connection required」，**与事实不符**：每个事件各发一次 HTTPS POST 到 PostHog。事件属性经全量核对**无 PII**（51 个事件均为计数、布尔、协议名、固定 provider id、编辑器显示名、字节数、错误条数；不含主机名/地址/用户名/密码/密钥/路径/文件名/片段内容/桶名/对象名/转发目标），故定级为**披露与合规风险**而非数据泄露。已修：README（英/中）新增 Telemetry 小节并更正失实声明，`SECURITY.md` 新增 `## Telemetry` 面向审计者披露端点、载荷、标识符（`.device_id` 随机 UUID，非机器/账号派生）与关闭方式。

**WARN-3：遥测无应用内开关。** 唯一退出方式是环境变量 `ANYSSH_DISABLE_TELEMETRY`，无 UI 开关（已在 `SECURITY.md` 明确写出，不做暗示）。另 `remote/bridge.rs` 的 loopback WebSocket **不校验 `Origin` 头**——由 32 字节 CSPRNG 令牌 + 单次消费（`pending.remove`）+ 60s TTL 兜底，且本轮以 20000 次互异性抽样固定该前提；风险低，仅记录。

---

## 6. 性能与稳定性 —— WARN

**本轮新增（泄漏面）**：`repeated_pty_lifecycle_does_not_leak_descriptors` 现在把「PTY 反复开关不泄漏描述符、teardown 必有界完成」纳入回归；桥接会话登记表的记账平衡也已被固定（§3.2）。此外新增 400 轮的长跑测量工装，取得句柄与关闭延迟的实际曲线（§3.3）。前序已修的两处「不可取消 await」陷阱（`term/mod.rs`、`ssh/session.rs`）均有 `IO_OP_TIMEOUT` / `CHANNEL_OP_TIMEOUT` = 5s 包裹后端 I/O，关闭走 `timeout(CLOSE_TIMEOUT, &mut task)` 后 `abort()`。

**已量化**：

| 指标 | 数值 |
|---|---|
| release 构建 | 3m05s（macOS arm64，含依赖） |
| 单测套件 | 12.77–13.78 s / 311 例 |
| release 二进制 | 35 MB |
| 发布资产 | 17.0 MB（`.dmg`）～ 229 MB（`.msi`，含 WebView2 离线包） |
| 传输并发 | 3 / manager（硬上限，有界） |
| 会话日志 | 保留 30 天、配额 500 MB、单文件 10 MB（设置中可调，带 `clamp`） |
| **PTY 400 轮句柄漂移** | **+0**（14 → 14，各检查点均稳定，§3.3） |
| **单轮 PTY 关闭最慢** | **55.5 ms**（400 轮共 23.9 s，约 60 ms/轮） |

**仍未量化（记为风险，不判定通过）**：

- 仓库**无 `benches/`、无 `criterion`** ⇒ 核心数据通路（SSH 吞吐、SFTP/SCP/S3 速率、终端渲染延迟）**无任何基准数据**；响应时间 / 吞吐量 / 错误率 / CPU / 内存占用均未测量。
- 压力测试（大文件、海量小文件、多会话并发、弱网/高丢包/高延迟）未执行。
- **长时间运行稳定性仅部分验证**：终端（PTY）层的句柄曲线已有 400 轮实测数据且无漂移，但**应用层 >1 小时的混合负载仍未验证**（无连续运行记录）；**内存增长趋势仍无数据**（本次受沙箱限制未能采样 RSS，见 §3.3），线程数、连接数的长期曲线同样无数据。
- **冷启动耗时未测量**——E2E 里连「条件轮询 30 s 都等不到首次渲染」的用例（§3.4）暗示 CI 软件渲染下单次首屏可能非常慢，但**这是 CI 容器（无 GPU、多 worker 争用）的特征，不能当作实机结论**，必须实机确认（§12 第 4 项）。

---

## 7. 数据与部署 —— PASS

| 项目 | 结论 |
|---|---|
| 数据库自包含 | `rusqlite` 用 `bundled`（编译期自带 SQLite），无外部 SQLite 依赖 |
| schema 保护 | `LATEST_SCHEMA_VERSION` 常量 + 「库版本高于 App」保护 + 3 个配套测试 |
| 迁移幂等 | `migrations_are_idempotent_across_reopen`：重复打开不重复迁移 |
| 备份 / 恢复 | `build_and_restore_roundtrip_is_compact` 单测 + E2E `62-data-backup-restore`；AES-256-GCM + Argon2id，口令错误时 AEAD 标签校验失败、**不改动任何数据** |
| 升级 | 更新器端点实测 http 200、`version 0.15.0`、**11 平台全部带签名**；`createUpdaterArtifacts: v1Compatible` |
| Windows 无网安装 | `webviewInstallMode: offlineInstaller` ⇒ `.msi` 自带 WebView2 |
| Linux 依赖 | `.deb` / `.rpm` 声明 `libwebkit2gtk-4.1` 等；AppImage 免安装 |
| 全新安装与首启 | **需人工验证**（§12 第 4、7 项） |

---

## 8. 兼容性 —— WARN

CI 覆盖 **3 平台 × 4 目标**：

| 目标 | 运行时 | 产出 |
|---|---|---|
| `macos-14` `aarch64-apple-darwin` | WKWebView | `.dmg` + `.app.tar.gz` |
| `macos-14` `x86_64-apple-darwin` | WKWebView | `.dmg` + `.app.tar.gz` |
| `ubuntu-22.04` x86_64 | WebKitGTK 4.1 | `.deb` / `.rpm` / AppImage / portable |
| `windows-latest` x64 | WebView2（离线安装包） | `.msi` / `.exe` / portable |

已核实：Rust `edition = 2021`；主窗口由 `src-tauri/src/lib.rs` 的 `WebviewWindowBuilder` 创建（默认 1200×800、最小 800×500）——注意 `tauri.conf.json` 的 `app.windows` 是空数组，改窗口配置别只搜配置文件。

**WARN**：① **未声明 MSRV**（`Cargo.toml` 无 `rust-version`），CI 用 `stable` ⇒ 源码构建的可重现性随时间漂移；② **高 DPI / 多显示器未验证**——仅 `ExplorerView` 对 Windows 单独补偿 `devicePixelRatio`，其余缩放场景无实机证据；③ Windows 上 GUI 启动**拿不到任何日志**（无控制台），见 §9。

---

## 9. 可运维性 —— WARN

- **日志**：`tracing_subscriber::fmt().with_env_filter("anyssh=debug,russh=info")`，**仅写 stdout**，无文件 appender、无 rolling。级别**硬编码**，既不读 `RUST_LOG` 也非 `from_default_env` ⇒ 用户**无法在运行时提升日志级别**（需重新编译）。
- **后果**：Windows 上从 GUI 启动时日志无处可去，现场排查基本无据可依。这一限制已写入人工验证手册，要求所有验证**从终端启动**。
- **唯一落盘日志**：会话日志（`<app_data_dir>/session-logs`），带保留期与配额清理，有测试覆盖（`cleanup_respects_retention_and_quota`）。
- **错误可定位性**：错误枚举统一序列化为 `{ kind, message }`，`kind` 作稳定翻译键，前端保留技术细节原文（如 `Connection refused (os error 61)`）——该设计良好。RDP 失败会 `tracing::warn!` 打印真实原因（证书变更 / TLS 错误 / 连接拒绝可区分）。
- **崩溃恢复**：**无 panic hook、无 `catch_unwind`**。panic 无结构化落盘。
- **健康检查 / 监控**：桌面应用无服务端指标；应用内有主机健康检查功能（E2E `53-host-health-check` 覆盖）。

---

## 10. 本轮提交清单（8 个，全部推送）

前 6 个是修复/补齐，后 2 个是交付物本身：

| 提交 | 问题 | 修复 |
|---|---|---|
| `6377a5e` | `deny.toml` 缺 `[licenses]` 段 ⇒ 许可检查 776 条 rejected，从未真正门禁；CI 只跑 advisories 故未暴露 | 补 permissive-only 白名单（16 项）+ `version = 2`；CI job 更名并改为 `check advisories licenses`。Copyleft 仅以 OR 备选形式出现（`unescaper` 的 `GPL-3.0-only`、`r-efi` 的 `LGPL-2.1-or-later`）故不列白名单，真正 GPL/LGPL-only 依赖仍会失败；MPL-2.0 为文件级 copyleft，未修改消费无源码披露义务 |
| `0537d3f` | 遥测用**无界** `mpsc` + `reqwest::Client::new()`（**默认无超时**）。半开连接（完成 TCP 握手后不响应）可永久阻塞唯一消费者，事件同时无界增长 | `QUEUE_DEPTH = 256` 有界队列 + `REQUEST_TIMEOUT = 10s` + `try_send`（满队列静默丢弃，符合 fire-and-forget 契约）。同提交修正 README 失实的 offline 声明并补遥测披露 |
| `798d8cb` | ① sftp/scp/s3「保存即回传」监视器在 `spawn_blocking` 内用两个 `.expect()` 建 watcher，失败是**环境性**的（Linux inotify 配额耗尽即拒绝）；任务无人 await ⇒ panic 被吞 + `edit_temp_cleanup` 不执行（暂存目录泄漏）+ 功能无声失效。② RDP `handle_rdp_client` 用 `if let Err(..){…return}` + `result.unwrap()`，该 unwrap 仅因错误分支 return 才成立 | 6 处 watcher expect 改为「记录错误（含路径）→ 清理临时文件 → 退出」，成功路径不变；RDP 改为单次 `match`，消除潜在 panic |
| `9d66c0d` | 报告本身 | 首次《上线前测试报告》 |
| `a746290` | 两处零覆盖的资源归属问题（PTY 生命周期、桥接登记表记账） | 新增 3 个回归用例（§3.2）+ 人工验证手册 |
| `0fc493d` | E2E shard 4 首个用例**连续 2/2 失败**：`sshd-key` 的就绪只用 TCP 探活，而该目标需密钥已装入；端口可连 ≠ 可用 | `entrypoint.sh` 增加**能力探测**（真实 publickey 认证，有界重试）替代该目标的 TCP 探活。不放松任何断言，只把失败前移到就绪门并正确归因；修复后 shard 4 转绿 |
| `25b2a92` | （非修复）报告定稿 + 记忆压缩 | 按 CI 全绿结果重写报告；`MEMORY.md` 超限故压缩为四段式 |
| `824555a` | （非修复）长跑无数据 | 新增 `#[ignore]` 的 400 轮 PTY 测量工装（§3.3），并把「RSS 采不到」显式输出为不可用而非 0；默认套件仍为 311 例（1 ignored） |

> 本报告自身的最后一次修订（纯 Markdown）**不重跑 CI**：以 `git diff --name-only 2c31fd2..HEAD` 自证改动范围仅限于 `docs/` 与 `.workbuddy/memory/`，而 `2c31fd2` 已由 run `34613427870` 完整验证（attempt 2 全绿、75 spec PASSED）。

**未采用的手段**：未删除任何测试、未屏蔽任何错误、未降低任何标准、未为提高通过率而放宽既有断言或加宽超时、未为通过检查而改动既有功能。

---

## 11. 未解决问题 / 风险

| 编号 | 问题 | 级别 | 状态 |
|---|---|---|---|
| R-1 | ~~本轮提交未推送 / 未过 CI~~ | — | **已解决**：`0fc493d` CI 8/8 green |
| R-2 | E2E 抖动：**8 次失败分属 7 个不同 spec / 3 个 shard**；含容器 DNS 与 Docker Hub oauth 两类基础设施错误；其余为「等待边际」（固定 5 s / 10 s 与 30 s 条件轮询），最可能源于 CI 软件渲染（`libEGL DRI3` 不可用）+ 多 worker 并行争用。1 次复现于**零代码改动**的文档提交；同一产物 attempt 1 三 shard 红、attempt 2 全绿。对**产品风险低**，对**作为发布门禁的可用性影响中等**——判绿时必须看清是「一次即绿」还是「重跑才绿」 | 中 | 已修其中唯一可复现的一类（`sshd-key` 就绪门）；其余**未通过放宽超时/加重试掩盖**，且无法排除「仅在负载下触发的竞态」（需 §12 第 6、8 项实机排除） |
| R-3 | 前端完全不可本地验证（`node_modules` 为空）⇒ 任何前端改动只能以 CI 为准 | 中 | 环境限制 |
| WARN-1 | 外部编辑器保存回传后前端不刷新（`*:file-edited` 三事件前端从未订阅） | 低 | 未修复，见 §4 |
| WARN-2/3 | 遥测披露已补；**无应用内开关**（仅环境变量）；bridge 未校验 `Origin` | 低 | 已披露，设计取舍 |
| R-4 | `quick-xml` ×2 与 `rsa` 公告不可修；8 条 transitive `unmaintained` | 低 | 已登记于 `deny.toml` |
| R-5 | 无基准与压力测试；**应用层**长跑与内存曲线、冷启动耗时未测量（PTY 层 400 轮句柄已实测、无漂移） | 中 | 部分验证，见 §6 |
| R-6 | 无 MSRV（`Cargo.toml` 未声明 `rust-version`），CI 用 `stable` | 低 | 未修复 |
| R-7 | 无 panic hook / 日志不落盘 / 级别硬编码 ⇒ Windows GUI 场景零日志 | 中 | 未修复，见 §9 |

---

## 12. 需要人工验证项

以下项目**无法**在本环境自动验证，一律**不判定通过**。已逐项写成可照做的运行手册（含前置条件、步骤、期望结果、判定标准与排查入口）：

> **`docs/manual-verification-checklist-2026-09-11.md`**

| # | 项目 | 需要环境 |
|---|---|---|
| 1 | RDP 真实会话（TLS/NLA）+ 标准 RDP 安全层的诊断文案 | Windows RDP 主机 |
| 2 | VNC 真实会话（画面 / 输入 / resize / 重连） | VNC 服务端 |
| 3 | Telnet 真机 + **NAWS 主动协商**（改窗口尺寸后设备端尺寸同步） | telnet 网元 |
| 4 | 串口真机 + 热插拔（`serial:ports-changed`） | USB 转串口 + console 线 |
| 5 | 堡垒机 / 设备互通（华为、H3C、DPtech、TopSec、StoneOS） | 相应设备 |
| 6 | 三平台实机安装与**首次启动**（含 Windows 离线 WebView2） | macOS / Windows / Linux 实机 |
| 7 | 高 DPI / 多显示器（尤其 SFTP 拖拽落点） | Windows 150%/200% 缩放 |
| 8 | 4 小时长跑：RSS 与句柄数**无单调上升**（另可先跑手册 6.1 的 PTY 工装取得可复现基线） | 任一实机 |
| 9 | 升级 + **回滚**（旧版应给出「库版本高于 App」提示而非损坏数据） | 两个版本的安装包 |
| 10 | 遥测关闭抓包（**必须带对照组**，否则抓包无效不得判过） | 抓包工具 + root |

> 手册第 0 节写明：因日志只走 stdout，**所有验证必须从终端启动**；Windows GUI 启动拿不到日志。

---

## 13. 最终结论

### 有条件发布 —— 代码侧条件已全部达成，剩余条件为实机验证

**已达成（本轮闭环）**：

1. **CI 全绿**：`0fc493d` 上 run `34609578512` 8/8 success（**一次即绿**）；本轮末提交 `2c31fd2` 上 run `34613427870` 经**重跑失败 job 后** 8/8 success、75 spec PASSED —— 两次失败均为环境性（§3.4），**但未以任何放宽手段掩盖**；
2. 核心功能全部通过：311 单测（四种时序一致、五连跑无抖动）+ 75 E2E spec + Rust/frontend/依赖审计；
3. **无阻塞级缺陷、无高危安全问题**：SQL / 命令注入与 XSS 均无路径，CSRF 不适用，凭据入 OS keychain 或 AES-256-GCM + Argon2id，备份同等级加密且口令不入日志，`unsafe` 零处；依赖公告均属低可利用性且已登记；
4. 具备可靠部署与恢复能力：更新器签名链路实测有效（11 平台），备份/恢复有单测与 E2E 双覆盖，DB 有 schema 版本保护与迁移幂等测试；
5. 本轮共修 **5 类真实问题**（许可门禁失效、遥测无界队列 + 无超时、静默 panic、两处零覆盖资源归属、E2E 密钥目标就绪门），全程未放松任何断言；
6. 泄漏面已有两层证据：6 轮差分回归（常驻门禁）+ 400 轮实测（句柄 14 → 14、无漂移，最慢关闭 55.5 ms），且「测不到」不会被显示成「没增长」（§3.3）。

**剩余条件（非代码，需人工）**：

- §12 的 10 项实机验证中，**第 1、2、3、4、5、6、9 项**至少各完成一轮；
- 第 8 项（4 小时混合负载长跑、RSS 曲线）与 §6 的冷启动耗时，建议在正式对外前补一轮；
- 第 10 项遥测抓包须带对照组执行。

**风险知悉项**（不阻塞，但须记录在案）：E2E 环境性抖动（R-2）、前端仅能由 CI 验证（R-3）、应用层无基准与长跑数据（R-5）、Windows GUI 零日志（R-7）。

**结论**：可以发布，但发布前的最后一道闸门是**实机冒烟**，不能由自动化测试替代。
