# anySSH 项目长期笔记

## 会话循环的两处「不可取消 await」陷阱（2026-09-10 已修，勿再引入）

`term/mod.rs` 的 `spawn_session` 与 `ssh/session.rs` 的 PTY 任务**结构相同**，改动其中一个时另一个要同步看：

- `tokio::select!` 的分支**一旦被选中就无法取消**。在分支体内直接 `await` 后端 I/O（`io.write` / `channel.data` / `resize`）会在对端停止排空时冻结整个循环，包括 `Close`/`Eof` 分支 → `term_close` / `ssh_disconnect` 永久挂起。所有后端 I/O 必须包 `IO_OP_TIMEOUT`(5s)。
- `close()` 不能无条件 `task.await`。用 `tokio::time::timeout(dur, &mut join_handle).await`（JoinHandle 是 Unpin，`&mut F` 实现 Future），失败后 `handle.abort()`。
  **坑**：`Elapsed::into_inner()` 在本项目 tokio 版本**不存在**，别照抄记忆。
- 会话日志对解码后的字节必须用 `String::from_utf8_lossy`：chunk 边界会切断多字节序列，`str::from_utf8` 失败即整块丢弃日志。

## portable-pty 语义（读上游 0.9.0 源码实证）

- `Child::kill()` 在 Unix 只发 **SIGHUP** 且只作用于 shell 自身（`src/lib.rs:347`）。
- `spawn_command` 的 `pre_exec` 里调用 `setsid()`（`src/unix.rs:257`）→ **pid == pgid == sid**，因此 `kill(-pid, SIGKILL)` 可杀整个进程组（否则 `top`/`vim`/后台作业会继续持有 slave fd，master 收不到 EOF，读线程不退出）。
- 关闭顺序：SIGHUP → `try_wait()` 轮询 ~2s → 进程组 SIGKILL → reap。**不要**用无超时的 `spawn_blocking(child.wait())`。

## 协议后端分布

| 功能 | 后端 | 备注 |
|---|---|---|
| SSH/SFTP/SCP | `ssh/`（russh 0.63.3 直连 crates.io，vendor 补丁已退役） | 走 `ssh:*` 事件通道 |
| 本地终端 / 串口 / telnet | `term/`（`local.rs` / `serial.rs` / `telnet.rs`，共用 `spawn_session`） | 走 `term:*` 事件通道 |
| RDP | `remote/rdp.rs`（**ironrdp-rdcleanpath + WASM，不是 FreeRDP FFI**；`vendor/FreeRDP` 是空目录） | 位图/输入/resize 全在 WASM |
| VNC | 前端 `VncCanvas.tsx`(noVNC) + `remote/bridge.rs` 的 WebSocket 代理 | 一次性 token 路由 |

- Telnet 必须**主动**发 `IAC WILL NAWS`：大量网元/嵌入式 telnetd 从不发起协商，纯被动实现的窗口尺寸永远是 80×24。
- Telnet 脚本化发送的字节要过 `iac_escape`（与用户键入同一路径）。

## 前端约定

- `useTranslation()` 的 `t` memo 在 `[locale]`，**identity 会随语言切换变化**。把 `t` 放进 `useEffect` 依赖会导致 effect 重跑。`RdpCanvas` 依赖里没有 `t`，`VncCanvas` 已改为 ref —— 新增类似组件时勿再踩。
- Tauri 命令拒绝值是对象（`BridgeError` 序列化为 `{kind, message}`），`String(err)` 会渲染 `[object Object]`。统一用 `messageOf(err)` 取 `.message`。

## 环境（2026-09-11 修正根因）

- 主 worktree `/Volumes/My-Data/jason.wa/codebase/anySCP` 的 `node_modules` 是**部分安装树**。根因：WorkBuddy 沙箱用 `node-brokered-fs-shim.cjs` 代理 Node FS，**拒绝 `pnpm install` 的 `symlink`/`mkdir`**（`ERR_PNPM_CODEBUDDY_BROKER_DENY`），`/tmp` 与托管工作区都一样。残留物 `node_modules.partial-20260907/` 即证据。
- 后果：本地 `tsc --noEmit` **run-to-run 不稳定**（实测同树同命令：一次 240 errors/exit 2，一次 0 errors/exit 0；`--traceResolution` 显示模块解析其实成功）。
  **⇒ 本机任何依赖完整 node_modules 的前端命令（tsc/vitest/vite build）结论一律不可采信，以 CI 为准。** 修复需在非沙箱终端重跑 `pnpm install --frozen-lockfile`。
- CI 只在 `main` / PR / `workflow_dispatch` 触发。worktree 分支要用 `gh workflow run ci.yml --ref <branch>` 手动触发验证。
- `cargo` 不在非交互 shell PATH：`export PATH="/Volumes/My-Data/jason.wa/.cargo/bin:$PATH"; export CARGO_HOME="/Volumes/My-Data/jason.wa/.cargo"`。`gh` 用绝对路径 `/opt/homebrew/bin/gh` 且必须带 `-R jincaiw/anySSH`。
- **macOS BSD `grep` 不支持 `\b` / `\s`，BRE 下 `\|` 交替也不可靠** → 审计脚本统一用 `grep -E`，否则会静默假阴性。

## CSP / RDP WASM（2026-09-11 启用 CSP；**这是最容易再次踩坏的点**）

`tauri.conf.json` 的 `app.security.csp` 已由 `null` 改为务实策略。三条指令**专为 RDP 存在，去掉任何一条 RDP 就整体失效（且静默）**：

| 指令 | 为什么必需 |
|---|---|
| `script-src 'wasm-unsafe-eval'` | 编译 ironrdp WASM 模块 |
| **`connect-src data:`** | **`rdp.init()` 的第一步是 `fetch(<内嵌 data:…wasm URL>)`** —— CSP 把 `fetch()` 一个 `data:` URL 当网络请求按 `connect-src` 校验，**`'self'` 和 `*` 都不覆盖 `data:` scheme，必须显式列出** |
| `connect-src ws://127.0.0.1:*` | 自家 loopback 桥 `ws://127.0.0.1:<临时端口>/rdp\|/vnc/<token>`（`remote/bridge.rs:172,200`） |

- WASM 不是「无资源抓取」：`@devolutions/iron-remote-desktop-rdp` 把 WASM 以 `data:application/wasm;base64,…` 常量内嵌，wasm-bindgen `__wbg_init` 里 `B === void 0 && (B = kA)` → `B = fetch(B)` → `instantiateStreaming`。
- 失败模式：`rdp.init()` reject → 落外层 `catch` → **`RdpCanvas.tsx` 的 `host.appendChild(el)` 不执行 → 查看器根本不挂载**，UI 无有效提示。
- `style-src 'unsafe-inline'` **不能去掉**：`@xterm/xterm/lib/xterm.js` 有 4 处 `createElement("style")` + `textContent` 注入（含 `_injectCss`）。
- CSP 面已收敛：`dist/index.html` 只有同源外部 `<script type="module">`/`<link>`，**无内联脚本**；应用代码 `convertFileSrc`/`new WebSocket`/`eval` 均 0 处。
- 回归护栏：`tests/e2e/specs/75-rdp-wasm-csp.spec.ts`（既读配置，也在真实 webview 内探测 `fetch(data:)` + `WebAssembly.instantiate` + `instantiateStreaming` 并回报 `securitypolicyviolation`）。
- **写 CSP/WASM 测试的坑**：WebKit 只**在实例创建时**检查 `wasm-unsafe-eval`，`instantiateStreaming`/`compileStreaming`/`new Module` 全部绕过（WebKit bug 315489，2026-05 才修）⇒ 只用 `instantiateStreaming` 写的测试在 Linux CI 上**会假阴性**，必须用 `WebAssembly.instantiate(bytes)`。

## 依赖审计门禁（2026-09-11 建立）

- `deny.toml`（仓库根）+ CI job `Advisory audit (cargo-deny)`，**阻断式**（未加 `continue-on-error`）。
- **`unmaintained` 默认是 error 级**，不是 warning ⇒ 必须显式登记，否则 `check advisories` 直接失败。`unmaintained`/`unsound` 在 0.20 取**作用域**（`all|workspace|transitive|none`），写 `"warn"` 报 `unexpected-value` 反序列化错误。
- `cargo-deny-action@v2` 需显式 `manifest-path: src-tauri/Cargo.toml`（根目录没有 `Cargo.toml`）。
- **quick-xml 不可升级（已定案，勿再当待办）**：`aws-creds 0.39.1` 与 `rust-s3 0.37.2`（**均为最新**）都写 `quick-xml = "^0.38"`，修复要求 `>=0.41.0` —— 跨 semver 大版本，`cargo update --precise` 必然冲突，`[patch.crates-io]` 会撞破坏性 API 变更。
- `quick-xml 0.39.4` 来自 **proc-macro 构建期**（`wayland-scanner → … → wl-clipboard-rs → arboard → tauri-plugin-clipboard-manager`），非运行期；`0.38.4` 才是 host 依赖。
- `cargo-audit 0.22` 的 JSON **无 `severity` 键**（用 `cvss`）。

## 已修复（2026-09-11，分支 `chore/pre-release-hardening`，**6 提交，未推送**）

`bb43826` 真删 `vendor/FreeRDP` gitlink（`git submodule status` fatal→exit 0）｜`ecd38e0` `serialport 4.10.0→4.10.1`（原版本**已被 crates.io yank 且是直接依赖**，由 `cargo deny` 的 yanked 报告暴露，非 `cargo audit`）｜`0ec9add` DB「库版本高于 App」保护 + `LATEST_SCHEMA_VERSION=20` 常量 + 3 测试、`SECURITY.md`、`.gitattributes`、`bundle.copyright` 双版权、两处 README 过期表述｜`6384ab2` `deny.toml` + CI 审计 job｜`6d06d16` 启用 CSP + `75-rdp-wasm-csp.spec.ts`｜`c3084f0` 审计报告 `docs/pre-release-acceptance-audit-2026-09-10.md` + 附录。

**教训（仍在生效）**：核对提交必须用 `git show --name-status`，不能信 message（`975dc25` 声称删 gitlink 却从未生效）。`0.0.0-dev` 是**刻意占位**（由 `release.yml` 从 tag 注入、不回写仓库），不是缺陷。

## CI 判定（2026-09-11 已完成，全部闭环）

分支 `chore/pre-release-hardening`（7 提交）已推送 `jincaiw`。**CI run `34562021131` @ `c3084f0`，`run_attempt=1` 首次即绿，8/8 job success**（含新增 `Advisory audit (cargo-deny)` 与 4 个 E2E shard）。

- **CSP 已被运行时证实不破坏应用**：4 shard 合计 75 spec PASSED / 0 FAILED、0 skipped；`75-rdp-wasm-csp.spec.ts` 落在 shard 4/4，在**真实 `wry 0.54.4 linux` webview** 内两条断言均 PASS ⇒ `connect-src data:` 与 `script-src 'wasm-unsafe-eval'` 均有效。
- CI 独立复核：Rust `306 passed; 0 failed`（与本地一致）；日志含 `Downloaded serialport v4.10.1`。
- 末条 `131259c` 仅改审计报告 Markdown，代码与已验证 SHA 字节一致 ⇒ 未重跑 CI（用 `git diff --name-only c3084f0..HEAD` 自证范围）。

**待办：分支合并 main（未合并）。**

## RDP 只支持 TLS/NLA；标准 RDP 安全层无法连接（2026-09-11 定案，非缺陷）

IronRDP 上游 `ironrdp-connector/src/connection.rs:266-268` 硬拒绝 `is_standard_rdp_security()`，官方原话 "The legacy RC4-based security is not supported in IronRDP"。这是**故意的设计决策**（标准 RDP 安全无预认证、易 MITM），不是 bug。

- 判定：看 X.224 CC 的 `NEG_RSP selectedProtocol`（偏移 15..19，小端）。`0x0`=PROTOCOL_RDP（anySSH 无解）/ `0x1`=SSL / `0x2`=HYBRID(NLA)。
- **服务端解法**：`HKLM\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp` 下 `SecurityLayer=2` + `UserAuthentication=1`，重启主机，且需有可用证书。堡垒机只代理标准 RDP 安全层时只能在设备侧改，或该主机继续用 `mstsc`。
- anySSH 有**双重闸门**：① `rd_inspect_certificate` 必须先完成 TLS 握手取得证书指纹才能开标签页；② IronRDP 协议层拒绝。绕过 ① 也会被 ② 挡住。
- `rdp.rs` 诊断的两个布尔必须分开：`explicit_rdp_rsp`（服务端回显式 `NEG_RSP selected=PROTOCOL_RDP`）与 `ignored_negotiation`（回裸 11 字节 CC、无协商载荷）。**合并二者会产出与自身 hex 自相矛盾的错误文本。** 测试常量同样要分清：`X224_CONFIRM_RDP`（显式选 RDP，19 字节）≠ `X224_CONFIRM_BARE_CC`（裸 CC，11 字节）。
- 结论句必须放在 `tried` 变体列表**之前**：该列表约 700 字符，会把结论挤出连接弹窗可见区（表现为句子断在半个从句上）。


