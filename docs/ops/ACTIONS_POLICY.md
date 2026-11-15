# Waylan CI：当前有效策略

仓库仅使用 `.github/workflows/verify.yml`。代码校验由 `scripts/ci-plan.mjs` 根据文件变化决定范围，完整浏览器审计可在 GitHub Actions 中手动启动 `Waylan CI`。

## 实际行为

- `pull_request`：仅非 Draft PR 运行检查。Ready PR 触发相应代码、构建和浏览器检查，新的提交会取消旧检查。
- `push` 到 `main`：运行核心检查，不重复完整浏览器矩阵。
- `workflow_dispatch`：按配置运行完整质量审计。
- 纯文档改动不触发应用构建。涉及代码的改动执行 TypeScript 检查、Vite 构建、Node 测试和生成产物完整性检查。
- UI 变更的浏览器检查依据 `ci-plan.mjs` 的影响范围选择；最终测试结论须查看该次运行的 Steps，不能只凭绿色状态判断真机功能。

## 质量与发布边界

当前仓库 `main` 没有启用分支保护，也没有必需状态检查。开启 PR 审核发布之前，应先测试后台 `review-pr` 模式和 GitHub Token 权限，再配置 GitHub 的合并保护。

GitHub CI 通过只代表对应提交的自动化测试结果。Cloudflare Workers Builds、D1、GitHub App 授权与真实站点需要单独验收。

发布核对方法见 [RELEASE_HANDOFF.md](RELEASE_HANDOFF.md)。
