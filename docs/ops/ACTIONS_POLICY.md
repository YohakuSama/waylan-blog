# Waylan CI 运行与额度管理

## 唯一入口

`.github/workflows/verify.yml` 是仓库唯一的 GitHub Actions 工作流。保留现有所有真实测试脚本，不删除测试范围；统一调用入口减少多次重复 `npm ci`、`npm run build`、Playwright / Chromium / Firefox / WebKit 安装和报告上传。

原来一次 PR 更新会同时运行 5 个工作流、6 个 Ubuntu jobs（`verify` 本身有两个），并附带 6 次依赖安装和多次重复构建。现在常规 PR 只有一个 Ubuntu job，先进行必要的类型、构建和单元测试，再按受影响的代码范围复用浏览器运行定向检查。

## 自动触发策略

| 事件/变更 | 必要检查 | 浏览器 | 深度专项 |
| --- | --- | --- | --- |
| PR 只改文档/README | 仅变更范围判定及成功状态 | 不安装 | 无 |
| PR 改后端/普通代码 | TypeScript、build、unit、静态完整性、离线预览 | 受影响源码触发 UI/后台回归 | 视模块判定 |
| PR 改 Reader / 选区 | 上述核心门禁 + UI 浏览器 | Chromium/Firefox/WebKit + WCAG | 阅读器、触摸和导航 |
| PR 改 Feed / 数据源 | 核心门禁 + UI 浏览器 | 同上 | 摘录与状态机 |
| PR 改共享 CSS/路由/动效/CI | 核心门禁 + UI 浏览器 | 同上 | 阅读器、Feed、动效全部 |
| 合并后 push 到 main | 必要类型、构建、单元与静态检查 | 不重新安装 | 默认无，避免 PR 已通过的浏览器检查重复消耗 |
| Actions → Run workflow → full | 全部 | 三引擎 | 全部专项 + 只读生产对比 |

`scripts/ci-plan.mjs` 实现最小的纯变更规则；`scripts/maintenance.test.mjs` 验证规则和分支删除保护。如果无法确定变更文件，**默认扩大测试范围，而不是跳过检查**。

深度专项保留：
- `visual-smoke.mjs`，`quality-smoke.mjs`，`a11y-smoke.mjs`；
- `reader-deep-smoke.mjs`，`selection-composer-smoke.mjs`，`responsive-navigation-smoke.mjs`，`route-motion-ghost-smoke.mjs`；
- `excerpt-audit.mjs`，`interaction-state-smoke.mjs`，`live-sort-motion-audit.mjs`。
- Windows 自托管 Runner 的本地 build 与连通性检查，仍然只能由仓库所有者在 `main` 手动调用。

## 安全与维护原则

1. `main` 的 PR 回归必须通过。若需要避免直接推送绕过浏览器门禁，应在 GitHub Rulesets / branch protection 中要求 PR 和 `check` 状态。仓库当前 API 显示 `main` 未标记 protected，需在设置页面单独确认。
2. 取消旧 PR 的在运行构建；不取消 main 或手动的深度检查。不会让并发组误伤其他仓库任务。
3. 生产站点的只读动效对比仅在手动 `full` 时运行，不再对每一次 PR 发送额外请求。
4. 普通成功运行不上传大量重复截图；失败或手动完整审计时才上传，保留 3 天。GitHub Actions 日志和 Git 变更仍提供追溯。
5. 如果用户有意绕过 PR 直接推送 main，仍运行核心检查，但不自动重复浏览器深度检查；本策略依赖 PR 审核工作流。
6. 统一入口不是取消质量验证。新 UI/阅读器功能落地时，优先扩展 `ci-plan` 的范围规则及对应测试，而不是创建第八个 workflow 文件。

## 手动清理分支

详见 [分支档案](BRANCH_ARCHIVE.md)。在 Actions → **Waylan CI** → **Run workflow**，选择 `branches-preview` 或 `branches-prune`，后者需填入确认串。删除必须发生在已经合并档案和脚本的可信 `main` 分支。当前变更另设一个带唯一合并提交标记的**一次性清理入口**，仅在本次合并时自动尝试删除快照中 SHA 与已合并 PR 都匹配的分支；后续正常 push 不会自动清理分支。若执行未成功，可手工使用上述入口重试。

## 额度事实

GitHub API 在 2026-11-05 报告该仓库可见性为 `public`，标准 GitHub 托管 Runner 在公开仓库免费；如果历史使用量来自此前私有时期、另一私有仓库或额外收费功能，须以 GitHub Billing 页面为准。即使当前免费，统一工作流仍减少 Runner 消耗、取消浪费和维护复杂度。

## 验收标准

每个工作流改动本身仍要通过 PR 上的 `check`，并检查 workflow YAML 解析、CI 变更范围测试、原有主要单元测试、完整构建、可视化和 WCAG 回归。合并之后核对 Actions 页只保留一个新的可触发工作流；旧工作流历史记录可作为审计记录保留，不必人为删除历史。
