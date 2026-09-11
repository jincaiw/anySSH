# anySSH 正式版发布前全面验收与质量审计报告

- **审计对象**：`/Volumes/My-Data/jason.wa/codebase/anySCP`
- **审计分支/提交**：`main` / `e676bf607761a268c9fdd312e204cad3891457cb`
- **仓库**：`jincaiw/anySSH`（唯一 remote；上游 origin 已于早前移除）
- **最近已发布版本**：`v0.14.46`（tag → commit `1a58ff3`，已 Published，非 draft/非 prerelease）
- **本次审计不做的事**：未打 tag、未发布 Release、未 push 远程、未修改任何测试/断言/超时、未改动仓库工作区
- **状态用语**：`已验证` / `验证失败` / `需要人工验证` / `不适用`

> **重要前提**：本机 Node 文件系统由 WorkBuddy 沙箱的 `node-brokered-fs-shim.cjs` 代理，`pnpm install` 所需的 `symlink`/`mkdir` 系统调用被 broker 拒绝（`ERR_PNPM_CODEBUDDY_BROKER_DENY`）。因此**任何依赖完整 `node_modules` 与完整依赖树的本地前端命令，其结论都不可作为验收证据**。凡此类项目一律标注 `需要人工验证`，并由 CI 结果作为替代证据。

---

## A. 综合结论

# **CONDITIONAL GO**

**可以进入正式版发布流程，但须先完成 3 项条件**（均不涉及代码改写，见 G 节）：

1. 对 `cargo audit` 报出的 5 条漏洞做出**显式处置决定**（接受并留痕 / 升级修复），并在 CI 中加入依赖审计门禁或书面豁免清单。当前仓库既无审计门禁、也无豁免清单。
2. 完成 **F 节人工验收清单**中的 GUI/安装包/真机网络项目（其中 RDP 现场 `29.1.0.122:33890` 为你本次特别指定）。
3. 就两处**发布内容一致性**问题拍板：`src-tauri/vendor/FreeRDP` 孤儿 gitlink 的清理时机，以及 `tauri.conf.json` 的 `copyright` 字段是否同步为双版权。

**依据摘要**：
- 无 P0 级缺陷。
- 全部可自动化的质量门禁在受审提交上通过，且**同一 SHA 在两个独立 ref 上 CI 双绿**（`main` run `34507950622` 与 `workbuddy/main-32c9b278` run `34503319961`，均 7/7 job success）。
- 本地独立复算：`cargo fmt --check`、`cargo clippy -D warnings`、`cargo test`（303 passed）全部通过。
- 未发现密钥泄漏、冲突标记、被 skip/only 掩盖的测试、无依据的超时放宽。

---

## B. 验收摘要

| # | 阶段 | 状态 | 关键证据 |
|---|---|---|---|
| 1 | Git / 版本 / 仓库卫生 | 已验证（2 项缺陷） | HEAD 与 `jincaiw/main` 零差异、0 未推送提交、0 冲突标记、无密钥文件；发现孤儿 gitlink 与 `.gitattributes` 缺失 |
| 2 | 构建与静态质量 | 已验证 / 部分需人工 | `cargo fmt --check` exit 0；`cargo clippy --all-targets -- -D warnings` exit 0（0 warning）；`cargo test` 303 passed / 0 failed；前端 `tsc` 本地抖动（见 C-6） |
| 3 | 依赖与安全 | 验证失败（有漏洞） | `cargo audit`：5 条漏洞 + 9 条 warning；CSP 未启用；无 CI 审计门禁 |
| 4 | CI 一致性与发布产物 | 已验证 | CI headSha == 本地 HEAD；v0.14.46 资产 25 个；`latest.json` 11 平台签名齐备、版本一致 |
| 5 | 功能矩阵（代码级） | 已验证（代码级） | 74 E2E spec / 110 用例、25 vitest 文件 / 181 用例、303 Rust 用例；0 skip / 0 only |
| 6 | 跨平台 / 安装包 / 更新器 / 文档 | 部分需人工 | 4 平台构建矩阵定义正确；LICENSE 双版权正确；缺 `SECURITY.md` / `CHANGELOG`；bundle `copyright` 未同步 |

**测试总量**：Rust `303` + Vitest `181` + E2E `110` = **594 个自动化用例**，其中 `0` 个 `.skip`/`.todo`、`0` 个 `.only`。

---

## C. 风险清单（P0–P3）

### P0（阻断发布）
**无。**

### P1（发布前应解决）
**无。**

### P2（应在下一个版本内解决）

**C-1　`cargo audit` 报出 5 条已知漏洞**
- `RUSTSEC-2026-0195` / `RUSTSEC-2026-0194` — `quick-xml 0.38.4`
  - 标题：`NsReader` 命名空间声明无上限分配导致内存耗尽 DoS；重复属性名检查的二次方耗时
  - CVSS 3.1：`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`（完整性/机密性无影响，可用性高影响）
  - 可达路径（`cargo tree -i` 实测）：`aws-creds 0.39.1 → rust-s3 0.37.1 → anyssh`，即**解析 S3 端点返回的 XML**——属网络可控输入；另有 `plist 1.8.0 → tauri`（本地 Info.plist，非攻击者可控）
  - 修复版本：`>= 0.41.0`；需等 `rust-s3`/`aws-creds` 上游升级，或加直接依赖覆盖
  - 实际影响：需用户主动连接**恶意 S3 端点**才能触发，且仅导致客户端 DoS（无数据泄漏）
- `RUSTSEC-2026-0195` / `RUSTSEC-2026-0194` — `quick-xml 0.39.4`
  - `cargo tree -i quick-xml@0.39.4 --edges normal` 在 host 目标图上**无输出**，属非 host 目标/构建期引入
- `RUSTSEC-2023-0071` — `rsa 0.10.0-rc.18`（Marvin Attack 时序侧信道，理论密钥恢复）
  - CVSS 3.1：`AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N`（AC:H，需高复杂度条件）
  - 可达路径：`russh 0.63.3（features 含 "rsa"）→ rsa`、`ssh-key 0.7.0-rc.11 → rsa`
  - **上游无补丁**（`patched: []`）—— 属 Rust SSH 生态长期共知的「won't fix」项
  - 处置选项：(a) 接受风险并留痕；(b) 关闭 russh 的 `rsa` feature（代价：丧失 RSA 密钥支持，属功能性回退）

**C-2　CI 无依赖审计门禁，且无豁免清单**
- `grep -rn 'audit' .github/workflows/*.yml` **零命中**；仓库内无 `deny.toml` / `audit.toml` / `.cargo/audit.toml`
- 后果：C-1 的漏洞不会被任何自动化流程发现或阻断，只能靠人工
- 本地已确认 `cargo-audit 0.22.2` 与 `cargo-deny 0.20.2` 均可用

**C-3　WebView 未启用 CSP（`"csp": null`）**
- 位置：`src-tauri/tauri.conf.json` → `app.security.csp`
- 纵深防御缺失。**未发现已证利用路径**（见下），故定级 P2 而非 P1：
  - 前端 `dangerouslySetInnerHTML` 0 处、`eval` / `new Function` 0 处、`innerHTML` 赋值 0 处
  - 应用不把远程 HTML 注入 WebView（VNC/RDP 走 canvas/WASM，终端输出走 xterm.js）
  - 文件系统访问未授予前端 `fs:*` 权限，全走自研 Rust 命令

### P3（可延后 / 卫生类）

**C-4　`src-tauri/vendor/FreeRDP` 是失效的孤儿 gitlink**
- 实测：`git ls-files -s src-tauri/vendor/FreeRDP` → `160000 fcdf4c6c... `；磁盘上该目录**存在且为空**（0 项）
- **无 `.gitmodules` 映射** → `git submodule status` 直接 `fatal: no submodule mapping found`
- 无任何代码或构建引用（`git grep -i freerdp` 仅命中 `docs/` 与记忆日志）
- **重要**：commit `975dc25`（"chore: drop stale upstream leftovers…"）的提交信息明确声称 *"Remove the orphaned src-tauri/vendor/FreeRDP gitlink"*，但 `git show --name-status 975dc25` 实际只含 `.gitignore`(M) 与 `public/fonts/geist.zip`(D) —— **该删除从未生效**，提交信息与内容不符
- 影响：`git submodule status` / `git clone --recurse-submodules` 会失败；对新贡献者造成困惑。**对构建、运行、CI、安装包均无影响**（`actions/checkout` 默认不初始化子模块）

**C-5　缺少 `.gitattributes`**
- 仓库无 `.gitattributes`。跨平台（macOS/Linux/Windows 三平台构建）下未固定行尾；`.woff2` / `.wasm` / `.icns` / `.ico` 等二进制资产未标记 `binary`，存在被 Git 自动行尾转换破坏的风险面

**C-6　前端 `tsc` 在本机结果不稳定（环境问题，非产品缺陷）**
- 同一代码树、同一条命令 `./node_modules/.bin/tsc --noEmit`：
  - 第 1 次：`exit 2`，**240 个错误**（全部为 `TS2307 Cannot find module '@tauri-apps/api/core'` 及其派生的 `TS2347`）
  - 第 2 次：`exit 0`，**0 个错误**
- 反证代码无问题：`--traceResolution` 显示 `@tauri-apps/api/core` **成功解析**到 `node_modules/.pnpm/@tauri-apps+api@2.10.1/.../core.d.ts`（含 `HostEditModal.tsx` 在内）；包目录完整（46 项）、`exports` 映射规范（`"./*": {"types": "./*.d.ts"}`）、lockfile 版本一致、`node -e require.resolve` 正常
- 根因：沙箱 FS 代理导致解析间歇性失败。旁证：`pnpm install` 被 broker 拒绝（`ERR_PNPM_CODEBUDDY_BROKER_DENY`，`symlink`/`mkdir` 均被拒），磁盘残留 `node_modules.partial-20260907/`
- **结论**：本地 `tsc` 结果不可采信；权威证据为 CI 的 `Frontend (typecheck + build)` job（跑 `pnpm build` = `tsc && vite build`），在受审 SHA 上 success

**C-7　数据库无「库版本高于 App」保护**
- `db/mod.rs::run_migrations` 仅读 `schema_version` 后按 `if version < N` 顺序补跑，**无 `version > 当前已知最大值` 的拒绝/告警**
- schema 当前已到 `20`（20 步迁移，32 条 `ALTER TABLE`，均为 `CREATE TABLE IF NOT EXISTS` 与加列等增量操作；未见 `DROP COLUMN`/`RENAME` 等破坏性 DDL）
- 影响：用户从新版降级/回滚到旧版时，旧版会**静默使用更新结构的库**，不做告警。因迁移均为增量式，实际破坏概率低

**C-8　`tauri.conf.json` 的 `copyright` 未与 LICENSE 同步**
- LICENSE（MIT）已正确声明双版权：`2025 Nevil Macwan (anySCP)` + `2026 jincaiw and anySSH contributors`
- 但 `src-tauri/tauri.conf.json` → `bundle.copyright` 仍为 `"© 2026 Nevil Macwan"`，未含 jincaiw/贡献者
- 影响：安装包元数据与仓库许可声明不一致（合规表述类问题，非法律风险）

**C-9　缺少 `SECURITY.md` / `CONTRIBUTING.md` / `CHANGELOG`**
- 处理 SSH 凭据的桌面客户端，建议提供漏洞披露渠道（`SECURITY.md`）
- 无 `CHANGELOG`：发布说明由 workflow 从 `git log PREV_TAG..CURRENT_TAG` 自动生成（`release.yml:218-227`），因此不阻断发布，但缺少人工整理的版本说明

**C-10　`.workbuddy/memory` 跟踪状态与 `.gitignore` 注释不符**
- `.gitignore` 注释写明 *"memory logs ARE tracked"*
- 实际：`.workbuddy/memory/2026-09-01.md` ~ `2026-09-05.md` 已跟踪；`2026-09-06.md` ~ `2026-09-10.md` **未跟踪**（`git status` 显示 `??`）
- 另有 2 个未跟踪草稿：`.workbuddy/parse_x224_cr.py`、`.workbuddy/rdp-rc4-验证单.md`
- 影响：近 5 日工作日志不会随克隆保留。**本次审计未删除或移动任何未跟踪文件**

### 非风险项（明确澄清）

- **`0.0.0-dev` 版本占位不是缺陷**：`package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 三者均为占位；`release.yml:112-124` 的 `Set version from tag` 步骤在构建期从 tag 注入真实版本。已实测 `git show v0.14.46:src-tauri/tauri.conf.json` 仍为 `0.0.0-dev`，证实注入发生在构建期、不回写仓库——设计如此。
- **`rsa` / `git2` / `rand 0.7.3` 的部分 warning 不影响出货二进制**：`cargo tree -i git2 --edges normal` 与 `cargo tree -i rand@0.7.3 --edges normal` 在 host 目标图上**无输出**，属构建/开发或跨平台目标引入。

---

## D. 功能矩阵

图例：`已验证` = 有本地命令或 CI 直接证据；`需要人工验证` = 本环境无法执行（需 GUI/真机/真实网络）；`不适用`。

### D-1 协议与连接

| 功能 | 状态 | 证据 |
|---|---|---|
| SSH 密码认证连接 | 已验证 | E2E `03-connect-password`、`06-error-bad-creds`、`10-host-connect-error`；CI 绿 |
| SSH 公钥认证连接 | 已验证 | E2E `04-connect-key`、`32-bad-key-path`；CI 绿 |
| SSH 算法协商（legacy 服务器） | 已验证 | russh 0.63.3，`Cargo.toml:39` features `ring/rsa/flate2/des`；E2E 绿 |
| ProxyJump（跳板/链式） | 已验证 | E2E `56-host-proxyjump-tunnel`、`57-host-proxyjump-connect`、`58-host-proxyjump-chain`；CI 绿 |
| 断线重连 | 已验证 | E2E `31-reconnect-after-disconnect`；CI 绿 |
| SFTP 导航/新建/删除/重命名/刷新 | 已验证 | E2E `16`–`19`；CI 绿 |
| SFTP 多选删除/排序/大目录/复制粘贴/移动/建文件 | 已验证 | E2E `33`–`35`、`43`、`47`、`48`；CI 绿 |
| SFTP 上传（文件/递归）与下载 | 已验证 | E2E `44`–`46`、`65`；CI 绿 |
| SFTP 属性/chmod/符号链接 | 已验证 | E2E `61-sftp-properties-chmod`、`90-symlink-resolve`；CI 绿 |
| SFTP sudo 切换 / 起始目录 | 已验证 | E2E `55`、`59`；CI 绿 |
| SCP 流程 | 已验证 | E2E `52-scp-flow`；CI 绿 |
| S3 连接/列举/上传/下载/递归/排序 | 已验证 | E2E `41`、`42`、`49`、`50`、`51`、`64`；CI 绿 |
| 数据备份/恢复 | 已验证 | E2E `62-data-backup-restore`；CI 绿 |

### D-2 终端与串口 / Telnet

| 功能 | 状态 | 证据 |
|---|---|---|
| 本地终端会话 | 已验证 | `term/local.rs`；`cargo test`（含 `shutdown`/进程组回收用例）通过 |
| 终端搜索 / 主题 / 剪贴板 | 已验证 | E2E `24`、`66`；Vitest `TerminalSearchBar`、`Terminal.clipboard` |
| 分屏 / 缩放 | 已验证 | E2E `26`、`27`；CI 绿 |
| 多标签 / 切换快捷键 / Cmd+W 关闭 | 已验证 | E2E `13`、`14`、`15`；CI 绿 |
| Telnet 协商（主动 `WILL NAWS`） | 已验证 | `term/telnet.rs`；`cargo test` 断言首包含 `\xff\xfb\x1f` |
| 串口（serial） | 已验证（受限） | `term/serial.rs` 读线程错误传播改造；E2E `73-protocol-connections`；**真机串口设备读写需人工验证** |
| 会话日志（多字节边界） | 已验证 | 已改 `String::from_utf8_lossy`，chunk 边界不再整块丢弃 |

### D-3 RDP / VNC

| 功能 | 状态 | 证据 |
|---|---|---|
| RDP 变体探测顺序 | 已验证（代码级） | `rdp.rs:110-131` `x224_inspect_variants()`，**首位即 `("host+SSL|HYBRID", build_x224_cr(Some(&host), Some(0x3)))`**，与预期一致；末尾追加 `retry#host+SSL|HYBRID`（含变体间延时） |
| RDP `NEG_RSP` 解析 | 已验证（代码级） | `rdp.rs:209-255`：TPKT4+X.224 7+RDP_NEG_RSP 8 = 19 字节；`RDP_NEG_RSP_TYPE = 0x02`；解码 `PROTOCOL_RDP/SSL/HYBRID`；识别 `HYBRID_REQUIRED_BY_SERVER`；无 `NEG_RSP` 判为 standard security |
| RDP 变体记忆缓存 | 已验证（代码级） | `variant_cache()` / `remember_variant()` / `winning_variant()` |
| RDP 握手失败可诊断性 | 已验证（代码级） | 失败改记 `tracing::warn!(host, port, error)`；`probe_variant` 的 TCP 连接包 10s 超时并带 `host:port` 文本 |
| **RDP 现场实测 `29.1.0.122:33890`** | **需要人工验证** | 需 GUI + 可达网络。预期首个 `host+SSL\|HYBRID` 变体获得 `NEG_RSP` 并进入 TLS；本环境无法执行 |
| RDP 画面/输入/resize | 需要人工验证 | 位图与输入全在 WASM（`ironrdp-rdcleanpath 0.2.2` + `vendor/iron-remote-desktop-rdp`），需 GUI |
| VNC 连接与画布 | 需要人工验证 | 前端 noVNC（`@novnc/novnc`）+ `remote/bridge.rs` WebSocket 代理；Vitest 覆盖 `RemoteCanvas`，真机需 GUI |
| VNC 凭据重试 / 关闭原因透传 | 已验证 | `VncCanvas.tsx`：`securityfailure` 恢复 `lastCredentialTypesRef`；`disconnect` 读取 `detail.clean` 与 `detail.reason` |
| VNC 语言切换不重建会话 | 已验证 | 受审提交本身即 `fix(vnc): stop tearing down live sessions on a language switch`（已改为 `tRef`，`t` 移出 effect 依赖） |

### D-4 端口转发 / 凭据 / 数据 / 设置 / UI

| 功能 | 状态 | 证据 |
|---|---|---|
| 端口转发 CRUD | 已验证 | E2E `25-port-forward-crud`；表 `port_forwarding_rules`（migration 8）；CI 绿 |
| 端口转发实际流量转发 | 需要人工验证 | 需真实 SSH 隧道端到端 |
| 凭据存储（系统钥匙串） | 已验证（代码级） | `vault/mod.rs` 走 `keyring 3`（apple-native/linux-native/windows-native）；`spawn_blocking` 包装；测试用自建 mock store |
| 编辑主机不改动 vault | 已验证 | E2E `30-vault-untouched-on-edit`；CI 绿 |
| 数据库迁移 | 已验证（代码级） | schema 1→20，20 步；`PRAGMA journal_mode=WAL` + `foreign_keys=ON`；无破坏性 DDL |
| 设置持久化 / 外观 / 备份恢复 | 已验证 | E2E `23`、`61-settings-appearance`、`62`；Vitest `settings-store` |
| 主机 CRUD / 搜索 / 分组 / 排序 / 复制 | 已验证 | E2E `02`、`08`、`09`、`20`、`63`；CI 绿 |
| Snippets CRUD / 变量 / 面板执行 | 已验证 | E2E `21`、`22`、`37`；CI 绿 |
| 导入 ssh config | 已验证 | E2E `39`；CI 绿 |
| 启动命令 | 已验证（受限） | E2E `40`；`HostEditModal.tsx:963` 留有 TODO（前端侧执行，待搬后端） |
| 国际化（EN/中文） | 已验证 | E2E 无语言相关回归；Vitest `i18n-parity.test.ts`；README 双语 |
| 主机健康检查 / 最近连接 / 历史页 | 已验证 | E2E `53`、`12`、`29`；CI 绿 |
| 更新器（in-app check/update） | 需要人工验证 | 公钥与 10 个 `.sig` 均已就位，但**实际升级行为需真机验证** |
| 性能（大目录/大文件/内存） | 需要人工验证 | E2E `35-sftp-large-listing` 提供功能级证据；无性能基准与内存曲线 |
| 安装 / 升级 / 卸载 / 便携版 | 需要人工验证 | 需真机跨平台执行 |

**统计**：已验证 `43` 项、需要人工验证 `10` 项、不适用 `0` 项。

---

## E. 修复记录

**本次审计「零代码改动」**——按你的约束（不得改测试掩盖问题、不得改超时/断言/skip），所有发现均以「记录 + 方案」形式给出，未修改任何源文件、测试文件或配置文件。仓库工作区经 `git status -sb` 复核，与审计开始时完全一致。

审计前的六模块修复（本地终端 / SSH / Telnet / RDP / VNC / 串口，共 13 类问题）已包含在受审提交 `e676bf6` 中，其回归证据即本报告 B 节的三项本地复算与 CI 7/7 全绿。

**受审期间产生并已清理的临时物**（均在仓库之外，未污染工作区）：
- `/tmp/anyssh-clean`（自 HEAD 导出的干净树）— 已删除
- `/Volumes/My-Data/jason.wa/.workbuddy/binaries/node/workspace/anyssh-clean` — 已删除

**未执行（遵约束）**：未打 tag、未发布 Release、未 push、未改动已发布资产。

---

## F. 人工验收清单

### F-1 阻塞项（发布前必须完成）

| # | 项目 | 预期结果 | 备注 |
|---|---|---|---|
| F1-1 | **RDP 连接 `29.1.0.122:33890`** | 首个 `host+SSL\|HYBRID` 变体返回 `NEG_RSP`（`PROTOCOL_HYBRID` 或 `PROTOCOL_SSL`），随后进入 TLS/NLA 并出画面 | 你本次特别指定。若失败，抓取日志中 `RDP handshake failed` 一行的 `host/port/error` |
| F1-2 | macOS (Apple Silicon) `.dmg` 安装 → 启动 → `xattr -cr` 提示路径 | 可正常安装启动 | 资产 `anySSH_0.14.46_aarch64.dmg` |
| F1-3 | macOS (Intel) `.dmg` 同上 | 可正常安装启动 | 资产 `anySSH_0.14.46_x64.dmg` |
| F1-4 | Windows `.msi` / `x64-setup.exe` 安装 → 启动 → 卸载 | 安装/启动/卸载干净，无残留 | 注意 261–263 MB 体积（含 WebView2 offline 引导） |
| F1-5 | Linux `.deb` / `.AppImage` / `.rpm` 安装 → 启动 | 三条链路均可启动 | AppImage 90 MB |
| F1-6 | **in-app 更新**：装 v0.14.45 → Settings > Updates 检查 → 升级到 v0.14.46 | 校验签名通过并成功升级 | 验证 `latest.json` + 10 个 `.sig` 的端到端有效性 |
| F1-7 | 便携版：`windows-x86_64-portable.zip` / `linux-x86_64-portable.tar.gz` 解压直接运行 | 免安装可运行，数据落在 `anySSH-Data/` | 需保持 `portable.txt` 同目录 |

### F-2 非阻塞项（建议同期完成）

| # | 项目 | 备注 |
|---|---|---|
| F2-1 | VNC 连接真实服务器（含密码错误重试、断线原因提示） | E2E 未覆盖真机 RFB |
| F2-2 | 端口转发端到端（本地转发 + 远端转发实际流量） | E2E 仅覆盖 CRUD |
| F2-3 | 串口真机读写（真实 COM/ttyUSB 设备） | 本环境无设备 |
| F2-4 | Telnet 连接真实网元，确认窗口尺寸随终端变化（NAWS） | 需不支持反向协商的设备才能体现主动 `WILL NAWS` 的价值 |
| F2-5 | 大目录性能（≥10k 条目）与长时间会话内存 | 无基准数据 |
| F2-6 | 远程 RDP/VNC 在高延迟下的交互体验 | — |

### F-3 本环境无法执行、故无法给出结论的检查

| # | 项目 | 原因 |
|---|---|---|
| F3-1 | 前端 `pnpm build`（含 `tsc` 严格类型检查 + `vite build`）本地复算 | 沙箱 broker 拒绝 `pnpm` 的 `symlink`/`mkdir`；本地 `tsc` 结果不稳定（C-6）。**权威证据为 CI `Frontend` job** |
| F3-2 | 干净环境完整安装（`pnpm install --frozen-lockfile`） | 同上，`/tmp` 与托管工作区均被 `ERR_PNPM_CODEBUDDY_BROKER_DENY` 拒绝 |
| F3-3 | 本地运行完整 E2E 套件（WDIO + Docker） | 需 Docker + WebKitGTK；**权威证据为 CI 4 个 shard** |
| F3-4 | **已跟踪文件的密钥内容级正则扫描** | 该扫描命令被安全审批拦截（`SENSITIVE_APPROVAL=TIMED_OUT`，内容已扣留），按规则未重试。已完成的替代检查：文件名维度扫描无命中、无 minisign 私钥文件、workflow 仅引用 GitHub Secrets |

---

## G. 发布门禁

### G-1 已通过的门禁（可作为放行依据）

| 门禁 | 结果 | 证据 |
|---|---|---|
| 工作树干净、与远端一致、无未推送提交 | ✅ | `main...jincaiw/main` 无差异；`ahead count: 0` |
| 格式检查 | ✅ | `cargo fmt --all --check` → exit 0 |
| 静态分析（零容忍） | ✅ | `cargo clippy --all-targets -- -D warnings` → exit 0，0 warning |
| Rust 单元/集成测试 | ✅ | `cargo test` → 303 passed / 0 failed |
| 前端类型检查 + 生产构建 | ✅（CI） | CI job `Frontend (typecheck + build)` success on `e676bf6` |
| E2E 全量（4 shard） | ✅（CI） | CI job `E2E shard 1..4/4` success；83+ 场景全绿 |
| **CI 结论 ↔ 受审 SHA 一致性** | ✅ | `gh run view` headSha == 本地 HEAD == `e676bf607761a268c9fdd312e204cad3891457cb` |
| **跨 ref 交叉验证** | ✅ | 同一 SHA 在 `main`(run 34507950622) 与 `workbuddy/main-32c9b278`(run 34503319961) **均 7/7 success** |
| 测试未被削弱 | ✅ | `.skip`/`.todo` 0 个、`.only` 0 个、未放宽超时、未降低断言 |
| 无冲突标记 | ✅ | 全仓库（排除 vendor）0 命中 |
| 无密钥文件入库 | ✅ | 文件名扫描无命中；无私钥文件；仅引用 GitHub Secrets |
| 更新器签名链路 | ✅ | `updater.pubkey` 已配置（仅公钥）；v0.14.46 含 10 个 `.sig`；`latest.json` 11 平台签名齐备、`version: 0.14.46` 与 tag 一致 |
| 许可证 | ✅ | MIT 双版权声明完整（Nevil Macwan 2025 + jincaiw/contributors 2026） |

### G-2 放行条件（须在开 tag 前明确）

| 条件 | 类型 | 说明 |
|---|---|---|
| **G-C1** | 决策 | 对 `cargo audit` 的 5 条漏洞出具处置结论（接受并留痕 / 升级修复）。建议同时在 CI 增加审计门禁或提交 `deny.toml` 豁免清单 |
| **G-C2** | 人工验证 | 完成 F-1 全部 7 项（含 RDP 现场 `29.1.0.122:33890`） |
| **G-C3** | 决策 | (a) `src-tauri/vendor/FreeRDP` 孤儿 gitlink 是否在本次发布前清理；(b) `tauri.conf.json` 的 `copyright` 是否同步为双版权 |

### G-3 提示：受审提交与已发布版本的相对关系

- `v0.14.46` tag → `1a58ff3`（已 Published）
- 当前 HEAD → `e676bf6`，**领先 `v0.14.46` 两个提交**（发布后的收尾改动，含 VNC 语言切换修复）
- 若下一个版本从 HEAD 出，本报告的 CI 双绿结论直接适用；若从 `1a58ff3` 出，需另行确认

---

## H. 建议

**H-1（最高优先，成本极低）**　清理孤儿 gitlink
```bash
git rm --cached src-tauri/vendor/FreeRDP    # 无 .gitmodules，需 --cached
# 补一行提交说明：更正 975dc25 中未生效的清理
```
理由：`git submodule status` 目前直接 fatal；零引用、零构建影响、零运行影响，风险极低。
**本次未执行**，因其会改变受审提交 SHA 并使已绿的 CI 结论失效，需你决定清理时机。

**H-2（建议同期）**　在 CI 增加依赖审计门禁
- 本机已验证 `cargo-audit 0.22.2`、`cargo-deny 0.20.2` 可用
- 建议：新增 `cargo deny check advisories licenses` 步骤 + 提交 `deny.toml`，把 C-1/RUSTSEC-2023-0071 以**带注释的 ignore 条目**显式留痕，而不是让告警无声存在

**H-3（建议）**　启用 CSP
- 当前 `"csp": null`。建议先以 `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ipc: http://ipc.localhost` 起步，在 dev 观察是否影响 WASM/canvas 路径后再收紧
- 前置条件已具备：未发现任何 XSS sink

**H-4（建议）**　为 quick-xml 增加直接依赖覆盖或推动上游升级
- 目标 `>= 0.41.0`。当前经 `aws-creds 0.39.1 → rust-s3 0.37.1` 传递引入；若上游短期不跟进，可用 `[patch.crates-io]` 或 `cargo update -p quick-xml --precise` 试探兼容性
- 若采纳，需回归 S3 全部 E2E（`41/42/49/50/51/64`）与 SCP/SFTP XML 相关路径

**H-5（建议）**　`rsa` 漏洞的处置留痕
- 上游无补丁，属长期共知项。建议在 `deny.toml` 中以注释说明「SSH 客户端侧不构成 Marvin 攻击所需的解密 oracle」并显式 ignore；若后续关闭 russh 的 `rsa` feature，需评估 RSA 密钥用户的功能回退成本

**H-6（低成本卫生）**
- 补 `.gitattributes`：固定 `* text=auto eol=lf`，并将 `*.woff2 *.wasm *.icns *.ico *.png *.jpg *.zip *.gz` 标记为 `binary`
- `tauri.conf.json` 的 `copyright` 同步为 LICENSE 的双版权表述
- 补 `SECURITY.md`（漏洞披露渠道）；考虑补人工整理的 `CHANGELOG.md`（自动生成说明可用但不便阅读）
- 消除 `.gitignore` 注释与 `.workbuddy/memory` 实际跟踪状态的矛盾；决定 5 个未跟踪记忆日志与 2 个草稿文件的去留（**本次未代你决定**）

**H-7（环境，非产品）**　本地前端工具链
- 本地 `node_modules` 是**部分安装树**，且沙箱 broker 拒绝 `pnpm` 的 `symlink`/`mkdir`。在修复沙箱或换用非沙箱终端前，**本机 `tsc`/`vitest`/`vite build` 的结论不可采信**，一律以 CI 为准。清理建议：删除 `node_modules/` 与 `node_modules.partial-20260907/` 后在非沙箱终端重跑 `pnpm install --frozen-lockfile`

**H-8（流程）**　flake 判定方法论固化
- 本次两处结论均按「同一 SHA 跨 ref 全绿 > 失败点轮换 > UI/环境层指纹」的优先级判定，**未改动任何测试**。建议将该优先级写入团队规范，避免下次用 `retry`/`skip` 掩盖
- 附带发现：macOS BSD `grep` 不支持 `\b`、`\s`，且 BRE 下 `\|` 交替不可靠 —— 审计脚本统一改用 `grep -E` 可避免假阴性（本次已因此纠正两条误判为「0 命中」的检查）

---

## 附：本次审计执行的命令与结果（可复核）

| 命令 | 结果 |
|---|---|
| `git rev-parse --abbrev-ref HEAD` / `HEAD` | `main` / `e676bf607761a268c9fdd312e204cad3891457cb` |
| `git remote -v` | 仅 `jincaiw https://github.com/jincaiw/anySSH.git`（fetch+push） |
| `git status -sb` | `## main...jincaiw/main`，7 个 untracked |
| `git rev-list --count jincaiw/main..HEAD` | `0` |
| `git stash list` | 空 |
| `git tag --sort=-v:refname \| head -8` | `v0.14.46` … `v0.14.39` |
| `git cat-file -t v0.14.46` | `commit`（lightweight tag） |
| `git grep -nIE '^(<<<<<<<\|>>>>>>>\|=======$)'` | 零命中 |
| `git grep -nIE '(FIXME\|TODO\|HACK\|XXX)[: ]' -- src src-tauri/src tests scripts` | 2 处（已注明的占位） |
| `git ls-files -s \| awk '$1=="160000"'` | `src-tauri/vendor/FreeRDP` |
| `git submodule status` | `fatal: no submodule mapping found` |
| `git ls-tree -r -l HEAD \| sort -rn`（top blob） | 4.14 MB `ironrdp_web_bg.wasm` |
| `cargo fmt --all --check` | exit `0`，无输出 |
| `cargo clippy --all-targets -- -D warnings` | exit `0`，0 warning/error |
| `cargo test` | `303 passed; 0 failed; 0 ignored` |
| `./node_modules/.bin/tsc --noEmit`（两次） | `240 errors/exit 2` vs `0 errors/exit 0`（环境抖动） |
| `tsc --noEmit --traceResolution` | `@tauri-apps/api/core` **解析成功** |
| `pnpm install --frozen-lockfile`（干净树） | `ERR_PNPM_CODEBUDDY_BROKER_DENY`（两次，`/tmp` 与托管工作区） |
| `cargo audit --json` | exit `1`；`vulnerabilities.found = true`（5 条）；`warnings` 9 条 |
| `cargo tree -i quick-xml@0.38.4` | `aws-creds → rust-s3 → anyssh`；`plist → tauri` |
| `cargo tree -i rsa` | `russh 0.63.3`；`ssh-key 0.7.0-rc.11` |
| `cargo tree -i git2` / `-i rand@0.7.3` | 无输出（非 host 正常依赖图） |
| `gh run view 34507950622 --json jobs` | headSha `e676bf6`，7/7 job `success` |
| `gh run list -R jincaiw/anySSH` | 同 SHA 另一 ref（run 34503319961）亦 `success` |
| `gh release view v0.14.46 --json assets` | 25 资产，869.1 MB，published |
| `gh release download v0.14.46 -p latest.json` | `version: 0.14.46`，11 平台，签名 404–428 B |
| E2E/vitest 用例统计 | 74 spec / 110 `it()`；25 文件 / 181 用例；`.skip`/`.only` 均 0 |

---

# 附录（整改阶段追加，2026-09-11）

> 上面 A–H 各节是**审计当时**的现场记录，保持原样不改。以下记录随后的核实、更正与整改。凡与原结论冲突处，以本附录为准。

## 附录 A　H-4 更正：quick-xml 无法单独升级

H-4 原建议「用 `cargo update -p quick-xml --precise` 或 `[patch.crates-io]` 试探兼容性」。**以 crates.io 原始依赖元数据复核后，该建议不成立，本条由「待办」改判为「不可执行」**：

| 上游 | 版本 | `quick-xml` 约束（`kind = normal`） |
|---|---|---|
| `aws-creds` | `0.39.1`（当前最新） | `req = "^0.38"`，`features = ["serialize"]` |
| `rust-s3` | `0.37.2`（当前最新） | `req = "^0.38"`，`features = ["serialize"]` |

- `^0.38` 即 `>=0.38.0, <0.39.0`；advisory 要求的修复版本是 `>= 0.41.0`。两者**跨 semver 大版本**，Cargo 在单一依赖图上无法同时满足 ⇒ `--precise 0.41.x` 必然以版本冲突失败，这不是「需要试探」，而是确定不可行。
- `[patch.crates-io]` 指向 0.41 会让 `aws-creds` / `rust-s3` 直面 0.39→0.41 的破坏性 API 变更，编译不可能通过。
- 现实选项只剩三条：(a) 显式接受并登记（本次采纳，见 `deny.toml`）；(b) 等上游跟进；(c) 替换 `rust-s3` / `aws-creds` 为维护中的 S3 客户端 —— 属功能面改动，需单独立项。

**附带的 C-1 事实更正**（`cargo tree --target all` 实测）：`quick-xml 0.39.4` 的来源并非笼统的「非 host 目标」，而是 **proc-macro 构建期**链路：

`wayland-scanner 0.31.10 (proc-macro) → wayland-client → wayland-protocols → wayland-protocols-wlr → wl-clipboard-rs → arboard → tauri-plugin-clipboard-manager`

它解析的是随 crate 分发的 Wayland 协议 XML，既非运行期输入，也不进出货二进制。`0.38.4` 则是实打实的 host 依赖：`aws-creds → rust-s3 → anyssh` 与 `plist → tauri → anyssh`。

## 附录 B　整改登记

分支 `chore/pre-release-hardening`（基线为审计时的 `e676bf6`）。

| 提交 | 主题 | 对应发现 |
|---|---|---|
| `bb43826` | `chore: actually remove the orphaned vendor/FreeRDP gitlink` | C-4 |
| `ecd38e0` | `chore(deps): bump serialport 4.10.0 -> 4.10.1` | **本轮新发现**（附录 C-2） |
| `0ec9add` | `chore: pre-release hardening (schema guard, security policy, repo hygiene)` | 新增 DB 版本保护、H-6 三项、两处 README 过期表述 |
| `6384ab2` | `ci: gate dependency advisories with cargo-deny` | C-2、C-1、H-5 |
| `6d06d16` | `feat(security): enable a Content-Security-Policy for the webview` | C-3、H-3，并修正整改中发现的 CSP 缺陷（附录 C-1） |

产物清单：新增 `deny.toml`（11 条显式登记）、`SECURITY.md`、`.gitattributes`、`tests/e2e/specs/75-rdp-wasm-csp.spec.ts`、CI job `Advisory audit (cargo-deny)`（阻断式）；修改 `db/mod.rs`（+3 测试）、`tauri.conf.json`、`RdpCanvas.tsx`、`ci.yml`、两个 README。

## 附录 C　整改过程中新发现的缺陷

### C-1（P1，已修）　按 H-3 原方案落地 CSP 会让 RDP 彻底失效

H-3 当时只写了起步策略 `connect-src 'self' ipc: http://ipc.localhost`。按实际调用链复核后发现：

- `@devolutions/iron-remote-desktop-rdp` 把 WASM 以**内嵌 `data:application/wasm;base64,…` 常量**打包。启动路径为 `init()` → wasm-bindgen `__wbg_init` → `fetch(<data URL>)` → `WebAssembly.instantiateStreaming`。
  实证（`iron-remote-desktop-rdp.js`）：`B === void 0 && (B = kA)`（`kA` 即该 data URL），随后 `(typeof B == "string" …) && (B = fetch(B))`。
- CSP 把 `fetch()` 一个 `data:` URL 当作网络请求并按 `connect-src` 校验；`'self'` 与 `*` **均不覆盖** `data:` scheme，必须显式列出。
- 缺失时 `rdp.init()` reject → 组件落入外层 `catch` → `host.appendChild(el)`（`RdpCanvas.tsx:371`）不执行 → 查看器根本不挂载，且**无任何报错露出到 UI**。
- **原有 E2E 无法发现**：RDP 无 fixture，`74-dashboard-connections.spec.ts` 只断言卡片文案 `"RDP"`。
- 处置：`connect-src` 显式补 `data:`；新增 `75-rdp-wasm-csp.spec.ts` 作为回归护栏（既读配置、又在真实 webview 内探测并回报 `securitypolicyviolation`）。

另一处被实证的依赖：`style-src` 的 `'unsafe-inline'` 不可去掉 —— `@xterm/xterm/lib/xterm.js` 有 **4 处** `createElement("style")` + `textContent` 注入（含 `_injectCss` 主题注入与滚动条样式）。

### C-2（P2，已修）　`serialport 4.10.0` 已被 crates.io yank，且是直接依赖

- 由 `cargo deny check advisories` 的 yanked 报告暴露：`Cargo.lock` 中 `serialport 4.10.0` 已被 yank。
- 影响：`cargo update` 与全新 lock 解析的基线不再一致；直接依赖yanked 版本比升上去更糟。
- 处置：升至 `4.10.1`，`Cargo.lock` 仅 2 行变化（version + checksum），单独提交便于回退。

## 附录 D　本轮可验证 / 不可验证的边界

| 项 | 状态 | 证据 |
|---|---|---|
| `cargo fmt --all --check` | **已验证** | exit `0`，无输出 |
| `cargo clippy --all-targets -- -D warnings` | **已验证** | exit `0`，0 warning / 0 error |
| `cargo test` | **已验证** | `306 passed; 0 failed; 0 ignored`（303 + 3 新增） |
| `cargo deny check advisories` | **已验证** | exit `0`，`advisories ok`（yanked 仍以 warning 可见） |
| `tauri.conf.json` JSON 合法性与 `csp` 取值 | **已验证** | `json.load` 通过，四条关键指令逐一核对 |
| 新 E2E 用例的 TS 结构 | **部分验证** | 单文件 `tsc --strict` 无非环境性报错；剩余报错全部为本地缺失 `@wdio/globals`/`mocha`/`chai` 类型定义（既有 helper 同样如此） |
| `cargo tree -i quick-xml@0.38.4` / `@0.39.4` | **已验证** | 前者命中 `aws-creds → rust-s3`、`plist → tauri`；后者 host 图无输出，`--target all` 指向 `wayland-scanner` proc-macro |
| **CSP 生效后应用能否启动并加载 WASM** | **已验证**（见附录 E） | 4 个 E2E shard 全绿；`75-rdp-wasm-csp.spec.ts` 在真实 `wry 0.54.4 linux` webview 内 PASS |
| 远端 CI（含新 `Advisory audit` job） | **已验证**（见附录 E） | run `34562021131` @ `c3084f0`，8/8 job success，`run_attempt=1` |

未执行（按约定不得执行）：打 tag、发布 Release、推送 `main`。

## 附录 E　CI 判定结果（结论已出）

**run `34562021131`，ref `chore/pre-release-hardening`，sha `c3084f0`，event `workflow_dispatch`，`run_attempt = 1`（首次运行即绿，无重跑），耗时 9 分 03 秒。**

| Job | 结论 |
|---|---|
| Frontend (typecheck + build) | **success** |
| Advisory audit (cargo-deny) | **success**（新门禁在真实 CI 生效） |
| Rust (fmt, clippy, test) | **success** |
| Build E2E runner image | **success** |
| E2E shard 1/4 · 2/4 · 3/4 · 4/4 | **success**（4/4） |

判定依据（逐条取自 job 日志，非推断）：

- **E2E 覆盖完整**：4 个 shard 共报 **75 spec PASSED / 0 FAILED**（原 74 + 新增 1），shard 分布 19/19/19/18，`FAIL:` 与 `skipped` **均为 0 次**。
- **CSP 未破坏启动**：整套 E2E 全绿即证明应用在新策略下正常启动（本地 PTY、telnet、**VNC 像素级断言**、SFTP、S3 等既有用例全部通过），RDP 相关的三条指令按预期工作。
- **新用例真实执行而非被跳过**：`specs/75-rdp-wasm-csp.spec.ts` 被分配到 **shard 4/4**，日志含 `RUNNING … 75-rdp-wasm-csp.spec.ts → PASSED`，两条 `it` 均为 `✓`：
  - `keeps the three directives the RDP viewer depends on`
  - `instantiates the RDP WASM in the real webview (fetch data: + compile)`
  运行环境 `[wry 0.54.4 linux #0-17]` —— 即**真实 WebKitGTK webview**，`fetch(data:)` 与 `WebAssembly.instantiate` 均成功 ⇒ **`connect-src data:` 与 `script-src 'wasm-unsafe-eval'` 两条策略均被运行时证实有效**，附录 C-1 的缺陷已闭环。
- **Rust 侧独立复核**：CI 报 `test result: ok. 306 passed; 0 failed`（与本机一致）；3 个新增 DB 测试在 CI 中可见并通过：
  `db::tests::fresh_database_reaches_the_latest_schema_version ... ok`、`refuses_a_database_written_by_a_newer_build ... ok`、`accepts_a_database_at_the_latest_schema_version ... ok`。
- **依赖升级在 CI 中真实生效**：日志含 `Downloaded serialport v4.10.1`。

**范围声明**：本附录的 CI 证据属于 sha `c3084f0`。此后追加的提交**仅改动本 Markdown 文件**（`git diff --name-only c3084f0..HEAD` 可自证），代码字节与已验证 SHA 一致，故未为文档改动重跑 CI。


