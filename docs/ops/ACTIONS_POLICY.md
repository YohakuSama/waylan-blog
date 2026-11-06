# Waylan CI（精简后的长期策略）

仓库仅保留 `.github/workflows/verify.yml` 一个工作流。对 `main` 的 PR 与推送自动检查，手动运行 `Waylan CI` 执行完整质量审计。历史清理用的临时分支回收任务不属于长期 CI，已移除；ThinkPad Windows 自托管 Runner 已停用，因此不再定义 `windows-check` / `windows-connectivity`。

## 核心门禁

- `scripts/ci-plan.mjs` 根据文件变更选择测试；无法识别变更时回退到完整检查。
- **开发态 Draft PR 不占用 Runner**：PR 创建为 Draft 后可集中提交、修改和代码审阅；`opened/synchronize/reopened/converted_to_draft` 的草稿检查标记跳过，不执行 npm/构建/浏览器。**提交代码并准备合并时必须点 Ready for review**，`ready_for_review` 将触发相同的正式检查；Ready 状态后再 push 提交仍执行正式门禁并取消同 PR 的旧运行。草稿无法合并。仅在仍需修改时使用 Draft，不将它当作绕过最终测试的入口。
- 仅变更 Actions 工作流、CI 分类、已退休维护脚本时，只执行核心检查与 CI 规则单测，不无故下载 Chromium / Firefox / WebKit。
- 有代码变更时执行 Node 24 依赖安装、TypeScript、构建、单元测试及静态完整性检查。
- PR 的受影响 UI 模块复用同一次浏览器安装运行 Chromium、Firefox、WebKit、三端布局、WCAG、Reader、Feed、交互与动效专项；仅文档变更不安装浏览器。常规 PR 的视觉矩阵覆盖 320/390/601/767/768/860/1024/1025/1440px、Editorial/Terminal × light/dark（共 288 个页面/外观组合）；`workflow_dispatch` 手动完整审计覆盖 18 个屏宽（含 601px、1025px 边界）（576 个组合）。
- 已验证 PR 合并后推送 `main` 只重新执行核心检查，不重复安装浏览器；手动运行执行完整审计。
- 截图与报告仅在失败或手动完整审计时上传，产物保留 3 天。历史 CI 日志由 GitHub 管理。

## 浏览器检查的耗时与故障边界

- **一次 npm ci、一次构建**仍在同一 `Waylan CI` 工作流执行。不新增并行重复构建的 workflow，不通过跳过浏览器检查伪造绿灯。
- 按版本和运行系统缓存 `~/.cache/ms-playwright`，**在安装并校验全部浏览器后立即保存**，不等后续浏览器场景成功才写缓存。缓存命中也执行 Playwright 安装完整性校验；损坏/缺失会自动补装或明确失败。Linux 系统库需要每个新 Runner 检查，不能缓存。
- npm 浏览器工具安装（4 分钟）后先恢复/补齐 Playwright 二进制，再实际启动 Chromium、Firefox、WebKit 检测 Linux 库。**三者可启动则跳过系统 apt 下载**；确实缺依赖时才运行最多 8 分钟的 `install-deps` 修复，并在修复后再次启动三种浏览器做严格校验，失败仍会阻断所有浏览器测试。
- 历史实测：2026-11-06 CI #42213248805 第一次尝试缓存命中后仍无条件从 Ubuntu 镜像下载约 114 MB 包，因字体包镜像响应缓慢在 4 分钟阈值被终止。此类系统包安装不应成为每个 PR 的强制路径；备用修复仍设置单次网络请求限时和有限重试。
- 常规 UI PR 使用涵盖高风险断点的九个宽度、两皮肤与明暗模式；涉及断点边界/全局设计系统的高风险合并或人工最终验收，手动运行 `Waylan CI` 的 `workflow_dispatch` 完整视觉矩阵。手动完整审计不减少原有场景。
- PR 新提交依旧取消旧 SHA 的运行，避免旧代码通过验收。为避免重复投入，先集中修改并完成静态检查，再提交稳定版本；对运行中的 PR 不为纯进度更新追加无意义提交。
- **缓存不保证必然提速**：Playwright 官方说明在 Linux 上恢复缓存可能与直接下载耗时接近，系统依赖仍要安装。实际以 CI 中缓存命中、安装步骤耗时与视觉测试总时长比较；若缓存连续无收益则取消缓存，保留明确分阶段超时和分级矩阵。

## 成本自律与质量底线

- **只使用 GitHub 托管 Runner**：正式工作流固定 `runs-on: ubuntu-latest`，不再要求 ThinkPad 本机在线。历史维护日志中的旧 ThinkPad 记载仅作审计，不代表当前 Runner 仍在使用。GitHub `Settings → Actions → Runners` 里残留的注册条目需由仓库所有者删除，代码修改不会注销已登记的机器。
- **单 PR、单 CI 工作流**：一次功能变更优先先在 Draft 上完成代码和静态检查，再转换 Ready 做最终综合验证；不通过不断新增 CI workflow、反复推空提交或无意义触发 full 构建来改善状态。必要的回归必须针对同一待合并 SHA。
- **范围与覆盖分离**：已有 `scripts/ci-plan.mjs` 只选择受影响的测试，不能静默屏蔽异常。普通 UI PR 保留代表性断点、两皮肤/深浅模式、多浏览器、WCAG 和相关功能；重大共享规则/部署前按维护规范使用手动完整验收。
- **缓存边界**：`setup-node` 的 npm 缓存仅存储下载包，`~/.cache/ms-playwright` 仅存储浏览器二进制；`npm ci` 始终全新安装依赖。不得共享测试用户 Cookie、LocalStorage、IndexedDB、Service Worker 或站点应用缓存；浏览器脚本按独立 context/state 隔离，必要时主动清空网站状态。依赖缓存键应跟随锁定版本更新。
- **预算与监控**：按 GitHub `Billing & Licensing → Usage` 实际账单来源核查，给适用的产品设置 Budget/alerts。公开仓库的标准 GitHub-hosted Runner 与私有仓库、增值 Runner、其他计费产品不能混为一谈；节约资源并不改变必要的合并前质量门禁。
- **合并门禁需要人工核对仓库设置**：为 `main` 设置所需 `check` 状态检查（Waylan CI）。历史已通过的检查不能代替当前 PR SHA；Draft 的 skipped 状态不能被当作就绪 PR 的成功验收。若无法确定分支保护是否已正确配置，应在 PR 合并前显式核查。
- 合并后的 `main` push 仍执行核心检查，用于记录最终落地主分支版本；它不再次安装浏览器。确认没有误触发不必要的浏览器完整 QA 后才考虑改变这项防护。

## 运维边界

Cloudflare Workers Builds 与 GitHub Actions 是独立的状态检查；不能把 GitHub CI 成功等同于 Cloudflare 发布成功。运行/维护前核实两个状态。正式版本合并请尽量通过 PR，保留必要质量门禁。旧分支 GC 的处理记录见 [分支清理结项](BRANCH_ARCHIVE.md) 与 GitHub 历史，不保留长期删除分支的自动化入口。
