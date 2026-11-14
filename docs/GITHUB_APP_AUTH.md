# GitHub App 登录、评论与运行配置

## 当前唯一支持的认证方式

Waylan Blog 仅使用 **GitHub App 用户授权**。`wrangler.jsonc` 明确设置 `GITHUB_AUTH_PROVIDER=github-app`；如果该设置缺失、被改成未知值、App 凭据不完整，Worker 将拒绝启动登录（fail closed），不会自动切换到其他认证提供者。

GitHub App 的用户授权仍使用 `https://github.com/login/oauth/authorize`、`/api/auth/callback`、PKCE S256、一次性 state 和加密会话。这些是 GitHub App **正常运行所需的 OAuth 协议机制**，不是额外支持一种旧 App。相关 `oauth_states` D1 表及登录回调路由必须保留。

供 Cloudflare Workers Builds 获取源代码的 GitHub 连接，与用户在本站登录评论的 GitHub App 是**不同用途**的集成，不能混用其凭据。

## 配置要求

在 GitHub App 的设置中核对 Homepage 与用户授权 Callback，本站使用：

- Homepage：`https://waylan.org`
- Callback：`https://waylan.org/api/auth/callback`
- 仓库授权范围：应包含 Discussions 来源仓库 `YohakuSama/waylan-comments`，且仅授予完成读写所需权限。

Worker 的非敏感 vars（见 `wrangler.jsonc`）：

- `GITHUB_AUTH_PROVIDER=github-app`
- `SITE_ORIGIN=https://waylan.org`
- `GITHUB_REPO_OWNER=YohakuSama`，`GITHUB_REPO_NAME=waylan-comments`

Worker **Secrets**，仅在 Cloudflare 控制台或受保护终端中录入，禁止写进 Git 仓库：

- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_CLIENT_SECRET`
- `SESSION_SECRET`（至少 32 字符）
- `GITHUB_READ_TOKEN`（独立、指定公开 Discussions 仓库、只读的细粒度令牌）

内容后台另使用 `GITHUB_CONTENT_TOKEN`，它负责指定源代码仓库的编辑/提审权限，**不能代替用户登录令牌**。该令牌所需权限因 `CONTENT_PUBLISH_MODE` 而异：`direct` 需要 Contents 写；`review-pr` 还需要 Pull requests 写，参见 [发布交接](ops/RELEASE_HANDOFF.md)。

本地开发通过 `.dev.vars.example` 新建不提交版本的 `.dev.vars`，应使用独立开发 GitHub App 与正确的本地回调。不要把生产 Secret 带入本地测试或公开日志。

## 验证已经部署的版本

`GET https://waylan.org/api/status` 只返回非敏感配置状态，预期：

```json
{
  "login": true,
  "authProvider": "github-app",
  "authProviderExplicit": true
}
```

其他公开字段可能同时出现。它只能证明认证配置可用，**不能单独证明 GitHub App 具备实际评论权限**。还应在实际环境以测试账号检查登录、退出、刷新会话、发评论及 GitHub Discussions 数据一致性；不要公开 Cookie、state、code 或 Client Secret。

打开 `/api/auth/github` 时，授权跳转**不应携带 `scope=public_repo`**。只需核对 URL 的参数名和 scope 是否存在，绝不复制带有 state 的完整 URL。

旧会话如果没有 GitHub App 身份标记，会按设计被拒绝；用户可重新登录，不能重新启用另一套授权模式绕过检查。

## 旧 OAuth App 的外部配置清理（管理员操作）

**项目运行时代码不再读取旧 OAuth App 凭据，也不支持按旧 provider 登录**。但生产 Cloudflare Secrets 和 GitHub 开发者设置不属于公开仓库，代码合并无法自动删除那里的条目。

在本次代码部署、正式域名实际登录和评论通过之后，站点管理员应检查并清理：

1. Cloudflare Worker → Settings → Variables and Secrets：移除不再使用的 `GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET`（仅这些旧键；不要删除 `GITHUB_APP_CLIENT_ID`、`GITHUB_APP_CLIENT_SECRET` 或会话 Secret）。
2. GitHub Developer settings：确认原 OAuth App 不再被其他站点依赖后，撤销其授权或删除原 App；不要误删当前 GitHub App。
3. 如果曾签发旧 OAuth App 用户令牌，按 GitHub 的撤销机制清理。当前应用代码不会再解封并使用缺少 GitHub App 标识的会话。
4. 记录实际部署的 `main` SHA、Cloudflare Build / 活跃 Worker Version ID 和验证结果，避免撤销错误版本的凭据。

如果新版本出现问题，优先排查 GitHub App 的凭据、Callback、安装仓库与权限、Cloudflare 活跃版本；**不要重新引入旧 OAuth App 作为自动回退**。源代码回滚与 Cloudflare 发布回滚是两件事，参见 [生产发布与回滚交接](ops/RELEASE_HANDOFF.md)。
