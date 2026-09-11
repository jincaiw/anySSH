# anySSH 上线前测试报告

**日期**：2026-09-11
**基线**：`main` @ `e08305e`（远端已推送，CI 绿）+ 本轮 3 个本地提交
**被测代码**：`6377a5e` → `0537d3f` → `798d8cb`（3 提交，领先 `jincaiw/main` 3 个，**未推送**）
**范围**：基础质量 / 自动化测试 / 功能验收 / 安全 / 性能与稳定性 / 数据与部署 / 兼容性 / 可运维性

---

## 1. 汇总

| 检查维度 | 结论 |
|---|---|
| 1. 基础质量（构建、静态检查、依赖） | **PASS**（依赖门禁有 1 处真实缺口，已修） |
| 2. 自动化测试（单测、集成、E2E、覆盖率、并发） | **PASS** |
| 3. 功能验收 | **PASS**（含 1 处 WARN：外部编辑器保存回传后无 UI 刷新） |
| 4. 安全检查 | **PASS**（含 2 处 WARN） |
| 5. 性能与稳定性 | **WARN** —— 无基准测试，吞吐/延迟/长跑未量化 |
| 6. 数据与部署 | **PASS**（实机安装与回滚需人工验证） |
| 7. 兼容性 | **WARN** —— 3 平台 × 4 目标已由 CI 构建，DPI 与实机仅部分覆盖 |
| 8. 可运维性 | **WARN** —— 无日志落盘、无 panic hook、无法运行时调日志级别 |

**无 FAIL 项**（无阻塞级缺陷、无高危安全问题）。

---

## 2. 基础质量 —— PASS

| 项目 | 结果 |
|---|---|
| 完整构建 | `cargo build --locked --release` 成功（3m05s，exit 0） |
| 格式 | `cargo fmt --all --check` 通过 |
| 静态检查 | `cargo clippy --all-targets -- -D warnings` 零告警 |
| 依赖审计 | `cargo deny check` → `advisories ok, bans ok, licenses ok, sources ok`（exit 0） |
| 依赖锁定 | `Cargo.toml` + `Cargo.lock` 一致，`rusqlite` 用 `bundled`（自包含 SQLite，无外部依赖） |
| 产物体积 | release 二进制 35 MB（macOS arm64）；最小发布资产 `.dmg` 17.0 MB，最大 `.msi` 229 MB（内含 WebView2 离线安装包） |

**已修复缺口**：`deny.toml` 此前**完全没有 `[licenses]` 段**。cargo-deny 的默认许可白名单为空，因此 `cargo deny check licenses` 报 **776 条 `error[rejected]`**，该检查从未具备门禁能力；CI 又只跑 `check advisories`，问题被完全掩盖。已补 permissive-only 白名单（16 项）并把 CI 命令扩为 `check advisories licenses`。

`bans` / `sources` 未纳入 CI 命令：二者在 cargo-deny 默认配置下（`multiple-versions = "warn"`、`unknown-registry = "warn"`）本就 pass 且不阻断，纳入只会增加噪音。

---

## 3. 自动化测试 —— PASS

### 3.1 单元 / 集成测试

| 运行方式 | 结果 | 耗时 |
|---|---|---|
| 默认 ×3 | 308 passed / 0 failed（三次一致） | 13.17 / 12.99 / 12.96 s |
| `--test-threads=1` | 308 passed / 0 failed | — |
| `--test-threads=32` | 308 passed / 0 failed | — |
| `--release` | 308 passed / 0 failed | — |

四种时序组合结果一致 ⇒ **无顺序依赖、无并发抖动**。CI 侧对同一提交独立复核亦为 `308 passed; 0 failed`。

### 3.2 端到端测试

- **75 个 spec**（`tests/e2e/specs/`），分 4 个 shard 跑在 Docker 镜像内。
- 覆盖：主机 CRUD、口令/密钥连接、SFTP 全流程（导航/上传/下载/递归/复制/移动/chmod/属性/软链接）、SCP 回退、S3 连接与对象操作、端口转发与跳板链、片段与变量、导入 ssh_config、备份恢复、多标签/分屏/缩放、i18n 一致性、退出遮罩、协议连接面板、RDP WASM CSP。
- **最近一次 main 上的 CI 运行：8/8 job success**（Frontend、Rust、cargo-deny、E2E 镜像构建、E2E shard 1–4）。

### 3.3 覆盖率（实测，非估算）

`cargo llvm-cov --lib` 测得：

| 指标 | 覆盖 | 计数 |
|---|---|---|
| 行 | **47.18%** | 8617 / 18264 |
| 函数 | **34.02%** | 863 / 2537 |
| 区域 | **52.85%** | 14422 / 27290 |

高覆盖模块：`ssh/config.rs` 98.70%、`scp/listing.rs` 91.93%、`scp/wire.rs` 90.84%、`vault/portable.rs` 89.19%、`remote/rdp.rs` 88.85%、`db/mod.rs` 87.31%、`term/telnet.rs` 85.96%。

**20 个文件 0%** —— 均为命令层与传输编排（`s3/transfer_manager.rs`、`*/commands.rs`、`ssh/session.rs`、`term/mod.rs` 等）。这是**口径限制而非未测试**：命令层由 75 个 E2E spec 驱动**成品二进制**，llvm-cov 无法插桩；若要覆盖需改用 E2E 侧覆盖率（未做）。

### 3.4 并发与数据竞争

`cargo-miri` 不适用（`rusqlite` 链接 C SQLite、`ring` 含汇编、`portable-pty` 为 FFI，均无法在 Miri 下执行）。改用组合证据：

- 四种线程/时序组合结果完全一致（见 3.1）；
- `src-tauri/src` 下 **`unsafe` 零处** ⇒ 不存在手工数据竞争前提；
- 共享状态均为 `Mutex` / `DashMap` / `OnceLock` / `Semaphore`，无裸共享可变；
- 传输并发硬上限 **3**（三个 transfer manager 各 `Semaphore::new(3)`），连接与文件句柄有界；
- `remote/bridge.rs` 的 `expire_pending()` 按 TTL 清理待连令牌，`ActiveSessionGuard::drop` 保证活跃表不泄漏。

---

## 4. 功能验收 —— PASS（1 处 WARN）

按 README / 既有功能逐项核对，核心链路（SSH / SFTP / SCP / S3 / 端口转发 / 本地终端）均由单测 + E2E 双覆盖且通过。边界与异常流程已覆盖：错误凭据、连接拒绝、坏密钥路径、错误横幅自动清除、重连、目录保持、大量文件列举、多选删除、复制粘贴冲突、无效端口（`/^\d+$/` + 1..65535 校验）。

**WARN-1：外部编辑器「保存即回传」完成后前端不刷新。**
后端在回传成功后 emit `sftp:file-edited` / `scp:file-edited` / `s3:file-edited`，但前端**从未订阅过这三个事件名**（前端只 `listen` 7 个事件：`term:status` / `ssh:status` / `${channel}:output` / `sftp|scp|s3:transfer` / `pf:status` / `serial:ports-changed`）。经 `git log -S` 追溯：事件自**初始提交**即存在，前端**全历史从未有过监听** ⇒ 上游长期遗留的死事件，非本项目引入的回归。影响：回传成功后远端列表不自动刷新（需手动刷新）；不影响数据正确性。**未修复**——前端改动在本机无法验证（`node_modules` 为空，无 tsc/vitest/vite），留待 CI 验证窗口内处理。

---

## 5. 安全检查 —— PASS（2 处 WARN）

### 5.1 逐项结论

| 检查项 | 结果 |
|---|---|
| 认证 / 授权 / 权限绕过 | 无服务端会话概念；权限由 OS keychain 与文件权限承载 |
| 注入（SQL） | **无注入路径**。`COPYABLE_TABLES` 为硬编码 `&[&str]` 常量，`format!("DELETE FROM main.{table}")` / `PRAGMA table_info({table})` 的表名只来自该常量，且注释明确「`table` is always a trusted constant」 |
| 注入（命令） | **无注入路径**。全部外部进程调用一律走 `.arg()` / `.args()`，不经 shell：`open -a`、用户配置的编辑器 `exec_path`、`which puttygen`、`puttygen`。PPK 口令经 `tempfile::NamedTempFile`（0600）传递，不落共享临时目录 |
| XSS | 前端 `dangerouslySetInnerHTML` / `innerHTML` / `eval(` / `new Function` **均 0 处** |
| CSRF | **不适用**：无 Cookie、无浏览器会话、无 HTTP 服务端口；前后端仅经 Tauri IPC |
| SSRF | Rust 侧 `reqwest` **仅出现在 `telemetry.rs`**，目标为硬编码 `https://us.i.posthog.com`。S3 走 `attohttpc`（经 `rust-s3`），端点为用户自填的存储端点——客户端连自己的存储，属设计内行为。更新器的清单地址固定为 `github.com/jincaiw/anySSH/releases/latest/download/latest.json`，更新包 URL 取自该清单，但**必须通过 `tauri.conf.json` 中配置的 minisign 公钥验签** ⇒ 篡改下载源无法投递未签名包 |
| 路径穿越 | `fsio::sanitize` 处理 `..`、`.`、点段、Windows 尾点（`...` → `unnamed`），测试覆盖 `../../../../tmp/evil.sh`、`..\..\evil.txt`、`C:\Windows\evil.exe`；各 transfer manager 另有 `name == ".."` / 分隔符 / 绝对路径过滤 |
| 凭据存储 | 已安装版写入 **OS keychain**（`keyring`）；便携版为 **AES-256-GCM** 文件，密钥来自 256-bit CSPRNG 材料并过 **Argon2id**（m=8 MiB, t=2, p=1；固定 salt 已注明仅作域分隔，密钥本身为 CSPRNG）。Telnet 登录脚本按凭据处理，整体入加密 vault，SQLite 与备份只存引用 |
| 备份加密 | **AES-256-GCM + Argon2id（m=64 MiB, t=3, p=1）**，含全库快照与全部凭据，gzip 压缩后加密；头部作 AEAD 关联数据，改参数即校验失败；`#[instrument(skip(password, …))]` 确保口令不入日志 |
| 密钥 / Token 泄露 | 仓库内**无** `.env`/`.pem`/真实私钥：`keys.rs` 中 `PRIVATE KEY` 全部为测试夹具（正文为 `MIIEpAIBAAKCAQEA...` 等占位）或格式判定字符串。`.gitignore` 覆盖日志、`.test-ssh/`、e2e 缓存 |
| 第三方依赖漏洞 | 见 5.2，全部已登记并按设计接受 |
| 崩溃面 | 生产代码 `unwrap/expect` 由 **20 处降至 13 处**（本轮修掉 7 处，详见 §7）；`unsafe` 0 处；`println!/eprintln!/dbg!` 0 处 |

### 5.2 依赖公告（已登记于 `deny.toml`，非新增）

- `RUSTSEC-2026-0194` / `0195`（quick-xml DoS ×2）：经 `aws-creds 0.39.1` → `rust-s3 0.37.1`。**两者均为当前最新版**，仍写 `quick-xml = "^0.38"`，修复需 `>=0.41`，跨 semver 大版本 ⇒ `cargo update --precise` 必冲突、`[patch]` 会撞破坏性 API 变更。**已定案不可修**，触发条件为恶意 S3 端点返回畸形 XML。
- `RUSTSEC-2023-0071`（RSA Marvin 时序侧信道）：经 russh 的 `rsa` feature，上游 `patched: []`（无修复版本）。需精确计时测量，对本地 SSH 客户端威胁有限。
- 8 条 transitive `unmaintained`（均为构建期或已停维护的传递依赖）。

### 5.3 WARN

**WARN-2：遥测披露缺失（已修复，但保留说明）。** 两个 README 原称「Fully offline — no internet connection required」，**与事实不符**：每个事件各发一次 HTTPS POST 到 PostHog。事件属性经全量核对**无 PII**（51 个事件均为计数、布尔、协议名、固定 provider id、编辑器显示名、字节数、错误条数；不含主机名/地址/用户名/密码/密钥/路径/文件名/片段内容/桶名/对象名/转发目标），故定级为**披露与合规风险**而非数据泄露。已修：README（英/中）新增 Telemetry 小节并更正失实声明，`SECURITY.md` 新增 `## Telemetry` 面向审计者披露端点、载荷、标识符（`.device_id` 随机 UUID，非机器/账号派生）与关闭方式。

**WARN-3：遥测无应用内开关。** 当前唯一退出方式是环境变量 `ANYSSH_DISABLE_TELEMETRY`，无 UI 开关（已在 `SECURITY.md` 明确写明，不做暗示）。另有 `remote/bridge.rs` 的 loopback WebSocket **未校验 `Origin` 头**——由 32 字节 CSPRNG 令牌 + 单次消费（`pending.remove`）+ 60s TTL 兜底，风险低，仅记录。

---

## 6. 性能与稳定性 —— WARN

**已量化的部分**：

| 指标 | 数值 |
|---|---|
| release 构建 | 3m05s（macOS arm64，含依赖） |
| 单测套件 | 12.87–13.45 s / 308 例 |
| release 二进制 | 35 MB |
| 最小 / 最大发布资产 | 17.0 MB（`.dmg`）/ 229 MB（`.msi`，含 WebView2 离线包） |
| E2E 超时上限 | 60 min/shard（4 shard 并行） |
| 传输并发 | 3 / manager（硬上限，有界） |
| 会话日志 | 保留 30 天、配额 500 MB、单文件 10 MB，均可在设置中调（`clamp` 保护） |

**资源泄漏检查**：本会话前序已修复两处「不可取消 await」陷阱（`term/mod.rs` 与 `ssh/session.rs`），现均有 `IO_OP_TIMEOUT` / `CHANNEL_OP_TIMEOUT` = 5s 包裹后端 I/O，关闭走 `timeout(CLOSE_TIMEOUT, &mut task)` 后 `abort()`，不会因对端停止排空而冻结循环。本轮另修掉遥测的无界队列（详见 §7）。

**未量化的部分（记为风险，不判定通过）**：

- 仓库**无 `benches/` 目录、无 `criterion` 依赖** ⇒ 核心数据通路（SSH 吞吐、SFTP/SCP/S3 传输速率、终端渲染延迟）**无任何基准数据**；响应时间 / 吞吐量 / 错误率 / CPU / 内存占用均未测量。
- 压力测试（大文件、海量小文件、多会话并发、弱网/高丢包/高延迟）未执行。
- **长时间运行稳定性未验证**（无 >数小时的连续运行记录）；内存增长趋势、线程数、连接数、文件句柄的长期曲线无数据。

---

## 7. 已修复问题（本轮，3 提交，均本地验证）

| 提交 | 问题 | 修复 |
|---|---|---|
| `6377a5e` | `deny.toml` 缺 `[licenses]` 段 ⇒ 许可检查 776 条 rejected，从未真正门禁；CI 只跑 advisories 故未暴露 | 补 permissive-only 白名单（16 项）+ `version = 2`；CI job 更名 `Dependency audit (cargo-deny)` 并改为 `check advisories licenses`。Copyleft 仅以 OR 备选形式出现（`unescaper` 的 `GPL-3.0-only`、`r-efi` 的 `LGPL-2.1-or-later`）故未列白名单，真正 GPL/LGPL-only 依赖仍会失败；MPL-2.0 为文件级 copyleft，未修改消费无源码披露义务 |
| `0537d3f` | 遥测用**无界** `mpsc` 队列 + `reqwest::Client::new()`（**默认无超时**）。半开连接（完成 TCP 握手后不响应）可永久阻塞唯一消费者，事件同时无界增长 | `QUEUE_DEPTH = 256` 有界队列 + `REQUEST_TIMEOUT = 10s` + `try_send`（满队列静默丢弃，符合 fire-and-forget 契约，不再阻塞调用方或增长进程）。同提交修正 README 失实的 offline 声明并补遥测披露 |
| `798d8cb` | ① sftp/scp/s3 的「保存即回传」监视器在 `spawn_blocking` 内用两个 `.expect()` 建 watcher。失败是**环境性**的（Linux inotify watch 配额耗尽即拒绝），后果全为静默：任务无人 await ⇒ panic 被吞、`edit_temp_cleanup` 不执行 ⇒ 暂存目录泄漏、功能无声失效且 UI 无提示。② RDP `handle_rdp_client` 以 `if let Err(..){…return}` + `result.unwrap()` 取 TLS 流，该 unwrap 仅因错误分支 return 才成立，任何后续改动都会让已处理的失败变成游离任务里的 panic | 6 处 watcher expect 改为「记录错误（含路径）→ 清理临时文件 → 退出」，成功路径不变；RDP 改为单次 `match`，消除潜在 panic |

**未采用的手段**：未删除任何测试、未屏蔽任何错误、未降低任何标准、未为通过检查而改动既有功能。

---

## 8. 未解决问题 / 风险

| 编号 | 问题 | 级别 | 状态 |
|---|---|---|---|
| R-1 | 本轮 3 个提交**尚未推送、未经 CI 验证**（本地 fmt / clippy / 308 测试 / cargo-deny 均通过） | 中 | 待推送后由 CI 复核 |
| R-2 | 前端完全不可本地验证（`node_modules` 为空）⇒ 任何前端改动只能以 CI 为准 | 中 | 环境限制 |
| WARN-1 | 外部编辑器保存回传后前端不刷新（`*:file-edited` 三事件前端从未订阅） | 低 | 未修复，见 §4 |
| WARN-2 / 3 | 遥测披露已补；**无应用内开关**（仅环境变量）；bridge 未校验 `Origin` | 低 | 已披露，设计取舍 |
| R-3 | `quick-xml` ×2 与 `rsa` 公告不可修；8 条 transitive `unmaintained` | 低 | 已登记于 `deny.toml` |
| R-4 | 无基准与压力测试数据；长跑稳定性未验证 | 中 | 未验证，见 §6 |
| R-5 | 无 MSRV（`Cargo.toml` 未声明 `rust-version`），CI 用 `stable` ⇒ 源码构建的可重现性随时间漂移 | 低 | 未修复 |

---

## 9. 需要人工验证项

以下项目**无法**在本环境自动验证，一律**不判定通过**：

1. **RDP / VNC 真实会话** —— E2E 无真实 RDP/VNC 目标（仅验证了 WASM 加载与 CSP 生效）。另：RDP 仅支持 TLS/NLA，标准 RDP 安全层由 IronRDP 上游硬拒绝（设计决策，非缺陷）。
2. **Telnet / 串口真实设备** —— E2E 无对应服务端；NAWS 主动协商、脚本化发送与 `iac_escape` 需真机确认。
3. **真实堡垒机 / 网络设备**（华为、H3C、DPTech、TopSec、StoneOS 等）互通性。
4. **macOS / Windows / Linux 实机安装与首次启动**（含 Windows WebView2 离线安装、macOS 公证、Linux 各发行版依赖）。
5. **高 DPI / 多显示器** —— 仅 `ExplorerView` 对 Windows 做 `devicePixelRatio` 处理，无 HiDPI 实机验证。
6. **长时间运行稳定性**（>数小时连续使用）与内存/句柄增长趋势。
7. **升级安装与回滚** —— 更新器端点已实测（http 200、版本 0.15.0、11 平台全签名），但跨版本升级与失败回滚需实机演练。
8. **遥测关闭验证** —— 设 `ANYSSH_DISABLE_TELEMETRY` 后需抓包确认零出站请求。

---

## 10. 可运维性 —— WARN

- **日志**：`tracing_subscriber::fmt().with_env_filter("anyssh=debug,russh=info")`，**仅输出 stdout**，无文件 appender、无 rolling。级别**硬编码**，不读 `RUST_LOG` 也非 `from_default_env` ⇒ 用户无法在运行时提升日志级别（需重新编译）。
- **唯一落盘日志**：会话日志（`<app_data_dir>/session-logs`），带保留期与配额清理，且有测试覆盖（`cleanup_respects_retention_and_quota`）。
- **错误可定位性**：错误枚举统一序列化为 `{ kind, message }`，`kind` 作稳定翻译键，前端保持技术细节原文（如 `Connection refused (os error 61)`）——这一设计良好。RDP 失败会 `tracing::warn!` 打印真实原因（证书变更 / TLS 错误 / 连接拒绝可区分）。
- **崩溃恢复**：**无 panic hook、无 `catch_unwind`**。panic 无结构化落盘，字段排查只能依赖终端；桌面端无 stderr 时即彻底丢失。
- **健康检查 / 监控**：桌面应用无服务端指标；应用内有主机健康检查功能（E2E `53-host-health-check` 覆盖）。

---

## 11. 最终结论

### 有条件发布

**依据**：

- 核心功能全部通过（308 单测 × 4 种时序 + 75 E2E spec + CI 8/8 job），**无阻塞级缺陷**；
- **无高危安全问题**：SQL/命令注入与 XSS 均无路径，CSRF 不适用，凭据入 OS keychain 或 AES-256-GCM + Argon2id，备份同等级加密且口令不入日志，`unsafe` 零处；依赖公告均属低可利用性且已登记；
- 具备可靠部署与恢复能力：更新器签名链路实测有效（11 平台），备份/恢复往返有单测与 E2E 双覆盖；
- 本轮修掉 3 个真实缺口（许可门禁失效、遥测无界队列 + 无超时、静默 panic），保持既有功能不变且全量校验通过。

**发布条件**：

1. 推送本轮 3 个提交并取得 CI 绿（本地已全绿，但 CI 是唯一的端到端复核）；
2. 第 9 节人工验证项中，**第 1、2、3、4、7 项**在目标平台上至少完成一轮冒烟；
3. 第 6 节性能/长跑缺口的风险由使用者知悉，或补做一轮基准测试。

**不建议在不满足上述条件的情况下直接打 tag 发布。**
