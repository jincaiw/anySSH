# anySSH v0.15.2 发布前验收记录

> 本报告区分打候选 tag 与公开发布。结论只适用于本文记录的提交和证据；发布产物尚未由 tag 构建产生时，不得声称产物、安装包或更新签名已验收。

## 验收对象

- 仓库：`jincaiw/anySSH`
- 目标版本：`v0.15.2`（当前最新正式版 `v0.15.1`，补丁版本递增）
- 验收分支：`codex/release-v0.15.2`，从远端 `main` 的 `81c2009f047a260336ddee1b99501ac8b08505c5` 开始；安全修复提交为 `28a27326af62660ea6df6c933582f93a85a185a0`
- 代码范围：`v0.15.1` 之后的主分支变更，包括 release 版本注入修复、自动化/人工验收工装、Linux/MSI 维护者元数据修正及相应记录；本次新加的是验收标准与本报告
- 候选 tag：尚未创建
- 工作区原有 `.workbuddy` 未跟踪文件：保留，不纳入本次提交

## 阶段结论

**NO-GO（当前不能公开发布）。**

原候选 `f049a25` 的依赖审计发现 `RUSTSEC-2026-0285`，已更新 `Cargo.lock` 到修复版；本地 advisory/license 审计、313 项 Rust 测试和 Clippy 均通过。安全修复提交 `28a2732` 的同 SHA CI 中，前端、Rust 和依赖审计成功，但 E2E shard 2/4 失败：`22-snippet-palette-run` 将用户名输入成了 `tes`，SSH 拒绝凭据。已在测试助手加输入值稳定性断言，尚待新候选 SHA CI 验证。Windows/Linux 干净环境安装首次启动尚无实机记录。已有验收记录显示 macOS 下载包为 ad-hoc 签名且未公证，浏览器下载的首次启动会被 Gatekeeper 拦截；GitHub 仓库当前只有 Tauri updater 签名密钥，没有 Apple Developer 签名/公证所需 secrets。以上缺口不能记录为通过。

## 门禁证据

| 门禁 | 状态 | 证据与缺口 |
|---|---|---|
| 版本与发布来源 | 已验证 | 最新正式版 `v0.15.1` 已发布；远端 `main` 为 `81c2009f047a260336ddee1b99501ac8b08505c5`，其祖先包含 `v0.15.1`。候选版本按补丁号为 `0.15.2`。无候选 tag。 |
| 工作区保护 | 已验证 | 在独立 worktree 上工作；原工作区的 `.workbuddy` 未跟踪文件未移动、覆盖或提交。 |
| 前端构建与单测 | 已验证（`28a2732`） | 候选 CI run [35854906336](https://github.com/jincaiw/anySSH/actions/runs/35854906336) 的 `Frontend (typecheck + build)` 成功；新测试助手改动待新 SHA 复验。 |
| Rust fmt/clippy/test | 已验证（`28a2732`） | 同一 CI run 的 Rust job 成功；另有本地 `cargo test --locked`（313 passed / 1 ignored）和 `cargo clippy --locked --all-targets -- -D warnings` 通过。 |
| 依赖安全审计 | 已验证（`28a2732`） | 同一 CI run 的 `Dependency audit (cargo-deny)` 成功；本地 `cargo deny check advisories licenses` 输出 `advisories ok, licenses ok`。 |
| E2E | 验证失败（修复待验证） | 候选 CI run [35854906336](https://github.com/jincaiw/anySSH/actions/runs/35854906336)：shard 2/4 为 18 passed / 1 failed，其余 3 shard 成功。失败在 `22-snippet-palette-run`；传给表单的用户名 `testuser` 最终被后端读为 `tes`，因此认证失败。测试 helper 目前增加输入值稳定性断言，需新候选 SHA 完整 CI 复验。 |
| 版本注入 / Linux 维护者元数据 | 已验证（静态） | `release.yml` 将替换限制为 `0.0.0-dev` 占位符；`cargo metadata --no-deps` 确认 `authors[0]` 为项目维护者、上游作者保留第二位。须在 v0.15.2 实际 `.deb` / MSI 中核对字段。 |
| macOS/Windows/Linux 发布构建 | 未验证 | tag 构建尚未运行；需检查所有平台 job 及产物完整性。 |
| updater 签名配置 | 配置已验证，产物待验证 | GitHub 仓库存在 `TAURI_SIGNING_PRIVATE_KEY` 与密码 secret；候选 `latest.json` 与 `.sig` 尚未生成，须在 tag build 后核对并验证签名。 |
| macOS Developer ID 签名/公证 | 验证失败（已知风险） | 最新历史验收报告的 R-8 证实包未公证、浏览器下载会被 Gatekeeper 拦截。GitHub secrets 列表中无 Apple 签名/公证 secrets。 |
| 三平台干净安装 | 需要人工验证 | macOS 历史记录有安装与升级/回滚实测；Windows 与 Linux 实机首次启动尚无证据。Linux 静态包检查不能替代安装运行。 |
| 协议设备实测 | 需要人工验证 | RDP、VNC、Telnet 设备、串口、堡垒机互通仍需相应现场环境；自动化覆盖不能替代真实设备验收。 |
| 跨平台回归 / 高 DPI / 长稳 | 需要人工验证 | Windows/Linux DPI、4 小时混合负载长跑与应用 RSS 曲线未验证。 |

## 已知缺陷与风险

- **R-8（macOS 分发）**：ad-hoc 签名且无公证，用户从浏览器下载后首次打开会遇到 Gatekeeper 拦截。当前仓库没有 Apple Developer 签名/公证 secret；需提供签名环境并重新构建，或由发布负责人明确批准公开分发未公证包并在下载说明披露处理步骤。
- **R-12（已修复，待新 SHA CI）**：`Cargo.lock` 的 `rustls 0.23.37` 命中 [RUSTSEC-2026-0285](https://rustsec.org/advisories/RUSTSEC-2026-0285)（CVSS 5.3 Medium）。升级至 `0.23.45` 后本地和候选 CI 的依赖审计均通过；其修复版本为 `>=0.23.45`，当前同 SHA 的 Rust 测试/clippy 也通过。
- **R-13（E2E，修复待验证）**：`22-snippet-palette-run` 在连接前提交了不完整用户名 `tes`，导致认证失败。已在 `tests/e2e/helpers/host.ts` 加入输入值一致性等待，错误信息不包含 password 等字段值。需在新候选 SHA 完整 CI 验证；不降低用例断言或重试连接。
- **E2E 环境稳定性**：历史报告还记录跨 shard 时序波动和至少一次未解释认证拒绝。必须区分同一 SHA 重跑与首次运行，不通过放宽断言或超时消除失败。
- **Windows/Linux 首次安装**：缺少真实干净环境证据；CI 编译成功不能证明 installer、WebView2、系统依赖和桌面集成运行正常。

## 放行条件

打候选 tag 前：取得包含 E2E 输入同步修复的新候选 SHA 全绿 CI 结果，并确认四个 E2E shard 的全部 spec 均执行完成。

公开发布前：tag 构建全部平台成功；核对 Release 资产、版本、`.deb` Maintainer / MSI Manufacturer、`latest.json` 与 updater 签名；完成 Windows/Linux 干净安装，或由发布负责人明确记录并接受相应风险；决定 macOS 未公证包的发布策略并披露。

## 结论更新

本报告会在候选 SHA 的 CI、tag 产物和用户授权范围内的人工验收有结果后更新。不得在缺证时将 NO-GO 改写为通过。
