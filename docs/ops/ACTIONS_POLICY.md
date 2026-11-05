# Waylan CI：保留必需门禁

GitHub Actions 统一由 `.github/workflows/verify.yml` 执行。自动触发：针对 `main` 的 PR 和主分支 push；Actions 的手动 Run workflow 用于完整的三浏览器专项回归。正式部署由独立的 Cloudflare Workers Builds 管理，不能把 GitHub CI 成功视为生产发布成功。

## 核心检查

- 源码、依赖、配置或 CI 本身变化：Node 24、`npm ci`、类型检查、构建、单元测试、静态产物与离线预览完整性检查。
- 纯 `docs/` 和 README 变化：仅做变更分类，不重复安装依赖或构建。
- CI 工作流与维护脚本本身变更：运行核心检查及 CI 分类单测，不触发无关的浏览器下载。
- 改动 UI、Reader、Feed、动效与共享样式的 PR：在核心检查之外，按 `scripts/ci-plan.mjs` 执行相关浏览器、WCAG 和交互回归。
- 合并后的 `main` push：保留核心检查，避免复制 PR 已触发的浏览器下载。
- 手动 Run workflow：强制全部专项回归，包含仅用于核验的只读生产动效对比。

## 已退役

ThinkPad Windows 自托管 Runner 的构建与连通性任务、历史分支 GC 入口、过期分支快照及专用维护脚本均不再属于 CI。GitHub Settings 中 Runner 的注册记录需单独注销；Cloudflare 预览构建也由 Cloudflare 侧独立控制。

## 防回归

保留 `tests/*.test.ts`、`scripts/ci-plan.test.mjs` 与实际被 CI 调用的视觉、无障碍、阅读器、Feed 和动效测试。构建产物 `dist/`、本地缓存、浏览器 QA 报告由 `.gitignore` 排除。失败或手动审计的 QA artifacts 保留三天。

历史 PR 和 CI 日志仍可追溯。若未来需要删除分支，应重新逐一核验 SHA、PR merged 状态和开放 PR，不能复用已完成的临时 GC 清单。
