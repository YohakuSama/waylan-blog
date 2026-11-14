import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import worker from "../worker/index";
import { database } from "./db";
import {
  base64url,
  hash,
  seal,
  unseal,
  safeReturn,
  limit,
  cookie,
} from "../worker/security";
import { commentPayload, parseMarker, cleanComment } from "../worker/github";
import { commentNotification } from "../worker/notifications";
import type { Env } from "../worker/types";
import type { Anchor, Comment } from "../shared/types";
import manifest from "../worker/generated/manifest.json";
const user = {
  login: "test-reader",
  avatarUrl: "https://avatars.githubusercontent.com/u/1",
  url: "https://github.com/test-reader",
};
const discussion = {
  id: "D_test",
  repository: { nameWithOwner: "test-owner/test-blog", isPrivate: false },
  url: "https://github.com/test-owner/test-blog/discussions/1",
};
const actual = new Map<string, any>();
let sequence = 0,
  writeTokens: string[] = [],
  failAfterWrite = false,
  offline = false,
  privateRepo = false;
let env: Env, db: ReturnType<typeof database>;
const csrf = "test-csrf",
  rawSession = "test-session-cookie";
const block = manifest[0].blocks[0];
const anchor: Anchor = {
  schema: 1,
  postId: manifest[0].id,
  version: manifest[0].version,
  segments: [
    {
      blockId: block.id,
      quote: {
        type: "TextQuoteSelector",
        exact: block.text.slice(0, 12),
        prefix: "",
        suffix: block.text.slice(12, 44),
      },
      position: { type: "TextPositionSelector", start: 0, end: 12 },
    },
  ],
};
const postId = manifest[0].id;
async function call(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.method && init.method !== "GET" && init.method !== "HEAD") {
    headers.set("Origin", "https://echo.test");
    headers.set("Content-Type", "application/json");
  }
  return worker.fetch(
    new Request("https://echo.test" + path, { ...init, headers }),
    env,
  );
}
const send = (
  body: unknown,
  headers: HeadersInit = {
    Cookie: `__Host-echo_session=${rawSession}`,
    "X-CSRF-Token": csrf,
  },
) =>
  call(`/api/posts/${postId}/comments`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
const requestBody = (extras: Record<string, unknown> = {}) => ({
  body: "这一句让我想起了一次真实的阅读。",
  anchor,
  requestId: crypto.randomUUID(),
  ...extras,
});
const node = (id: string) =>
  id === "D_test" || id === "D_other"
    ? {
        ...discussion,
        id,
        repository: { ...discussion.repository, isPrivate: privateRepo },
        comments: {
          nodes: [...actual.values()],
          totalCount: actual.size,
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }
    : actual.has(id)
      ? {
          ...actual.get(id),
          discussion: {
            ...discussion,
            repository: { ...discussion.repository, isPrivate: privateRepo },
          },
        }
      : null;
beforeEach(async () => {
  db = database();
  env = {
    DB: db.db,
    SITE_ORIGIN: "https://echo.test",
    GITHUB_REPO_OWNER: "test-owner",
    GITHUB_REPO_NAME: "test-blog",
    GITHUB_READ_TOKEN: "test-read-only-token",
    GITHUB_AUTH_PROVIDER: "github-app",
    GITHUB_APP_CLIENT_ID: "test-app-client",
    GITHUB_APP_CLIENT_SECRET: "test-app-secret",
    SESSION_SECRET: "test-only-random-secret-longer-than-32-bytes",
    GITHUB_WEBHOOK_SECRET: "test-webhook-secret",
  };
  db.sqlite
    .prepare("INSERT INTO discussions VALUES(?,?,?,?)")
    .run(postId, "D_test", 1, discussion.url);
  db.sqlite
    .prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)")
    .run(
      await hash(rawSession),
      "1",
      JSON.stringify({ ...user, authProvider: "github-app" }),
      await seal("test-current-user-token", env.SESSION_SECRET!),
      csrf,
      Math.floor(Date.now() / 1000) + 3600,
    );
  actual.clear();
  sequence = 0;
  writeTokens = [];
  failAfterWrite = false;
  offline = false;
  privateRepo = false;
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (offline) throw new TypeError("network failed");
      if (url.endsWith("/login/oauth/access_token"))
        return Response.json({
          access_token: "test-oauth-user-token",
          expires_in: 28800,
        });
      if (url.endsWith("/user"))
        return Response.json({
          id: 1,
          login: user.login,
          avatar_url: user.avatarUrl,
          html_url: user.url,
        });
      const { query, variables: v } = JSON.parse(String(init?.body));
      if (query.includes("updateDiscussionComment")) {
        writeTokens.push(new Headers(init?.headers).get("Authorization") || "");
        const current = actual.get(v.input.commentId);
        if (!current) return Response.json({ errors: [{ message: "Not found", type: "NOT_FOUND" }] });
        const updated = { ...current, body: v.input.body, updatedAt: "2026-11-01T10:00:00Z" };
        actual.set(updated.id, updated);
        return Response.json({ data: { updateDiscussionComment: { comment: updated } } });
      }
      if (query.includes("deleteDiscussionComment")) {
        writeTokens.push(new Headers(init?.headers).get("Authorization") || "");
        actual.delete(v.input.id);
        return Response.json({ data: { deleteDiscussionComment: { clientMutationId: null } } });
      }
      if (query.includes("addDiscussionComment")) {
        writeTokens.push(new Headers(init?.headers).get("Authorization") || "");
        const c = {
          id: `C_test${++sequence}`,
          body: v.input.body,
          url: `https://github.com/test-owner/test-blog/discussions/1#discussioncomment-${sequence}`,
          createdAt: "2026-10-31T10:00:00Z",
          updatedAt: "2026-10-31T10:00:00Z",
          author: user,
          replies: {
            nodes: [],
            totalCount: 0,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
          replyTo: v.input.replyToId ? { id: v.input.replyToId } : null,
        };
        actual.set(c.id, c);
        if (failAfterWrite) throw new TypeError("response lost");
        return Response.json({
          data: { addDiscussionComment: { comment: c } },
        });
      }
      if (v?.ids) return Response.json({ data: { nodes: v.ids.map(node) } });
      if (v?.id) return Response.json({ data: { node: node(v.id) } });
      return Response.json({ data: { p0: node("D_test") } });
    },
  );
});
afterEach(() => {
  mock.restoreAll();
  db.sqlite.close();
});
describe("Worker HTTP API with real SQLite schema and mocked GitHub transport", () => {
  it("edits only one's own comment, preserving GitHub metadata and CSRF checks", async () => {
    const created = (await (await send(requestBody())).json()) as any;
    const id = created.comment.id;
    const path = `/api/posts/${postId}/comments/${id}`;
    const request = (body: string, headers: HeadersInit = {
      Cookie: `__Host-echo_session=${rawSession}`,
      "X-CSRF-Token": csrf,
    }) => call(path, { method: "PUT", headers, body: JSON.stringify({ body }) });
    // Missing credentials are 401; a signed-in user missing CSRF is 403.
    assert.equal((await request("改变文字", {})).status, 401);
    assert.equal((await request("改变文字", { Cookie: `__Host-echo_session=${rawSession}` })).status, 403);
    const updated = await request("已经修改的测试评论");
    assert.equal(updated.status, 200);
    const data = (await updated.json()) as any;
    assert.equal(data.comment.body, "已经修改的测试评论");
    assert.deepEqual(data.comment.annotation?.anchor, anchor);
    assert.ok(actual.get(id).body.includes("<!-- echo:v1:"));
    assert.ok(writeTokens.every((t) => t === "Bearer test-current-user-token"));
    actual.get(id).author = { ...user, login: "someone-else" };
    assert.equal((await request("不允许改他人评论")).status, 403);
    assert.equal(actual.get(id).body.includes("不允许"), false);
  });
  it("allows a configured moderator to delete spam but not edit other authors", async () => {
    env.ADMIN_GITHUB_LOGINS = user.login;
    const created = (await (await send(requestBody())).json()) as any;
    const id = created.comment.id;
    actual.get(id).author = { ...user, login: "spam-account" };
    const path = `/api/posts/${postId}/comments/${id}`;
    const headers = { Cookie: `__Host-echo_session=${rawSession}`, "X-CSRF-Token": csrf };
    assert.equal((await call(path, {
      method: "PUT", headers, body: JSON.stringify({ body: "未经作者允许的编辑" }),
    })).status, 403);
    assert.equal((await call(path, { method: "DELETE", headers })).status, 200);
    assert.equal(actual.has(id), false);
    const session = (await (await call("/api/session", {
      headers: { Cookie: `__Host-echo_session=${rawSession}` },
    })).json()) as any;
    assert.equal(session.moderator, true);
  });
  it("deletes only one's own comment and clears anchors and comment cache", async () => {
    const created = (await (await send(requestBody())).json()) as any;
    const id = created.comment.id;
    const path = `/api/posts/${postId}/comments/${id}`;
    const remove = () => call(path, {
      method: "DELETE",
      headers: { Cookie: `__Host-echo_session=${rawSession}`, "X-CSRF-Token": csrf },
    });
    actual.get(id).author = { ...user, login: "someone-else" };
    assert.equal((await remove()).status, 403);
    actual.get(id).author = user;
    assert.equal((await remove()).status, 200);
    assert.equal(actual.has(id), false);
    assert.equal((await remove()).status, 404);
    assert.equal(
      (db.sqlite.prepare("SELECT COUNT(*) AS n FROM annotations WHERE comment_id=?").get(id) as any).n,
      0,
    );
    const after = (await (await call(`/api/posts/${postId}/comments`)).json()) as any;
    assert.equal(after.totalCount, 0);
  });
  it("keeps the exact addressee for a reply to another reply", async () => {
    const first = (await (await send(requestBody({ anchor: undefined }))).json()) as any;
    const second = (await (await send(requestBody({ replyToId: first.comment.id, anchor: undefined }))).json()) as any;
    const third = (await (await send(requestBody({ replyToId: second.comment.id, anchor: undefined }))).json()) as any;
    assert.equal(actual.get(third.comment.id).replyTo?.id, first.comment.id);
    assert.equal(parseMarker(actual.get(third.comment.id).body)?.replyTarget?.id, second.comment.id);
    assert.equal(third.comment.replyTarget?.login, user.login);
  });
  it("reads a public discussion without login", async () => {
    const response = await call(`/api/posts/${postId}/comments`);
    assert.equal(response.status, 200);
    assert.partialDeepStrictEqual(await response.json(), {
      nodes: [],
      mapped: true,
      totalCount: 0,
    });
  });
  it("returns an honest unconfigured state without fake comments", async () => {
    env = {};
    const response = await call("/api/session");
    assert.deepEqual(await response.json(), { user: null, configured: false });
    assert.partialDeepStrictEqual(
      await (await call(`/api/posts/${postId}/comments`)).json(),
      { nodes: [], mapped: false },
    );
  });
  it("returns 404 for a nonexistent article", async () =>
    assert.equal((await call("/api/posts/not-a-post/comments")).status, 404));
  it("rejects non-object JSON bodies instead of returning an internal error", async () => {
    assert.equal((await send(null)).status, 400);
    assert.equal((await send([])).status, 400);
  });
  it("requires login for a write", async () =>
    assert.equal((await send(requestBody(), {})).status, 401));
  it("rejects forged CSRF tokens", async () =>
    assert.equal(
      (
        await send(requestBody(), {
          Cookie: `__Host-echo_session=${rawSession}`,
          "X-CSRF-Token": "forged",
        })
      ).status,
      403,
    ));
  it("rejects cross-origin writes", async () => {
    const req = new Request(`https://echo.test/api/posts/${postId}/comments`, {
      method: "POST",
      headers: {
        Origin: "https://attacker.test",
        "Content-Type": "application/json",
        Cookie: `__Host-echo_session=${rawSession}`,
        "X-CSRF-Token": csrf,
      },
      body: JSON.stringify(requestBody()),
    });
    assert.equal((await worker.fetch(req, env)).status, 403);
  });
  it("writes with the current user token, persists anchors, and survives a fresh GET", async () => {
    const response = await send(requestBody());
    assert.equal(response.status, 201);
    const result = (await response.json()) as any;
    assert.ok(!result.comment.body.includes("echo:v1"));
    assert.deepEqual(writeTokens, ["Bearer test-current-user-token"]);
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) n FROM annotations").get()!.n,
      1,
    );
    assert.deepEqual(
      ((await (await call(`/api/posts/${postId}/annotations`)).json()) as any)
        .nodes[0].anchor,
      anchor,
    );
    assert.deepEqual(
      ((await (await call(`/api/posts/${postId}/comments`)).json()) as any)
        .nodes[0].annotation.anchor,
      anchor,
    );
  });
  it("does not duplicate an acknowledged retry", async () => {
    const body = requestBody();
    await send(body);
    assert.equal((await send(body)).status, 200);
    assert.equal(writeTokens.length, 1);
  });
  it("recovers a lost GitHub response without posting twice", async () => {
    failAfterWrite = true;
    const body = requestBody();
    const first = await send(body);
    assert.equal(first.status, 409);
    assert.equal(((await first.json()) as any).code, "DELIVERY_UNKNOWN");
    failAfterWrite = false;
    const retry = await send(body);
    assert.equal(retry.status, 200);
    assert.equal(writeTokens.length, 1);
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) n FROM annotations").get()!.n,
      1,
    );
  });
  it("rejects idempotency keys reused for different text", async () => {
    const body = requestBody();
    await send(body);
    assert.equal((await send({ ...body, body: "不同内容" })).status, 409);
    assert.equal(writeTokens.length, 1);
  });
  it("rejects made-up anchors and changed quotations", async () => {
    const changed = JSON.parse(JSON.stringify(anchor));
    changed.segments[0].quote.exact = "这句话根本不存在";
    changed.segments[0].position.end = changed.segments[0].quote.exact.length;
    assert.equal((await send(requestBody({ anchor: changed }))).status, 409);
    assert.equal(writeTokens.length, 0);
  });
  it("prevents new replies under a deleted empty parent", async () => {
    const created = (await (await send(requestBody({ anchor: undefined }))).json()) as any;
    actual.get(created.comment.id).body = "";
    const result = await send(requestBody({
      replyToId: created.comment.id,
      body: "不应继续回复已经删除的楼层",
      anchor: undefined,
    }));
    assert.equal(result.status, 409);
    assert.equal(((await result.json()) as any).code, "PARENT_DELETED");
  });
  it("blocks replies to missing or foreign comments", async () =>
    assert.equal(
      (await send(requestBody({ replyToId: "C_unknown" }))).status,
      404,
    ));
  it("checks a public repository before exposing any comment", async () => {
    privateRepo = true;
    assert.equal((await call(`/api/posts/${postId}/comments`)).status, 403);
  });
  it("returns a clear service failure when GitHub is unavailable", async () => {
    offline = true;
    const result = await call(`/api/posts/${postId}/comments`);
    assert.equal(result.status, 503);
    assert.equal(((await result.json()) as any).code, "GITHUB_NETWORK");
  });
  it("serves explicitly marked stale data only for temporary outages", async () => {
    await call(`/api/posts/${postId}/comments`);
    db.sqlite.prepare("UPDATE api_cache SET expires_at=0").run();
    offline = true;
    const result = (await (
      await call(`/api/posts/${postId}/comments`)
    ).json()) as any;
    assert.equal(result.stale, true);
  });
  it("does not serve stale cache when the repository becomes private", async () => {
    await call(`/api/posts/${postId}/comments`);
    db.sqlite.prepare("UPDATE api_cache SET expires_at=0").run();
    privateRepo = true;
    assert.equal((await call(`/api/posts/${postId}/comments`)).status, 403);
  });
  it("hides unavailable GitHub comments without erasing durable D1 anchors", async () => {
    const created = (await (await send(requestBody())).json()) as { comment: Comment };
    const savedComment = actual.get(created.comment.id);
    assert.ok(savedComment);
    const stored = () => Number((db.sqlite.prepare(
      "SELECT COUNT(*) AS total FROM annotations WHERE post_id=?"
    ).get(postId) as { total: number }).total);
    assert.equal(stored(), 1);
    actual.delete(created.comment.id); // GraphQL null: deleted or temporarily inaccessible.
    await env.DB!.prepare("DELETE FROM api_cache").run();
    const hidden = await call(`/api/posts/${postId}/annotations`);
    assert.equal(hidden.status, 200);
    assert.deepEqual(((await hidden.json()) as any).nodes, []);
    assert.equal(stored(), 1, "a null GitHub node must not erase durable D1 metadata");
    actual.set(created.comment.id, savedComment);
    await env.DB!.prepare("DELETE FROM api_cache").run();
    const visible = await call(`/api/posts/${postId}/annotations`);
    assert.equal(visible.status, 200);
    assert.equal(((await visible.json()) as any).nodes[0]?.commentId, created.comment.id);
    assert.equal(stored(), 1);
  });
  it("returns real feed previews and real recent echoes", async () => {
    await send(requestBody());
    const preview = (await (
      await call(`/api/feed/comments?ids=${postId}`)
    ).json()) as any;
    assert.equal(preview.posts[postId].totalCount, 1);
    const echo = (await (await call("/api/echo")).json()) as any;
    assert.equal(echo.comment.author.login, user.login);
  });
  it("blocks repeated messages with a new request ID and allows idempotent retries", async () => {
    const submitted = requestBody({ body: "同一条广告消息" });
    assert.equal((await send(submitted)).status, 201);
    assert.equal((await send(submitted)).status, 200);
    const copied = requestBody({ body: "同一条广告消息" });
    const denied = await send(copied);
    assert.equal(denied.status, 429);
    assert.equal(((await denied.json()) as any).code, "DUPLICATE_COMMENT");
    assert.equal(writeTokens.length, 1);
  });
  it("allows identical text on another post without changing old requestId hashes", async () => {
    const second = manifest.find((post) => post.id === "echo-002");
    assert.ok(second);
    db.sqlite.prepare("INSERT INTO discussions VALUES(?,?,?,?)")
      .run(second.id, "D_other", 2, "https://github.com/test-owner/test-blog/discussions/2");
    const message = "同一句话可以分别评论两篇不同文章。";
    const first = requestBody({ body: message, anchor: undefined });
    assert.equal((await send(first)).status, 201);
    const row = db.sqlite.prepare("SELECT payload_hash FROM write_intents WHERE request_id=?")
      .get(first.requestId) as { payload_hash: string };
    assert.equal(row.payload_hash, await hash(JSON.stringify({
      body: message, anchor: undefined, replyToId: undefined, replyTarget: undefined,
    })), "keep legacy persisted payload hashes valid for retries");
    const other = await call(`/api/posts/${second.id}/comments`, {
      method: "POST",
      headers: { Cookie: `__Host-echo_session=${rawSession}`, "X-CSRF-Token": csrf },
      body: JSON.stringify(requestBody({ body: message, anchor: undefined })),
    });
    assert.equal(other.status, 201, "distinct articles must not share duplicate-content suppression");
    assert.equal((await send(first)).status, 200, "acknowledged retries remain idempotent");
    const duplicate = await send(requestBody({ body: message, anchor: undefined }));
    assert.equal(duplicate.status, 429, "repeat content on the original article is still rate limited");
    assert.equal(((await duplicate.json()) as any).code, "DUPLICATE_COMMENT");
    assert.equal(writeTokens.length, 2);
  });

  it("rejects link-heavy ads before posting", async () => {
    const result = await send(requestBody({
      body: "广告 https://a.example https://b.example https://c.example",
    }));
    assert.equal(result.status, 400);
    assert.equal(((await result.json()) as any).code, "LINK_LIMIT");
    assert.equal(writeTokens.length, 0);
  });
  it("allows pasted developer examples with several URLs inside code fences", async () => {
    const example = "```js\nconst sites = ['https://a.example', 'https://b.example', 'https://c.example'];\n```";
    const result = await send(requestBody({ body: example }));
    assert.equal(result.status, 201);
  });
  it("applies anti-ad link limits when a comment is edited", async () => {
    const created = (await (await send(requestBody())).json()) as any;
    const result = await call(`/api/posts/${postId}/comments/${created.comment.id}`, {
      method: "PUT",
      headers: { Cookie: `__Host-echo_session=${rawSession}`, "X-CSRF-Token": csrf },
      body: JSON.stringify({ body: "https://a.example https://b.example https://c.example" }),
    });
    assert.equal(result.status, 400);
    assert.equal(((await result.json()) as any).code, "LINK_LIMIT");
  });
  it("keeps create/edit body validation codes, messages and rejected-write behavior identical", async () => {
    const invalid = [
      { value: null, code: "COMMENT_LENGTH" },
      { value: "   ", code: "COMMENT_LENGTH" },
      { value: "字".repeat(6001), code: "COMMENT_LENGTH" },
      { value: "<!-- echo:v1:forged -->", code: "RESERVED" },
      { value: "https://a.example https://b.example https://c.example", code: "LINK_LIMIT" },
    ];
    for (const { value, code } of invalid) {
      const result = await send(requestBody({ body: value }));
      assert.equal(result.status, 400);
      const error = (await result.json()) as { code: string; message: string };
      assert.equal(error.code, code);
      if (code === "COMMENT_LENGTH") assert.equal(error.message, "请写下 1 到 6000 字的想法。");
    }
    assert.equal(writeTokens.length, 0);
    const created = (await (await send(requestBody())).json()) as { comment: Comment };
    const original = created.comment.body;
    const route = `/api/posts/${postId}/comments/${created.comment.id}`;
    const edit = (body: unknown) => call(route, {
      method: "PUT",
      headers: { Cookie: `__Host-echo_session=${rawSession}`, "X-CSRF-Token": csrf },
      body: JSON.stringify({ body }),
    });
    for (const { value, code } of invalid) {
      const result = await edit(value);
      assert.equal(result.status, 400);
      const error = (await result.json()) as { code: string; message: string };
      assert.equal(error.code, code);
      if (code === "COMMENT_LENGTH") assert.equal(error.message, "评论需要 1 到 6000 字。");
    }
    assert.equal(writeTokens.length, 1, "invalid edits must not send GitHub mutations");
    assert.equal((await edit("更新内容")).status, 200);
    assert.equal(writeTokens.length, 2, "only one create and one valid edit should reach GitHub");
    assert.equal(original.includes("echo:v1"), false, "published comment remains scrubbed");
  });
  it("limits comments across many GitHub accounts sharing one IP", async () => {
    for (let i = 0; i < 8; i++) {
      // Simulate different authenticated users, all behind the same client IP.
      db.sqlite.prepare("UPDATE sessions SET user_id=?,user_json=?")
        .run(String(i + 10), JSON.stringify({ ...user, login: `reader-${i}`, authProvider: "github-app" }));
      assert.equal((await send(requestBody({ body: `来自不同账号 ${i}` }))).status, 201);
    }
    db.sqlite.prepare("UPDATE sessions SET user_id=?,user_json=?")
      .run("999", JSON.stringify({ ...user, login: "reader-extra", authProvider: "github-app" }));
    assert.equal((await send(requestBody({ body: "第九条评论" }))).status, 429);
  });
  it("enforces write rate limits across requests", async () => {
    for (let i = 0; i < 5; i++)
      assert.equal((await send(requestBody({ body: `不同评论 ${i}` }))).status, 201);
    assert.equal((await send(requestBody({ body: "第六条" }))).status, 429);
  });
  it("expires sessions instead of accepting stale user credentials", async () => {
    db.sqlite.prepare("UPDATE sessions SET expires_at=0").run();
    assert.equal((await send(requestBody())).status, 401);
  });
  it("logs out and invalidates the server-side session", async () => {
    const response = await call("/api/logout", {
      method: "POST",
      headers: {
        Cookie: `__Host-echo_session=${rawSession}`,
        "X-CSRF-Token": csrf,
      },
    });
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("Set-Cookie")!.includes("Max-Age=0"));
    assert.equal((await send(requestBody())).status, 401);
  });
});
describe("Page views", () => {
  const view = (headers: HeadersInit = {}, id = postId) =>
    call(`/api/posts/${id}/view`, {
      method: "POST",
      headers: { "CF-Connecting-IP": "203.0.113.7", ...headers },
    });
  it("counts a visitor once per day and exposes the total", async () => {
    assert.deepEqual(await (await view()).json(), { enabled: true, views: 1 });
    assert.deepEqual(await (await view()).json(), { enabled: true, views: 1 });
    assert.deepEqual(
      await (await view({ "CF-Connecting-IP": "203.0.113.8" })).json(),
      { enabled: true, views: 2 },
    );
    assert.deepEqual(await (await call("/api/views")).json(), {
      enabled: true,
      views: { [postId]: 2 },
    });
  });
  it("stores only opaque marks, never the address", async () => {
    await view();
    const marks = db.sqlite.prepare("SELECT mark FROM view_marks").all();
    assert.equal(marks.length, 1);
    assert.doesNotMatch(JSON.stringify(marks), /203\.0\.113/);
  });
  it("ignores crawlers and unknown posts, and refuses cross-site pings", async () => {
    assert.deepEqual(
      await (await view({ "User-Agent": "Googlebot/2.1" })).json(),
      { enabled: true, views: 0 },
    );
    assert.equal((await view({}, "not-a-post")).status, 404);
    const forged = new Request(`https://echo.test/api/posts/${postId}/view`, {
      method: "POST",
      headers: { Origin: "https://attacker.test" },
    });
    assert.equal((await worker.fetch(forged, env)).status, 403);
  });
  it("works with only a database and stays quiet without one", async () => {
    env = { DB: db.db, SITE_ORIGIN: "https://echo.test" };
    assert.deepEqual(await (await view()).json(), { enabled: true, views: 1 });
    env = { SITE_ORIGIN: "https://echo.test" };
    assert.deepEqual(await (await call("/api/views")).json(), {
      enabled: false,
      views: {},
    });
  });
  it("expires day marks in the scheduled cleanup", async () => {
    await view();
    db.sqlite.prepare("UPDATE view_marks SET expires_at=1").run();
    await worker.scheduled({} as ScheduledController, env, {} as ExecutionContext);
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) AS n FROM view_marks").get()!.n,
      0,
    );
  });
});
describe("OAuth, cryptography and rendering", () => {
  it("uses PKCE, a host-only secure cookie and a one-time state", async () => {
    const response = await call(
      "/api/auth/github?return=%2Fpost%2Fa-room-on-the-internet",
    );
    const location = new URL(response.headers.get("Location")!);
    assert.equal(location.hostname, "github.com");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.equal(location.searchParams.has("scope"), false, "GitHub App cannot request broad OAuth scopes");
    const state = location.searchParams.get("state")!;
    const flow = db.sqlite.prepare("SELECT * FROM oauth_states").get() as any;
    assert.equal(
      await hash(await unseal(flow.verifier_encrypted, env.SESSION_SECRET!)),
      location.searchParams.get("code_challenge"),
    );
    const cookie = response.headers.get("Set-Cookie")!;
    assert.ok(cookie.includes("__Host-echo_oauth"));
    assert.ok(cookie.includes("HttpOnly; SameSite=Lax"));
    assert.ok(cookie.includes("Secure"));
    const callback = await call(
      `/api/auth/callback?code=test-code&state=${state}`,
      { headers: { Cookie: `__Host-echo_oauth=${state}` } },
    );
    assert.equal(callback.status, 302);
    assert.equal(
      callback.headers.get("Location"),
      "https://echo.test/post/a-room-on-the-internet",
    );
    assert.ok(
      callback.headers.get("Set-Cookie")!.includes("__Host-echo_session"),
    );
    assert.equal(
      (
        await call(`/api/auth/callback?code=test-code&state=${state}`, {
          headers: { Cookie: `__Host-echo_oauth=${state}` },
        })
      ).status,
      400,
    );
  });
  it("reports only GitHub App mode without exposing credentials", async () => {
    const configured = await (await call("/api/status")).json() as any;
    assert.equal(configured.login, true);
    assert.equal(configured.authProvider, "github-app");
    assert.equal(configured.authProviderExplicit, true);
    assert.ok(!JSON.stringify(configured).includes(env.GITHUB_APP_CLIENT_SECRET!));

    delete env.GITHUB_AUTH_PROVIDER;
    const absent = await (await call("/api/status")).json() as any;
    assert.equal(absent.login, false);
    assert.equal(absent.authProvider, null);
    assert.equal(absent.authProviderExplicit, false);
    assert.equal((await call("/api/auth/github")).status, 503);

    env.GITHUB_AUTH_PROVIDER = "github-app";
    delete env.GITHUB_APP_CLIENT_SECRET;
    const missing = await (await call("/api/status")).json() as any;
    assert.equal(missing.login, false);
    assert.equal(missing.authProvider, null);
    assert.equal(missing.authProviderExplicit, true);
    assert.equal((await call("/api/auth/github")).status, 503);

    env.GITHUB_APP_CLIENT_SECRET = "test-app-secret";
    assert.equal((await call("/api/auth/github")).status, 302);
  });
  it("rejects a retired provider name without falling back", async () => {
    (env as unknown as { GITHUB_AUTH_PROVIDER?: string }).GITHUB_AUTH_PROVIDER = "oauth-app";
    assert.equal((await call("/api/auth/github")).status, 503);
    const status = await (await call("/api/status")).json() as any;
    assert.equal(status.login, false);
    assert.equal(status.authProvider, null);
  });
  it("uses App permissions and rejects pre-App sessions", async () => {
    db.sqlite.prepare("UPDATE sessions SET user_json=?").run(
      JSON.stringify({ login: user.login, avatarUrl: user.avatarUrl, url: user.url }),
    );
    const before = await call("/api/admin/session", {
      headers: { Cookie: `__Host-echo_session=${rawSession}` },
    });
    assert.equal(((await before.json()) as any).user, null);
    const response = await call("/api/auth/github?return=%2Fadmin");
    const location = new URL(response.headers.get("Location")!);
    assert.equal(location.searchParams.has("scope"), false);
    assert.equal(location.searchParams.get("client_id"), "test-app-client");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    const state = location.searchParams.get("state")!;
    const callback = await call(`/api/auth/callback?code=test-code&state=${state}`, {
      headers: { Cookie: `__Host-echo_oauth=${state}` },
    });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.get("Location"), "https://echo.test/admin");
    const rows = db.sqlite
      .prepare("SELECT user_json FROM sessions")
      .all() as { user_json: string }[];
    assert.ok(
      rows.some((row) => JSON.parse(row.user_json).authProvider === "github-app"),
    );
  });
  it("rejects a mismatched browser OAuth state before token exchange", async () => {
    assert.equal(
      (
        await call("/api/auth/callback?code=test&state=one", {
          headers: { Cookie: "__Host-echo_oauth=two" },
        })
      ).status,
      400,
    );
    assert.equal((fetch as any).mock.calls.length, 0);
  });
  it("restores the destination on declined authorization", async () => {
    const start = await call("/api/auth/github?return=%2Ffeed");
    const state = new URL(start.headers.get("Location")!).searchParams.get(
      "state",
    )!;
    const response = await call(
      `/api/auth/callback?error=access_denied&state=${state}`,
      { headers: { Cookie: `__Host-echo_oauth=${state}` } },
    );
    assert.equal(
      response.headers.get("Location"),
      "https://echo.test/feed?auth_error=cancelled",
    );
  });
  it("prevents return-URL injection", () => {
    for (const url of [
      "//evil.test",
      "https://evil.test",
      "/\\evil.test",
      "/api/logout",
      "/\nLocation:evil",
    ])
      assert.equal(safeReturn(url), "/feed");
    assert.equal(safeReturn("/post/hello#echo-123"), "/post/hello#echo-123");
  });
  it("encrypts and authenticates stored user tokens", async () => {
    const sealed = await seal("private-token", env.SESSION_SECRET!);
    assert.ok(!sealed.includes("private-token"));
    assert.equal(await unseal(sealed, env.SESSION_SECRET!), "private-token");
    await assert.rejects(unseal(sealed, "a-different-key"));
  });
  it("keeps GitHub metadata recoverable and out of the rendered body", () => {
    const body = commentPayload(
      "认真留下的评论",
      postId,
      "test-request-id",
      anchor,
    );
    assert.deepEqual(parseMarker(body)?.anchor, anchor);
    assert.equal(
      cleanComment({ id: "c", body } as Comment, postId).body,
      "认真留下的评论",
    );
  });
  it("does not execute HTML or javascript URLs in comment Markdown", () => {
    const html = renderToStaticMarkup(
      createElement(ReactMarkdown, {
        skipHtml: true,
        children: "hello<script>alert(1)</script> [link](javascript:alert(1))",
      }),
    );
    assert.ok(!html.includes("<script"));
    assert.ok(!html.includes("javascript:"));
  });
  it("creates private idempotent reply notifications from signed GitHub webhooks", async () => {
    env.NOTIFICATIONS_ENABLED = "true";
    env.ADMIN_GITHUB_LOGINS = "test-reader";
    const parent = (await (await send(requestBody({ anchor: undefined }))).json()) as any;
    const replyId = "C_signed-reply";
    actual.set(replyId, {
      id: replyId, body: "来自另外一位读者的回复",
      author: { ...user, login: "guest-reader" },
      replyTo: { id: parent.comment.id, author: user },
      url: "https://github.com/test-owner/test-blog/discussions/1",
      createdAt: "2026-11-02T10:00:00Z", updatedAt: "2026-11-02T10:00:00Z",
    });
    const body = JSON.stringify({
      action: "created",
      repository: { full_name: "test-owner/test-blog" },
      discussion: { node_id: "D_test" },
      comment: { node_id: replyId },
    });
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET!),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const signature = "sha256=" + [...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
    )].map((b) => b.toString(16).padStart(2, "0")).join("");
    const webhook = () => worker.fetch(new Request("https://echo.test/api/webhook/github", {
      method: "POST",
      headers: { "X-Hub-Signature-256": signature, "X-GitHub-Event": "discussion_comment" },
      body,
    }), env);
    assert.equal((await webhook()).status, 200);
    assert.equal((await webhook()).status, 200);
    const headers = { Cookie: `__Host-echo_session=${rawSession}` };
    const inbox = (await (await call("/api/notifications", { headers })).json()) as any;
    assert.equal(inbox.unread, 1);
    assert.equal(inbox.items[0].actor, "guest-reader");
    assert.equal(inbox.items[0].kind, "reply");
    assert.equal(JSON.stringify(inbox).includes("来自另外一位读者的回复"), false);
    const mark = await call("/api/notifications", {
      method: "POST", headers: { ...headers, "X-CSRF-Token": csrf },
      body: JSON.stringify({ ids: [inbox.items[0].id] }),
    });
    assert.equal(mark.status, 200);
    assert.equal(((await (await call("/api/notifications", { headers })).json()) as any).unread, 0);
  });
  it("hides deleted or unpublished article notifications without deleting stored discussions", async () => {
    env.NOTIFICATIONS_ENABLED = "true";
    db.sqlite.prepare("INSERT INTO posts(id,slug,title,version) VALUES(?,?,?,?)")
      .run("retired-story", "retired-slug", "原文章", "v1");
    db.sqlite.prepare("INSERT INTO discussions(post_id,discussion_id,discussion_number,url) VALUES(?,?,?,?)")
      .run("retired-story", "D_retired", 99, "https://github.com/test-owner/test-blog/discussions/99");
    const insert = db.sqlite.prepare(
      "INSERT INTO notifications(id,recipient_login,actor_login,post_id,comment_id,kind,created_at) VALUES(?,?,?,?,?,'new_comment',?)",
    );
    for (let i = 0; i < 32; i++)
      insert.run(`stale:${i}`, user.login, "guest", "retired-story", `comment:${i}`, 3000 + i);
    insert.run("live", user.login, "guest", postId, "active-comment", 1);
    const headers = { Cookie: `__Host-echo_session=${rawSession}` };
    const live = (await (await call("/api/notifications", { headers })).json()) as any;
    assert.equal(live.unread, 1, "stale unread messages must not inflate the badge");
    assert.equal(live.items.length, 1, "30 stale messages must not hide current notifications");
    assert.equal(live.items[0].id, "live");
    assert.equal(live.items[0].slug, manifest[0].slug);
    assert.equal(live.items[0].title, manifest[0].title);
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE post_id='retired-story'").get()!.n, 32,
      "keep historical notification metadata for possible restoration");
    assert.equal(db.sqlite.prepare("SELECT discussion_id FROM discussions WHERE post_id='retired-story'").get()!.discussion_id,
      "D_retired", "never delete actual GitHub Discussion mappings");
    await commentNotification(env, "retired-story", "D_retired", {
      action: "created", comment: { node_id: "C_retired_new" },
    });
    assert.equal(db.sqlite.prepare("SELECT COUNT(*) AS n FROM notifications WHERE post_id='retired-story'").get()!.n, 32,
      "a removed article cannot create new dead-link alerts");
  });
  it("marks all unread notifications including those outside the 30-item inbox window", async () => {
    env.NOTIFICATIONS_ENABLED = "true";
    const insert = db.sqlite.prepare(
      "INSERT INTO notifications(id,recipient_login,actor_login,post_id,comment_id,kind,created_at) VALUES(?,?,?,?,?,'new_comment',?)",
    );
    for (let i = 0; i < 35; i++)
      insert.run(`bulk:${i}`, user.login, "guest-reader", postId, `comment:${i}`, 1000 + i);
    insert.run("another-user", "someone-else", "guest-reader", postId, "outside", 2000);
    const auth = { Cookie: `__Host-echo_session=${rawSession}`, "X-CSRF-Token": csrf };
    const before = (await (await call("/api/notifications", { headers: auth })).json()) as any;
    assert.equal(before.unread, 35);
    assert.equal(before.items.length, 30);
    const sendAll = (headers: HeadersInit, body: unknown = { all: true }) =>
      call("/api/notifications", { method: "POST", headers, body: JSON.stringify(body) });
    assert.equal((await sendAll({})).status, 401);
    assert.equal((await sendAll({ Cookie: `__Host-echo_session=${rawSession}` })).status, 403);
    assert.equal((await sendAll(auth, { all: true, ids: [] })).status, 400);
    assert.equal((await sendAll(auth)).status, 200);
    const after = (await (await call("/api/notifications", { headers: auth })).json()) as any;
    assert.equal(after.unread, 0);
    assert.equal(after.items.length, 30);
    assert.ok(after.items.every((item: { read: boolean }) => item.read));
    const other = db.sqlite.prepare(
      "SELECT read_at FROM notifications WHERE id='another-user'",
    ).get() as { read_at: number | null };
    assert.equal(other.read_at, null, "must not mark another account's notifications");
  });
  it("notifies the site author of new comments and respects opt-out", async () => {
    env.NOTIFICATIONS_ENABLED = "true";
    env.ADMIN_GITHUB_LOGINS = user.login;
    const top = {
      id: "C_guest-1", body: "来自 GitHub 的公开评论",
      author: { ...user, login: "guest-account" }, replyTo: null,
    };
    actual.set(top.id, top);
    await commentNotification(env, postId, "D_test", {
      action: "created", comment: { node_id: top.id },
    });
    const headers = { Cookie: `__Host-echo_session=${rawSession}` };
    const first = (await (await call("/api/notifications", { headers })).json()) as any;
    assert.equal(first.unread, 1);
    assert.equal(first.items[0].kind, "new_comment");
    const optOut = await call("/api/notifications", {
      method: "POST", headers: { ...headers, "X-CSRF-Token": csrf },
      body: JSON.stringify({ subscribed: false }),
    });
    assert.equal(optOut.status, 200);
    actual.set("C_guest-2", { ...top, id: "C_guest-2" });
    await commentNotification(env, postId, "D_test", {
      action: "created", comment: { node_id: "C_guest-2" },
    });
    const second = (await (await call("/api/notifications", { headers })).json()) as any;
    assert.equal(second.unread, 1);
    assert.equal(second.subscribed, false);
  });
  it("restricts simulated inbox alerts to the site owner and clears only those alerts", async () => {
    env.NOTIFICATIONS_ENABLED = "true";
    const headers = { Cookie: `__Host-echo_session=${rawSession}`, "X-CSRF-Token": csrf };
    const submit = (method: "POST" | "DELETE", given: HeadersInit = headers) =>
      call("/api/notifications/test", { method, headers: given });
    assert.equal((await submit("POST")).status, 403); // Not an admin
    env.ADMIN_GITHUB_LOGINS = user.login;
    assert.equal((await submit("POST", {})).status, 401);
    assert.equal((await submit("POST", { Cookie: `__Host-echo_session=${rawSession}` })).status, 403);
    assert.equal((await submit("POST")).status, 200);
    const inboxFirst = (await (await call("/api/notifications", {
      headers: { Cookie: `__Host-echo_session=${rawSession}` },
    })).json()) as any;
    assert.equal(inboxFirst.unread, 1);
    assert.equal(inboxFirst.items[0].actor, "waylan-system");
    assert.ok(inboxFirst.items[0].id.startsWith("test:"));
    assert.equal((await submit("DELETE")).status, 200);
    const inboxLast = (await (await call("/api/notifications", {
      headers: { Cookie: `__Host-echo_session=${rawSession}` },
    })).json()) as any;
    assert.equal(inboxLast.items.length, 0);
    assert.equal(inboxLast.unread, 0);
  });
  it("rate limits owner self-test notifications and respects opt-out", async () => {
    env.NOTIFICATIONS_ENABLED = "true";
    env.ADMIN_GITHUB_LOGINS = user.login;
    const headers = { Cookie: `__Host-echo_session=${rawSession}`, "X-CSRF-Token": csrf };
    for (let i = 0; i < 4; i++)
      assert.equal((await call("/api/notifications/test", { method: "POST", headers })).status, 200);
    assert.equal((await call("/api/notifications/test", { method: "POST", headers })).status, 429);
    await call("/api/notifications", {
      method: "POST", headers,
      body: JSON.stringify({ subscribed: false }),
    });
    assert.equal((await call("/api/notifications/test", { method: "POST", headers })).status, 429);
  });
  it("advertises an enabled inbox only with configured webhook, read token and D1 migration", async () => {
    env.NOTIFICATIONS_ENABLED = "true";
    const status = () => call("/api/status").then((r) => r.json()) as Promise<{ notifications: boolean }>;
    assert.equal((await status()).notifications, true, "the migrated opt-in inbox should be available");
    delete env.GITHUB_WEBHOOK_SECRET;
    assert.equal((await status()).notifications, false,
      "missing webhook credentials must not advertise a broken notification service");
    env.GITHUB_WEBHOOK_SECRET = "test-webhook-secret";
    delete env.GITHUB_READ_TOKEN;
    assert.equal((await status()).notifications, false,
      "delivery without GitHub read access cannot send notifications");
    env.GITHUB_READ_TOKEN = "test-read-only-token";
    db.sqlite.exec("DROP TABLE notification_settings");
    assert.equal((await status()).notifications, false,
      "an unmigrated D1 database must return disabled instead of a 500");
    const inbox = await call("/api/notifications", {
      headers: { Cookie: `__Host-echo_session=${rawSession}` },
    });
    assert.equal(inbox.status, 200);
    assert.equal(((await inbox.json()) as { enabled: boolean }).enabled, false);
    const update = await call("/api/notifications", {
      method: "POST",
      headers: { Cookie: `__Host-echo_session=${rawSession}`, "X-CSRF-Token": csrf },
      body: JSON.stringify({ subscribed: false }),
    });
    assert.equal(update.status, 503,
      "writes must fail closed if notification migrations are missing");
  });
  it("keeps notifications disabled until migrations and webhook setup are enabled", async () => {
    const response = await call("/api/notifications");
    assert.deepEqual(await response.json(), { enabled: false, unread: 0, items: [] });
  });
  it("acknowledges signed GitHub App installation events without a repository", async () => {
    const body = JSON.stringify({
      action: "new_permissions_accepted",
      installation: { id: 12345 },
    });
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET!),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const signature = "sha256=" + Array.from(new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
    ), (b) => b.toString(16).padStart(2, "0")).join("");
    const deliver = (sig: string) => worker.fetch(
      new Request("https://echo.test/api/webhook/github", {
        method: "POST",
        headers: {
          "X-Hub-Signature-256": sig,
          "X-GitHub-Event": "installation",
        },
        body,
      }), env,
    );
    const response = await deliver(signature);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, ignored: true });
    assert.equal((await deliver("sha256=invalid")).status, 403);
  });
  it("validates GitHub webhook signatures and applies deletion", async () => {
    const created = (await (await send(requestBody())).json()) as any;
    const body = JSON.stringify({
      action: "deleted",
      repository: { full_name: "test-owner/test-blog" },
      discussion: { node_id: "D_test" },
      comment: { node_id: created.comment.id },
    });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature =
      "sha256=" +
      Array.from(
        new Uint8Array(
          await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
    const req = new Request("https://echo.test/api/webhook/github", {
      method: "POST",
      headers: {
        "X-Hub-Signature-256": signature,
        "X-GitHub-Event": "discussion_comment",
      },
      body,
    });
    assert.equal((await worker.fetch(req, env)).status, 200);
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) n FROM annotations").get()!.n,
      0,
    );
    const forged = new Request("https://echo.test/api/webhook/github", {
      method: "POST",
      headers: {
        "X-Hub-Signature-256": "sha256=forged",
        "X-GitHub-Event": "discussion_comment",
      },
      body,
    });
    assert.equal((await worker.fetch(forged, env)).status, 403);
  });
});
