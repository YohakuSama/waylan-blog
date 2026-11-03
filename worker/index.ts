import type { Env } from "./types";
import { authReady, HttpError, json, now, readReady } from "./types";
import { callback, getSession, logout, startAuth } from "./auth";
import { clientIP, limit, requireOrigin, verifyWebhook } from "./security";
import {
  cursor,
  feedPreviews,
  getSingle,
  manageComment,
  readAnnotations,
  readComments,
  readReplies,
  recentEcho,
  writeComment,
} from "./comments";
import { readViews, recordView } from "./views";
import { admin } from "./admin";
import { ensurePostCatalog } from "./post-sync";
import { inbox, updateInbox, testInbox, commentNotification, notificationsReady } from "./notifications";
async function webhook(request: Request, env: Env) {
  if (!env.DB || !env.GITHUB_WEBHOOK_SECRET)
    throw new HttpError(503, "WEBHOOK_DISABLED", "Webhook 尚未配置。");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "BODY", "缺少内容。");
  let text = "",
    size = 0;
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1024 * 1024) {
      await reader.cancel();
      throw new HttpError(413, "BODY", "Webhook 内容太大。");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (
    !(await verifyWebhook(
      text,
      request.headers.get("X-Hub-Signature-256") || "",
      env.GITHUB_WEBHOOK_SECRET,
    ))
  )
    throw new HttpError(403, "SIGNATURE", "Webhook 签名未通过。");
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new HttpError(400, "JSON", "内容格式不正确。");
  }
  const event = request.headers.get("X-GitHub-Event");
  if (event === "ping") return json({ ok: true });
  // Installation and permission updates do not always include a repository.
  // Once the HMAC is verified, acknowledge unsupported events without accessing D1.
  if (!["discussion", "discussion_comment"].includes(event || ""))
    return json({ ok: true, ignored: true });
  if (
    payload.repository?.full_name?.toLowerCase() !==
    `${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`.toLowerCase()
  )
    throw new HttpError(403, "REPOSITORY", "Webhook 仓库不匹配。");
  const discussionId = payload.discussion?.node_id;
  if (typeof discussionId !== "string")
    throw new HttpError(400, "DISCUSSION", "缺少讨论标识。");
  const map = await env.DB.prepare(
    "SELECT post_id FROM discussions WHERE discussion_id=?",
  )
    .bind(discussionId)
    .first<{ post_id: string }>();
  if (!map) return json({ ok: true, ignored: true });
  const statements = [
    env.DB.prepare("DELETE FROM api_cache WHERE post_id=?").bind(map.post_id),
  ];
  if (
    event === "discussion_comment" &&
    payload.action === "deleted" &&
    typeof payload.comment?.node_id === "string"
  )
    statements.push(
      env.DB.prepare(
        "DELETE FROM annotations WHERE comment_id=? AND post_id=?",
      ).bind(payload.comment.node_id, map.post_id),
    );
  if (event === "discussion" && payload.action === "deleted")
    statements.push(
      env.DB.prepare("DELETE FROM discussions WHERE post_id=?").bind(
        map.post_id,
      ),
    );
  await env.DB.batch(statements);
  if (event === "discussion_comment")
    await commentNotification(env, map.post_id, discussionId, payload);
  return json({ ok: true });
}
function secure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Cache-Control", "no-store");
  if (response.headers.get("Content-Type")?.includes("json"))
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'",
    );
  return new Response(response.body, { status: response.status, headers });
}
const worker = {
  async fetch(
    request: Request,
    env: Env,
    _ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/"))
      return env.ASSETS
        ? env.ASSETS.fetch(request)
        : new Response("Not found", { status: 404 });
    try {
      if (request.method === "OPTIONS")
        throw new HttpError(405, "METHOD", "这个接口不接受跨站请求。");
      const write = request.method !== "GET" && request.method !== "HEAD";
      if (write && url.pathname !== "/api/webhook/github")
        requireOrigin(request, env);
      if (env.DB && readReady(env) && url.pathname !== "/api/webhook/github") {
        await limit(env, `api:${clientIP(request)}`, 180, 60);
        // GitHub-triggered Workers Builds do not run db:sync:remote. Align D1
        // from the deployed manifest before API reads, without taking comments
        // offline if an unrelated historical slug conflict needs attention.
        try {
          await ensurePostCatalog(env);
        } catch {
          console.error(JSON.stringify({ event: "post_catalog_sync_failed" }));
        }
      }
      let response: Response;
      if (url.pathname === "/api/status" && request.method === "GET")
        response = json({ comments: readReady(env), login: authReady(env), notifications: notificationsReady(env) });
      else if (url.pathname === "/api/session" && request.method === "GET") {
        const session = await getSession(request, env);
        response = json({
          user: session?.user || null,
          ...(session ? { csrf: session.row.csrf } : {}),
          configured: authReady(env) && readReady(env),
          ...(session ? { moderator: (env.ADMIN_GITHUB_LOGINS || "")
            .split(/[\s,]+/)
            .some((login) => login.toLowerCase() === session.user.login.toLowerCase()) } : {}),
        });
      } else if (
        url.pathname === "/api/auth/github" &&
        request.method === "GET"
      )
        response = await startAuth(request, env);
      else if (
        url.pathname === "/api/auth/callback" &&
        request.method === "GET"
      )
        response = await callback(request, env);
      else if (url.pathname === "/api/logout" && request.method === "POST")
        response = await logout(request, env);
      else if (
        url.pathname === "/api/webhook/github" &&
        request.method === "POST"
      )
        response = await webhook(request, env);
      else if (url.pathname === "/api/notifications/test" &&
        (request.method === "POST" || request.method === "DELETE"))
        response = await testInbox(request, env);
      else if (url.pathname === "/api/notifications" && request.method === "GET")
        response = await inbox(request, env);
      else if (url.pathname === "/api/notifications" && request.method === "POST")
        response = await updateInbox(request, env);
      else if (url.pathname === "/api/echo" && request.method === "GET")
        response = await recentEcho(env);
      else if (
        url.pathname === "/api/feed/comments" &&
        request.method === "GET"
      )
        response = await feedPreviews(env, [
          ...new Set(
            (url.searchParams.get("ids") || "").split(",").filter(Boolean),
          ),
        ]);
      else if (url.pathname.startsWith("/api/admin/"))
        response = await admin(request, env, url.pathname);
      else if (url.pathname === "/api/views" && request.method === "GET")
        response = await readViews(env);
      else if (
        /^\/api\/posts\/[a-z0-9-]+\/view$/.test(url.pathname) &&
        request.method === "POST"
      )
        response = await recordView(request, env, url.pathname.split("/")[3]);
      else {
        const match = url.pathname.match(
          /^\/api\/posts\/([a-z0-9-]+)\/(comments|annotations)(?:\/([^/]+))?(?:\/(replies))?$/,
        );
        if (!match)
          throw new HttpError(404, "API_NOT_FOUND", "没有找到这个接口。");
        const [, postId, resource, encodedId, replies] = match;
        let id = "";
        try {
          id = encodedId ? decodeURIComponent(encodedId) : "";
        } catch {
          throw new HttpError(400, "COMMENT_ID", "回声地址不完整。");
        }
        if (id && !/^[\w=+/-]{1,200}$/.test(id))
          throw new HttpError(400, "COMMENT_ID", "回声地址不完整。");
        if (resource === "annotations" && request.method === "GET" && !id)
          response = await readAnnotations(
            env,
            postId,
            url.searchParams.get("after"),
          );
        else if (
          resource === "comments" &&
          request.method === "GET" &&
          id &&
          replies
        )
          response = await readReplies(
            env,
            postId,
            id,
            cursor(url.searchParams.get("after")),
          );
        else if (resource === "comments" && request.method === "GET" && id)
          response = json({ comment: await getSingle(env, postId, id) });
        else if (resource === "comments" && id && !replies &&
          (request.method === "PUT" || request.method === "DELETE"))
          response = await manageComment(request, env, postId, id);
        else if (resource === "comments" && request.method === "GET")
          response = await readComments(
            env,
            postId,
            cursor(url.searchParams.get("after")),
          );
        else if (resource === "comments" && request.method === "POST" && !id)
          response = await writeComment(request, env, postId);
        else throw new HttpError(405, "METHOD", "这个操作不受支持。");
      }
      return secure(response);
    } catch (error) {
      let failure =
        error instanceof HttpError
          ? error
          : new HttpError(500, "INTERNAL", "讨论服务暂时不可用，请稍后重试。");
      if (request.method === "GET" && failure.code === "GITHUB_AUTH")
        failure = new HttpError(
          503,
          "GITHUB_UNAVAILABLE",
          "讨论服务暂时不可用，请稍后重试。",
        );
      // Never log request headers, OAuth codes, tokens, comment text, or selectors.
      if (failure.status >= 500)
        console.error(
          JSON.stringify({
            event: "echo_api_error",
            code: failure.code,
            path: url.pathname,
          }),
        );
      const response = json(
        { code: failure.code, message: failure.message },
        failure.status,
        failure.status === 429 ? { "Retry-After": "60" } : {},
      );
      return secure(response);
    }
  },
  async scheduled(
    _event: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ) {
    if (!env.DB) return;
    try {
      await ensurePostCatalog(env, true);
    } catch {
      console.error(JSON.stringify({ event: "post_catalog_sync_failed", source: "scheduled" }));
    }
    const t = now();
    if (env.NOTIFICATIONS_ENABLED === "true") {
      // Keep a bounded, private inbox; notification metadata is not archived.
      await env.DB.prepare("DELETE FROM notifications WHERE created_at<?")
        .bind(t - 180 * 86400).run();
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(t),
      env.DB.prepare("DELETE FROM oauth_states WHERE expires_at<?").bind(t),
      env.DB.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(t),
      env.DB.prepare("DELETE FROM api_cache WHERE stale_until<?").bind(t),
      env.DB.prepare("DELETE FROM view_marks WHERE expires_at<?").bind(t),
      env.DB.prepare("DELETE FROM write_intents WHERE created_at<?").bind(
        t - 90 * 86400,
      ),
    ]);
  },
};
export default worker;
