# anySSH 项目长期笔记

## 一、破坏即出 bug 的不变量

**会话循环**（`term/mod.rs::spawn_session` 与 `ssh/session.rs` 结构相同，改一个必看另一个）

- `tokio::select!` 分支一旦被选中**不可取消**。分支体内直接 `await` 后端 I/O（`io.write`/`channel.data`/`resize`）会在对端停止排空时冻结整个循环（含 `Close`/`Eof`）→ `term_close`/`ssh_disconnect` 永久挂起。所有后端 I/O 必须包 `IO_OP_TIMEOUT`(5s)。
- `close()` 不能无条件 `task.await`：用 `timeout(dur, &mut join_handle)`，失败后 `abort()`。`Elapsed::into_inner()` 在本项目 tokio 版本不存在，勿照抄。
- 会话日志对解码字节必须 `String::from_utf8_lossy`（chunk 边界会切断多字节序列，`from_utf8` 失败即整块丢日志）。
- 关闭 portable-pty：`Child::kill()` 只发 SIGHUP 且只作用于 shell 自身；`spawn_command` 的 `pre_exec` 调 `setsid()` ⇒ pid==pgid==sid，`kill(-pid, SIGKILL)` 可杀整个进程组（否则 `top`/`vim`/后台作业仍持 slave fd，master 收不到 EOF）。顺序：SIGHUP → `try_wait()` 轮询 ~2s → 组 SIGKILL → reap；**不要**无超时 `spawn_blocking(child.wait())`。

**CSP（`tauri.conf.json` → `app.security.csp`，三条缺一 RDP 即静默全废）**

- `script-src 'wasm-unsafe-eval'` 编译 ironrdp WASM；`connect-src data:`（`rdp.init()` 第一步 `fetch(<内嵌 data:…wasm>)`，`'self'`/`*` 不覆盖 `data:` scheme）；`connect-src ws://127.0.0.1:*`（自家 loopback 桥）。`style-src 'unsafe-inline'` 不能去（xterm.js 4 处 `createElement("style")`）。
- 失败模式：`rdp.init()` reject → 外层 catch → `RdpCanvas` 的 `host.appendChild(el)` 不执行 → 查看器根本不挂载、UI 无提示。
- 写 CSP/WASM 测试：WebKit 只在**实例创建时**检查 `wasm-unsafe-eval`，`instantiateStreaming`/`compileStreaming`/`new Module` 全绕过 ⇒ 必须用 `WebAssembly.instantiate(bytes)`，否则 Linux CI 假阴性。
- 护栏：`tests/e2e/specs/75-rdp-wasm-csp.spec.ts`（已在真实 wry webview 内证实两条指令有效）。

**协议/前端约定**

- Telnet 必须**主动**发 `IAC WILL NAWS`（大量网元从不发起协商，纯被动实现窗口永远 80×24）；脚本化发送的字节要过 `iac_escape`。
- `useTranslation()` 的 `t` identity 随 `[locale]` 变化，放进 `useEffect` 依赖会导致 effect 重跑（`VncCanvas` 已改 ref）。
- Tauri 命令拒绝值是对象，`String(err)` → `[object Object]`；统一 `messageOf(err)`。

**后端分布**：SSH/SFTP/SCP → `ssh/`（russh 0.63.3 直连 crates.io，vendor 补丁已退役，走 `ssh:*`）；本地终端/串口/telnet → `term/`（走 `term:*`）；RDP → `remote/rdp.rs`（ironrdp-rdcleanpath + WASM，**不是 FreeRDP FFI**）；VNC → 前端 noVNC + `remote/bridge.rs` WS 代理。

## 二、环境与工具（本机）

- `node_modules` 为空、沙箱 FS 代理拒绝 `pnpm install` 的 `symlink`/`mkdir` ⇒ **本机前端命令（tsc/vitest/vite build）结论一律不可采信，以 CI 为准**。
- `cargo` 不在非交互 PATH：`export PATH="/Volumes/My-Data/jason.wa/.cargo/bin:$PATH"; export CARGO_HOME=/Volumes/My-Data/jason.wa/.cargo; export RUSTUP_HOME=/Volumes/My-Data/jason.wa/.rustup`。**cargo 命令必须先 `cd src-tauri`**（根目录无 Cargo.toml）。`gh` 用 `/opt/homebrew/bin/gh -R jincaiw/anySSH`（`gh api` 不支持 `-R`，要写全路径）。
- macOS BSD `grep` 不支持 `\b`/`\s`，BRE `\|` 也不可靠 → 一律 `grep -E`。
- **沙箱（seatbelt）禁止 `ps`**（`Operation not permitted`），且 macOS 无 `/proc`。⇒ 任何以 `ps` 采样的指标会拿到**空输出**：必须把「采不到」显式表示为**不可用并跳过断言**，绝不能 `unwrap_or(0)` —— 那会印成「零增长」。「测不到」与「没增长」不能长得一样。RSS 类指标只能在普通终端采（`cargo test -- --ignored` 由人手动跑）。
- CI 仅在 main/PR/`workflow_dispatch` 触发；`ci.yml` 有 `concurrency.cancel-in-progress` ⇒ 再次 push 会取消同分支旧 run。
- 合规：`cargo fmt` 以实际输出为准（100 列断行会改写手写换行）；核对提交必须 `git show --name-status`，不能信 message。

## 三、基线与发布事实

- 单测 **311**（2026-09-11）；`--test-threads=1|32`/`--release` 一致，无顺序依赖。llvm-cov 只 `--lib`：行 **47.66%** / 函数 **34.44%** / 区域 53.26%；20 文件 0% 属口径限制（命令层由 75 spec 驱动成品二进制），**勿重复调查**。`cargo-miri` 不可用（rusqlite/ring/portable-pty）。生产 `unwrap/expect` 基线 **13 处**（统计时要匹配 `#[cfg(all(test, unix))]`）。无 `benches/`/`criterion`；`tracing` 硬编码 `anyssh=debug,russh=info`（不读 `RUST_LOG`）且**只写 stdout** ⇒ 人工验证必须从终端启动（Windows GUI 启动零日志）。
- 主窗口在 `src-tauri/src/lib.rs` 的 `WebviewWindowBuilder` 建（`tauri.conf.json` 的 `app.windows` 是 `[]`）。
- **main 历史线性，合分支用 rebase 不要 merge commit**。仅 `jincaiw` remote。v0.15.0 已发布（2026-09-11，tag `a2f53d8`）。
- ⚠️ **v0.15.0 不含审计后的修复（2026-09-12 核实）**：`v0.15.0` = `a2f53d8` @ 09-11 12:59，release 发布于 13:33；而审计产出的修复提交在**当晚 21:31–21:41**，**全部不在该 tag 内**。其中**两条是真缺陷修复**：`0537d3f`（`telemetry.rs` 有界队列 + 10s 超时）、`798d8cb`（`rdp.rs`/`s3`/`scp`/`sftp` 的 6 处 watcher `.expect()` 改优雅降级）。另 `a746290`（`bridge.rs`/`term/local.rs`，含回归用例）与 `824555a`（soak 工装）以测试为主；`6377a5e`（`deny.toml`）是 CI 门禁不随包发布。⇒ **要交付这些修复必须切新 tag（如 v0.15.1）**，不能复用 v0.15.0。判断「修复是否已发布」一律用 `git merge-base --is-ancestor <fix> <tag>`，**别信 skill 里"该版即 HEAD"这类会过期的记述**。
- RDP 只支持 TLS/NLA：IronRDP 硬拒绝标准 RDP 安全层（**设计决策非缺陷**）。判定看 X.224 CC 的 `NEG_RSP selectedProtocol`（偏移 15..19，小端）：0=PROTOCOL_RDP 无解/1=SSL/2=NLA。`rdp.rs` 的 `explicit_rdp_rsp` 与 `ignored_negotiation` 两个布尔必须分开，合并会产生自相矛盾的错误文本。

## 四、已知遗留缺口（非回归）

- `sftp:file-edited`/`scp:file-edited`/`s3:file-edited` 前端从未订阅 ⇒ 外部编辑器保存回传后远端列表不自动刷新。
- 遥测无应用内开关，唯一退出 `ANYSSH_DISABLE_TELEMETRY`；bridge 的 loopback WS **不校验 Origin**（靠 32B CSPRNG 单次令牌 + 60s TTL 兜底）。
- quick-xml 不可升级（**已定案勿再当待办**）：`aws-creds`/`rust-s3` 最新版都锁 `^0.38`，修复需 `>=0.41`，跨 semver 必冲突。0.39.4 来自 proc-macro 构建期。
- E2E 失败分**三类，必须分开讲**（判绿前先归对类）：
  - **A 类·编排被上游打断（确定性，0 个 spec 运行）**：2026-09-12 起 `make e2e-pull` 必然失败——MinIO 于 2025-10-23 停止发布社区版镜像，Docker Hub 上 `minio/minio`、`minio/mc` **已被移除**（实测匿名 pull 401、token `access` 声明为空；**限流是 429/`toomanyrequests`，不是这个**）。已改为 `quay.io/minio/{minio,mc}`（`ba5b8d1`）。**这类重跑永远不会好**。换源前查是否 distroless：Chainguard 镜像无 shell，`entrypoint: sh -c` 直接跑不起来。
  - **B 类·环境性（时序 / 容器 DNS）**：累计 15 次 spec 级失败 / 9 个 spec / **覆盖全部 4 个 shard**。**分片是确定性 round-robin**（`wdio.conf.ts`：排序后 `i % 4`）⇒ 每个 shard 的 spec 集合固定——把失败 spec 映射回 shard 若**分散且每轮换点**，即可判环境；若**集中且复现**，才是真缺陷。机制：`libEGL DRI3 error` ⇒ WebKitGTK 软渲染 + 多 worker 争用。**根因整改方向是让 runner 图形栈确定化（装 mesa 软光栅 / 设 `WEBKIT_DISABLE_COMPOSITING_MODE`、`LIBGL_ALWAYS_SOFTWARE`），不是调大等待预算——后者属"放宽断言"**。
  - **C 类·未解释（保持不判定）**：`04-connect-key` 曾报 `publickey ssh-ed25519 rejected`，而同 shard 就绪门在 **74 秒前**已打印 `sshd-key accepts the test key`，且两者 host/port/user/key **完全相同** ⇒ **不是就绪竞态**。⚠️ **因此"该类失败已由 `0fc493d`（`wait_for_key_auth` 能力探测）修复"这个结论不成立**，勿再沿用。
  - **别把不同超时混为一谈**：`waitForExplorer()` 是 **30s 条件轮询**（非固定 10s），`waitForEntry` 10s，`02-host-crud` 10s，`22-snippet-palette` 5s。
  - 读日志陷阱：`--log-failed` 里 `Incorrect password…` / `Not a valid anySSH backup file` 的 `ERROR webdriver` 行是 `62-data-backup-restore` 的**负向用例**（该 spec 6 passing），不是失败；`libEGL` 噪音会淹没 grep，先 `grep -v libEGL`。
  - 基线：`ba5b8d1` @ run `34680933632` 经**3 次 attempt** 才 8/8 绿、75/75 spec（19+19+19+18）。
- **CI 对 `main` 的每次 push 都无条件运行，纯文档提交也会跑**（不存在按改动范围跳过的机制）。⇒ 纯文档提交红了也要查；且**修了编排类故障后，旧提交无法用"重跑旧 run"回头验证**，等价证据只能在源码相同的**新**提交上取。
