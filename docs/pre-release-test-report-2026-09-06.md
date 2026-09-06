# anySSH 上线前测试报告

- **版本**：main @ e6c5a79（tag v0.14.35 后 3 个修复提交）
- **日期**：2026-09-06
- **平台**：macOS（darwin / aarch64），Docker 化 e2e
- **结论**：**有条件发布**

---

## 1. 汇总

| 类别 | 结果 | 说明 |
| --- | --- | --- |
| 构建/编译 | PASS | `tsc --noEmit`、`vite build`、`cargo check/clippy` 全部零错误零警告 |
| 前端单元测试 | PASS | vitest 25 文件 / **178 用例全部通过**（含 i18n parity） |
| Rust 单元测试 | PASS | **285 用例全部通过**（release 模式） |
| E2E 测试 | PASS | `make e2e`（tauri-driver + 真实 sshd/S3 容器）：**116/116 通过**（修复后复验见 §5） |
| 静态检查 | PASS | cargo clippy `--all-targets` 0 warning |
| 依赖漏洞 | WARN | pnpm prod 0 漏洞；cargo audit 10 项（已修 2，剩余为传递依赖，见 §4） |
| 安全审查 | PASS* | 源码六项审查通过；2 处低风险问题已修复（§3） |
| 功能验收 | PASS | e2e 覆盖主机 CRUD、密码/密钥连接、SFTP 全操作、传输队列、分组/片段/端口转发、设置持久化、断线重连、VNC/Telnet/本地 PTY、仪表盘 |
| 性能与长稳 | WARN | 无自动化性能套件；构建体积 1 项告警（§6） |
| 数据/部署 | PASS | SQLite WAL + schema_version 迁移、备份模块、updater（pubkey+endpoint）、便携模式、首启动 e2e smoke 通过 |
| 兼容性 | PASS* | CI 矩阵：macOS arm64/x64、Linux、Windows（含 portable）；分辨率/DPI 需人工（§7） |
| 可运维性 | WARN | tracing 仅 stdout，无文件日志轮转（§8） |

## 2. 已修复问题（本次 3 个提交）

1. `d495c06` **依赖安全升级**：rustls-webpki 0.103.10 → 0.103.13（RUSTSEC-2026-0104/0098）、quinn-proto 0.11.14 → 0.11.15（RUSTSEC-2026-0185），升级后 285 测试复验通过。
2. `e6c5a79` **SCP 树下载路径穿越防护**：远端 `find` 输出的 `rel_path` 未校验即 `Path::join`，Windows 客户端上 `\` 可作分隔符逃逸下载目录；新增 `validate_tree_rel_path` 组件级校验 + 2 个单元测试。
3. `（本次提交）` **passphrase 临时文件**：puttygen 转换时明文 passphrase 写入共享临时目录，改用 `tempfile::NamedTempFile`（0600、drop 即删）；tempfile 移入正式依赖。

## 3. 未解决问题（遗留风险）

| 级别 | 问题 | 说明 |
| --- | --- | --- |
| WARN | quick-xml 0.38/0.39 两个 high（RUSTSEC-2026-0194/0195，XML DoS） | 传递依赖（tauri/plist、rust-s3/aws-creds、wayland-scanner），需上游升级，本地无法修复；实际暴露面低（仅解析本地/S3 配置 XML） |
| WARN | russh-cryptovec 0.7.3（RUSTSEC-2026-0153，high） | 来自 vendor 的 russh 0.46，修复需升级 russh 到 0.6x（大版本迁移），建议列入下一版本专项 |
| WARN | rsa 0.9.10 Marvin 时序侧信道（5.9 medium） | 官方无修复版；SSH RSA 交互场景，建议后续优先 modern KEX |
| INFO | rand unsound / spin yanked | 已知警告，27 项已在 audit 配置放行 |

## 4. 安全检查结果

- 命令注入：仅 3 处进程创建，均为数组传参无 shell；远端命令统一 `shell_quote`。OK
- 路径穿越：SFTP `validate_remote_name`、S3 `file_name()` 提取均有效；SCP 树下载缺陷已修复。OK
- 凭据：OS keychain 默认 / AES-256-GCM+Argon2id 便携模式；日志无敏感输出；仓库无真实密钥。OK
- Tauri IPC：未启用 shell/fs 插件，opener 仅默认应用。OK（建议：`csp: null` → 配置 CSP）
- XSS：前端无 innerHTML/dangerouslySetInnerHTML。OK

## 5. 修复后复验

- 修复 1/2/3 各自完成后：`cargo test --release` 285 通过、clippy 0 警告。
- **e2e 复验（修复提交后的最终构建）：74/74 spec 文件全部通过，exit 0**（runner 日志 2026-09-06T15:32Z，报告 tests/e2e/report.md）。

## 6. 性能与稳定性

- 传输采用并发限制队列（Semaphore + DashMap），e2e 传输用例在限期内完成，进度/取消/完成状态一致。
- 构建告警：RDP chunk 6.06 MB（gzip 2.2 MB）、主 bundle 1.14 MB — 建议后续 manualChunks 拆分。
- **需要人工验证**：真实长会话（8h+）内存/CPU/句柄、高并发传输下的吞吐、大文件（>1GB）传输稳定性。本机无可自动化长稳环境。

## 7. 需要人工验证项

1. 真实云 S3（AWS/R2/B2/Wasabi）端到端 — e2e 仅覆盖 MinIO。
2. RDP 连接真实 Windows 主机 / RD 网关（iron-remote-desktop 流程）。
3. 应用内自动更新全流程（latest.json → 下载 → 签名校验 → 重启）。
4. Windows/macOS 安装包双击安装、升级覆盖安装与回滚。
5. 高 DPI / 多显示器 / 系统深浅色切换下的 UI。
6. 性能与长稳（见 §6）。

## 8. 可运维性

- 日志：`tracing_subscriber`（anyssh=debug）仅输出 stdout，桌面双击启动时不可见 → 建议接入 `tauri-plugin-log` 文件轮转。
- 会话日志已落盘 `<app_data>/session-logs`；错误统一 `{kind, message}` 结构，前端可匹配。
- SQLite：WAL + foreign_keys + `_meta.schema_version` 线性迁移；`backup` 模块提供备份/恢复命令。
- 文档：README（中英）、docs/ 3 篇、e2e README 完整。

## 9. 最终结论

**有条件发布。**

核心功能全部通过（285 Rust + 178 前端 + 116 e2e），无阻塞级缺陷，部署/迁移/备份能力齐备。附加条件：

1. 发布说明中披露 quick-xml / russh-cryptovec 传递依赖公告及暴露面评估；
2. 将 russh 0.46 → 0.6x 升级列入下一版本（高优先级）；
3. 完成 §7 人工验证 1–4 项后方可正式对外推送更新。
