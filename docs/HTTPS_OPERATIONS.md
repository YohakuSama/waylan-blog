# HTTPS 与认证 Cookie 运维验收

## 实施范围

- `worker/index.ts` 在处理任何 `/api/*` 业务逻辑前，将直接抵达 Worker 的 HTTP 请求以 308 重定向至 HTTPS，不建立 OAuth 状态，也不签发 Cookie。
- `worker/security.ts` 的 OAuth 和会话 Cookie 始终使用 `__Host-` 前缀、`Secure`、`HttpOnly`、`SameSite=Lax` 和 `Path=/`。即使错误地从 HTTP 调用生成函数，也不再返回不带 Secure 的降级 Cookie。
- HTTPS API 响应（包括错误）由 Worker 添加 `Strict-Transport-Security: max-age=31536000`。公开页面和静态资源由 `public/_headers` 设置相同的 HSTS。暂不启用 `includeSubDomains` 或 `preload`，避免将尚未验证的子域加入长期约束。

## 仍需在 Cloudflare 域名控制台执行

**GitHub 仓库改动不能代替 Cloudflare Zone 层面的 HTTP → HTTPS 重定向。**

1. 检查 `waylan.org` 的边缘证书正常、HTTPS 可用，SSL/TLS 加密模式不为 Off。
2. 在 Cloudflare 的 **SSL/TLS → Edge Certificates** 开启 **Always Use HTTPS**，使页面、图片、静态资源及 API 的 HTTP 请求在边缘层统一升级。
3. 核对其他 Redirect Rules / Page Rules 没有把 HTTPS 再重定向至 HTTP；排查重定向循环。
4. 维持 `wrangler.jsonc` 中 `assets.run_worker_first: ["/api/*"]`：静态资源继续以优先静态路由服务，不因 HTTPS 修复把所有静态流量计入 Worker 执行量。因而此设置无法在 Worker 代码中统一完成，必须在域名边缘层实施。

## 生产复验命令

部署后分别执行并记录完整响应头（包括日期与部署 SHA）：

```bash
curl --max-redirs 0 -sS -D - -o /dev/null http://waylan.org/
curl --max-redirs 0 -sS -D - -o /dev/null http://waylan.org/assets/example.js
curl --max-redirs 0 -sS -D - -o /dev/null 'http://waylan.org/api/auth/github?return=%2Ffeed'
curl --max-redirs 0 -sS -D - -o /dev/null https://waylan.org/
curl --max-redirs 0 -sS -D - -o /dev/null https://waylan.org/api/session
curl -sS -L -D - -o /dev/null http://waylan.org/
```

把静态资源示例替换为当前构建实际存在的资源路径。

**成功条件：** 每个 HTTP 入口首个响应均为升级到 HTTPS 的重定向，不包含 `Set-Cookie`；HTTPS 页面与 API 响应包含 HSTS；通过 HTTPS 启动 GitHub 登录时临时 Cookie 带 `__Host-`、`Secure`、`HttpOnly` 和 `SameSite=Lax`；整个流程无循环。需在真实浏览器对登录回调、会话创建及退出再做复验。

**注意：** HSTS 只会被浏览器从 HTTPS 响应中接受；强制 HTTPS 重定向必须先于所有敏感 HTTP 请求生效。本文件记录的是实施办法，不表示控制台已配置或线上复验已通过。
