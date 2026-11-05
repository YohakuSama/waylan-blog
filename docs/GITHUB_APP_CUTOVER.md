# GitHub App 登录切换与生产验证

## 现状

本站已支持 `GITHUB_AUTH_PROVIDER=github-app`，但 `worker/types.ts` 在变量缺失时仍默认选择 `oauth-app`。旧 OAuth 模式的授权 URL 会携带 `scope=public_repo`；GitHub App 模式不会传递该 OAuth scope。**仓库的 GitHub App 支持不等于 Cloudflare 生产环境已经启用。**

Cloudflare Workers Builds 用于读取私有源码的 GitHub App，与本站用于读者登录、给 `YohakuSama/waylan-comments` 添加 Discussions 评论的 GitHub App 是两个独立集成。不要将两者的权限或凭据混用。

## 先确定线上实际使用哪种模式（无需登录）

当前版本可读取 `https://waylan.org/api/status`：

- `login: true` 表示登录配置看起来完整；**不能证明 GitHub App 安装权限、评论写入或真实 OAuth 回调一定成功**。
- `authProvider: "github-app"` 表示 Worker 正在使用 GitHub App 凭据分支。
- `authProvider: "oauth-app"` 表示 Worker 正在使用旧 OAuth App，仍可能请求 `public_repo`。
- `authProvider: null` 表示没有满足当前认证模式的必需配置。
- `authProviderExplicit: false` 表示未显式设置 `GITHUB_AUTH_PROVIDER`，正在使用兼容性回退；应排查生产变量，不能视为完成最小授权切换。
- 接口**不返回** Client ID、Client Secret、访问令牌或用户会话。

只有返回上述新字段才能说明这个**新 Worker 版本**被部署。若没有字段，先核对 Cloudflare 部署版本。

## 切换前核对

1. Cloudflare Dashboard → Workers & Pages → `waylan-blog` → **Settings → Variables and Secrets**。
2. 只查看**名称与存在性**，确认 `GITHUB_APP_CLIENT_ID` 和 `GITHUB_APP_CLIENT_SECRET` 已配置；**Secret 必须保持隐藏，切勿复制到聊天或 Git 仓库**。它们与旧 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` 是不同的变量。
3. 在 GitHub App 的实际管理页检查回调地址 `https://waylan.org/api/auth/callback`、安装仓库范围（应覆盖 `YohakuSama/waylan-comments`）、用户授权能力以及 Discussions 评论需要的权限。只授予必要仓库和权限。GitHub App 用户令牌的权限是**用户权限与 App 已授予权限的交集**。
4. **先保证有一个可回滚的成功 Worker 版本**，并确认 Cloudflare 构建能正常通过。

## 切换与验证

**当前部署目标已经在 `wrangler.jsonc` 的非敏感 `vars` 中显式设置 `GITHUB_AUTH_PROVIDER=github-app`。** Cloudflare Worker 已有的 `GITHUB_APP_CLIENT_ID` 和 `GITHUB_APP_CLIENT_SECRET` 继续作为加密 Secret 在控制台保存；**绝不能**把 Client Secret 或任何访问令牌写进 Wrangler 的 `vars` 或公开仓库。以后通过 `wrangler deploy` 发布时，以版本化的 `wrangler.jsonc` 为生产认证模式的来源，避免只在控制台增加普通变量而被下一次部署覆盖。

再次访问 `/api/status`，预期 `login: true`、`authProvider: "github-app"`、`authProviderExplicit: true`。如果 `login: false`，先核对变量/绑定，停止进行评论测试。随后使用全新的隐私浏览器会话测试：

1. 打开 `https://waylan.org/api/auth/github`，仅检查**跳转 URL 的参数名及 scope**，不要分享 `state` 或 Cookie 值。应不包含 `scope=public_repo`。
2. 完成 GitHub App 登录，确认回到站内且用户正确显示。
3. 在真实文章完成一条测试评论、读取和删除（如果允许），并在 GitHub Discussions 核对该条评论。
4. 用站长身份核对后台登录、内容读取。不要仅凭前台登录成功就判定后台发布可用。
5. 测试退出与重新登录。**切换 provider 后旧 OAuth 会话按设计失效**，需要重新授权。

## 出现故障时

若出现 503、GitHub 授权失败或评论写入失败：保存状态与错误码，核对变量是否完整、GitHub App 安装范围及 Discussions 权限。若恢复服务必须临时回切旧 provider，则会重新出现较宽的 `public_repo` 授权请求，应作为**明确标注的安全风险**记录，并尽快完成 App 迁移。不要在未取得证据前删除旧凭据、重新创建 App 或把 `public_repo` 当作 App 的必要权限。

正式关闭 F-04 需要同时拥有：生产部署 SHA、`/api/status` 返回 App 模式、授权跳转不含广泛 scope、真实评论可用、旧 OAuth 授权已按计划撤销的验证证据。
