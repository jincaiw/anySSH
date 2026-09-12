# anySSH 人工验证运行手册

**版本**：v0.15.0（`main` @ `2c31fd2` 及后续纯文档提交）
**用途**：报告 §12 列出的 **10 项**无法自动验证的项目，逐项给出可照做的步骤、期望结果与判定标准。
**前置**：本手册所有项目都要求在**目标平台上用真实目标**执行；任何一项未执行即视为**未验证**，不得记为通过。

## 本机现状（2026-09-12 核实，直接照此执行）

| 项目 | 实测值 |
|---|---|
| 架构 | **arm64**（Apple Silicon）⇒ 下载 `anySSH_0.15.0_aarch64.dmg` |
| 已安装 | `/Applications/anySSH.app`，版本 **0.15.0**（2026-09-12 由 0.14.46 升级；**注意**：库中有 `app_auto_update='false'` 一行，是执行第 7 项时写入的——原库**没有**这一行，默认即为「开」。想恢复默认就删掉这行，或在「设置 → 自动更新」里打开） |
| 可执行文件 | `/Applications/anySSH.app/Contents/MacOS/anyssh`（**全小写 `anyssh`**） |
| 数据目录 | `~/Library/Application Support/com.jincaiw.anyssh/` |
| 库文件 | `anyssh.db`，`_meta.schema_version` = **20**（v0.15.0 上限也是 20 ⇒ 升级**不触发迁移**） |
| 其他文件 | `.device_id`（遥测随机 UUID）、`anyssh.db-wal` / `-shm` |
| 可回滚配对 | Releases 现有 `v0.14.46`（本机旧版）与 `v0.15.0`（目标版） |
| 更新器 | 插件已注册、能力 `updater:default` 已授予、公钥与 0.14.46 **一致**；入口为启动自动检查 + 设置页「检查更新」；`autoUpdate` **默认开** |

## 0. 通用准备：先把日志拿到手

**这是先决条件，不是可选项。** anySSH 的 `tracing` 只写 **stdout**，没有文件日志、没有 rolling、级别硬编码为 `anyssh=debug,russh=info`。因此**必须从终端启动**才能留下可排查的日志：

| 平台 | 启动方式 |
|---|---|
| macOS | `/Applications/anySSH.app/Contents/MacOS/anyssh 2>&1 \| tee /tmp/anyssh.log` |
| Linux | `./anyssh 2>&1 \| tee /tmp/anyssh.log`（或 AppImage 直接执行） |
| Windows | **GUI 启动无法获得任何日志**（无控制台、无日志文件）。若需要日志，请在 WSL/PowerShell 中运行 `anyssh.exe 2>&1 \| Tee-Object C:\Temp\anyssh.log` 并接受可能无输出 |

> 注意可执行文件名是 **`anyssh`（小写）**，不是 `anySSH`——按产品名猜会得到 «no such file or directory»。
> 带环境变量启动（如关遥测）也只能走终端：`ANYSSH_DISABLE_TELEMETRY=1 /Applications/anySSH.app/Contents/MacOS/anyssh`。用 `open -a anySSH` 或双击会把环境变量丢掉。

同时打开 webview 开发者工具（macOS：`Cmd+Opt+I`；Windows/Linux：`Ctrl+Shift+I`）并保持 **Console** 面板可见——RDP/VNC 的失败大多只在 Console 里可见。

**留档要求**：每项记录 `平台 / 版本 / 时间 / 结果 / 截图或日志片段`。

---

## 1. RDP / VNC 真实会话

### 1.1 VNC

| 步骤 | 期望结果 |
|---|---|
| 起一个真实 VNC 服务端（macOS「屏幕共享」、TigerVNC、RealVNC 任一），端口 5900 | 服务端监听正常 |
| 新建主机 → 协议选 VNC → 填地址/端口 → 连接 | 新标签页打开，出现远程桌面画面 |
| 移动鼠标、点击、输入文字 | 远端光标与键盘输入双向生效，无可见延迟累积 |
| 拖动窗口边缘改变 anySSH 窗口大小 | 远端分辨率跟随变化（`resize` 生效） |
| 关闭标签页，再重连 | 首次令牌单次消费，第二次连接能正常工作 |

**失败排查**：Console 中 `WebSocket` 是否连上 `ws://127.0.0.1:<port>/vnc/<token>`；若连接被拒且日志有 `upstream <host>:<port>: <err>`，说明是到 VNC 服务端那一段失败（桥接已正常工作）。

### 1.2 RDP

前提：目标必须是 **TLS 或 NLA**。标准 RDP 安全层（`SecurityLayer=0`）由 IronRDP 上游硬拒绝，**这是设计决策，不是缺陷**——若目标只支持标准 RDP 安全层，请改设备侧设置或该主机继续用 `mstsc`。

Windows 服务端启用 NLA：

```
reg add "HKLM\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" /v SecurityLayer /t REG_DWORD /d 2 /f
reg add "HKLM\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" /v UserAuthentication /t REG_DWORD /d 1 /f
shutdown /r /t 0
```

| 步骤 | 期望结果 |
|---|---|
| 新建主机 → 协议 RDP → 连接 | 弹出**证书指纹确认**对话框（需先完成 TLS 握手才能取得指纹） |
| 确认指纹 → 开标签页 | 出现 Windows 登录/桌面画面 |
| 键盘鼠标操作 | 双向生效 |
| 故意把服务端证书换掉后重连 | 应提示指纹变化并拒绝直接连接（而不是静默继续） |

**必须同时验证的边界**：对一个**只支持标准 RDP 安全层**的主机连接，应看到明确的诊断文本，且结论句在可见区域内（不含「被截断」的半个从句）。

**失败排查**：Console 若显示 `rdp.init()` reject，则 WASM 根本没挂载，查看器不会出现——此时检查是否出现 CSP violation（`script-src 'wasm-unsafe-eval'` / `connect-src data:` 相关）。

---

## 2. Telnet / 串口真实设备

### 2.1 Telnet（交换机 / 网元 / 嵌入式设备）

**先用夹具验证 NAWS 协商**（不需要任何真机，1 分钟）：

```bash
# 终端 A：启动"被动式网元"（它从不主动发 DO NAWS —— 这正是要测的场景）
python3 tests/manual/telnet_naws_fixture.py --port 2323
# 终端 B：不需要；直接在 anySSH 里新建 Telnet 会话连 127.0.0.1:2323
```

然后在 anySSH 里**改变窗口大小**（最大化 / 拖动边缘）。

| 步骤 | 期望结果 |
|---|---|
| 连接 127.0.0.1:2323 | 出现夹具横幅，且终端里打印 `[device] window = <cols>x<rows>` |
| 改变 anySSH 窗口大小 | 终端里**立刻**打印新的 `[device] window = …`；夹具日志出现新的 `client -> SB NAWS cols=… rows=…` |

夹具日志里若出现 **`client -> WILL NAWS (its own initiative)`**，即证明客户端**不等服务端先问**就发起了协商（这是本项的核心）。夹具自测已通过（模拟客户端：`WILL NAWS` → `DO NAWS` → `SB 132x43` → `SB 100x30`）。

> 夹具是「**支持 NAWS 但不主动发起**」的设备，覆盖最常见的一类网元。**真机仍是最强证据**——不同厂商对 NAWS 的响应时机不同，若手边有设备，下面这张表照做一遍：

| 步骤 | 期望结果 |
|---|---|
| 连接一台真实 telnet 设备（23 端口） | 出现登录提示，可交互 |
| 改变 anySSH 窗口大小（如最大化） | 设备端窗口尺寸同步变化 |
| 在设备上执行 `show terminal`（或等效命令） | 报告的 rows/cols 与 anySSH 当前尺寸一致 |

**为什么单独列为一步**：anySSH 必须**主动**发 `IAC WILL NAWS`（`term/telnet.rs` 的 `connect()` 在建连后立即 `write_all(command(WILL, OPT_NAWS))`）。大量网元/嵌入式 telnetd 从不发起协商，纯被动实现的窗口尺寸会永远停在 80×24。**这一项失败即说明 NAWS 协商未生效。**

| 步骤 | 期望结果 |
|---|---|
| 配置登录脚本，且脚本内容包含 `0xFF` 字节（或触发 IAC 的字符） | 发送的字节被正确转义，设备不会误入 telnet 命令状态 |
| 脚本带延时/期望提示符的多步流程 | 按序执行，不粘包、不提前发送 |

### 2.2 串口

| 步骤 | 期望结果 |
|---|---|
| 用 USB 转串口线连 console，选设备与波特率（9600 / 115200） | 能看到设备启动输出 |
| 敲回车 | 出现提示符，可输入 |
| 拔掉再插上 USB 转串口 | 设备列表自动刷新（`serial:ports-changed` 事件）；已打开的会话给出明确断开提示，不静默卡死 |

---

## 3. 真实堡垒机 / 网络设备互通性

至少覆盖一台 **华为 / H3C / DPtech / TopSec / 山石 StoneOS** 设备，逐项：

| 能力 | 步骤 | 期望结果 |
|---|---|---|
| SSH 口令登录 | 直连设备 22 端口 | 登录成功，终端可交互 |
| SSH 密钥登录 | 用 `id_ed25519` / RSA / PPK | 三种密钥均能导入或转换（PPK 需本机有 `puttygen`，缺依赖时应给出安装提示而非崩溃） |
| 跳板链 | 配置两级 `ProxyJump` 后连接 | 逐跳建立，任一跳失败时错误信息指明是**哪一跳** |
| 端口转发 | 建本地转发规则，用它访问设备 Web 管理页 | 浏览器可打开设备管理页 |
| SFTP 上传 | 上传配置文件到设备 | 成功；大文件（>100 MB）进度持续更新、可取消 |
| SCP 回退 | 对只支持 SCP 的设备执行传输 | 自动回退到 SCP，功能等价 |
| 主机健康检查 | 对上述设备运行健康检查 | 结果准确（在线/离线与实际一致） |

---

## 4. 三平台实机安装与首次启动

**每台机器先用全新用户环境测一次「首次启动」**（或删除 app data 目录后重测），以覆盖"配置与默认值"路径。

| 平台 | 安装包 | 关键核对点 |
|---|---|---|
| macOS | `anySSH_0.15.0_aarch64.dmg` / `_x64.dmg` | 挂载 → 拖入 Applications → **首次启动能过 Gatekeeper**（见下方「macOS 签名实况」）→ 主窗口为 **1200×800**，最小可缩至 **800×500** |
| Windows | `anySSH_0.15.0_x64-setup.exe`（在线）与 `x64_en-US.msi`（含离线 WebView2） | 无网络环境用 `.msi` 安装，WebView2 应离线装好；首启不弹缺 WebView2 的错 |
| Linux | `.deb` / `.rpm` / AppImage | `.deb`/`.rpm` 依赖 `libwebkit2gtk-4.1` 可自动解析；AppImage 无需安装即可运行 |

### macOS 签名实况（2026-09-12 实测，**必须知道**）

对 v0.15.0 的 `aarch64.dmg` 与**本机已装的 v0.14.46** 同时做了签名核查，结论一致：

```text
Signature=adhoc       flags=0x20002(adhoc,linker-signed)     TeamIdentifier=not set
codesign --verify → "code has no resources but signature indicates they must be present"
xcrun stapler validate → does not have a ticket stapled to it
spctl -a -t open <dmg> → rejected (source=no usable signature)
```

即：**既没有用 Developer ID 签名，也没有公证（notarization）**。这**不是**本轮引入的回归——v0.14.46 完全一样。

**对验收的实际影响（这才是要点）**：

| 获取方式 | 是否被 Gatekeeper 拦 | 说明 |
|---|---|---|
| 浏览器下载（Safari / Chrome） | **会被拦** | 文件带上 `com.apple.quarantine`，首次启动提示「无法验证开发者 / Apple 无法检查是否包含恶意软件」 |
| 命令行 `gh` / `curl` 下载 | **不拦** | 实测下载到的 dmg **没有** quarantine 属性（只有 `provenance` / `macl` / `diskimages.recentcksum`），可直接安装启动 |

**因此第 6 项在 macOS 上必须按「真实用户路径」测**——命令行下载探测不到 Gatekeeper 问题。复现与验证步骤：

```bash
# 1) 故意打上 quarantine，模拟浏览器下载的真实状态
xattr -w com.apple.quarantine "0081;$(printf %x $(date +%s));Safari;" ~/Downloads/anySSH_0.15.0_aarch64.dmg
# 2) 挂载并拖入 /Applications 后，从 Finder 双击启动 → 应被拦
# 3) 用右键 → 打开，或：
xattr -dr com.apple.quarantine /Applications/anySSH.app
# 4) 再次双击 → 应能启动
```

**判定**：拦截本身**不算缺陷**（未公证的必然结果），但必须确认 ① 提示文案是可理解的、② 绕过步骤有效、③ 绕过之后应用一切正常。若希望用户**不再遇到这一步**，需要 Apple Developer Program 账号做 Developer ID 签名 + 公证（属发布决策，需另立任务）。

**首次启动核对**：

| 检查 | 期望 |
|---|---|
| app data 目录被创建 | macOS `~/Library/Application Support/com.jincaiw.anyssh/`；Windows `%APPDATA%\com.jincaiw.anyssh\`；Linux `~/.local/share/com.jincaiw.anyssh/` |
| 数据库建成 | `anyssh.db` 存在，schema 版本 = 当前 `LATEST_SCHEMA_VERSION` |
| 遥测标识符 | `.device_id` 文件被创建（随机 UUID，**不是**机器码/账号派生值） |
| 空状态界面 | 无主机时给出引导，不显示空白/报错 |
| Console | 无红色报错、无 CSP violation |

---

## 5. 高 DPI / 多显示器

| 场景 | 步骤 | 期望结果 |
|---|---|---|
| Windows 150% / 200% 缩放 | 设置显示缩放为 150%、200%，各测一次 | SFTP 拖拽落点坐标正确（`ExplorerView` 对 Windows 单独补偿 `devicePixelRatio`）；终端字体清晰不糊 |
| Windows 多显示器不同缩放 | 两个显示器设不同缩放，窗口在两者之间拖动 | 拖拽坐标始终正确，不出现落点偏移 |
| macOS Retina + 外接非 Retina | 窗口跨屏拖动 | 终端尺寸与字体随之重排，无错位 |
| 任意平台 | 系统字体放大后启动 | 布局不被裁切，滚动条可用 |

**失败排查**：拖拽落点偏移是这一项最常见的失败形态，优先核对 `src/components/sftp/ExplorerView.tsx` 中的 `isWindowsWebview()` 分支。

---

## 6. 长时间运行稳定性

**目的**：应用层的 4 小时观测在自动化测试里**完全没有覆盖**（无基准、无压测），必须人工观测。终端（PTY）层的句柄与关闭延迟曲线已有一个可自动跑的测量工装，见 6.1——两者互补：6.1 只压本地终端层，能给出可复现的数字；本节的 4 小时观测才覆盖真实混合负载。

### 6.1 PTY 层句柄 / 关闭延迟曲线（自动，但需普通终端）

```bash
cd src-tauri
cargo test --release --lib -- --ignored --nocapture soak_pty_churn
```

跑 400 轮 `open → shutdown → EOF`，每 50 轮打印一次句柄下界与关闭延迟。

- **必须在普通终端运行**：RSS 通过 `ps -o rss=` 取，受限沙箱会拒绝 `ps`；沙箱里跑出来的 RSS 列会显式显示 `unavailable`（不会伪装成 0），此时内存一列视为**未测**。
- 判定：句柄下界在 400 轮内**不得出现台阶式上升**（工装内置 `+10` 的宽松上限）；关闭延迟不得随时间单调恶化。

#### 两次实测（同一台 macOS arm64 / release）

| 时间 | 句柄 | RSS | 最慢单轮关闭 | 400 轮总耗时 |
|---|---|---|---|---|
| 2026-09-12（本轮审计） | 14 → 14（**+0**） | — | 55.5 ms | 23.9 s |
| 2026-09-12（jason 在普通终端复跑） | **10 → 10（+0）** | 11584 → 10896 KiB（**−688 KiB**） | 61.8 ms | 24.57 s |

两次都是**句柄零漂移**，第二次的 RSS 还**净下降** 688 KiB。

**两次句柄基线不同（14 vs 10）不是问题**：要看的是**同一次运行内的增量**（都是 +0），而不是绝对数值——下界取的是"进程当前打开了多少"，会随运行上下文（stdout 是管道还是 tty、locale/资源文件是否已加载）变动。同理，"最慢单轮关闭"是**单轮极值**而非均值，两次相差 6 ms 属正常噪声，两次都在 60 ms 量级、都远低于工装阈值。

> 复跑时终端开头的 `env: python: No such file or directory` 与 anySSH 无关：仓库与 `src-tauri` 内**没有任何** python 调用（`grep` 已确认），该行来自终端自身的 shell 初始化。测试照常执行并通过。

**负载构造**（尽量接近真实重度使用）：

- 8 个会话：3 个 SSH 终端 + 2 个 SFTP + 1 个本地终端 + 1 个 S3 + 1 个端口转发
- 同时跑一个大文件传输（≥ 1 GB）与一次递归目录上传（≥ 500 个小文件）
- 期间反复打开/关闭标签页 ≥ 50 次

**持续 4 小时**，每 30 分钟记录一次：

```bash
# macOS / Linux
PID=$(pgrep -f anySSH | head -1)
ps -o rss= -p "$PID"                 # 常驻内存（KB）
ls /proc/$PID/fd 2>/dev/null | wc -l # Linux：句柄数
lsof -p "$PID" 2>/dev/null | wc -l   # macOS：句柄数
```

**判定标准**：

| 指标 | 通过 | 不通过 |
|---|---|---|
| RSS | 波动在 ±15% 内，**无单调上升趋势** | 逐 30 分钟稳定上升 |
| 句柄数 | 会话开关循环后回落到基线附近（±5） | 每轮开关后净增 |
| 传输 | 全程无卡死；取消按钮立即生效 | 出现无法取消的传输 / `term_close` 挂起 |
| 界面 | 无内存告警、无白屏、无 UI 冻结 | 冻结或崩溃 |

失败即记录：崩溃前最后 200 行日志 + 当时的 RSS/句柄数。

---

## 7. 升级安装与回滚

> **先读这三条事实**（2026-09-12 按代码核实，避免照着做却得到相反结论）：
>
> 1. **设置项 `autoUpdate` 默认为 `true`**（`settings-store.ts:207`）：只要启动时发现更高版本，就会**静默下载、安装并重启**进新二进制（`checkOnStartup` → `downloadInstall` → `relaunch`）。想在升级前先看到弹窗，**必须先在设置里关掉自动更新**。
>    **注意语义**：关掉后**仍会**请求 `latest.json`（只是不静默安装、改为弹窗）——这个开关管的是**是否静默安装**，**不是**是否联网。已实测，见 §7.4。
> 2. **「库版本高于 App」这道保护只在 v0.15.0 及以后存在**（`LATEST_SCHEMA_VERSION` 常量与 `version > LATEST_SCHEMA_VERSION` 检查是在本轮的 `0ec9add` 才加入）。**v0.14.46 没有这道保护**，所以「用 v0.14.46 打开 v0.15.0 写的库」**不会**出现该提示——这条旧指令已作废，正确做法见 7.2。
> 3. schema 版本存在 **`_meta` 表的 `schema_version` 键**（不是 `PRAGMA user_version`）。本机现有库为 **20**，而 v0.15.0 上限也是 **20** ⇒ **0.14.46 → 0.15.0 不会执行任何迁移**（这一点必须知道，否则会误以为「迁移已验证」）。

### 7.1 正常升级（应用内更新）

| 步骤 | 命令 / 操作 | 期望结果 |
|---|---|---|
| 1 | 先看清当前版本 | 应用内「关于 / 设置」显示的版本号 = **v0.14.46** |
| 2 | 关掉自动更新（为了**看到**弹窗）：设置 → 自动更新 → 关 | 设置持久化 |
| 3 | 重启应用 | 弹窗提示发现新版本 **0.15.0**；含版本号与说明 |
| 4 | 确认安装 | 下载 → 校验签名（公钥固定于 `tauri.conf.json`，与 0.14.46 一致，已核对）→ 重启进新二进制 |
| 5 | 升级后核对 | 版本号显示 **0.15.0**；原有主机 / 分组 / 片段 / 转发规则 / S3 连接**全部保留**；凭据仍可从 OS keychain 读出 |
| 6 | 再核对 schema | `_meta.schema_version` 仍为 **20**（未发生迁移，属预期） |

> 想看「自动更新」通路：第 2 步保持默认（开），重启后应**直接**完成升级并重启，不弹窗。

### 7.2 回滚与 schema 保护（分开测，别混为一谈）

**A. 回滚本身（0.15.0 → 0.14.46，验证旧版能读新库、数据不损坏）**

| 步骤 | 命令 / 操作 | 期望结果 |
|---|---|---|
| 1 | **先关自动更新**（否则回滚后一启动就被升级回去，测试白做） | 设置里 `autoUpdate` 为关 |
| 2 | 退出应用，**备份数据目录** | `cp -R ~/Library/Application\ Support/com.jincaiw.anyssh /tmp/anyssh-backup-$(date +%s)` |
| 3 | 安装 v0.14.46：`anySSH_0.14.46_*.dmg`（或从 Releases 取） | 覆盖安装成功 |
| 4 | 启动 | 正常打开；主机 / 分组等**仍在**；无「数据损坏」提示；库文件未被重建（对比 `anyssh.db` 大小与 mtime） |

**B. schema 保护（必须制造「库比 App 新」的条件，v0.15.0 才有这道闸门）**

| 步骤 | 命令 / 操作 | 期望结果 |
|---|---|---|
| 1 | 全部退出 anySSH | 无 anySSH 进程 |
| 2 | 手工把库的版本标成 21（模拟未来版本写的库）<br>`sqlite3 ~/Library/Application\ Support/com.jincaiw.anyssh/anyssh.db "UPDATE _meta SET value='21' WHERE key='schema_version';"` | 写成功 |
| 3 | 从**终端**启动 v0.15.0：<br>`/Applications/anySSH.app/Contents/MacOS/anyssh 2>&1 \| tee /tmp/anyssh-guard.log` | **窗口不出现 / 进程退出**；终端打印含 `failed to initialise database:` 与 `schema v21`、`understands up to v20` 的报错（`db/mod.rs:265-276`） |
| 4 | 关键判定 | 数据**未被修改或删除**：库文件 mtime / 大小不变，主机表内容不变（可 `SELECT count(*) FROM saved_hosts` 对比） |
| 5 | 恢复 | 用第 2 步的备份覆盖回去；或用 `UPDATE _meta SET value='20' WHERE key='schema_version';` 改回 |

> 第 3 步的报错在 macOS 上走 stderr，GUI 双击启动看不到——这正是「必须从终端启动」的原因（§0）。

### 7.3 更新器失效时的兜底

| 步骤 | 期望结果 |
|---|---|
| 断网后触发「检查更新」 | 给出网络错误提示，不崩溃、不卡死 |
| 下载中断（中途断网） | 可重试；不会装上半截包 |
| 弹窗里选「跳过此版本」 | 本次启动不再提示；下次启动仍会检查（除非版本号相同） |

### 7.4 执行记录（2026-09-12 实测，macOS arm64）

按 7.1 / 7.2 实际跑完，逐条结果如下。**执行前已完整备份数据目录**（`.workbuddy/backups/anyssh-data-20260912-134059`）。

| 对应步骤 | 实际结果 | 证据 |
|---|---|---|
| 7.1 步 2（关自动更新） | **通过** | 写库 `app_auto_update='false'`；v0.14.46 源码 `settings-store.ts:726` 亦为 `value !== "false"` ⇒ 旧版同样认这个键 |
| 7.1 步 3（应看到弹窗） | **通过** | 实测 0.14.46 启动后弹出「发现新版本 0.15.0」（人眼确认）。**关键**：`autoUpdate=false` 时仍然会请求 `latest.json`，只是改为弹窗而**不**静默安装——「关掉自动更新」关的是**静默安装**，不是联网检查 |
| 7.1 步 4–5（应用内升级） | **通过** | 反向验证：置 `autoUpdate=true` 后启动 0.14.46，**20 秒内**自行下载、安装并重启为 0.15.0。且装出的 bundle 与官方 dmg **逐字节一致**（可执行文件 / `Info.plist` / 全 bundle 递归哈希三项全等）⇒ minisign 签名校验通过 |
| 7.1 步 6（schema 不变） | **通过** | `_meta.schema_version` 仍为 20（本无迁移，属预期） |
| 7.2 A 步 4（回滚） | **通过** | 装回 0.14.46 后正常启动，无「数据损坏」提示；`integrity_check` = ok；**对库零写入**（`anyssh.db` mtime 不变、`-wal` 0 字节）；全库快照与回滚前 `diff` **完全一致** |
| 7.2 B 步 3（schema 闸门） | **通过（拒绝正确）** | 置 `schema_version=21` 后启动 → **exit 134**，stderr 打印 `failed to initialise database: … (schema v21, but this build understands up to v20)` |
| 7.2 B 步 4（数据未被改） | **通过** | `integrity: ok`、3 个分组与 11 条设置完好、库 mtime/大小不变 |
| 7.2 B 步 5（恢复） | **通过** | 改回 `schema_version=20` 后启动成功 |
| 7.3（更新器兜底） | **未验证** | 需断网操作 + 界面点击（断网后检查更新 / 下载中断重试 / 跳过此版本），本环境无法自动触发 |

> **7.2 B 步 3 的一个重要补充**：闸门**拒绝得正确**，但**呈现方式不可用**——报错走 stderr，进程以 SIGABRT 退出。**GUI 双击启动的用户看不到窗口、对话框或日志文件**，只会觉得「点了没反应」。原因是 `lib.rs` 的 `.setup()` 返回 `Err` → Tauri 内部 panic → 末端 `.run(...).expect(...)`；日志又不落盘（见手册 §0）。已登记为报告 **R-9**。
>
> **另一条必须记下的事实**：`autoUpdate=false` 的对照实验里，「什么都没发生」**本身不是充分证据**——如果更新检查因网络失败根本没跑，观测结果一模一样。本次用了双向对照（`=true` 时确实自升级）才把这条推理缺口封住。后续做类似验证时不要只看单侧。

---

## 8. 遥测关闭验证（必须抓包）

代码层面确认过：设置 `ANYSSH_DISABLE_TELEMETRY` 时 HTTP client 根本不会被构造；但**唯一能证明"零出站"的方式是抓包**。

**推荐用一键脚本**（它会替你挡住上面那些假阴性，并在对照组无效时拒绝给结论）：

```bash
./scripts/telemetry-capture.sh     # 普通终端，会两次要 sudo 密码
```

下面手工步骤仍然保留，用于理解脚本在做什么、以及脚本跑不通时排查。

> **⚠️ 2026-09-12 实测：不加"文件必须存在"这一步，会得到假阴性。** 第一次执行后两条 `wc -l` 都是 0，看起来像"遥测已关闭"，实际是 **`tcpdump -w` 根本没生成 pcap**，而 `tcpdump -r <不存在的文件>` 的错误被 `2>/dev/null` 吞掉、`wc -l` 于是返回 0。**任何一次数包之前，先 `ls -l` 确认文件存在且非空。**

**步骤**：

0. **先证明 tcpdump 能用**（不要屏蔽 stderr）：
   ```bash
   sudo tcpdump -i any -c 5 -n
   ```
   打印出 5 行才继续。失败就把报错原样留下来看（多半是 sudo / BPF 权限）。
1. **解析端点 IP**。`tcpdump` 的 `host <name>` 在**启动那一刻**做 DNS 解析，结果不稳；用 IP 过滤更可靠：
   ```bash
   dig +short us.i.posthog.com      # 取第一个 A 记录
   ```
   端点在代码里是 `POSTHOG_HOST = "https://us.i.posthog.com"`，POST 到 `/capture/`；遥测**默认开启**（`init()` 仅当设了 `ANYSSH_DISABLE_TELEMETRY` 才 no-op），所以对照组本该有流量。
2. **对照组**（先证明抓包有效）：另开终端从**终端**启动（日志只在 stdout）→ 做几个动作（连接主机、开 SFTP、起传输）→ 退出：
   ```bash
   sudo tcpdump -i any -n -s 0 -w /tmp/tel-ctl.pcap "host <IP>"   # 终端 A
   /Applications/anySSH.app/Contents/MacOS/anyssh                 # 终端 B
   # ...做动作后退出应用，回到终端 A 按 Ctrl-C

   ls -l /tmp/tel-ctl.pcap                                        # ★ 必须存在
   tcpdump -r /tmp/tel-ctl.pcap -n 2>/dev/null | wc -l            # 应 > 0
   ```
3. **实验组**：同样抓包，但用禁用变量启动 → 做**同样**的动作 → 观察期内（≥ 10 分钟）：
   ```bash
   sudo tcpdump -i any -n -s 0 -w /tmp/tel-off.pcap "host <IP>"  # 终端 A
   ANYSSH_DISABLE_TELEMETRY=1 /Applications/anySSH.app/Contents/MacOS/anyssh   # 终端 B

   ls -l /tmp/tel-off.pcap                                        # ★ 必须存在
   tcpdump -r /tmp/tel-off.pcap -n 2>/dev/null | wc -l            # 必须 == 0
   ```

| 结果 | 判定 |
|---|---|
| 对照组有连接、实验组 0 连接 | **通过** |
| 对照组就没有连接 | 抓包无效，需换工具重做（**不得**据此判定通过） |
| 实验组仍出现连接 | **不通过**，按安全问题上报 |

### 8.1 执行记录（2026-09-12，macOS arm64，`scripts/telemetry-capture.sh`）

| 阶段 | 命中 | 说明 |
|---|---|---|
| 阳性对照（curl 走同一条路） | **38** | 证明抓包与过滤有效 |
| 对照组（默认启动，做连接/SFTP/传输动作） | **53** | 遥测确实在出站 |
| 实验组（`ANYSSH_DISABLE_TELEMETRY=1`，同样动作） | **0** | 零出站 |

**判定：通过。** 拿到这个结论的过程本身有两条必须记住的环境事实——**它们让"朴素 tcpdump 命令"在这台机器上永远不可能成功**：

1. **`-i any` 是 Linux 写法**。这台 macOS 既没有 `any` 也没有 `pktap`（`tcpdump -D` 列出 28 个接口，`lo0` 在后面）。必须显式指定接口。
2. **本机系统代理是 `127.0.0.1:1082`**（`scutil --proxy`），应用的 HTTPS 经**回环**送到代理。因此按 `host <端点IP>` 抓出口接口**永远抓不到**——目标主机名只出现在回环上那条**明文 `CONNECT`** 里。脚本因此同时抓 `lo0` 的代理端口与出口接口的端点 IP。

> 脚本内建**自动阳性对照**：抓不到就中止并声明「不能据此得出任何结论」。这挡的是最危险的一类误判——把「没抓到」读成「没有出站」（第一次手工执行就出现过 0/0 的假阴性，见上）。

---

## 汇总表（执行时逐项勾选）

| # | 项目 | 需要环境 | 结果 |
|---|---|---|---|
| 1 | RDP 真实会话（TLS/NLA） | Windows RDP 主机 | ☐ |
| 1 | VNC 真实会话 | VNC 服务端 | ☐ |
| 1 | 标准 RDP 安全层的诊断文案 | 只支持标准安全层的主机 | ☐ |
| 2 | Telnet 真机 + NAWS 窗口协商 | telnet 网元 | ☐ |
| 2 | 串口真机 + 热插拔 | USB 转串口 + console 线 | ☐ |
| 3 | 堡垒机/设备互通（华为/H3C/DPtech/TopSec/StoneOS） | 相应设备 | ☐ |
| 4 | macOS 安装 + 首次启动 | macOS 实机 | ☑ **通过**（2026-09-12，含 Gatekeeper 拦截复现，见 §4） |
| 4 | Windows 安装（含离线 WebView2）+ 首次启动 | 无网 Windows 实机 | ☐ |
| 4 | Linux 安装（deb/rpm/AppImage）+ 首次启动 | Linux 实机 | ☐ |
| 5 | 高 DPI / 多显示器 | Windows 150%/200% 缩放环境 | ☐ |
| 6 | 4 小时长跑（RSS/句柄不做单调上升） | 任一实机 | ☐ **部分**：6.1 的 PTY 基线**已取且通过**（2026-09-12 在普通终端复跑：句柄 10→10（+0）、RSS −688 KiB、最慢关闭 61.8 ms）；**4 小时混合负载观测仍未做** |
| 7 | 升级 + **回滚** | 两个版本的安装包 | ☑ **通过**（2026-09-12：应用内升级端到端 + 回滚本身 + schema 闸门，见 §7.4；**§7.3 兜底未验**） |
| 8 | 遥测关闭抓包（含对照组） | 抓包工具 + root | ☑ **通过**（2026-09-12：阳性对照 38、对照组 53、实验组 **0**，见 §8.1） |

> **为什么自动化环境做不了这一项（2026-09-12 实测）**：① 无 root ⇒ `tcpdump` 不可用；② 该环境**强制走代理**（`HTTPS_PROXY=127.0.0.1:55180`，且 `scutil --proxy` 显示系统代理也开启），于是出站只有「到代理」这一跳，`lsof` 只能看到端口 **55180**、看不到目标主机名；③ 改用自己的本地代理时，应用**完全没有连接它**（curl 经同一代理的阳性对照成功），因此无法归因；④ 应用启动阶段**没有可观测的 HTTPS 出站**（连更新器查 GitHub 的请求都没出现），所以"启动即观测"这条路也不通。
> ⇒ 这一项必须由人在普通终端执行上面的脚本。**不要用"没抓到包"当作"没有出站"。**

**全部 ☑ 后，本报告的「有条件发布」条件 2 即达成。**

**当前进度（2026-09-13）**：13 项中已 ☑ **3** 项（第 4 项 macOS 部分、第 7 项、**第 8 项遥测抓包**），另有 **1 项部分完成**（第 6 项的 6.1 PTY 基线）；**第 7 项的 §7.3 兜底、第 6 项的 4 小时观测、以及第 1/2/3/5 项与第 4 项的 Windows/Linux 部分仍待执行**。第 9 项（原「schema 提示」）的期望值已修正，其真正内容并入第 7 项。

**下一步建议**：剩下的项**全部需要外部环境**，本机目前缺：Windows/Linux 虚拟机（`~/Parallels` 下无任何 `.pvm`）、VNC/RDP 服务端（5900/5901/3389 无监听）、USB 转串口（仅有蓝牙与 debug-console）、真机设备。可先做的是**挂机 4 小时观测**（§6）与**开一次屏幕共享后验 VNC**（§1.1）。
