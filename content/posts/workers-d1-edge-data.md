---
id: echo-003
slug: workers-d1-edge-data
title: Cloudflare Workers + D1：一个小而完整的边缘数据层
excerpt: 静态站点只需要很少的服务端能力：登录、评论和批注。用一个 Worker 同时托管静态资源与 API，再配一个 D1 数据库，就能覆盖这些需求。
date: 2026-10-24
topic: dev
tags: [Cloudflare, D1, SQLite, Workers]
cover: /art/walk.svg
coverAlt: 沙色地面上一棵树投下长长的影子（示意插图）
---
<!-- block:opening -->
这个博客的服务端只做三件事：完成 GitHub 登录、保存评论与批注、为页面提供讨论数据。为这三件事维护一台服务器显然不值得，所以我选择了 Cloudflare Workers 加 D1：Worker 同时托管静态资源和 API，D1 提供一个基于 SQLite 的关系型数据库。

<!-- block:h-shape -->
## 部署形态

<!-- block:shape -->
构建产物 `dist/` 通过 Workers Static Assets 发布，请求先匹配静态文件，未命中的 `/api/*` 请求再交给 Worker 代码处理。这样页面和 API 同源，Cookie 不需要跨站，也不需要额外配置 CORS。

<!-- block:h-schema -->
## 用迁移管理表结构

<!-- block:schema -->
D1 的表结构通过 Wrangler 的迁移命令管理。每次变更都是一个带序号的 SQL 文件，先在本地数据库验证，再应用到远程：

<!-- block:schema-cmd -->
```bash
$ npx wrangler d1 create echo-db
$ npx wrangler d1 migrations create echo-db add_comments
$ npx wrangler d1 migrations apply echo-db --local
$ npx wrangler d1 migrations apply echo-db --remote
```

<!-- block:schema-sql -->
```sql
CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id),
  block_id TEXT,
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX comments_post_created ON comments (post_id, created_at);
```

<!-- block:schema-note -->
约束尽量写在数据库里：长度限制、外键和非空字段。Worker 里的校验负责给出友好的错误信息，数据库约束负责兜底，两者不能互相替代。

<!-- block:h-query -->
## 在 Worker 中查询

<!-- block:query -->
D1 通过绑定注入到 `env` 中。所有参数都使用 `bind` 传入，不拼接 SQL 字符串：

<!-- block:query-code -->
```ts
interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/comments" && request.method === "GET") {
      const postId = url.searchParams.get("post");
      if (!postId) return Response.json({ error: "missing post" }, { status: 400 });
      const { results } = await env.DB.prepare(
        "SELECT id, block_id, body, created_at FROM comments WHERE post_id = ?1 ORDER BY created_at LIMIT 50",
      )
        .bind(postId)
        .all();
      return Response.json(results);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
```

<!-- block:batch -->
需要同时写多张表时，使用 `env.DB.batch([...])`。批量执行的语句作为一个事务提交，其中任何一条失败，整批都会回滚，不会留下只写了一半的数据。

<!-- block:h-sync -->
## 内容与数据库的同步

<!-- block:sync -->
文章本身是 Markdown，不存进数据库；但评论需要外键指向文章。构建脚本因此会生成一份 `posts.sql`，用 `INSERT ... ON CONFLICT(id) DO UPDATE` 把文章 id、slug、标题和内容版本写入 `posts` 表。因为以 id 为键，改 slug 或标题不会影响已有评论。

<!-- block:quote -->
> 边缘数据层的价值不在“边缘”，而在它足够小：一个绑定、几张表、一组迁移文件。

<!-- block:h-local -->
## 本地开发与测试

<!-- block:local -->
`wrangler dev` 会在本地模拟 Worker 运行时，并把 D1 绑定指向本地的 SQLite 文件，开发时的读写不会触及线上数据。自动化测试则走另一条路：D1 的 SQL 方言就是 SQLite，因此测试可以直接用 Node 内置的 SQLite 执行同一批迁移文件，再把一个实现了 `prepare`、`bind`、`all`、`batch` 的薄适配层注入 Worker。这样测试运行的是真实的表结构和约束，而不是手写的模拟返回值。

<!-- block:local-cmd -->
```bash
$ npx wrangler d1 migrations apply echo-db --local
$ npx wrangler dev
$ npm test
```

<!-- block:local-note -->
这种做法的边界也要清楚：它验证的是 SQL 与业务逻辑，不覆盖网络延迟、并发写入和平台限额。上线前我仍然会在预发环境里对远程数据库跑一遍关键路径。

<!-- block:h-limits -->
## 需要注意的地方

<!-- block:limits-list -->
- D1 是 SQLite 语义，不是 PostgreSQL。窗口函数、JSON 函数可用，但具体能力以 SQLite 为准。
- 本地开发使用 `--local` 数据库，它和远程数据库完全独立，迁移需要分别应用。
- 写操作一定要有身份校验与频率限制，Worker 是公开入口。

<!-- block:refs -->
参考：[Cloudflare D1 文档](https://developers.cloudflare.com/d1/) · [D1 Worker Binding API](https://developers.cloudflare.com/d1/worker-api/) · [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) · [Wrangler 命令](https://developers.cloudflare.com/workers/wrangler/commands/)
