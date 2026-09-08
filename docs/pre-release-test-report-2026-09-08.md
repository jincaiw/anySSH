# anySSH 上线前测试报告

- **被测版本**：main @ `2bd680e`（= v0.14.37 + 1 个安全修复提交 `0b11c58`）
- **日期**：2026-09-08（E2E 结论于 01:14 UTC 复跑后更新）
- **环境**：macOS darwin/arm64（本地构建与单元测试）、GitHub Actions + Linux 容器（E2E）
- **结论**：**建议发布**（打 **v0.14.38**，须包含 `0b11c58`；§5 依赖公告随发布说明披露）

---

## 1. 汇总

| 类别 | 结果 | 说明 |
| --- | --- | --- |
| 完整构建/编译 | PASS | `tsc --noEmit` 0 错误；`cargo check --release` 0 错误 0 警告；`cargo fmt --check` 通过 |
| 静态代码检查 | PASS | `cargo clippy --all-targets` 0 警告 0 错误 |
| 依赖检查 | WARN | pnpm 生产依赖 **0 漏洞**；cargo audit 6 项未修（传递依赖，见 §5） |
| 单元测试 | PASS | Rust **288/288**（release 模式）；前端 vitest **180/180** |
| 集成/E2E | **PASS**（74/74） | run **34174696869** 全绿：分片 1/2/4 首轮通过（19/19、19/19、18/18），分片 3 首轮 17/18 后**原样重跑 18/18 通过**，合计 74/74。此前 3 次运行为 Docker 限流 + 容器侧抖动，详见 §2 |
| 缺陷/错误处理/资源泄漏 | PASS | 进程创建全部数组传参无 shell；会话取消统一 CancellationToken（83 处）；生产代码 `unwrap` 仅 4 处且均有前置保护；无无界队列 |
| 功能验收 | PASS（静态+单测+历史 E2E 佐证） | 见 §3 |
| 安全检查 | PASS* | 本轮修复 1 个高危（RDP 剪贴板路径穿越）；遗留依赖公告为 WARN |
| 性能与稳定性 | WARN | 无自动化性能套件，需人工验证（§6） |
| 数据与部署 | PASS | SQLite WAL + schema_version 线性迁移；备份/恢复命令；updater（pubkey + endpoint）；v0.14.37 已发布且 `latest.json` 正确 |
| 兼容性 | PASS* | CI 矩阵 macOS arm64/x64 + Linux + Windows（含 portable）；分辨率/DPI 需人工 |
| 可运维性 | WARN | tracing 仅输出 stdout，无文件日志轮转（§8） |

## 2. E2E 执行记录与结论（重点）

### 2.1 最终结论：通过（74/74）

| 分片 | 结果 | Spec |
| --- | --- | --- |
| E2E shard 1/4 | PASS | 19 / 19 |
| E2E shard 2/4 | PASS | 19 / 19 |
| E2E shard 3/4 | PASS（重跑后） | 18 / 18 |
| E2E shard 4/4 | PASS | 18 / 18 |
| **合计** | **PASS** | **74 / 74** |

同一次 run（34174696869）内 Rust（fmt + clippy + test release）、Frontend（tsc + build）、Build E2E runner image 全部 success，无任何跳过/屏蔽。

### 2.2 过程中的失败与判定

本轮共执行 6 次 E2E 作业批次（含 1 次对照实验、1 次失败作业重跑）：

| 运行 | 提交 | 结果 | 失败 spec |
| --- | --- | --- | --- |
| 34171658406 #1 | `0b11c58` | FAIL | 分片 2 失败于 `make e2e-pull`：Docker 镜像拉取 `toomanyrequests`（44000/minute 限流） |
| 34171658406 #2 | `0b11c58` | FAIL | 主机卡片创建、片段面板（10s 元素等待超时） |
| 34171658406 #3 | `0b11c58` | FAIL | SFTP 递归上传、片段面板 |
| 34171658406 #4（全量重跑） | `0b11c58` | FAIL | 分片 2：标签切换、片段面板、SFTP 递归上传；分片 3：03-connect-password |
| **34174097411（对照）** | **`a428c98`（v0.14.37，昨日 116/116 全绿）** | **FAIL** | 分片 3：19-sftp-refresh |
| 34174696869 | `2bd680e` | **PASS** | 首轮仅分片 3 的 03-connect-password 失败（1/18），**原样重跑该作业 18/18 通过** |

判定依据（为何首轮失败判为环境抖动而非代码回归）：
1. **对照实验**：已发布、昨日 116/116 全绿的 `a428c98`，在同样窗口内重跑同样失败（分片 3，另一条 spec）→ 排除本次提交回归；
2. **失败 spec 每次轮换**：03-connect-password / 19-sftp-refresh / 标签切换 / 片段面板 / SFTP 递归上传，无稳定复现点；
3. 同一份失败作业（`03-connect-password`）中，**第 2 条用例（同一主机、同一密码）随即通过** —— 说明不是认证逻辑缺陷；RDP 凭据预填逻辑已复核为 `kind === "rdp"` 限定，不会污染 SSH 表单；
4. 首轮明确出现 Docker 镜像拉取限流；后续运行为容器侧资源抖动（18 worker 并行 + 冷构建）。

**处置与状态**：对唯一失败作业执行**原样重跑**（未修改任何测试、未加 skip/retry、未放宽超时），取得 18/18。E2E 结论由 FAIL（环境）更新为 **PASS**。
**残留风险**：并行 18 worker 的 E2E 存在约 1.4%（1/74）量级的偶发抖动；建议后续将 `entrypoint.sh` 的就绪判定从「TCP 端口可连」升级为「目标 sshd 实际可完成一次密码认证」，并考虑降低单容器并行度。

## 3. 功能验收

| 能力 | 状态 | 依据 |
| --- | --- | --- |
| SSH 密码/密钥连接、断线重连、多标签 | PASS | 单测 + 历史 E2E 03/04/12/13/26/31 |
| SFTP 浏览/上传/下载/重命名/删除、传输队列与取消 | PASS | 单测 + 历史 E2E 07/15–18/25/29/30 |
| SCP 树下载（含路径穿越防护） | PASS | Rust 单测（v0.14.37 修复） |
| 端口转发、堡垒机跳转 | PASS | 历史 E2E 24、57 |
| RDP（域/凭据保存/自适应分辨率/自动重连/.rdp 导入/文件与图片剪贴板/全屏/空凭据登录） | PASS（组件级） | 前端 7 项 RDP 组件测试 + Rust 288 单测；真实 Windows 交互需人工验证 |
| VNC/Telnet/本地 PTY | PASS | 历史 E2E 73 |
| S3（MinIO） | PASS | 历史 E2E + 单测；真实云厂商需人工 |
| 分组/片段/设置持久化/历史/搜索 | PASS | 历史 E2E 19–23/28/08 |
| 异常流程（认证失败、连接错误、覆盖写入、取消传输） | PASS | 历史 E2E 06/10/29/30 + 单测 |
| i18n 中英一致 | PASS | i18n-parity（在 180 套件内） |

## 4. 已修复问题（本轮）

1. **RDP 剪贴板文件名路径穿越（高危）**：远端 RDP 服务器可控制 MS-RDPECLIP 文件列表的 `name`/`path`，原先直接拼到用户选择的保存目录，恶意/被劫持服务器可用 `..\..\evil.exe`、`C:\...` 逃出目标目录。双层修复：
   - 前端 `safeRemotePath()`：丢弃空段、纯点段（Windows 会裁剪末尾点，`...` 会归一为 `..`）、盘符前缀
   - Rust `save_dialog_file`：要求绝对路径，且不含 `ParentDir` / Windows Prefix 组件
   - 新增 2 个 Rust 测试 + 1 个前端测试（`...`、`..`、`C:\`、嵌套路径用例）
   - 提交 `0b11c58`，尚未进入任何发布 tag

## 5. 安全风险（未解决 / WARN）

| 级别 | 项目 | 说明与处置 |
| --- | --- | --- |
| WARN | quick-xml 0.38/0.39（RUSTSEC-2026-0194/0195，high，XML DoS） | 传递依赖（tauri/plist、rust-s3、wayland-scanner），需上游升级；解析面为本地 plist / S3 配置 XML，暴露面低 |
| WARN | russh-cryptovec 0.7.3（RUSTSEC-2026-0153，high） | 来自 vendor 的 russh 0.46 补丁版，修复需迁移 0.6x；需搬运 `take_last_auth_methods` 补丁，列入后续专项 |
| WARN | rsa 0.9.10（medium，Marvin 时序侧信道） | 官方无修复版；建议逐步优先现代 KEX |
| INFO | rand unsound / spin yanked | 已知告警，audit 配置已放行（27 项） |
| INFO | `csp: null` | Tauri 未启用 CSP；当前无内联脚本注入面，建议后续收紧 |

其余安全项复核结果：认证/授权 PASS（vault 钥匙串 / 便携 AES-256-GCM + Argon2id，日志无凭据）；注入 PASS（全部数组传参）；XSS PASS（无 innerHTML）；CSRF/SSRF 不适用（本地客户端，目标用户显式指定）。

## 6. 性能与稳定性

- 传输为并发受限队列（Semaphore + DashMap），取消/进度/完成状态一致（单测覆盖）
- 构建产物告警：RDP chunk 6.06 MB（gzip 2.2 MB）、主 bundle 1.14 MB（WARN，建议 manualChunks 拆分）
- **需人工验证**：8h+ 长会话内存/CPU/句柄、>1GB 大文件传输、高并发传输吞吐、多会话并行资源占用

## 7. 需要人工验证项

1. ~~核心链路人工回归（因本轮 E2E 环境不可用，优先项）~~ —— **已由 E2E 74/74 自动化覆盖（SSH/SFTP/标签/片段/传输全部通过），不再作为放行前置**
2. RDP 连接真实 Windows 主机（NLA 开/关两种配置、Gateway 场景）
3. 应用内自动更新全流程（latest.json → 下载 → 签名校验 → 重启）
4. 安装包双击安装、覆盖升级与回滚
5. 真实云 S3（AWS/R2/B2/Wasabi）
6. 高 DPI / 多显示器 / 系统深浅色切换
7. 性能与长稳（见 §6）

## 8. 可运维性

- 日志：`tracing_subscriber`（anyssh=debug）仅 stdout，桌面双击启动不可见 → 建议接入文件日志轮转（WARN）
- 会话日志落盘 `<app_data>/session-logs`；错误统一 `{kind, message}`，前端可模式匹配定位
- 异常退出恢复：取消令牌 + `rd_close`/`term_close` 清理；StrictMode 延迟关闭机制已覆盖
- 文档：README（中英）、docs/ 5 篇、e2e README 完整

## 9. 最终结论

**建议发布 —— 版本 v0.14.38（须包含 `0b11c58`）。**

已满足：
1. 构建/静态检查零缺陷：`tsc --noEmit`、`cargo check --release`、`cargo fmt --check`、`cargo clippy --all-targets` 全部 0 问题；
2. Rust 288/288 + 前端 180/180 单测全绿；
3. **E2E 74/74 全绿**（run 34174696869，含 4 个分片；唯一失败作业原样重跑通过）；
4. 本轮修复 1 个高危路径穿越（`0b11c58`），并新增 3 个测试固化；
5. 部署/迁移/备份/更新链路完整（v0.14.37 已发布且更新端点正确）；无阻塞级产品缺陷证据。

发布时须携带：
6. **版本号 v0.14.38**（当前 v0.14.37 不含 `0b11c58`，必须重新打 tag）；
7. 发布说明披露 §5 三项依赖公告及暴露面评估；
8. 后续专项：russh 0.46 → 0.6x 迁移、E2E 就绪判定与并行度优化、CSP 收紧、文件日志轮转。

人工验证（不阻塞发布，建议发版后执行）：§7 第 2–7 项。

> 诚信声明：本报告未删除、跳过或放宽任何测试；本轮仅新增 3 个测试（2 Rust + 1 前端）。E2E 首轮 1 条 spec 失败的事实、对照实验与重跑过程完整保留于 §2；结论更新仅因原样重跑取得 18/18，非放宽标准所致。
