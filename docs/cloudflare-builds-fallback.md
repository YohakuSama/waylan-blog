# Cloudflare Workers Builds 初始化超时：手动部署备用方案

当 Workers Builds 一直停留在 `Initializing build environment`，且 GitHub 的 build/test 任务已通过时，可以使用 GitHub Actions 在 GitHub runner 上完成构建，再用 Wrangler 发布到同一 Cloudflare Worker。

本流程不会修复 Cloudflare Builds 自身的初始化故障；它是独立的应急部署路径。**默认不运行，不会在 push 或合并 PR 时自动发布。**

## 准备（仅仓库管理者）

1. Cloudflare Dashboard → My Profile / API Tokens → Create Token，创建仅允许当前 Cloudflare 账号编辑 Workers 的 API Token。权限请遵照 [Cloudflare 官方 GitHub Actions 教程](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)；不要使用 Global API Key。
2. 从 Cloudflare Dashboard 的 Account Details 找到 **Account ID**。
3. GitHub 私有仓库 → Settings → Secrets and variables → Actions → New repository secret，分别添加：
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 的 Account ID。
   - `CLOUDFLARE_API_TOKEN`：上一步的受限 Token。
4. 这些值只能填写到 GitHub Actions Secrets，**不要发送到聊天、提交到 Git 或粘贴到公开 issue / 日志**。

## 手动执行

1. 等本变更合并到 `main` 后，进入 GitHub → Actions → **Manual Cloudflare deployment (fallback)**。
2. 选择 **Run workflow**，分支选择 `main`。
3. 检查整个 job：它依次执行 `npm ci`、`npm run check`、`validate-deploy`，然后才调用 `npx wrangler deploy --config wrangler.jsonc`。
4. 看到 Wrangler 发布成功后，再到 Cloudflare Worker → Deployments 检查对应版本，随后测试 https://waylan.org 上的最新改动。

## 安全边界

- 不在 PR、push、计划任务时自动部署；只有仓库 Actions 页面手动执行才触发。
- 仅 `main` 允许发布，保留既有 Cloudflare Worker 名 `waylan-blog` 与 `wrangler.jsonc` 配置。
- 本备用部署**不会运行 D1 migrations**，不删除或重建现有 D1 数据库；如果未来版本引入新迁移，需要独立审核和执行。
- Cloudflare 的原 Git 集成在确认新路径可用前不要随意拆除；避免同时启用两个自动发布途径造成竞态。
- 如果 GitHub Actions 的 Wrangler 发布也失败，应根据报错（鉴权、API、配额、绑定）单独处理，不应把 Cloudflare Builds 初始化超时归咎于前端代码。

## 原故障调查

连续多次 Cloudflare Builds 的完整日志仅包含初始化开始和超时，而没有 npm、Vite 或 Wrangler 编译日志。GitHub Actions `check` 和 `quality` 对主分支已成功运行。以上只证明 GitHub CI 的构建环境可用，**不能判断 Cloudflare 的每个独立部署环境都正常**。

依次检查 Cloudflare Worker → Settings → Build 的关联仓库、分支及 Build API Token；查看 Cloudflare [构建排障文档](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/) 和 [服务状态](https://www.cloudflarestatus.com/)。如果反复初始化超时，连同 Build ID 和时间提交给 Cloudflare 支持。
