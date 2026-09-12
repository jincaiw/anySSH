# anySSH 上线前测试报告

**日期**：2026-09-11（2026-09-12 追加实机验证与 E2E 编排修复）
**被测基线**：`main` @ `ba5b8d1`（已推送 `jincaiw/anySSH`）
**本轮改动**：全部已推送 `jincaiw/anySSH`（提交清单见 §10）
**CI**：
- run `34680933632` @ `ba5b8d1`（**当前基线**）—— **8/8 job success、75/75 spec PASSED**（19+19+19+18）。**注意：这是第 3 次 attempt 取得的**，attempt 1 有 3 个 spec 失败、attempt 2 有 1 个，详见 §3.4
- run `34613427870` @ `2c31fd2` —— attempt 1 有 3 个 E2E shard 失败，**attempt 2 重跑同一二进制后 8/8 success**、75 spec PASSED
- run `34609578512` @ `0fc493d` —— **8/8 job success（attempt 1 即绿）**
- **反例（已记录在案）**：`2a63485`、`7b57755`、`7e8d3b8` 三条**纯文档**提交的 run 均失败——CI 对 `main` 的每次 push 都无条件运行。详见 §3.4 与 §10 的更正说明
**范围**：基础质量 / 自动化测试 / 功能验收 / 安全 / 性能与稳定性 / 数据与部署 / 兼容性 / 可运维性
**实机验证（2026-09-12 追加）**：§12 第 9 项（升级 + 回滚）已在 macOS arm64 实机执行完毕，另含**应用内升级端到端**、`autoUpdate` 开关语义、schema 闸门与 Gatekeeper 复现 —— 结果与证据见 **§12.1**

---

## 1. 汇总

| 检查维度 | 结论 | 关键依据 |
|---|---|---|
| 1. 基础质量 | **PASS** | 构建 / fmt / clippy / `cargo deny check` 四段全 ok |
| 2. 自动化测试 | **PASS** | 311 单测 × 多种时序一致；E2E **75/75 spec PASSED**；覆盖率实测；400 轮 PTY 实测无句柄漂移。**注意：E2E 编排出过一次确定性故障（已修），且末次全绿需重跑才取得**——见 §3.4 |
| 3. 功能验收 | **PASS**（1 WARN） | 核心链路单测 + E2E 双覆盖；`*:file-edited` 死事件（低危） |
| 4. 安全检查 | **PASS**（2 WARN） | 无注入/XSS 路径；`unsafe` 0；凭据加密存储；遥测已披露 |
| 5. 性能与稳定性 | **WARN**（已收窄） | 新增资源泄漏回归 + 400 轮句柄/延迟实测；仍**无应用层基准、无 4 小时长跑与内存曲线** |
| 6. 数据与部署 | **PASS** | schema 保护 + 迁移幂等 + 备份往返；**macOS 实机安装、升级与回滚已实测通过**（§12.1 V3–V6） |
| 7. 兼容性 | **WARN** | 3 平台 × 4 目标由 CI 构建；DPI 与实机仅部分覆盖（Windows/Linux 未做）；**macOS 未签名/未公证（R-8）** |
| 8. 可运维性 | **WARN** | 无日志落盘、无 panic hook、级别硬编码；**启动期致命错误实测呈现为 SIGABRT 且 GUI 无提示（R-9）** |

**无 FAIL 项**（无阻塞级缺陷、无高危安全问题）。
**CI 已达全绿，但必须连着三个前提读**：① 基线 `ba5b8d1` 的全绿是**第 3 次 attempt** 取得的（attempt 1 有 3 个 spec 红、attempt 2 有 1 个红），**不是一次即绿**；② E2E 存在**环境性抖动**（§3.4 B 类），判绿时务必分清「一次即绿」与「重跑才绿」；③ E2E 还出过一次**确定性**编排故障——MinIO 镜像被上游从 Docker Hub 移除，导致拉取必然失败、**0 个 spec 运行**（§3.4 A 类，已于 `ba5b8d1` 修复）。**这三件事必须分开讲，混为一谈会得出相反结论。**

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

### 3.4 端到端测试（三类失败，性质不同）

**75 个 spec**（`tests/e2e/specs/`），分 4 shard 跑在 Docker 内；覆盖主机 CRUD、口令/密钥连接、SFTP 全流程（导航/上传/下载/递归/复制/移动/chmod/属性/软链接）、SCP 回退、S3、端口转发与跳板链、片段与变量、导入 ssh_config、备份恢复、多标签/分屏/缩放、i18n、协议连接面板、RDP WASM CSP。

**当前状态（2026-09-12 更新）**：`ba5b8d1` 的 run `34680933632` 经 **3 次 attempt** 后 **8/8 job success、75/75 spec PASSED**（19 + 19 + 19 + 18）。**末次全绿是第 3 次 attempt 取得的，不是一次即绿**——判绿时务必分清这两者。

分片方式是**确定性**的（`wdio.conf.ts`：spec 排序后 `i % 4 === shardIndex - 1` 取模，round-robin 而非连续分块），所以**每个 shard 的 spec 集合固定**。这一点对下面的归因很关键。

失败按性质归为**三类**，处置完全不同：

#### A 类：编排已被上游破坏（确定性，0 个 spec 运行）—— 已修

`7b57755` 与 `7e8d3b8` 两次 run 的 **4 个 shard 全部**倒在 `make e2e-pull`，一条测试都没跑到：

```
Error pull access denied for minio/minio, repository does not exist or
may require 'docker login'
```

MinIO 于 2025-10-23 停止发布社区版容器镜像，`minio/minio` 与 `minio/mc` 在 Docker Hub 上**已被移除**——实测匿名 pull 返回 **401 且 token 的 `access` 声明为空**（= 权限未授予；**限流是 429 / `toomanyrequests`，不是这个**），且两个仓库已不在该命名空间的公开列表中；而 `quay.io/minio/{minio,mc}` 仍返回 200。已在 `ba5b8d1` 改为 quay.io。

**这一类与"抖动"的本质区别**：它在**任何负载下都必然失败**，且失败发生在任何测试之前。把 A 类当成 B 类（"重跑就好"）是**误判**——重跑永远不会好。

#### B 类：环境性（时序 / 容器 DNS）—— 未修，且不应靠改测试来"修"

累计 **15 次 spec 级失败、9 个不同 spec，覆盖全部 4 个 shard**：

| 现象 | 等待预算 | 出现过的 spec |
|---|---|---|
| `explorer did not open` | **30 s 条件轮询** | `61-sftp-properties-chmod`、`19-sftp-refresh`×2、`16-sftp-navigate`、`07-sftp-flow` |
| host card / 目标元素未出现 | **固定 10 s** | `02-host-crud`×2 |
| `modal did not close`（含 `Username is required`） | 填表后立即断言 | `22-snippet-palette-run`×2、`38-edit-auth-type` |
| xterm 分屏后未重挂载 | **固定 10 s** | `26-split-pane` |
| 面板元素 5 s 内不可点击 | **5 s** | `22-snippet-palette-run` |
| `Temporary failure in name resolution` | — | `03-connect-password`、（早期）`04-connect-key` |

**判定为环境性的三条证据**：

1. **失败 spec 的身份在变化**：同一个二进制 `ba5b8d1`，attempt 1 失败于 `22-snippet-palette-run` / `03-connect-password` / `07-sftp-flow`，attempt 2 只剩 `02-host-crud`，attempt 3 全部通过。同一产物、同一套测试，**每次都换失败点**。
2. **失败分散在全部 4 个 shard**，而分片是**确定性**的。若某个 spec 或某个 shard 有真实缺陷，失败应当**集中**于同一处并**每轮复现**。
3. **曾复现于零代码改动的提交**（`25b2a92` 只改 `docs/` 与 `.workbuddy/memory/`，产物逐字节不变）。

**最可能的机制（有日志支撑，非猜测）**：容器内反复出现 `libEGL warning: DRI3 error: Could not get DRI3 device` ⇒ WebKitGTK 退回**软件渲染**；同一 runner 上多个 worker 并行各起一个 GUI 实例，CPU 争用下首屏偶发超出上述固定预算。

**一个尚未处理的根因**：runner 镜像**未安装 mesa 软件光栅化后端**，也**未设** `WEBKIT_DISABLE_COMPOSITING_MODE` / `LIBGL_ALWAYS_SOFTWARE`，因此这个回退是听天由命的。**修根因（让渲染确定化）与放宽断言是两件不同的事**——本轮只做了事实核查，**未改任何断言**。若要根治 B 类，应改进 runner 的图形栈，而不是把等待预算调大。

#### C 类：未解释（1 个 spec、1 次）—— 不判定为通过

`2a63485` 的 shard 4 在 `04-connect-key` 报 `publickey ssh-ed25519 rejected`。**决定性细节**：同一 shard 的 entrypoint 就绪门在 **15:27:47** 打印 `[entrypoint] sshd-key accepts the test key`，而失败发生在 **15:29:01**——**74 秒之后**；且 spec 使用的 host / port / user / key 与就绪门**完全相同**（`sshd-key:2222` / `testuser` / `/keys/id_ed25519`，已核对 `docker-compose.yml` 的 `USER_NAME`、`PUBLIC_KEY_FILE` 与 spec 的默认值）。

⇒ **这不是 `sshd-key` 的就绪竞态。** 因此**此前报告里「该类失败已由 `0fc493d` 修复」的判断不成立**——就绪门当时是**通过**的，修复并不覆盖这个实例。真正机制未确定，需要能复现的环境才能定位（本机 macOS 跑不了 tauri-driver，E2E 只能在 Linux 容器内跑）。这是本节**唯一悬空项**。

**两处容易被误读、必须说清的细节**：

1. `waitForExplorer()` **不是固定短超时**：它是 30 秒的**条件轮询**（每 200 ms 检查 `explorer-refresh` 是否存在且可见，并自动点击主机密钥信任弹窗）。所以 `explorer did not open` 的含义是「**30 秒内** SFTP 浏览器根本没渲染出来」，**不能**与固定 5 s / 10 s 的用例混为一谈——把两者合并会**低估**该类失败的严重程度。
2. shard 4 日志里出现 `Incorrect password, or the backup file is corrupt` 与 `Not a valid anySSH backup file` 的 `ERROR webdriver` 行，**不是失败**——那是 `62-data-backup-restore` 的**负向用例**，该 spec 最终 **6 passing**，应用正确地拒绝了错误口令与非法文件。读 `--log-failed` 时**先 `grep -v libEGL` 再去噪**，否则会被 `libEGL` 噪音淹没。

**一条对用户可见的结论**：E2E **不能**作为「首屏 / 首次打开耗时」的门禁——它在冷容器里对首屏的等待是固定值，而首屏恰恰是用户第一印象。该量至今未测，列入人工项（§12 第 6、8 项）。

**判定**：A 类已修；B 类**均非产品缺陷**（三条证据见上），但**保留不确定性**——自动化只能证明这些失败与代码改动无关，**不能**排除「仅在负载下才触发的竞态」；C 类**保持不判定为通过**，是本节唯一悬空项。要在实机上排除 B 类的竞态可能，靠的是 §12 第 6 项（真实安装 + 首次启动）与第 8 项（4 小时长跑）。

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
| 升级 | 更新器端点实测 http 200、`version 0.15.0`、**11 平台全部带签名**；`createUpdaterArtifacts: v1Compatible`。**应用内升级已端到端实测**：0.14.46 在 20 秒内自行升级为 0.15.0，且装出的 bundle 与官方 dmg **逐字节一致**（§12.1 V6）⇒ minisign 校验、下载、替换、重启四段全部有效 |
| 回滚 | **实测通过**：0.14.46 能正常打开 0.15.0 写的库，且**对库零写入**（§12.1 V4）；schema 闸门在人为制造 `schema_version=21` 时**正确拒绝**且不改数据（§12.1 V5） |
| Windows 无网安装 | `webviewInstallMode: offlineInstaller` ⇒ `.msi` 自带 WebView2 |
| Linux 依赖 | `.deb` / `.rpm` 声明 `libwebkit2gtk-4.1` 等；AppImage 免安装 |
| 全新安装与首启 | macOS **已人工验证通过**（§12.1 V1）；**Windows / Linux 仍需人工验证**（§12 第 6 项） |

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

**WARN**：① **未声明 MSRV**（`Cargo.toml` 无 `rust-version`），CI 用 `stable` ⇒ 源码构建的可重现性随时间漂移；② **高 DPI / 多显示器未验证**——仅 `ExplorerView` 对 Windows 单独补偿 `devicePixelRatio`，其余缩放场景无实机证据；③ Windows 上 GUI 启动**拿不到任何日志**（无控制台），见 §9；④ **macOS 分发包未签名未公证**（见 R-8）。

---

## 9. 可运维性 —— WARN

- **日志**：`tracing_subscriber::fmt().with_env_filter("anyssh=debug,russh=info")`，**仅写 stdout**，无文件 appender、无 rolling。级别**硬编码**，既不读 `RUST_LOG` 也非 `from_default_env` ⇒ 用户**无法在运行时提升日志级别**（需重新编译）。
- **后果**：Windows 上从 GUI 启动时日志无处可去，现场排查基本无据可依。这一限制已写入人工验证手册，要求所有验证**从终端启动**。
- **唯一落盘日志**：会话日志（`<app_data_dir>/session-logs`），带保留期与配额清理，有测试覆盖（`cleanup_respects_retention_and_quota`）。
- **错误可定位性**：错误枚举统一序列化为 `{ kind, message }`，`kind` 作稳定翻译键，前端保留技术细节原文（如 `Connection refused (os error 61)`）——该设计良好。RDP 失败会 `tracing::warn!` 打印真实原因（证书变更 / TLS 错误 / 连接拒绝可区分）。
- **崩溃恢复**：**无 panic hook、无 `catch_unwind`**。panic 无结构化落盘。**实测危害**（R-9）：schema 闸门触发时进程以 `exit 134` / SIGABRT 结束，报错只在 stderr；日志本身又不落盘 ⇒ **从 Finder 双击启动的用户拿不到窗口、对话框或日志**，现象是「点了没反应」。这是本轮唯一一项**有实测证据的用户可见缺陷**（§12.1 V5）。
- **健康检查 / 监控**：桌面应用无服务端指标；应用内有主机健康检查功能（E2E `53-host-health-check` 覆盖）。

---

## 10. 本轮提交清单（全部已推送）

前 6 个是修复/补齐（`6377a5e` → `0fc493d`，已由 run `34609578512` 完整验证），其后是交付物与报告自身的修订：

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
| `2c31fd2` 及之后 | （非修复）报告修订 | 把长跑实测数据、CI 重跑转绿的完整经过写入报告；仅改 `docs/` |
| 本次（2026-09-12 实机验证后） | （非修复）§12.1 执行记录 + R-9 | 把第 9 项（升级/回滚/schema 闸门/应用内升级）与 macOS 安装的实测结果写入报告与手册；新增 R-9（启动期致命错误呈现为 SIGABRT）；修正第 9 项原本错误的期望值。**仅改 `docs/`** |
| `ba5b8d1` | E2E **完全无法运行**：`make e2e-pull` 每次都在拉 `minio/minio`、`minio/mc` 时失败，4 个 shard 全挂且**一条 spec 都没跑到** | MinIO 于 2025-10-23 停止发布社区版镜像，Docker Hub 上两个仓库已被移除（匿名 pull 401、token `access` 为空 ≠ 限流）。改为 `quay.io/minio/{minio,mc}`（实测 200）；另把 `keygen` 显式写进 runner 的 `depends_on`（顺序本已由 `sshd-key` 传递保证，属显式化而非修复）。详见 §3.4 A 类 |

> **更正（2026-09-12）**：本节此前写「纯 Markdown 的报告修订**不重跑 CI**」——**这是错的**。`ci.yml` 在 push 到 `main` 时**无条件运行**，不存在按改动范围跳过的机制。实测证据：`2a63485`、`7b57755`、`7e8d3b8` 三条纯文档提交**都跑了 CI 且都失败**（原因见 §3.4 的 A 类与 C 类）。
>
> 由此还有一个必须交代的后果：**这几条提交无法用「重跑旧 run」的方式回头验证**——A 类故障是编排层面的，重跑同样提交仍然会卡在镜像拉取。因此 `2a63485` / `25b2a92` 的 spec 级失败不再单独追溯，**等价证据改为**在**源码与它们完全相同**的 `ba5b8d1` 上取到的全绿（本文档修订全程未改任何源码）。

**未采用的手段**：未删除任何测试、未屏蔽任何错误、未降低任何标准、未为提高通过率而放宽既有断言或加宽超时、未为通过检查而改动既有功能。

---

## 11. 未解决问题 / 风险

| 编号 | 问题 | 级别 | 状态 |
|---|---|---|---|
| R-1 | ~~本轮提交未推送 / 未过 CI~~ | — | **已解决**：`0fc493d` CI 8/8 green |
| R-2 | E2E 失败分三类（详见 §3.4）：**A 类**编排被上游破坏（MinIO 镜像从 Docker Hub 移除 ⇒ 拉取必然失败、0 spec 运行）——**已修**；**B 类**环境性时序/容器 DNS（累计 15 次 spec 级失败、9 个 spec、覆盖全部 4 个 shard；失败 spec 身份在 attempt 间变化、且曾复现于零代码改动提交；机制疑为 `libEGL DRI3` 不可用致 WebKitGTK 软件渲染 + 多 worker 争用）；**C 类** 1 次未解释（`04-connect-key` 在就绪门**通过 74 秒后**仍被拒，**不是**就绪竞态）。对**产品风险低**，对**作为发布门禁的可用性影响中等**——判绿必须看清是「一次即绿」还是「重跑才绿」 | 中 | A 类已修（`ba5b8d1`）；B 类**未通过放宽超时/加重试掩盖**，根治方向是让 runner 图形栈确定化（未做）；C 类**保持不判定**。B 类的竞态可能性需 §12 第 6、8 项实机排除 |
| R-3 | 前端完全不可本地验证（`node_modules` 为空）⇒ 任何前端改动只能以 CI 为准 | 中 | 环境限制 |
| WARN-1 | 外部编辑器保存回传后前端不刷新（`*:file-edited` 三事件前端从未订阅） | 低 | 未修复，见 §4 |
| WARN-2/3 | 遥测披露已补；**无应用内开关**（仅环境变量）；bridge 未校验 `Origin` | 低 | 已披露，设计取舍 |
| R-4 | `quick-xml` ×2 与 `rsa` 公告不可修；8 条 transitive `unmaintained` | 低 | 已登记于 `deny.toml` |
| R-5 | 无基准与压力测试；**应用层**长跑与内存曲线、冷启动耗时未测量（PTY 层 400 轮句柄已实测、无漂移） | 中 | 部分验证，见 §6 |
| R-6 | 无 MSRV（`Cargo.toml` 未声明 `rust-version`），CI 用 `stable` | 低 | 未修复 |
| R-7 | 无 panic hook / 日志不落盘 / 级别硬编码 ⇒ Windows GUI 场景零日志 | 中 | 未修复，见 §9；**危害已在 R-9 实测** |
| R-8 | **macOS 包为 ad-hoc（linker-signed）签名、未用 Developer ID、未公证**（`spctl` rejected、`stapler validate` 无票据、无 `_CodeSignature`）。**从浏览器下载的用户首次启动会被 Gatekeeper 拦截**；命令行下载（`gh`/`curl`）不带 quarantine 故探测不到。与 v0.14.46 状态一致，**非本轮回归** | 中 | 未修复（需 Apple Developer 账号 + 公证流程，属发布决策）；已在手册 §4 给出复现与绕过步骤 |
| R-9 | **启动期致命错误的呈现不可用**：`lib.rs` 的 `.setup()` 返回 `Err` → Tauri 内部 panic → 末端 `.run(...).expect(...)`；实测 schema 闸门触发时**进程 exit 134 / SIGABRT**，报错只走 stderr。**GUI 双击启动的用户看不到任何东西**——没有窗口、没有对话框、没有日志文件（日志不落盘，见 R-7），表现为「点了没反应」 | 中 | 未修复。这是 R-7 的具体危害实例（§12.1 V5）：**闸门本身工作正常**，坏在呈现。属发布前值得修的一项（加 panic hook + 原生错误对话框，或让 `.setup()` 失败时弹出模态提示） |

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
| 6 | 三平台实机安装与**首次启动**（含 Windows 离线 WebView2） | macOS / Windows / Linux 实机 —— **macOS 已执行**，Windows / Linux 未做（§12.1 V1） |
| 7 | 高 DPI / 多显示器（尤其 SFTP 拖拽落点） | Windows 150%/200% 缩放 |
| 8 | 4 小时长跑：RSS 与句柄数**无单调上升**（另可先跑手册 6.1 的 PTY 工装取得可复现基线） | 任一实机 |
| 9 | 升级 + **回滚** | 两个版本的安装包 —— **已执行**（§12.1 V3–V6） |
| 10 | 遥测关闭抓包（**必须带对照组**，否则抓包无效不得判过） | 抓包工具 + root |

> **第 9 项的期望值已修正。** 原表述「旧版应给出『库版本高于 App』提示」**在事实上不可能成立**：该闸门（`LATEST_SCHEMA_VERSION` 与 `version > LATEST_SCHEMA_VERSION`）是 v0.15.0 才引入的，且 v0.14.46 与 v0.15.0 **同为 schema 20** ⇒ 0.14.46 打开 0.15.0 写的库既不报错、也不迁移（**零次迁移**，故本项**不能**用来证明「迁移已验证」）。正确拆法见手册 §7.2 的 A（回滚本身）/ B（人为制造 `schema_version=21` 才有闸门可测）。

> 手册第 0 节写明：因日志只走 stdout，**所有验证必须从终端启动**；Windows GUI 启动拿不到日志。

### 12.1 已执行的实机验证（2026-09-12，macOS arm64 实机）

在 jason 的真实安装（`$HOME/Library/Application Support/com.jincaiw.anyssh`，`schema_version=20`，3 分组 / 11 设置）上执行。**采集前已完整备份数据目录**（`.workbuddy/backups/anyssh-data-20260912-134059`，`integrity: ok`）。全部结论均有命令输出或文件哈希支撑，**未凭推测判定**。

| 编号 | 验证项 | 方法 | 结果 | 证据 |
|---|---|---|---|---|
| V1 | macOS 安装 + 首次启动（第 6 项 macOS 部分） | `ditto` 覆盖安装 v0.15.0 → 从终端启动 | **PASS** | 日志 `INFO anyssh_lib::db: database initialised path=…`；进程存活；无 stderr 报错 |
| V2 | Gatekeeper 拦截复现（R-8 取证） | 手工打 `com.apple.quarantine` → `spctl -a -t exec` | **PASS（复现了缺陷）** | `spctl` rejected；`xcrun stapler validate` 无票据；`codesign` 显示 `Signature=adhoc` / `TeamIdentifier=not set`；`xattr -dr` 后可启动。**注意**：`gh`/`curl` 下载的 dmg **不带** quarantine ⇒ 命令行路径测不到浏览器下载用户的遭遇，必须手工补上 |
| V3 | 升级后数据保留（第 9 项 A 的一半） | 0.14.46 → 0.15.0 后逐表逐行比对 | **PASS** | 各表行数一致；3 个分组逐字段一致；原有 10 条设置逐字未变（唯一新增为 `app_auto_update`）；`integrity: ok` |
| V4 | **回滚本身**（0.15.0 → 0.14.46） | 覆盖安装 0.14.46 → 启动 → 读 0.15.0 写的库 | **PASS** | 启动日志无 schema / 损坏报错；`PRAGMA integrity_check` = ok；`schema_version` 仍为 20；**旧版对库零写入**（`anyssh.db` mtime 不变、`-wal` 0 字节）；全库快照与回滚前 `diff` **完全一致** |
| V5 | **schema 闸门**（第 9 项 B） | 置 `_meta.schema_version=21` → 从终端启动 v0.15.0 | **PASS（拒绝正确）／但呈现为崩溃** | 进程 **exit 134**，stderr：`failed to initialise database: … (schema v21, but this build understands up to v20). Upgrade anySSH …`；进程未留存；数据未损（`integrity: ok`、分组与设置完好）；复原为 20 后重启成功。**呈现方式见 R-9** |
| V6 | **应用内升级端到端**（第 9 项 / 手册 §7.1） | 0.14.46 + `autoUpdate=true` → 启动 | **PASS** | 20 秒内自行下载、安装、重启为 **0.15.0**（PID 变更、包 mtime 更新）；**装出的 bundle 与官方 dmg 逐字节一致**（可执行文件 / `Info.plist` / 全 bundle 递归哈希三项全等）⇒ 同时证明 minisign 签名校验通过（校验失败插件会拒装） |
| V7 | `autoUpdate` 开关的真实语义 | 对照组交叉验证 | **PASS** | `=false`：端点已证可达且通告 0.15.0（本机 `curl` 取到 `latest.json`）、v0.14.46 启动确实执行检查（`AppShell.tsx:356`），但 **PID / 版本 / 包 mtime 三项不变、无下载残留**，且 jason 肉眼确认**弹出了「发现新版本 0.15.0」提示**；`=true`：如 V6 **静默升级**。⇒ 该开关控制的是**是否静默安装**，**不是**是否联网检查（关掉后仍会请求 `latest.json` 并弹窗） |

**V7 的判定价值**：它同时封住了两个容易误判的推理缺口——① 若只看「什么都没发生」就下结论，无法区分「标志生效」与「更新检查根本没跑」（网络失败会得到相同观测）；② 正向对照（`=true` 时真的自升级）证明检查链路确实可用，反向对照才因此成立。

**仍未验证（保持不判定为通过）**：

- 手册 §7.3 更新器兜底（断网后检查更新 / 下载中断可重试 / 「跳过此版本」）——需断网操作 + 界面点击，本环境无法自动触发；
- 第 12 节表中第 6 项的 **Windows / Linux** 实机安装、第 7 项高 DPI、第 8 项 4 小时长跑、第 10 项遥测抓包，以及第 1–5 项（需 RDP/VNC 主机、telnet 网元、串口设备、堡垒机等外部设备）；
- **E2E runner 图形栈的根因整改**（安装 mesa 软件光栅化后端 / 设 `WEBKIT_DISABLE_COMPOSITING_MODE`、`LIBGL_ALWAYS_SOFTWARE`），以消除 §3.4 B 类抖动的"碰运气"成分。**尚未做**——本轮只做了事实核查，未改任何断言；
- **§3.4 C 类的复现与定位**（需要能跑 tauri-driver 的 Linux 环境）。

---

## 13. 最终结论

### 有条件发布 —— 代码侧条件已全部达成，剩余条件为实机验证

**已达成（本轮闭环）**：

1. **CI 全绿（基线 `ba5b8d1`）**：run `34680933632` 8/8 job success、**75/75 spec PASSED**——但这是**第 3 次 attempt** 取得的（attempt 1 有 3 个 spec 红、attempt 2 有 1 个），**故不能称"一次即绿"**；另有两个历史基线 `0fc493d`（一次即绿）与 `2c31fd2`（重跑后绿）。失败分三类（§3.4）：环境性抖动、已修的编排故障、以及 1 次未解释的密钥认证拒绝。**全程未以任何放宽手段掩盖**；
2. 核心功能全部通过：311 单测（四种时序一致、五连跑无抖动）+ 75/75 E2E spec + Rust/frontend/依赖审计；
3. **无阻塞级缺陷、无高危安全问题**：SQL / 命令注入与 XSS 均无路径，CSRF 不适用，凭据入 OS keychain 或 AES-256-GCM + Argon2id，备份同等级加密且口令不入日志，`unsafe` 零处；依赖公告均属低可利用性且已登记；
4. 具备可靠部署与恢复能力：**应用内升级端到端实测通过**（0.14.46 自升 0.15.0，装出的 bundle 与官方 dmg 逐字节一致）、**回滚实测通过**（旧版读新库、零写入）、**schema 闸门实测正确拒绝**（§12.1 V4–V6）、备份/恢复有单测与 E2E 双覆盖；
5. 本轮共修 **6 类真实问题**（许可门禁失效、遥测无界队列 + 无超时、静默 panic、两处零覆盖资源归属、E2E 密钥目标就绪门、**E2E 的 MinIO 镜像源失效**），全程未放松任何断言；
6. 泄漏面已有两层证据：6 轮差分回归（常驻门禁）+ 400 轮实测（句柄 14 → 14、无漂移，最慢关闭 55.5 ms），且「测不到」不会被显示成「没增长」（§3.3）。

**本轮新增的未决项（诚实登记）**：§3.4 C 类——`04-connect-key` 有 1 次在就绪门**通过 74 秒后**仍被服务端拒绝密钥认证，机制未定，**保持不判定为通过**。它不影响上面 1–6 条的结论，但也不应被"重跑就好"掩盖。

**剩余条件（非代码，需人工）**：

- §12 的 10 项实机验证中，**第 9 项（升级 + 回滚）已完成**（§12.1 V3–V6，含应用内升级端到端与 schema 闸门），**第 6 项的 macOS 部分已完成**（§12.1 V1、V2）；
- 仍需完成：第 1、2、3、4、5 项（需 RDP / VNC 主机、telnet 网元、串口设备、堡垒机等外部设备），第 6 项的 **Windows / Linux** 部分，第 7 项高 DPI；
- 第 8 项（4 小时混合负载长跑、RSS 曲线）与 §6 的冷启动耗时，建议在正式对外前补一轮；
- 第 10 项遥测抓包须带对照组执行（V7 证明「关掉自动更新仍会请求更新清单」，说明出站行为确需抓包核实，不能凭开关推断）。

**风险知悉项**（不阻塞，但须记录在案）：E2E 环境性抖动 + 编排易被上游变更打断（R-2，`libEGL` 软渲染根因未根治）、前端仅能由 CI 验证（R-3）、应用层无基准与长跑数据（R-5）、Windows GUI 零日志（R-7）、**macOS 未签名/未公证导致浏览器下载用户首启被拦（R-8）**、**启动期致命错误以 panic/SIGABRT 呈现、GUI 启动无任何提示（R-9）**，以及 §3.4 C 类那 1 次未解释的密钥认证拒绝。

**结论**：可以发布，但发布前的最后一道闸门是**实机冒烟**，不能由自动化测试替代。
