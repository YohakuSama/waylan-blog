# Waylan CI（精简后的长期策略）

仓库仅保留 `.github/workflows/verify.yml` 一个工作流。对 `main` 的 PR 与推送自动检查，手动运行 `Waylan CI` 执行完整质量审计。历史清理用的临时分支回收任务不属于长期 CI，已移除；ThinkPad Windows 自托管 Runner 已停用，因此不再定义 `windows-check` / `windows-connectivity`。

## 核心门禁

- `scripts/ci-plan.mjs` 根据文件变更选择测试；无法识别变更时回退到完整检查。
- 仅变更 Actions 工作流、CI 分类、已退休维护脚本时，只执行核心检查与 CI 规则单测，不无故下载 Chromium / Firefox / WebKit。
- 有代码变更时执行 Node 24 依赖安装、TypeScript、构建、单元测试及静态完整性检查。
- PR 的受影响 UI 模块复用同一次浏览器安装运行 Chromium、Firefox、WebKit、三端布局、WCAG、Reader、Feed、交互与动效专项；仅文档变更不安装浏览器。常规 PR 的视觉矩阵覆盖 320/390/767/768/860/1024/1440px、Editorial/Terminal × light/dark（共 196 个页面/外观组合）；`workflow_dispatch` 手动完整审计仍覆盖原有 16 个屏宽（448 个组合）。
- 已验证 PR 合并后推送 `main` 只重新执行核心检查，不重复安装浏览器；手动运行执行完整审计。
- 截图与报告仅在失败或手动完整审计时上传，产物保留 3 天。历史 CI 日志由 GitHub 管理。

## 浏览器检查的耗时与故障边界

- **一次 npm ci、一次构建**仍在同一 `Waylan CI` 工作流执行。不新增并行重复构建的 workflow，不通过跳过浏览器检查伪造绿灯。
- 按版本和运行系统缓存 `~/.cache/ms-playwright`，**在安装并校验全部浏览器后立即保存**，不等后续浏览器场景成功才写缓存。缓存命中也执行 Playwright 安装完整性校验；损坏/缺失会自动补装或明确失败。Linux 系统库需要每个新 Runner 检查，不能缓存。
- npm 浏览器工具安装、Linux 系统库安装和浏览器可执行文件安装分别设有限时（4/4/5 分钟）。这样可区分网络/npm、apt 和浏览器二进制下载问题，避免单步无反馈占满整场 CI。
- 常规 UI PR 使用有代表性的七个宽度、两皮肤与明暗模式；涉及断点边界/全局设计系统的高风险合并或人工最终验收，手动运行 `Waylan CI` 的 `workflow_dispatch` 完整视觉矩阵。手动完整审计不减少原有场景。
- PR 新提交依旧取消旧 SHA 的运行，避免旧代码通过验收。为避免重复投入，先集中修改并完成静态检查，再提交稳定版本；对运行中的 PR 不为纯进度更新追加无意义提交。
- **缓存不保证必然提速**：Playwright 官方说明在 Linux 上恢复缓存可能与直接下载耗时接近，系统依赖仍要安装。实际以 CI 中缓存命中、安装步骤耗时与视觉测试总时长比较；若缓存连续无收益则取消缓存，保留明确分阶段超时和分级矩阵。

## 运维边界

Cloudflare Workers Builds 与 GitHub Actions 是独立的状态检查；不能把 GitHub CI 成功等同于 Cloudflare 发布成功。运行/维护前核实两个状态。正式版本合并请尽量通过 PR，保留必要质量门禁。旧分支 GC 的处理记录见 [分支清理结项](BRANCH_ARCHIVE.md) 与 GitHub 历史，不保留长期删除分支的自动化入口。
