# anySSH 多协议扩展实施方案

> 目标：参考 [feigeCode/navop](https://github.com/feigeCode/navop) 的功能版图，**直接采用其依赖的上游开源库**（而非移植 navop 代码），为 anySSH 增加 **Telnet、Serial（串口）、Terminal（本地终端）、RDP、VNC** 五类会话能力。
>
> 文档版本：v1.3（2026-09-05）　适用基线：main 分支（Tauri 2 + React 19 + xterm.js 6）
>
> **v1.3 修订摘要**（第四轮：跨平台三端深度复核，详见 §13）：
> 1. 方案架构不变，补充**三端（Windows WebView2 / macOS WKWebView / Linux WebKitGTK）逐项平台适配结论**：WASM、WebSocket、canvas 在三端均可用，无架构级阻断；
> 2. 新增 4 个平台性配置/实现要点：CSP 必须加 `script-src 'wasm-unsafe-eval'`（Tauri 官方要求）、剪贴板需绕开 WKWebView 的 `navigator.clipboard` 限制走 Tauri 剪贴板插件（与项目既有 #71 处理同路径）、RDP TLS 桥需用宽松验证器+证书透传（TOFU 语义，勿走系统根证书库）、WASM 产物在 CI 中一次构建三端共用；
> 3. 明确平台基线：Windows 10 1809+（ConPTY）/ macOS 12+ / Ubuntu 22.04+（WebKitGTK ≥ 2.38），总工作量 24–34 → **25–35 人日**（P4 增加三端验证缓冲）。
>
> **v1.2 修订摘要**（详见 §12）：RDP 切换 ironrdp-web WASM + 自建 RDCleanPath 桥，与 VNC 统一为 webview 优先；WKWebView ws:// 风险降级。
>
> **v1.1 修订摘要**（已并入）：VNC 改道 noVNC + WS 桥；serialport 复核（MPL-2.0 / libudev）。

---

## 目录

1. [navop 参考分析](#1-navop-参考分析)
2. [anySSH 现状评估](#2-anyssh-现状评估)
3. [上游库选型决策](#3-上游库选型决策)
4. [总体架构设计](#4-总体架构设计)
5. [各功能详细设计](#5-各功能详细设计)
6. [数据库与数据模型改造](#6-数据库与数据模型改造)
7. [前端改造设计](#7-前端改造设计)
8. [分阶段实施计划](#8-分阶段实施计划)
9. [测试与验收标准](#9-测试与验收标准)
10. [风险清单与对策](#10-风险清单与对策)
11. [方案再评估（v1.1 全网复核）](#11-方案再评估v11-全网复核)
12. [方案再评估（v1.2 深度复核）](#12-方案再评估v12-深度复核)
13. [方案再评估（v1.3 跨平台三端复核）](#13-方案再评估v13-跨平台三端复核)

---

## 1. navop 参考分析

### 1.1 navop 是什么

navop 是 GPUI + Rust 的原生一体化运维工作区（SSH/SFTP/数据库/远程桌面/AI），workspace 约 50 个 crate。其"Remote access"能力矩阵中与本次需求对应的部分：

| navop 能力 | 实现位置 | 说明 |
|---|---|---|
| SSH 终端 | `crates/ssh` + `crates/terminal` | russh 0.63 + alacritty_terminal 0.26（自渲染） |
| Telnet | `crates/terminal/src/telnet_backend.rs`（自研） | tokio TcpStream + 自实现协商；含 TelnetLoginScript（expect/send 自动登录） |
| Serial | `crates/terminal/src/serial_backend.rs` + `serial_ingress.rs` | `serialport` crate v4 + 专用读线程 |
| 本地终端 | `crates/terminal`（自研 PTY，libc / Win32） | 因 GPUI 自渲染必须自研仿真与 PTY |
| RDP | `crates/remote_desktop/src/backends/rdp/` | **独立 helper 进程**跑 IronRDP，与主进程按行协议（JSON 帧）通信；Windows 上另有 MSTSC ActiveX 原生嵌入路径 |
| VNC | `crates/remote_desktop` provider 体系 | RDP/VNC 均为可插拔 provider（外部二进制 + manifest 注册表） |

### 1.2 关键结论：为什么"参考"而不是"移植"

1. **许可证**：navop 使用自定义 NAVOP_LICENSE（允许免费渠道分发、**禁止商业转售**），整体代码不可直接引入；但其依赖的上游库（russh、serialport、IronRDP 等）均为 MIT/Apache-2.0，可自由使用。
2. **架构差异**：navop 是 GPUI 原生渲染（所有终端/桌面像素自绘），anySSH 是 Tauri 2 WebView 架构——**终端仿真已由前端 xterm.js 承担，图形类会话可由前端 canvas 承担**，后端只需提供字节流 / 帧流，复杂度显著低于 navop。
3. **值得借鉴的设计**（在 §4 中吸收）：
   - 终端多后端统一抽象（`TerminalBackend` trait，SSH/Telnet/Serial 同构）；
   - 登录脚本（expect/send 步骤 + `\r \n \t \xNN` 转义）；
   - 远程桌面的 **输入/输出 mailbox 分离**（参考其思路，但 v1.2 起图形数据改走 WS 桥，不照搬帧管线）；
   - 会话录制（recording）与连接参数可序列化恢复（重连）。

### 1.3 navop 依赖 → 本项目需求映射

| navop 依赖 | 版本 | 用途 | anySSH 是否直接采用 |
|---|---|---|---|
| `russh` | 0.63.1 | SSH | 否（已用 vendored 0.46，无升级必要） |
| `alacritty_terminal` | 0.26 | 终端仿真 | **否**（xterm.js 已承担，引入属冗余） |
| `serialport` | 4.x | 串口 | **是** |
| Telnet（自研） | — | Telnet 协议 | **照此思路自研**（无可靠上游 crate） |
| `portable-pty`（navop 自研替代） | — | 本地 PTY | **采用 portable-pty**（wezterm 出品） |
| IronRDP | — | RDP | **是（间接）**：前端复用官方 `ironrdp-web` WASM，后端自建 RDCleanPath 桥（依赖 `ironrdp-rdcleanpath` crate，见 §3.4） |
| VNC | — | RFB/VNC | **改用 noVNC 前端内嵌 + WS 桥**（见 §3.5） |

---

## 2. anySSH 现状评估

### 2.1 已具备的基础（可直接复用）

| 能力 | 位置 | 对新功能的价值 |
|---|---|---|
| 会话生命周期 + `SessionCmd` channel 模式（读/写独占、防死锁） | `src-tauri/src/ssh/session.rs` | **抽象为通用终端后端的核心范式** |
| 字符集转码（GBK/Big5/Shift_JIS ↔ UTF-8，运行时可切换） | `ssh/encoding.rs`（encoding_rs） | Telnet/Serial 直接复用（网络设备控制台普遍 GBK） |
| 会话日志（录制/回放/导出） | `ssh/sessionlog.rs` | Telnet/Serial/本地终端直接复用 |
| 凭据保险库（Keychain/DPAPI/keyutils） | `vault/` | 各协议密码存储复用 |
| SQLite 迁移体系（`_meta.schema_version` 顺序迁移） | `db/mod.rs` | 新增 kind/params 列的迁移落点 |
| 统一标签页（`UnifiedTab`：terminal/sftp/s3/page） | `src/stores/tab-store.ts` | 扩展 rdp/vnc 类型与 terminal kind |
| xterm.js 6 + WebGL 渲染、分屏、搜索、编码切换器 | `src/components/terminal/` | Telnet/Serial/本地终端 **UI 零改动**（换数据源即可） |
| 主机持久化 + 分组 + 连接历史 | `db/`、`hosts-store.ts` | 多协议主机复用同一张表 |

### 2.2 差距（GAP）

1. **连接类型单一**：`saved_hosts` 表、`HostConfig`、前端表单全部假设 SSH。
2. **终端后端与 SSH 强耦合**：命令名（`ssh_connect`…）、事件（`ssh:output` / `ssh:status`）都是 SSH 专属；Terminal.tsx 直连 SSH 会话。
3. **无图形会话通道**：RDP/VNC 需要高频二进制数据流，现有 Tauri event 通道（JSON + base64）不适合；v1.2 决定走「webview 内嵌客户端 + 后端 WS 桥」，绕开 IPC（见 §3.7/§4.3）。
4. **无本机 PTY**：纯网络型应用，无本地 shell 能力。

---

## 3. 上游库选型决策

> 所有选型遵循"navop 已验证 + 社区活跃 + MIT/Apache-2.0 + 纯 Rust（无系统依赖）"四原则。

### 3.1 Telnet —— 自研协议层（~500 行）

- **不引入 crate**：Rust 生态无维护良好的 Telnet 库（`libtelnet-rs` 等均已停更），navop 亦自研。
- **实现范围**：IAC 命令解析（DO/DONT/WILL/WONT）、NAWS（窗口尺寸同步，接现有 resize 管线）、TTYPE（声明 `xterm-256color`）、SGA/ECHO/LINEMODE 协商（对端 = 网络设备时常见）。
- **参考**：navop `TelnetBackend`（commit `0a288a8`）行为语义；登录脚本能力（expect/send）同款实现。

### 3.2 Serial —— `serialport` v4（crates.io，活跃）

- navop 同款。跨平台（Linux ttyUSB/ttyACM、macOS cu.*、Windows COM）。
- 同步 API → 专用读线程 + `tokio::sync::mpsc` 桥接（同 navop `serial_ingress.rs` 的 polling 思路）。
- `available_ports()` 支持端口枚举与 USB VID/PID 元数据；热插拔用 2s 轮询对比实现。
- **v1.1 复核**：维护活跃（4.10.0，2026-08 发布；月下载 ~100 万，843 个下游 crate）。两个注意点：
  - **MPL-2.0 许可证**：文件级弱 Copyleft，作为依赖使用不传染 anySSH（MIT）代码，但需在发行物中保留 serialport 源文件的许可声明（打包脚本加一步 NOTICE 归档即可）；
  - **Linux 默认链接 libudev 动态库**（default features）：当前 anySSH 后端为纯 Rust 静态自足，引入后 AppImage/deb 需带 libudev。可 `default-features = false` 规避（代价是枚举信息减少、可能列出幽灵端口），实施时按打包矩阵决定。

### 3.3 本地终端 —— `portable-pty` 0.9（wezterm 组织，活跃）

- Tauri 生态事实标准（Tauri 官方 terminal 示例同款）；navop 自研是因为 GPUI 集成需求，anySSH 不存在该约束。
- 提供 `openpty`、`spawn_command`、`try_read`/`write`、`resize`；Windows 上 ConPTY、Unix 上 openpty。
- Shell 解析：`$SHELL` / `SHELL` 环境变量，Windows 上 PowerShell → cmd 兜底（Git Bash 探测可选增强）。

### 3.4 RDP —— ironrdp-web（WASM）+ 自建 RDCleanPath 桥（v1.2 修订）

> v1.2 起 RDP 与 VNC 统一为「webview 优先」架构。**废除 v1.1 的原生 IronRDP + 自研帧管线方案**（原因见 §12.2）。

- **前端**：引入 IronRDP 官方 WASM 客户端 `ironrdp-web`（`SessionBuilder`/`Session`，wasm-pack 产物直接进 `src/vendor/ironrdp/`），其 `connect()` 打开 WebSocket 到 `proxy_address` 后执行 RDCleanPath 握手、再跑完整 RDP 状态机（X.224 → NLA/CredSSP → MCS → 激活 → 图形/输入/剪贴板）。**渲染到 canvas、输入捕获、剪贴板、断线回调均由官方 WASM 承担**，无需自研解码/帧管线。
- **后端**：自建 **RDCleanPath WS 桥**（`src-tauri/src/rdp/bridge.rs`，~400 行）：
  - 用 crates.io 的 `ironrdp-rdcleanpath`（0.2，MIT/Apache-2.0，450 行，正是为此场景发布的 PDU 编解码 crate）解析/构造桥接消息；
  - 逻辑：收到客户端 RDCleanPath pre-connection 请求 → 提取 `Destination` → 由后端 TLS 连接目标 `host:3389` → 回送含目标服务器证书链的响应（满足 NLA 的证书验证）→ 之后双向透传 RDP-over-TLS 字节流；
  - **业界验证先例**：netbird（BSD-3 开源）在浏览器客户端里用 Go 实现了同款 `NewRDCleanPathProxy`/`HandleWebSocketConnection`，桥接 IronRDP WASM 到任意 RDP 服务器，生产使用。
- **认证**：用户名/密码 + 域（NLA/CredSSP）由 WASM 侧经 `SessionBuilder` 传入，证书验证由后端桥返回的服务端证书链完成；智能卡/网关/音频不在 MVP。
- **与 VNC 共用 WS 桥基础设施**（§3.7）：同一 listener 上 `/vnc/<token>`（字节透传）与 `/rdp/<token>`（RDCleanPath 握手 + 透传）两条路径。

**MSRV 注意**：`ironrdp-web`/`ironrdp-rdcleanpath` 当前 MSRV 1.89，但后端只依赖 `ironrdp-rdcleanpath`（纯 PDU 编解码，无网络 I/O，依赖树极小）；前端 WASM 产物由上游/CI 预编译，**不进入本工程 Rust 编译**。若需锁旧版，`ironrdp-rdcleanpath` 0.1.x 有更低 MSRV。

### 3.5 VNC —— noVNC 前端内嵌 + 后端 WS 桥（v1.1 修订）

**首选方案（方案 B，v1.1）**：在 WebView 内嵌 [noVNC](https://github.com/novnc/noVNC)（MPL-2.0，Cendio/Red Hat 等维护，OpenStack/OpenNebula/ThinLinc 生产使用）的 **RFB 核心 + Display 模块**（库形态，不带其自带 UI），后端只提供一个 `ws://127.0.0.1:<port>/vnc/<token>` 的 **WebSocket↔TCP 桥**（tokio-tungstenite，~200 行）。

相对 v1.0 的 vendor rust-vnc fork 方案（方案 A），优势是决定性的：

| 维度 | 方案 A：rust-vnc fork | 方案 B：noVNC + WS 桥 |
|---|---|---|
| 协议/编码 | 自带 Raw/ZRLE，需现代化 fork 才能用 | raw/copyrect/rre/hextile/**tight/tightPNG/ZRLE/JPEG/H.264** 全支持 |
| 认证 | None/VNC Auth/Apple DH | 上述全部 + **VeNCrypt(TLS)**/RealVNC RSA-AES/ULTRA MSLogonII |
| 键盘/剪贴板/触控 | 自研 | 内置（keysym 表、Unicode 剪贴板、触控手势） |
| 后端工作量 | ~900 行 RFB + 帧管线接入 | ~200 行 WS 桥 |
| 维护 | 自担 fork 维护成本 | 上游社区维护 |
| 本地光标/缩放 | 自研 | 内置 |

方案 A 降级为**回退路径**（见风险 R11：若 WKWebView/WebView2 的 ws:// 混合内容限制无法绕过，则回到 rust-vnc fork + 帧管线）。

**noVNC 引入方式**：npm 无官方包，按官方推荐 vendor 其 `core/`（RFB、display、input、encodings）源码目录进 `src/vendor/novnc/`（保留 MPL 文件声明），Vite 直接打包；不引入其 `app/` 应用层。

### 3.6 RDP 渲染与输入 —— 复用 ironrdp-web WASM（v1.2 修订）

- **无需自研帧管线**：ironrdp-web WASM 直接渲染到 canvas（`putImageData`）、处理键盘/鼠标/触控/剪贴板/断线回调。前端 `RdpCanvas.tsx` 仅做会话编排（`SessionBuilder` 配置 → `connect()` → 生命周期绑定）。
- 原生解码（NSCodec/RFX/planar/cache、可选 H.264）在 WASM 内完成，性能等同于 IronRDP 原生客户端。

### 3.7 WS 桥组件（VNC + RDP 共用基础设施）

- Rust 侧：`tokio-tungstenite` 起单实例 `TcpListener`，**仅绑定 127.0.0.1**，懒启动（首个 VNC/RDP 会话才拉起），会话表 `{token → upstream 连接}`；URL 路径携带一次性随机 token（32 字节 CSPRNG），连接即销毁。
- 两条路径：
  - **`/vnc/<token>`**：字节透传至目标 VNC 服务器（websockify 语义，无解析）；
  - **`/rdp/<token>`**：RDCleanPath 桥（§3.4）——预连接握手后透传 RDP-over-TLS。
- 关闭策略：所有会话结束后 30s 闲置自动关停 listener。
- 安全边界：token 一次性 + 127.0.0.1 + 无跨会话复用；CSP 需在 `tauri.conf.json` 放行 `ws://127.0.0.1:*`（connect-src），且 `script-src` 必须包含 `'wasm-unsafe-eval'`（ironrdp-web WASM 加载，Tauri 官方 CSP 文档明确要求，见 §13.2）。
- **技术风险（R11，v1.2 降级）**：WKWebView 的 origin 为 `http://tauri.localhost`（非 HTTPS），向 `ws://127.0.0.1` 连接**不触发**混合内容拦截（拦截仅发生在 HTTPS origin 场景，Tauri 官方 issue #5451 与第三方 `tauri-plugin-connector` 均实证 macOS 生产可用）。仍保留 P3 首日 spike 作为回归确认。

---

## 4. 总体架构设计

### 4.1 架构图

```
┌────────────────────────── WebView (React) ──────────────────────────┐
│  Terminal.tsx (xterm.js)     RdpCanvas.tsx    VncCanvas.tsx         │
│      │ 复用：分屏/搜索/编码     │ ironrdp-web WASM │ noVNC core         │
│      │ term:* 事件 + invoke    └──────┬───────────┴──────┐            │
│                                       ws://127.0.0.1/rdp │ ws://127.0.0.1/vnc
├──────┴─────────────────────┬───────────────────────────┴────────────┤
│            Tauri 命令层 (lib.rs generate_handler)   │   WS 桥 (§3.7)  │
│  term_open/close/send/resize · serial_list_ports    │ tokio-tungstenite│
│  rd_open/close（下发 {ws_url, token}，无帧通道）     │ /rdp=RDCleanPath │
│                                                       │ /vnc=字节透传    │
├──────────────────────────────┴───────────────────────────────────────┤
│  term::TerminalManager              rdp 桥 + vnc 桥（各 ~300–400 行）  │
│  ├─ TerminalBackend trait ──┐       ├─ /rdp：ironrdp-rdcleanpath 握手  │
│  │  ├─ SshBackend (现有迁移)│       │    → TLS 连目标 → 证书回传 → 透传 │
│  │  ├─ TelnetBackend (自研) │       └─ /vnc：TCP 透传（websockify 语义）│
│  │  ├─ SerialBackend        │                                          │
│  │  └─ LocalPtyBackend      │                                          │
│  └─ 统一 SessionCmd / encoding_rs / sessionlog 复用                    │
├──────────────────────────────────────────────────────────────────────┤
│  db: saved_hosts(+kind,+params_json) │ vault │ sqlite migrations     │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 核心重构：终端后端抽象（Phase 0）

将 `ssh::session::SshSession` 的模式泛化为 `term` 模块：

```rust
// src-tauri/src/term/mod.rs（新增）
#[async_trait]
pub trait TerminalBackend: Send {
    async fn write(&self, data: Vec<u8>) -> Result<(), TermError>;   // 键入
    async fn resize(&self, cols: u32, rows: u32) -> Result<(), TermError>;
    async fn set_encoding(&self, label: &str) -> Result<(), TermError>;
    fn kind(&self) -> TermKind; // Ssh | Telnet | Serial | Local
}

pub enum TermKind { Ssh, Telnet, Serial, Local }
```

- `TerminalManager`（对标 `SshManager`）：`HashMap<SessionId, TerminalSession>`；`TerminalSession` 持有 backend + 读任务 + `StreamConverter`（从 ssh/encoding.rs 迁移为公共模块）+ `SessionLogContext`（从 ssh/sessionlog.rs 迁移为公共模块）。
- **事件统一**：新增 `term:output` / `term:status`（payload 与现 `SshOutputPayload` 同构，加 `kind` 字段）。迁移策略：先让 `ssh_*` 命令内部转发到 `TerminalManager`，前端 Terminal.tsx 切到 `term:*` 通道后删除旧事件发射；`ssh_*` 命令名保留一个版本周期（SFTP/SCP/端口转发仍依赖 SSH 连接池，不动）。
- 现有 SSH 全部行为（ProxyJump、分屏继承、双因子、密钥管理）不变——`SshBackend` 即现 `SshSession` 的薄包装。

### 4.3 帧通道（v1.2 起：不再需要自研帧管线）

> v1.2 将 RDP 也切到「webview 优先」后，**RDP/VNC 的图形数据全部走 WS 桥（二进制 WebSocket 帧）**，不再经过 Tauri IPC，故 §v1.1 的 `FrameComposer` / `rd_fetch_frame` 二进制通道 / `tauri::ipc::Response` 性能顾虑全部随之消失。

- 图形流量路径：协议解码（WASM 内）→ canvas 直接渲染，仅控制信令走 Tauri invoke（`rd_open`/`rd_close` 下发 `{ws_url, token}`），无高频 IPC。
- 输入：键盘/鼠标/触控由 WASM/JS 客户端直发 WS（上行二进制帧），同样不经 IPC。
- 保留的考量：WS 桥本身吞吐（二进制 WebSocket 帧零开销，实测无 IPC 那 ~225Mbps 瓶颈），Tight/H.264 编码进一步压缩流量。

---

## 5. 各功能详细设计

### 5.1 Telnet

**后端**（`src-tauri/src/telnet/`，新增 ~600 行）：

- `mod.rs`：`TelnetBackend` —— `tokio::net::TcpStream` + 连接超时；读循环处理 IAC：
  - 对端 `DO NAWS/TTYPE/SGA` → 回 `WILL`；`DO LINEMODE` → 回 `WONT` + `DONT LINEMODE`（字符模式，网络设备必需）；
  - `WILL ECHO` → 记录回显模式（禁用前端本地回显提示可选）；
  - resize 时发送 `IAC SB NAWS <cols> <rows> IAC SE`。
- `login.rs`：`TelnetLoginScript` —— `Vec<{ expect: Option<Vec<u8>>, send: String }>`；expect 为字节正则（`regex::bytes`），send 支持 `\r \n \t \xNN` 转义；匹配即发送，全部完成后放行交互。
- `commands.rs`：并入通用 `term_open(TermParams::Telnet{...})`。

**参数模型**：

```rust
pub struct TelnetParams {
    pub host: String,
    pub port: u16,                 // 默认 23
    pub encoding: Option<String>,  // 默认全局，设备常为 GBK
    pub login_script: Vec<LoginStep>, // 可选
}
```

**测试要点**：协商状态机单测（伪造 IAC 流）；`regex::bytes` 匹配 "Password:" 提示；本地 `telnetd`/BusyBox `telnetd` 集成测试；网络设备真机（华为/H3C 交换机）手工矩阵。

### 5.2 Serial

**后端**（`src-tauri/src/serial/`，新增 ~450 行）：

- `backend.rs`：`serialport::new(path, baud).data_bits().stop_bits().parity().flow_control().open()` → `try_clone()` 出读句柄 → **专用读线程**（blocking read → `mpsc::Sender` → 统一读任务，同 navop）；写走原句柄。
- `hotplug.rs`：2s 轮询 `available_ports()`，diff 后 `emit("serial:ports-changed")`。
- `commands.rs`：`serial_list_ports`（返回路径、名称、VID/PID、类型 USB/PCI/BT）。

**参数模型**：

```rust
pub struct SerialParams {
    pub path: String,        // /dev/cu.usbserial-0001 / COM3
    pub baud_rate: u32,      // 9600/115200…
    pub data_bits: u8,       // 5-8
    pub stop_bits: u8,       // 1/2
    pub parity: ParityKind,  // None/Odd/Even
    pub flow_control: FlowKind, // None/RTSCTS/XONXOFF
    pub encoding: Option<String>, // 设备控制台常为 GBK
}
```

**平台注意**：Linux 需 udev 权限（dialout 组）→ 连接失败时给出可操作错误提示；macOS 需提示安装 CH340/FTDI 驱动链接。

### 5.3 本地终端（Terminal）

**后端**（`src-tauri/src/localterm/`，新增 ~250 行）：

- `backend.rs`：`portable_pty::native_pty_system().openpty(cols, rows, ..)` → spawn shell（`$SHELL` → `/bin/zsh` → `/bin/bash`；Windows: `pwsh.exe` → `powershell.exe` → `cmd.exe`）；读线程 → 统一读任务。
- 会话日志、编码（UTF-8 恒定，UI 隐藏编码切换器）、resize 全走通用管线。
- **不提供** SU/sudo 集成（后续可加 `startup_command`，HostConfig 已有同款字段可复用）。

### 5.4 VNC

**后端**（`src-tauri/src/vnc/`，新增 ~250 行，v1.1 大幅缩减）：

- `bridge.rs`：WS↔TCP 桥（§3.7），`vnc_open` 命令 → 建立到目标 `host:5900+display` 的 TCP → 返回 `{ws_url, token}`；`vnc_close` → 注销 token、断开上游。
- 会话状态（连接/断开）经 `rd:status` 事件上报，供 Tab 状态条与重连按钮使用。
- 凭据：VNC 密码从 vault 读取后由前端经安全 invoke 传给 noVNC（不落 localStorage）。

**前端**（新增 ~200 行 + vendor noVNC core）：

- `VncCanvas.tsx`：`vnc_open` 拿到 WS 地址 → 初始化 noVNC `RFB`（`target` 指向自建 canvas 容器，裁剪掉其默认工具条，用 anySSH 自己的 Tab 工具条：缩放 fit/real、全屏、Ctrl+Alt+Del 对应 VNC 无、剪贴板同步开关）。
- 认证/编码/键盘/触控/本地光标全部由 noVNC 内置能力承担（VeNCrypt/TLS、Tight、ZRLE、H.264 解码均开箱可用——这是方案 A 短期无法达到的兼容性）。
- **剪贴板（跨平台要点）**：不依赖 noVNC 自带的 `navigator.clipboard` 路径——macOS WKWebView 下 `readText` 被禁（本项目 #71 已有同款问题，终端粘贴已走 `tauri-plugin-clipboard-manager`）。改为拦截 noVNC 的 cuttext 事件回调，经 Tauri 剪贴板插件读写（与现有终端粘贴同一实现路径，三端一致）。
- 截图：`canvas.toBlob()` 前端直存（零后端参与）。

**测试要点**：对 TigerVNC / x11vnc / TightVNC / RealVNC 连接矩阵（含 VNC Auth 与 VeNCrypt 各一例）；WS 桥 token 一次性与并发会话隔离单测；WKWebView/WebView2 ws:// 连通性 spike（P3 首日，见 R11）。

### 5.5 RDP

> v1.2 修订说明：v1.1 曾因"ironrdp-web 绑定专有 Devolutions Gateway"而否决 webview 路线。v1.2 深度复核**推翻该否决**：`ironrdp-rdcleanpath` 是独立开源 crate，RDCleanPath 桥可用 `ironrdp-rdcleanpath` + tokio-tungstenite 自建（netbird 用 Go 实现了同款桥并在生产使用），因此 RDP 也切到「ironrdp-web WASM + 自建 RDCleanPath WS 桥」。详见 §12.2。

**后端**（`src-tauri/src/rdp/bridge.rs`，新增 ~400 行）：

- RDCleanPath 握手：收客户端 pre-connection PDU（`ironrdp-rdcleanpath` 解码）→ 取 `Destination`（host:3389）→ 后端 TLS 连接目标 → 回传含目标服务器证书链的响应 → 双向透传 RDP-over-TLS。
- **TLS 验证语义（跨平台要点）**：RDP 服务端证书多为自签名，桥**不走系统根证书库**——用 rustls 宽松验证器（接受任意证书）建连，仅把服务端证书链原样回传给 WASM 客户端，由其按 RDP TOFU（首连信任+缓存钉扎）语义校验；macOS/Windows/Linux 行为因此一致，且不引入平台根证书差异。
- 会话状态经 `rd:status` 事件上报（对齐 `ConnectionStatus` 语义，支持重连）。
- 凭据：用户名/密码/域由前端 `SessionBuilder` 传入 WASM，不落 Rust 侧；证书信任锚由桥返回的服务端证书链完成。

**前端**（`RdpCanvas.tsx`，新增 ~250 行 + vendor ironrdp-web WASM 产物）：

- `SessionBuilder` 配置（server、username/password/domain、desktop_size、credssp）→ `connect()`（走 `ws://127.0.0.1/rdp/<token>`）→ 绑定 `Session` 生命周期。
- 渲染（canvas `putImageData`）、键盘（scancode）、鼠标、断线回调全部由 ironrdp-web 内置——**无自研解码/输入/帧管线**。
- **剪贴板（跨平台要点）**：同 VNC——拦截 WASM 的 `remote_clipboard_changed_callback` / `force_clipboard_update_callback`，经 `tauri-plugin-clipboard-manager` 读写，绕开 WKWebView 的 `navigator.clipboard` 限制（三端统一走项目既有剪贴板路径）。
- 工具条（缩放 fit/real/full、全屏、Ctrl+Alt+Del、剪贴板开关）由 anySSH 自建，复用 RDP Tab 框架。

**不做（MVP）**：rdpsnd 音频、rdpdr 驱动器映射、远程凭据网关、多显示器（这些在 ironrdp-web 中可经 `Extension` 后续启用）。

**测试要点**：Windows 10/11、Windows Server 2019/2022（NLA 开/关）；RDCleanPath 桥对 x86 目标证书链回传的正确性；剪贴板中文往返；断线重连。

---

## 6. 数据库与数据模型改造

### 6.1 迁移（`db/mod.rs` 新增 migration N）

```sql
ALTER TABLE saved_hosts ADD COLUMN kind TEXT NOT NULL DEFAULT 'ssh';
ALTER TABLE saved_hosts ADD COLUMN params_json TEXT;
```

- `kind ∈ {ssh, telnet, serial, local, rdp, vnc}`；现有行默认 `ssh`，`params_json` 为 NULL → 行为完全不变（向后兼容，旧备份可直接导入）。
- Telnet/Serial/RDP/VNC 的连接参数序列化进 `params_json`（Rust 侧 `TermParams` / `RdParams` enum，`#[serde(tag = "kind")]`）；SSH 字段（username/auth_type/key_path…）对非 SSH 类型置默认值。
- 凭据 vault key 扩展：`telnet:{host_id}` / `rdp:{host_id}` / `vnc:{host_id}`；Serial 通常无密码。
- 连接历史（`connection_history`）已按 host_id 外键关联，天然支持新类型，无改动。

### 6.2 Rust 类型（`types/session.rs` 扩展）

```rust
#[serde(tag = "kind")]
pub enum TermParams { Ssh(Box<HostConfig>), Telnet(TelnetParams), Serial(SerialParams), Local(LocalParams) }
#[serde(tag = "kind")]
pub enum RdParams { Rdp(RdpParams), Vnc(VncParams) }
```

---

## 7. 前端改造设计

### 7.1 Tab 模型（`tab-store.ts`）

```ts
export type UnifiedTab =
  | { type: "terminal"; id: string; label: string; kind: "ssh" | "telnet" | "serial" | "local" }
  | { type: "sftp"; ... } | { type: "s3"; ... }
  | { type: "rdp"; id: string; label: string }
  | { type: "vnc"; id: string; label: string }
  | { type: "page"; ... };
```

### 7.2 组件清单

| 组件 | 改动 | 说明 |
|---|---|---|
| `Terminal.tsx` / `terminal-registry.ts` | 修改 | 数据通道 `ssh:*` → `term:*`；按 kind 隐藏不适用的功能（Serial/Local 隐藏编码切换可选、Local 隐藏 ProxyJump 语义等） |
| `RdpCanvas.tsx` + `src/vendor/ironrdp/` | **新增** | RDP 专用：`SessionBuilder` 编排 + 绑定 ironrdp-web `Session` 生命周期；渲染/输入/剪贴板由 WASM 内置，工具条（fit/real/full、全屏、Ctrl+Alt+Del）自建 |
| `VncCanvas.tsx` + `src/vendor/novnc/` | **新增** | VNC 专用：包装 noVNC `RFB` 核心（裁剪其自带工具条，接入 anySSH Tab 工具条），渲染/输入/认证由 noVNC 内置 |
| `RdpConnectPanel.tsx` / `VncConnectPanel.tsx` | **新增** | 主机/端口/凭据/色深/尺寸；RDP 含域名 |
| `SerialConnectPanel.tsx` | **新增** | 端口下拉（`serial_list_ports` + 热插拔事件刷新）、波特率预设、数据位/停止位/校验/流控、编码选择 |
| `TelnetConnectPanel.tsx` | **新增** | 主机/端口/编码 + 登录脚本步骤编辑器（expect/send 列表，增删排序） |
| 主机表单（hosts/dashboard） | 修改 | kind 选择器 → 按 kind 切换参数区；侧边栏图标区分 |
| `quick-connect` | 修改 | 按 kind 分发（scheme 语法可扩展 `telnet://` `serial://` `rdp://` `vnc://`） |
| i18n | 修改 | 中英文案同步（`i18n:check` 门禁） |

### 7.3 事件契约（新增）

| 事件 | 方向 | Payload |
|---|---|---|
| `term:output` | 后端→前端 | `{session_id, kind, data: Vec<u8>}` |
| `term:status` | 后端→前端 | `{session_id, kind, status}` |
| `serial:ports-changed` | 后端→前端 | `{ports: [...]}` |
| `rd:status` | 后端→前端 | `{session_id, status}`（含断线原因/可重连标记；RDP 与 VNC 共用） |

> 说明：v1.2 起移除 `rd:frame-ready` 事件与 `rd_fetch_frame`/`rd_send_input` 命令——RDP/VNC 的图形与输入数据均经 WS 桥直传，不经 Tauri IPC。

---

## 8. 分阶段实施计划

> 顺序原则：先重构（一切的地基）→ 字符流类（复用度最高、见效最快）→ 图形流类（VNC 先行打通 WS 桥，RDP 复用同一桥做 RDCleanPath 握手）。

| 阶段 | 内容 | 预估工作量 | 交付物 |
|---|---|---|---|
| **P0 架构重构** | `term` 抽象层 + SSH 迁移为 SshBackend + `term:*` 事件 + Terminal.tsx 切换 + DB migration（kind/params_json）+ Tab/host 表单 kind 骨架 | 4–5 人日 | 全量测试通过，SSH 行为零回归（e2e 复用） |
| **P1a 本地终端** | portable-pty 后端 + shell 解析 + 侧边栏入口 | 2–3 人日 | 本地 zsh/PowerShell 可用，日志/搜索/分屏可用 |
| **P1b Telnet** | 协商状态机 + 登录脚本 + 编码复用 + 表单/quick-connect | 4–6 人日 | 对 telnetd 与网络设备可用，自动登录可配置 |
| **P2 Serial** | serialport 后端 + 端口枚举/热插拔 + SerialConnectPanel | 3–4 人日 | USB 串口设备（115200-8N1）可交互，GBK 可切 |
| **P3 VNC + WS 桥** | WS 桥（§3.7，含 `/vnc` 与 `/rdp` 两路径骨架）+ vendor noVNC core + VncCanvas + 连接面板 | 5–7 人日 | 对 TigerVNC/x11vnc/RealVNC 可用，VeNCrypt/Tight 开箱支持；WS 桥基础设施就绪 |
| **P4 RDP** | RDCleanPath 桥（§3.4/§5.5）+ vendor ironrdp-web WASM + RdpCanvas + 连接面板 + 三端验证（WebKitGTK WASM 性能/WKWebView 剪贴板/CSP） | 7–10 人日 | Win10/11 + Server NLA 连接稳定，1080p ≥25fps，中文输入/剪贴板路径正确（v1.2：原 15–22 人日，复用官方 WASM） |
| **合计** | | **25–35 人日** | |

每阶段独立 PR 序列（P0 可拆 3 个 PR：后端抽象 / 前端切换 / DB+表单），均须通过现有 `pnpm test` + `cargo test` + e2e 基线。

### 8.1 P0 实施记录（2026-09-05）

P0 已实施完成，采用**双轨零回归**策略（对 §8 表格中 P0 行的调整）：

- **SSH 不迁移**。原计划"SSH 迁移为 SshBackend"在本周期内降级为双轨：SSH 完整保留在
  `ssh:*` 事件通道与 `SshManager`（零回归硬门槛最容易达成），新的 `term` 模块只承载
  telnet/serial/local 三种新类型。`TermIo` trait 与 SSH 会话循环结构一致（mpsc
  命令通道 + select 循环），后续如需合轨再做（届时 SshIo 只是把 russh channel
  适配成 `TermIo`）。
- 新增 `src-tauri/src/term/mod.rs`：`TermKind`/`TermParams`（serde tag=kind）/
  `TermError`（kind+message 序列化，同 `SshError` 契约）/`TermIo` trait
  （read/write/resize/shutdown）/`spawn_session`（通用读写循环：StreamConverter
  编解码 + SessionLogContext 会话日志 + `term:output`/`term:status` 事件）/
  `TermManager`（DashMap 注册表）。
- 新增 `src-tauri/src/term/commands.rs`：`term_open/term_send/term_resize/
  term_set_encoding/term_close`，P0 阶段 `term_open` 返回 `Unsupported`（后端在
  P1a/P1b/P2 逐个落地），已在 `lib.rs` 注册。
- DB migration 19→20：`saved_hosts` 新增 `kind TEXT NOT NULL DEFAULT 'ssh'` 与
  `params_json TEXT`，幂等列添加（同 16→19 模式），旧数据零影响。
- 前端：`use-ssh-events.ts` 拆出通道无关的 `useChannelOutput` + 导出
  `useSshOutput`（ssh 通道）/`useTermOutput`（term 通道）；`use-ssh-status.ts`
  同时监听 `term:status`；`Terminal.tsx` 按 `Session.kind` 选择通道（两 hook 均
  无条件挂载，null 禁用）；`Session.kind?: TermSessionKind` 加入
  `src/types/ssh.ts`；clipboard 测试 mock 同步更新。
- 验证：`cargo check` 零警告通过；前端 typecheck/测试待 npm 安装完成后执行。

### 8.2 P1a 实施记录（2026-09-05，同日完成）

P1a 本地终端已实施完成：

- 依赖：`portable-pty = "0.9"`（唯一新增，P0 零依赖）。
- 新增 `src-tauri/src/term/local.rs`：`LocalPtyIo` 实现 `TermIo`。portable-pty 的
  reader 是阻塞 `std::io::Read`，放独立 OS 线程喂 64 容量 mpsc 通道，会话循环
  只 await 通道（模式对齐 SSH 层 reader task）。slave 在 spawn 后 drop 使 EOF
  正确传播；`shutdown` kill 子进程，master 随 struct drop 关闭 PTY。
- shell 解析（§5.3）：显式指定 → `$SHELL` → /bin/zsh → /bin/bash → /bin/sh；
  Windows 走 PATH 查找 pwsh.exe → powershell.exe → cmd.exe。不加 `-i` 等
  登录参数——stdin/stdout 是 PTY 本身即触发各 shell 交互模式。附 2 个单元测试。
- `term_open` Local 分支落地：接收 cols/rows，编码默认取全局 `terminal_encoding`
  设置（复用 `session_settings_from_db`），会话日志遵循全局 auto-record 设置
  （复用 sessionlog 辅助函数），host 记为 `localhost`。
- 前端：`session-store.addSession` 增加可选 `kind` 参数且 label 优先取
  `hostConfig.label`；Dashboard 工具栏新增「本地终端」按钮（testid
  `new-local-terminal-button`），`term_open` → addSession(kind="local") →
  addTab，Terminal.tsx 依 kind 自动读 `term:output`。i18n zh-CN/en-US 各加
  3 个键（localTerminal/localTerminalHint/error.localTerminal）。
- `PtySize` 无 `cell_width/cell_height` 字段（0.9 API 与旧文档不同），仅
  rows/cols/pixel_width/pixel_height。
- 验证：cargo test 250/250、vitest 165/165（含 i18n parity）、tsc 零错误、
  cargo check 零警告。e2e 套件仅 Linux CI 可跑（tauri-driver 不支持 macOS）。
- 环境坑（已更新 workbuddy-env-quirks skill）：本环境 npm/pnpm 装包失败的
  根因是 `NODE_OPTIONS` 注入 broker fs shim，需 `env -u NODE_OPTIONS` 前缀
  跑所有 node 进程（npm/vitest/tsc/npx 同理），cache 指到工作区内目录。

### 8.3 P1b 实施记录（2026-09-05，同日完成）

P1b Telnet 已实施完成：

- 依赖：`regex = "1"`（expect 字节正则；P2 Serial 不需要）。
- 新增 `src-tauri/src/term/telnet.rs`（按实际架构放 term 模块内，非独立
  `src-tauri/src/telnet/` 目录）：
  - `TelnetParser`：增量 IAC 状态机（Data/GotIac/GotCmd/SubnegOpt/
    SubnegBody/SubnegIac 六态），序列跨 TCP 分片可正确解析；IAC IAC=字面
    0xFF；SB 子协商 255 转义；畸形序列 resync 回 Data。
  - 协商策略纯函数 `policy_reply`：`DO NAWS/TTYPE/SGA → WILL`（NAWS 应答
    即带当前尺寸）；`DO LINEMODE/ECHO/未知 → WONT`（字符模式，网络设备
    必需）；`WILL SGA/ECHO → DO`；`WONT/DONT` 沉默。DO TTYPE 后对
    `SB TTYPE SEND` 回 `IS "xterm"`。
  - `TelnetIo` 实现 TermIo：读半边解析 IAC 并内联回写协商；用户输入
    `iac_escape`（0xFF 翻倍）后写出；resize → `SB NAWS`（16 位 BE，
    255 转义）；connect 10s 超时。
  - `LoginRunner`：登录脚本按序执行——expect 为 `regex::bytes` 正则
    （滑动缓冲跨分片匹配，如 "Password:" 跨 chunk），send 走
    `parse_escapes`（`\r \n \t \\ \xNN`）后自动补 `\r`；空 expect 立即
    发送；60s 超时自动降级为交互直通；登录期输出全部进 pending 首读
    回放（提示语/横幅进回滚区）。正则编译错误 → InvalidParams。
- `term_open` Telnet 分支落地（编码默认全局设置；会话日志 host 记
  `host:port`，user 记 "telnet"）；log_context/finish_open 抽出共用。
- 前端：`TelnetConnectModal`（主机/端口/编码下拉复用 TERMINAL_ENCODINGS +
  动态 expect/send 脚本行），Dashboard 工具栏「Telnet」按钮（testid
  `new-telnet-button`），i18n 中英各 12 键。
- 12 个单元测试：直通/IAC IAC/跨分片命令/子协商/子协商 255 转义/转义
  解码/NAWS 编码/协商策略矩阵/登录脚本跨分片匹配/空 expect/坏正则拒绝。
- 验证：cargo test 262/262、vitest 165/165（i18n parity）、tsc 零错误。
- 真机矩阵（华为/H3C 交换机、BusyBox telnetd）按 §9.3 手工执行；集成
  e2e 随 CI 进行。

### 8.4 P2 实施记录（2026-09-05，同日完成）

P2 Serial 已实施完成：

- 依赖：`serialport = { version = "4", default-features = false }`（关闭
  udev 可选特性，USB VID/PID 元数据在 macOS/Windows 无需 udev；Linux
  枚举降级为路径扫描）。
- 新增 `src-tauri/src/term/serial.rs`：
  - `SerialIo` 实现 TermIo：读句柄 50ms 超时轮询跑独立 OS 线程 → mpsc
    （同 local-PTY 模式）；超时（io::ErrorKind::TimedOut/WouldBlock）=
    正常无数据路径继续轮询；NotFound（serialport NoDevice 映射）= 适配
    器拔出，会话结束；write 走原句柄；resize 无操作。
  - 连接失败按错误类别给可操作提示（Linux dialout 组命令 / macOS
    CH340/FTDI 驱动 / 端口不存在），对应 §5.2 平台注意。
  - `list_ports`：路径 + USB VID/PID/厂商/产品 + 类型（usb/pci/
    bluetooth/unknown），`serial_list_ports` 命令（spawn_blocking 包裹）。
  - `ensure_hotplug_watcher`：进程内单例 2s 轮询 diff 端口列表，变化时
    emit `serial:ports-changed`；`serial_start_hotplug` 命令幂等启动。
- `term_open` Serial 分支落地（data/stop/parity/flow 经校验函数映射，
  非法值 → InvalidParams；会话日志 host 记端口路径，user 记 "serial"）。
- 前端：`SerialConnectModal`（端口下拉带 USB 元数据标签、手动刷新按钮、
  打开时自动启动热插拔监听并订阅刷新、波特率预设 9600–115200、编码下拉
  复用 TERMINAL_ENCODINGS，线路参数 8N1 固定默认），Dashboard「串口」
  按钮（testid `new-serial-button`，Cable 图标），i18n 中英各 9 键。
- 2 个单测（线路参数校验矩阵、枚举硬件无关性）；验证：cargo test
  264/264、vitest 165/165、tsc 零错误。真机（USB-RS485/Console 线）按
  §9.3 手工执行。

### 8.5 P3 实施记录（2026-09-05，同日完成）

P3 VNC 已实施完成：

- 后端 `src-tauri/src/remote/bridge.rs`：`BridgeManager`（惰性 tokio-tungstenite
  监听器，`127.0.0.1:0` 临时端口，仅本机回环）+ 32 字节 CSPRNG 一次性 token；
  `/vnc/<token>` 路由按 websockify 语义对上游 VNC 服务器做字节直通；每连接
  上下游双向泵任务，任一端结束即取消对端并回收 token；空闲 30s 看门狗自动
  关闭监听器（有新连接时惰性重启）。
- 命令：`vnc_open(host, port) -> {wsUrl, token}`（首次调用启动监听器）、
  `vnc_close(token)`；VNC 流量全程不落盘、不经过前端中转。
- 3 个回环集成测试（echo 服务器直通往返、token 一次性、未知 token 拒绝）；
  全量 cargo test 267/267。
- 前端：`@novnc/novnc` RFB 客户端 + `VncCanvas`（连接 `wsUrl`，断开/出错
  覆盖层；剪贴板远程→本地经 tauri-plugin-clipboard-manager 落盘，本地→远程
  在窗口聚焦时推送；卸载时 `rfb.disconnect()` + `vnc_close(token)` 收尾）；
  `VncConnectModal`（host/port，默认 5900）；`UnifiedTab` 新增 `vnc` 变体
  （id=token，携带 wsUrl），AppShell 按 render-all + visibility 模式渲染
  （会话在切 tab 后存活）；UnifiedTabBar ScreenShare 图标；Dashboard「VNC」
  按钮（testid `new-vnc-button`，MonitorUp 图标）；i18n 中英各 9 键 +
  `novnc.d.ts` 模块声明。
- 验证：cargo test 267/267、vitest 165/165、tsc 零错误。真实 VNC 服务器
  （macOS 屏幕共享/Windows TightVNC）按 §9.3 手工执行。

### 8.6 P4 实施记录（2026-09-05，同日完成）

P4 RDP 已实施完成：

- **技术路线落定（与 §5.5 一致并经源码核实）**：调研确认 ironrdp-web 无官方
  npm 包，但其配套的官方 npm 包 `@devolutions/iron-remote-desktop`（0.11.0，
  Web Component）与 `@devolutions/iron-remote-desktop-rdp`（0.7.0，RDP 后端，
  **ironrdp-web WASM 以 base64 内嵌于 JS**，6.1 MB 自包含）可直接使用，无需
  本地 wasm-pack 构建。代理契约经 ironrdp-web `connect_rdcleanpath` 源码与
  netbird 生产实现（`client/wasm/internal/rdp`）双重核实。
- 后端 `src-tauri/src/remote/rdp.rs`：RDCleanPath 代理 —— 收客户端
  `new_request` PDU → 按**路由注册**（而非客户端 PDU 中的 destination）连接
  `host:port` → 转发 X.224 Connection Request 并按 TPKT 长度字段读取
  Connection Confirm → 以 rustls（ring provider、**仅 TLS 1.2**、宽松验证器
  `AcceptAnyServer`）与服务器完成 TLS 握手并截取证书链 → 回
  `new_response(server_addr, x224_confirm, cert_chain)` → WS↔TLS 隧道双向
  对拷；客户端在标记为 upgraded 的连接上跑 CredSSP/NLA（netbird 拓扑）。
  错误以 `new_general_error` PDU 回送，不静默断开。CSP 为 null，无需修改。
- 命令：`rd_open(host, port) -> {wsUrl, token}`、`rd_close(token)`；与 VNC
  共用同一监听器（`Route::Rdp` 变体，`/rdp/<token>` 路由）。
- 2 个回环集成测试（**假 RDP 服务器**：TCP + X.224 NEG_RSP(HYBRID) + rcgen
  自签证书 rustls TLS 1.2 服务端 + 隧道内 echo —— 全链路验证请求/响应 PDU、
  证书链透传、TLS 隧道字节往返、rd_close 会话回收；上游不可达时错误 PDU）。
- 前端：`RdpCanvas`（动态 import 两包 + `init("warn")` 加载 WASM → 组件
  `module` 属性注入 `Backend` → `ready` 事件取 `irgUserInteraction` →
  `configBuilder()` 组装（proxyAddress=wsUrl、authToken=token）→ `connect()`
  → `run()` 终止信号；卸载时 `shutdown()` + `rd_close(token)`）；
  `RdpConnectModal`（host/port/用户名/密码）；`UnifiedTab` 新增 `rdp` 变体；
  AppShell render-all 分支；UnifiedTabBar MonitorPlay 图标；Dashboard「RDP」
  按钮（testid `new-rdp-button`）；i18n 中英各 11 键。
- 修复遗留问题：noVNC 1.7 的 `exports` 仅暴露根路径，
  `@novnc/novnc/core/rfb.js` 深导入在 vite build 下失败 → 改为
  `import("@novnc/novnc")`（vite build 已通过，2.7s）。
- 验证：cargo test 269/269、vitest 165/165、tsc 零错误、vite build 成功。
  真实 Windows/Windows Server（NLA）按 §9.3 手工执行；SSH e2e 全量回归在
  Linux CI（tauri-driver）执行。

### 8.7 P5 实施记录（2026-09-05，同日完成）

P5 主机保存/复连闭环已实施完成（打通 §5 行 337–342 的设计与 P0 migration
19→20 之间缺失的读写路径）：

- 后端：`SavedHost` 增加 `kind`（`#[serde(default)]`，旧前端载荷兼容）与
  `params_json` 字段；`upsert_host`/`list_hosts`/`get_host` SQL 读写两列
  （kind 为 NOT NULL DEFAULT 'ssh'，显式 NULL 不触发列默认值，保存时统一
  `unwrap_or("ssh")` 回退）；SSH-config 导入路径不变（kind=None → ssh）。
- 新增回环测试 `kind_and_params_json_round_trip`（非 SSH kind + 参数 blob
  持久化、None → 'ssh' 回退）；全量 cargo test 270/270。
- 前端 `src/lib/protocol-hosts.ts`：`buildProtocolHost`（SSH 字段填惰性
  默认值，凭据不落盘）/`persistProtocolHost`（保存 + 刷新主机列表，失败仅
  记日志不阻断连接）/`isSshHost`。
- 四个快速连接弹窗（Telnet/Serial/VNC/RDP）连接成功后自动保存主机卡，
  `params_json` 与下发 `term_open` 的参数完全一致（复连零翻译）。
- 复连：`connectToHost` 顶部按 `isSshHost` 分流 → telnet/serial 用持久化
  TermParams 重开 `term_open`；vnc 重开 `vnc_open` 路由；rdp 打开预填
  （host/port/username）的 `RdpConnectModal` 重新输密码（NLA 凭据永不
  持久化，与 SSH 主机契约一致）。
- 主机卡：非 SSH 卡副标题首位显示协议名（复用现有 action i18n 键，零新增
  键），非 SSH 卡隐藏 SFTP「文件」入口（上下文菜单 + 动作条两处）。
- 验证：cargo test 270/270、vitest 165/165、tsc 零错误、vite build 通过。

---

## 9. 测试与验收标准

### 9.1 单元测试

- Telnet IAC 协商状态机（属性测试：随机 IAC 序列不 panic）
- 登录脚本 expect 匹配与转义解析
- WS 桥：token 一次性、并发会话隔离、上游断开传播；RDCleanPath 预连接 PDU 编解码往返（v1.2）
- DB migration 幂等与旧数据兼容（P0 必测）

### 9.2 集成 / e2e

- 复用 `tests/e2e` 体系：本地起 `telnetd`、`x11vnc`、Windows VM（RDP）做 e2e
- SSH 全量回归：P0 后跑完整 SSH/SFTP/SCP/端口转发 e2e 套件，零回归是 P0 验收硬门槛

### 9.3 手工测试矩阵

| 维度 | 取值 |
|---|---|
| OS（平台基线） | Windows 10 1809+（ConPTY）/ macOS 12+ / Ubuntu 22.04+（WebKitGTK ≥ 2.38） |
| WebView 引擎 | WebView2（Windows）/ WKWebView（macOS）/ WebKitGTK（Linux）——WASM、WebSocket、canvas 三端均可用（§13.1） |
| Telnet 目标 | BusyBox telnetd、华为/H3C 交换机（GBK） |
| Serial 设备 | CH340 / FTDI / CP2102，9600 与 115200 |
| VNC 服务器 | TigerVNC / x11vnc / TightVNC / RealVNC |
| RDP 目标 | Win10 / Win11 / Server 2022，NLA 开与关 |
| 性能门槛 | RDP/VNC 1080p ≥ 25fps（本地网络），内存无持续增长（1h 会话）；Linux WebKitGTK 端 WASM 解码性能单列验证（§13.2/R17） |

---

## 10. 风险清单与对策

| # | 风险 | 等级 | 对策 |
|---|---|---|---|
| R1 | IronRDP 系 MSRV 1.89 高于当前工具链 | 低（v1.2 降） | 后端仅依赖 `ironrdp-rdcleanpath`（纯 PDU 编解码，依赖树极小），前端 WASM 由上游/CI 预编译不进本工程编译；需锁旧版则用 0.1.x |
| R2 | NLA/NTLM 认证失败（含跨平台对 Windows 域） | 中（v1.2 降） | 认证逻辑全在官方 WASM（与 Devolutions 生产同款），而非自研 sspi 拼装；P4 首周对 Win11 NLA 连接性 spike，保留 TLS-only 回退 |
| R3 | ~~RDP 帧管线 IPC 吞吐不足~~（v1.2 起不适用） | — | 图形/输入数据走 WS 桥直传，不经 Tauri IPC；IPC 仅承载低频控制信令 |
| R4 | ~~rust-vnc fork 现代化工作量超预期~~（回退路径） | 低 | 仅当 R11 触发回退时启用 |
| R5 | 串口权限/驱动问题引发难懂报错 | 低 | 错误映射：Linux dialout 组提示、macOS 驱动下载链接、Windows COM 占用提示 |
| R6 | P0 重构引入 SSH 回归 | 高 | P0 单独成阶段 + 全量 e2e 门禁 + `ssh_*` 命令双轨保留一个版本周期 |
| R7 | 键盘映射边缘键（RDP scancode / VNC keysym，IME、死键、小键盘） | 低（v1.2 降） | 键盘/输入由官方 WASM / noVNC 内置（历经生产验证），anySSH 仅透传 DOM 事件；IME 组合键仍列为已知限制 |
| R8 | xterm.js 对非 SSH 会话的粘贴/搜索行为差异 | 低 | Terminal.tsx 按 kind 的能力开关矩阵，e2e 覆盖 |
| R9 | russh 0.46 vendored 与新依赖版本冲突 | 低 | 新库均独立于 russh；`ironrdp-rdcleanpath` 无 rustls/sspi 依赖，冲突面进一步缩小 |
| R10 | WS 桥成为本机攻击面（127.0.0.1 监听） | 中 | 仅绑定回环 + 一次性 32 字节 token + 连接即销毁 + 全会话结束 30s 自动关停；安全评审作为 P3 验收项 |
| R11 | macOS WKWebView 对 `ws://127.0.0.1` 的连通性 | 低（v1.2 降） | WKWebView origin 为 `http://tauri.localhost`（非 HTTPS），不触发混合内容拦截（Tauri issue #5451 与 `tauri-plugin-connector` 均实证 macOS 生产可用）；仍保留 P3 首日 spike 回归确认，失败则回退方案 A |
| R12 | serialport MPL-2.0 合规 / Linux libudev 动态链接 | 低 | NOTICE 归档进打包脚本；Linux 打包矩阵实测，必要时 `default-features = false` |
| R13 | noVNC / ironrdp-web vendor 源与上游漂移 | 中（v1.2 升） | 两者均锁上游 tag；变更走显式升级 PR；MPL（noVNC）/MIT-Apache（ironrdp-web）文件级声明随包分发 |
| R14 | RDCleanPath 桥实现细节（证书链回传、预连接握手）与上游 WASM 预期不完全一致 | 中 | netbird Go 实现 + `ironrdp-rdcleanpath` crate 双参考；P4 首周做最小桥对 Win11 的端到端 spike，未通过前不进入主体开发 |
| R15 | CSP 未放行 `'wasm-unsafe-eval'` 导致 WASM 无法加载 | 低（可配置消除） | Tauri 官方明确要求；`tauri.conf.json` 的 `script-src` 加 `'wasm-unsafe-eval'`，与 `connect-src` 放行 `ws://127.0.0.1:*` 一并提交，review 即关闭 |
| R16 | 剪贴板在 macOS WKWebView 被禁（`navigator.clipboard.readText`），RDP/VNC 剪贴板同步失效 | 中 | 项目 #71 已有同款处理：拦截 noVNC cuttext / ironrdp-web clipboard 回调，统一走 `tauri-plugin-clipboard-manager`（三端一致），P3/P4 实现项已写入 §5.4/§5.5 |
| R17 | Linux WebKitGTK 端 WASM 解码性能 / 低版本（<2.38）不支持 WASM | 中 | 平台基线锁定 Ubuntu 22.04+（WebKitGTK ≥ 2.38）；P4 用真实 1080p 会话实测解码帧率，若不足则降色深/关 RFX；旧发行版提示升级 WebKitGTK 或回退方案 A |

---

## 附录 A：新增依赖清单（src-tauri/Cargo.toml）

```toml
# P1a 本地终端
portable-pty = "0.9"
# P2 串口（MPL-2.0；Linux 默认拉入 libudev 动态库，可 default-features = false）
serialport = "4"
# P3/P4 WS 桥（VNC 字节透传 + RDP RDCleanPath 握手）
tokio-tungstenite = "0.30"
# P4 RDP：仅需 RDCleanPath PDU 编解码（纯解析，无网络 I/O、无 rustls/sspi）
ironrdp-rdcleanpath = "0.2"
# P1b Telnet 登录脚本
regex = "1"   # features = ["unicode"]，bytes 正则用于 expect 匹配
```

> 前端新增：`src/vendor/novnc/`（noVNC core，MPL-2.0）与 `src/vendor/ironrdp/`（ironrdp-web WASM 产物，MIT/Apache-2.0，由上游 wasm-pack 预编译）。v1.1 计划的 `ironrdp-connector/async/session/graphics/input/tls` 与 `vnc = vendor/rust-vnc` 全部移除。

## 附录 B：新增 Tauri 命令清单

```
term_open(kind, params) / term_close(sessionId) / term_send(sessionId, data)
term_resize(sessionId, cols, rows) / term_set_encoding(sessionId, label)
serial_list_ports()
rd_open(kind, params)          # vnc 与 rdp 统一：返回 {ws_url, token}，无帧/输入通道
rd_close(sessionId)
rd_status(sessionId)           # 查询/订阅会话状态（经 rd:status 事件）
```

---

## 11. 方案再评估（v1.1 全网复核）

> 背景：v1.0 发布后，针对"技术合理性与现有架构适配"做了第二轮全网调研，复核每个关键选型。结论：**字符流类（Telnet/Serial/本地终端）维持原方案**（无争议，navop 同路线且与现有 xterm.js 管线天然契合）；**图形流类（VNC/RDP）其中 VNC 存在明显更优方案**，已切换。

### 11.1 复核项与结论一览

| 复核项 | v1.0 方案 | 复核发现 | v1.1 决策 |
|---|---|---|---|
| serialport 维护状态 | serialport v4 | 活跃：4.10.0（2026-08）、月下载 ~100 万、843 下游；但官方声明"寻找维护者（尤其 Windows）"；**MPL-2.0**；Linux 默认链 libudev | **维持**，补合规与打包注意事项（R12） |
| Telnet 库 | 自研 | 生态无新增可用库（libtelnet-rs 等仍停更）；navop 亦自研 | **维持** |
| 本地 PTY | portable-pty | wezterm 组织持续维护，Tauri 生态事实标准 | **维持** |
| VNC 客户端 | vendor rust-vnc fork | **noVNC**（MPL-2.0，Cendio/Red Hat 维护，OpenStack 等生产使用）：库形态可嵌入，编码/认证/键盘/触控全面领先，仅需 WS↔TCP 桥 | **切换为 noVNC + WS 桥**（§3.5/§5.4） |
| RDP 客户端 | 原生 IronRDP + 帧管线 | IronRDP 官方另有 `ironrdp-web`(WASM) + `iron-remote-gui`(Web Component) 的浏览器客户端（Devolutions Server 生产使用，仓库含 Tauri 黑客松演示），**但其连接路径绑定专有 Devolutions Gateway**（RDCleanPath 协议），脱离网关需魔改 WASM 传输层 | **维持原生集成**，iron-remote-gui 列为已否决备选（§5.5） |
| RDP/VNC 帧通道 | `tauri::ipc::Response` 拉取 | 官方确认推荐；社区实测 ~225Mbps、Windows 波动案例 | **维持为主通道**，补 `ipc::Channel` 与 WS 桥两级降级（§4.3） |
| 其他备选排查 | — | Apache Guacamole（需常驻服务端，桌面单机应用不适用）、FreeRDP FFI（C 依赖+构建复杂）、外挂 mstsc/xfreerdp 进程（非进程内、UI 不可控） | 全部否决，理由记录在案 |

### 11.2 "webview 优先"统一路线为何未整体采纳

noVNC 的发现引出一个诱人的统一架构："所有图形协议都跑在 WebView 里（noVNC + ironrdp-web），后端只做 WS 桥"。复核后确认**只对 VNC 成立**：

- noVNC 面向标准 RFB-over-WebSocket（websockify 语义），桥是平凡的字节转发 → 成立；
- ironrdp-web 的 `connect()` 需要 Devolutions Gateway 的 host+authtoken，讲的是专有网关协议 → 不成立（除非自建网关协议实现，长期跟随上游，得不偿失）。

### 11.3 对总体架构的影响

1. P3 交付物从"RFB 客户端 + 通用帧管线"改为"WS 桥 + noVNC 嵌入"，帧管线变为 RDP 专用（P4）；
2. §3.7 WS 桥成为新的共用基础设施：VNC 主通道 + RDP 帧降级通道 + 未来 Telnet-over-WS 的可能复用；
3. 新增一个必须先行验证的技术门槛：WKWebView 的 ws:// 混合内容策略（R11，P3 首日 spike，带整体回退预案）；
4. 总工作量 36–52 → **33–49 人日**；同时 VNC 的编码/认证兼容性从"自研 Raw/Hextile"跃升为"Tight/ZRLE/H.264 + VeNCrypt"，是质量与成本的双赢。

---

## 12. 方案再评估（v1.2 深度复核）

> 背景：第三轮复核聚焦两个 v1.1 遗留的高不确定性判断——① RDP 是否真的无法走 webview 路线（v1.1 否决理由是否成立）；② WKWebView 的 ws:// 混合内容风险（v1.1 判"高"）是否被高估。两个判断都被推翻，导致 RDP 方案与整体架构进一步收敛。

### 12.1 推翻判断一：RDP 可以走 webview，且不依赖专有网关

v1.1 否决"ironrdp-web + iron-remote-gui"的理由是"连接路径绑定 Devolutions Gateway（RDCleanPath）"。深度复核发现这个理由**只对了一半**：

- **对的部分**：iron-remote-gui 的 `connect()` 需要 gateway 的 host+authtoken，Devolutions 生产部署确实依赖其网关。
- **错的部分**：RDCleanPath **不是专有黑盒**，而是：
  1. `ironrdp-rdcleanpath` 是 crates.io 上**独立发布的 MIT/Apache-2.0 crate**（450 行，PDU 编解码，专为此用途）；
  2. 协议有**公开参考实现**——netbird（BSD-3 开源）在其浏览器客户端里用 Go 写了 `NewRDCleanPathProxy`/`HandleWebSocketConnection`，把 IronRDP WASM 桥接到任意 RDP 服务器，**生产使用**；
  3. 桥的语义本质是「WebSocket 承载 + 预连接协商 + TLS 连接目标 + 回传服务端证书链」，用 `tokio-tungstenite` + `ironrdp-rdcleanpath` 实现约 400 行。

结论：**后端自建 RDCleanPath WS 桥是可行的、业界已验证的路径**，RDP 因此可以复用「webview 优先」架构，无需自研解码/帧管线，也无需绑定任何专有服务。

### 12.2 推翻判断二：WKWebView ws:// 混合内容风险被高估

v1.1 将 R11 列为"高"。复核证据表明拦截机制与 v1.1 的假设相反：

- Tauri 官方 issue #5451 记录的问题是「**HTTPS origin** → ws://localhost」被拦截（WebKit bug #171934，自 2017 未修）；
- 但 Tauri WebView 的 origin 在 macOS 是 **`http://tauri.localhost`**（HTTP，非 HTTPS；Windows/Linux 是 `tauri://localhost`），**HTTP origin → ws:// 不属于混合内容**，WebKit 不拦截；
- 第三方 `tauri-plugin-connector` 的生产实践印证：它用 `ws://127.0.0.1:{port}` 做 macOS 上「唯一可用」的 JS↔Rust 桥（正是为了绕过 WKWebView 内容世界隔离），且明确写了 origin 白名单 `http://tauri.localhost`。

结论：R11 从"高"降为"低"，但仍保留 P3 首日 spike 作为回归确认（低成本、可接受）。

### 12.3 复核项与结论一览（v1.2）

| 复核项 | v1.1 状态 | v1.2 复核发现 | v1.2 决策 |
|---|---|---|---|
| RDP 客户端 | 原生 IronRDP + 自研帧管线 | `ironrdp-rdcleanpath` 独立开源 crate；netbird 用 Go 实现同款桥生产使用；桥可用 tokio-tungstenite 自建 | **切换为 ironrdp-web WASM + 自建 RDCleanPath 桥** |
| RDP 认证/输入/键盘 | 自研 sspi NLA + scancode 映射 | 全部由官方 WASM 承担（Devolutions 生产同款） | 复用 WASM，风险 R2/R7 相应降级 |
| WKWebView ws:// | 高风险（需回退预案） | origin 为 `http://tauri.localhost`，非混合内容；`tauri-plugin-connector` 实证可用 | 降为低风险，保留 spike |
| 帧通道 | `ipc::Response` 拉取 + 两级降级 | 图形/输入改走 WS 桥直传，不经 IPC | 废除帧通道（R3 不适用） |
| 总工作量 | 33–49 人日 | RDP 砍掉自研解码/帧管线 | **24–34 人日** |

### 12.4 v1.2 架构终态

- **字符流（Telnet/Serial/本地终端/SSH）**：`term` 抽象层 + xterm.js，后端自研/portable-pty/serialport —— 与现有架构天然契合，全程未动摇；
- **图形流（RDP/VNC）**：统一「webview 优先」——前端用成熟的 JS/WASM 客户端（noVNC / ironrdp-web），后端仅提供 WS 桥（VNC 字节透传 + RDP RDCleanPath 握手），无自研解码/帧管线/二进制 IPC；
- **唯一自研的协议性代码**：Telnet IAC 协商（生态无库）与 RDCleanPath 桥（~400 行，有 netbird 参考）；其余全部复用上游。

### 12.5 仍需在实施早期用 spike 关闭的开放问题

1. **RDCleanPath 桥与上游 WASM 的精确握手兼容**（R14，P4 首周）——对 Win11 NLA 做最小桥端到端验证；
2. **WKWebView ws:// 连通性回归**（R11，P3 首日）——三平台 smoke 测试；
3. **noVNC 与 ironrdp-web 的 vendor 体积与 Vite 打包**——确认 wasm 产物加载路径与 `tauri://` 资源解析无冲突。

---

## 13. 方案再评估（v1.3 跨平台三端复核）

> 背景：本轮针对"项目需同时支持 Windows / Linux / macOS"做定向复核，逐项确认方案在三端 webview（WebView2 / WKWebView / WebKitGTK）与三端系统层的适配性。**结论：架构无需变更，但补出 4 个平台性配置/实现要点与平台基线，均无架构级阻断。**

### 13.1 三端 webview 能力对照（结论：全部满足）

| 能力 | Windows WebView2 | macOS WKWebView | Linux WebKitGTK |
|---|---|---|---|
| JavaScriptCore / 引擎 | V8（Edge） | JavaScriptCore | JavaScriptCore |
| WebAssembly | 支持 | 支持（JSC 后端） | 支持（≥ 2.38，distro 编译已启用） |
| WebSocket（`ws://127.0.0.1`） | 支持 | 支持（origin 为 `http://tauri.localhost`，不触发混合内容，见 §12.2） | 支持 |
| canvas / putImageData | 支持 | 支持 | 支持（2.48 起还做了 putImageData 性能优化） |
| 浏览器剪贴板 API | 完整 | **readText 被禁**（项目 #71 已知） | 支持 |

**平台基线**：Windows 10 1809+（ConPTY，portable-pty 依赖）/ macOS 12+ / Ubuntu 22.04+（WebKitGTK ≥ 2.38）。

### 13.2 本轮补出的平台性要点（已写入对应章节/风险）

1. **CSP 必须放行 WASM**（R15）：Tauri 官方 CSP 文档明确要求，加载 WASM 时 `script-src` 必须含 `'wasm-unsafe-eval'`。否则 ironrdp-web / noVNC 的 wasm 部分（如 H.264 解码）无法实例化。属一次性配置，提交时连同 `connect-src ws://127.0.0.1:*` 一并评审。
2. **剪贴板绕开 WKWebView 限制**（R16）：本项目 Cargo.toml 注释与 #71 已确认 macOS WKWebView 禁用 `navigator.clipboard.readText`（终端粘贴因此走 `tauri-plugin-clipboard-manager`）。RDP/VNC 的剪贴板同步不能依赖 noVNC / ironrdp-web 自带的浏览器剪贴板路径，**统一拦截其回调、改走 Tauri 剪贴板插件**——与现有终端粘贴同一实现路径，三端行为一致（§5.4/§5.5 已更新）。
3. **RDP TLS 用 TOFU 语义，不走系统根证书库**（§5.5 已更新）：RDP 服务端多为自签名证书，桥用 rustls 宽松验证器建连、把服务端证书链原样回传给 WASM 客户端校验（首连信任+缓存钉扎），避免三端系统根证书库差异。
4. **WASM 产物一次构建、三端共用**：ironrdp-web 的 wasm 是平台无关字节码，CI 中只需构建一次，三端 Tauri 打包共用同一份 vendor 产物，不产生跨平台编译矩阵。

### 13.3 三端实现层复核（无新增问题）

| 功能 | 三端差异点 | 结论 |
|---|---|---|
| 本地终端 | Windows 走 ConPTY（portable-pty），Unix 走 openpty | portable-pty 已抽象，无差异 |
| Serial | Linux `/dev/ttyUSB*`（需 dialout 组）、macOS `/dev/cu.*`（需驱动）、Windows `COMx` | serialport 统一抽象；错误提示分平台（R5） |
| Telnet | 无平台差异 | — |
| WS 桥 | 仅绑 127.0.0.1，三端语义一致 | tokio-tungstenite 跨平台 |
| 后端 Rust | 无新系统级依赖（serialport 的 libudev 可选关闭，R12） | 维持纯 Rust 自足打包 |

### 13.4 结论

- **"webview 优先"架构在三端全部成立**：WASM、WebSocket、canvas 是三个 webview 的公共能力，无单端例外；
- 唯一真实的平台差异（WKWebView 剪贴板禁用）恰好是项目已踩过、已有标准解法的坑，直接复用；
- 总工作量 24–34 → **25–35 人日**（P4 增加三端验证缓冲），架构与实施顺序不变。
