# anySSH v0.15.2 发布前验收记录

> 本报告区分打候选 tag 与公开发布。结论只适用于本文记录的提交和证据；发布产物尚未由 tag 构建产生时，不得声称产物、安装包或更新签名已验收。

## 验收对象

- 仓库：`jincaiw/anySSH`
- 目标版本：`v0.15.2`（当前最新正式版 `v0.15.1`，补丁版本递增）
- 验收分支：`codex/release-v0.15.2`，从远端 `main` 的 `81c2009f047a260336ddee1b99501ac8b08505c5` 开始
- 代码范围：`v0.15.1` 之后的主分支变更，包括 release 版本注入修复、自动化/人工验收工装、Linux/MSI 维护者元数据修正及相应记录；本次新加的是验收标准与本报告
- 候选 tag：尚未创建
- 工作区原有 `.workbuddy` 未跟踪文件：保留，不纳入本次提交

## 阶段结论

**NO-GO（当前不能公开发布）。**

目前有一条 CI 运行在 E2E 失败分片重跑后卡在 runner 镜像缓存加载，尚无最终结果；因此还不能确认候选 SHA 的必需 CI 全绿。Windows/Linux 干净环境安装首次启动尚无实机记录。已有验收记录显示 macOS 下载包为 ad-hoc 签名且未公证，浏览器下载的首次启动会被 Gatekeeper 拦截；GitHub 仓库当前只有 Tauri updater 签名密钥，没有 Apple Developer 签名/公证所需 secrets。以上缺口不能记录为通过。

## 门禁证据

| 门禁 | 状态 | 证据与缺口 |
|---|---|---|
| 版本与发布来源 | 已验证 | 最新正式版 `v0.15.1` 已发布；远端 `main` 为 `81c2009f047a260336ddee1b99501ac8b08505c5`，其祖先包含 `v0.15.1`。候选版本按补丁号为 `0.15.2`。无候选 tag。 |
| 工作区保护 | 已验证 | 在独立 worktree 上工作；原工作区的 `.workbuddy` 未跟踪文件未移动、覆盖或提交。 |
| 前端构建与单测 | 已验证（代码基线） | CI run [34705638014](https://github.com/jincaiw/anySSH/actions/runs/34705638014) 的 `Frontend (typecheck + build)` job 成功；该 SHA 上 E2E 重跑仍在进行，最终 run 结论待补。 |
| Rust fmt/clippy/test | 已验证（代码基线） | 同一 CI run 的 `Rust (fmt, clippy, test)` job 成功。 |
| 依赖安全审计 | 已验证（代码基线） | 同一 CI run 的 `Dependency audit (cargo-deny)` job 成功。 |
| E2E | 验证失败 / 复核中 | 首次 CI 的 shard 2/4 和 3/4 各有一个失败，分别是 snippet 用例连 SSH 端口被拒、密码认证夹具拒绝；shard 1/4 和 4/4 成功。对失败分片的重跑在 `Load runner image from layer cache` 阶段超过 10 分钟未推进，须取得运行终态或针对候选 SHA 再跑 CI。不得将重跑未完成写成 PASS。 |
| 版本注入 / Linux 维护者元数据 | 已验证（静态） | `release.yml` 将替换限制为 `0.0.0-dev` 占位符；`cargo metadata --no-deps` 确认 `authors[0]` 为项目维护者、上游作者保留第二位。须在 v0.15.2 实际 `.deb` / MSI 中核对字段。 |
| macOS/Windows/Linux 发布构建 | 未验证 | tag 构建尚未运行；需检查所有平台 job 及产物完整性。 |
| updater 签名配置 | 配置已验证，产物待验证 | GitHub 仓库存在 `TAURI_SIGNING_PRIVATE_KEY` 与密码 secret；候选 `latest.json` 与 `.sig` 尚未生成，须在 tag build 后核对并验证签名。 |
| macOS Developer ID 签名/公证 | 验证失败（已知风险） | 最新历史验收报告的 R-8 证实包未公证、浏览器下载会被 Gatekeeper 拦截。GitHub secrets 列表中无 Apple 签名/公证 secrets。 |
| 三平台干净安装 | 需要人工验证 | macOS 历史记录有安装与升级/回滚实测；Windows 与 Linux 实机首次启动尚无证据。Linux 静态包检查不能替代安装运行。 |
| 协议设备实测 | 需要人工验证 | RDP、VNC、Telnet 设备、串口、堡垒机互通仍需相应现场环境；自动化覆盖不能替代真实设备验收。 |
| 跨平台回归 / 高 DPI / 长稳 | 需要人工验证 | Windows/Linux DPI、4 小时混合负载长跑与应用 RSS 曲线未验证。 |

## 已知缺陷与风险

- **R-8（macOS 分发）**：ad-hoc 签名且无公证，用户从浏览器下载后首次打开会遇到 Gatekeeper 拦截。当前仓库没有 Apple Developer 签名/公证 secret；需提供签名环境并重新构建，或由发布负责人明确批准公开分发未公证包并在下载说明披露处理步骤。
- **E2E 不稳定**：当前 CI 首次运行在两个分片失败，历史报告还记录了跨 shard 环境性抖动和至少一次未解释认证拒绝。必须区分同一 SHA 重跑与首次运行，不通过放宽断言或超时消除失败。
- **Windows/Linux 首次安装**：缺少真实干净环境证据；CI 编译成功不能证明 installer、WebView2、系统依赖和桌面集成运行正常。

## 放行条件

打候选 tag 前：候选提交的必需 CI 全绿，并取得 E2E 完整结果；确认接受或修复 E2E 不稳定问题。

公开发布前：tag 构建全部平台成功；核对 Release 资产、版本、`.deb` Maintainer / MSI Manufacturer、`latest.json` 与 updater 签名；完成 Windows/Linux 干净安装，或由发布负责人明确记录并接受相应风险；决定 macOS 未公证包的发布策略并披露。

## 结论更新

本报告会在候选 SHA 的 CI、tag 产物和用户授权范围内的人工验收有结果后更新。不得在缺证时将 NO-GO 改写为通过。
