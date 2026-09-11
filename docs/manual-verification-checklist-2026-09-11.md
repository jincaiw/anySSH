# anySSH 人工验证运行手册

**版本**：v0.15.0 之后（`main` @ `9d66c0d` 及后续提交）
**用途**：第 9 节 8 项无法自动验证的项目，逐项给出可照做的步骤、期望结果与判定标准。
**前置**：本手册所有项目都要求在**目标平台上用真实目标**执行；任何一项未执行即视为**未验证**，不得记为通过。

## 0. 通用准备：先把日志拿到手

**这是先决条件，不是可选项。** anySSH 的 `tracing` 只写 **stdout**，没有文件日志、没有 rolling、级别硬编码为 `anyssh=debug,russh=info`。因此**必须从终端启动**才能留下可排查的日志：

| 平台 | 启动方式 |
|---|---|
| macOS | `/Applications/anySSH.app/Contents/MacOS/anySSH 2>&1 \| tee /tmp/anyssh.log` |
| Linux | `./anySSH 2>&1 \| tee /tmp/anyssh.log`（或 AppImage 直接执行） |
| Windows | **GUI 启动无法获得任何日志**（无控制台、无日志文件）。若需要日志，请在 WSL/PowerShell 中运行 `anySSH.exe 2>&1 \| Tee-Object C:\Temp\anyssh.log` 并接受可能无输出 |

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

| 步骤 | 期望结果 |
|---|---|
| 连接一台真实 telnet 设备（23 端口） | 出现登录提示，可交互 |
| 改变 anySSH 窗口大小（如最大化） | 设备端窗口尺寸同步变化 |
| 在设备上执行 `show terminal`（或等效命令） | 报告的 rows/cols 与 anySSH 当前尺寸一致 |

**为什么单独列为一步**：anySSH 必须**主动**发 `IAC WILL NAWS`。大量网元/嵌入式 telnetd 从不发起协商，纯被动实现的窗口尺寸会永远停在 80×24。**这一项失败即说明 NAWS 协商未生效。**

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
| macOS | `anySSH_0.15.0_aarch64.dmg` / `_x64.dmg` | 挂载 → 拖入 Applications → 首次启动通过 Gatekeeper → 主窗口为 **1200×800**，最小可缩至 **800×500** |
| Windows | `anySSH_0.15.0_x64-setup.exe`（在线）与 `x64_en-US.msi`（含离线 WebView2） | 无网络环境用 `.msi` 安装，WebView2 应离线装好；首启不弹缺 WebView2 的错 |
| Linux | `.deb` / `.rpm` / AppImage | `.deb`/`.rpm` 依赖 `libwebkit2gtk-4.1` 可自动解析；AppImage 无需安装即可运行 |

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

**目的**：这一项在自动化测试里**完全没有覆盖**（无基准、无压测），必须人工观测。

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

### 7.1 正常升级

| 步骤 | 期望结果 |
|---|---|
| 安装 v0.15.0，建立若干主机与分组 | 数据正常 |
| 触发应用内「检查更新」（有更高版本时） | 显示新版本号与说明，签名校验通过后才允许安装 |
| 执行升级 | 升级成功后原有主机、分组、片段、转发规则、S3 连接**全部保留**；凭据仍可从 OS keychain 读出 |

### 7.2 回滚（重点，最易被忽略）

| 步骤 | 期望结果 |
|---|---|
| 用**新版本**启动一次，确认数据库已被迁移到更高 schema 版本 | 新版本正常工作 |
| 再安装**旧版本**并启动 | 应给出**明确提示**（库版本高于当前 App），**不得**静默降级、不得损坏数据库 |
| 回滚后原数据 | 仍可通过重装新版本正常读取 |

### 7.3 更新器失效时的兜底

| 步骤 | 期望结果 |
|---|---|
| 断网后触发「检查更新」 | 给出网络错误提示，不崩溃、不卡死 |
| 下载中断（中途断网） | 可重试；不会装上半截包 |

---

## 8. 遥测关闭验证（必须抓包）

代码层面确认过：设置 `ANYSSH_DISABLE_TELEMETRY` 时 HTTP client 根本不会被构造；但**唯一能证明"零出站"的方式是抓包**。

**步骤**：

1. 抓包准备（macOS 需要 root）：
   ```bash
   sudo tcpdump -i any -n 'host us.i.posthog.com' -w /tmp/telemetry-off.pcap
   ```
   或使用 Little Snitch / Wireshark 过滤 `us.i.posthog.com`。
2. **对照组**（先证明抓包有效）：不带变量启动 anySSH → 做几个动作（连接主机、开 SFTP、起传输）→ 应观察到对 `us.i.posthog.com:443` 的连接。
3. **实验组**：`ANYSSH_DISABLE_TELEMETRY=1` 启动 → 做**同样**的动作 → 观察期内（≥ 10 分钟）**必须 0 连接**。

| 结果 | 判定 |
|---|---|
| 对照组有连接、实验组 0 连接 | **通过** |
| 对照组就没有连接 | 抓包无效，需换工具重做（**不得**据此判定通过） |
| 实验组仍出现连接 | **不通过**，按安全问题上报 |

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
| 4 | macOS 安装 + 首次启动 | macOS 实机 | ☐ |
| 4 | Windows 安装（含离线 WebView2）+ 首次启动 | 无网 Windows 实机 | ☐ |
| 4 | Linux 安装（deb/rpm/AppImage）+ 首次启动 | Linux 实机 | ☐ |
| 5 | 高 DPI / 多显示器 | Windows 150%/200% 缩放环境 | ☐ |
| 6 | 4 小时长跑（RSS/句柄不做单调上升） | 任一实机 | ☐ |
| 7 | 升级 + **回滚** | 两个版本的安装包 | ☐ |
| 8 | 遥测关闭抓包（含对照组） | 抓包工具 + root | ☐ |

**全部 ☑ 后，本报告的「有条件发布」条件 2 即达成。**
