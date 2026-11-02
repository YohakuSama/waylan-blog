import { getSession, requireSession } from "./auth";
import { github, parseMarker } from "./github";
import { HttpError, json, now, type Env } from "./types";
import { readBody } from "./security";

export const notificationsReady = (env: Env) =>
  env.NOTIFICATIONS_ENABLED === "true" && !!env.DB;

type NotificationRow = {
  id: string;
  recipient_login: string;
  actor_login: string;
  post_id: string;
  slug: string;
  title: string;
  comment_id: string;
  kind: "reply" | "new_comment";
  created_at: number;
  read_at: number | null;
};

export async function inbox(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session) return json({ enabled: false, unread: 0, items: [] });
  if (!notificationsReady(env))
    return json({ enabled: false, unread: 0, items: [] });
  const login = session.user.login.toLowerCase();
  const enabled = (await env.DB!.prepare(
    "SELECT enabled FROM notification_settings WHERE recipient_login=?",
  ).bind(login).first<{ enabled: number }>())?.enabled !== 0;
  const unread = (await env.DB!.prepare(
    "SELECT COUNT(*) AS count FROM notifications WHERE recipient_login=? AND read_at IS NULL",
  ).bind(login).first<{ count: number }>())?.count || 0;
  const rows = (await env.DB!.prepare(
    `SELECT n.*, p.slug, p.title
     FROM notifications n JOIN posts p ON p.id=n.post_id
     WHERE n.recipient_login=?
     ORDER BY n.created_at DESC LIMIT 30`,
  ).bind(login).all<NotificationRow>()).results;
  return json({
    enabled: true,
    subscribed: enabled,
    unread,
    items: rows.map((row) => ({
      id: row.id,
      actor: row.actor_login,
      slug: row.slug,
      title: row.title,
      commentId: row.comment_id,
      kind: row.kind,
      time: row.created_at,
      read: row.read_at !== null,
    })),
  });
}

export async function updateInbox(request: Request, env: Env) {
  if (!notificationsReady(env))
    throw new HttpError(503, "NOTIFICATIONS_OFF", "站内通知尚未启用。");
  const session = await requireSession(request, env);
  const login = session.user.login.toLowerCase();
  const body = (await readBody(request, 2048)) as {
    ids?: unknown;
    subscribed?: unknown;
  };
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new HttpError(400, "BODY", "请求格式不正确。");
  if (typeof body.subscribed === "boolean") {
    await env.DB!.prepare(
      "INSERT INTO notification_settings(recipient_login,enabled) VALUES(?,?) ON CONFLICT(recipient_login) DO UPDATE SET enabled=excluded.enabled",
    ).bind(login, body.subscribed ? 1 : 0).run();
    return json({ ok: true });
  }
  if (!Array.isArray(body.ids) || body.ids.length > 30 ||
    body.ids.some((id) => typeof id !== "string" || id.length > 240))
    throw new HttpError(400, "NOTIFICATION_IDS", "通知标识无效。");
  if (body.ids.length)
    await env.DB!.prepare(
      `UPDATE notifications SET read_at=? WHERE recipient_login=?
       AND id IN (${body.ids.map(() => "?").join(",")}) AND read_at IS NULL`,
    ).bind(now(), login, ...body.ids).run();
  return json({ ok: true });
}

type GitHubComment = {
  id: string;
  body: string;
  author: { login: string } | null;
  replyTo: { id: string; author: { login: string } | null } | null;
  discussion: { id: string } | null;
};

/** Call only after GitHub webhook HMAC + repository checks succeeded. */
export async function commentNotification(
  env: Env,
  postId: string,
  discussionId: string,
  payload: any,
) {
  if (!notificationsReady(env) || !env.GITHUB_READ_TOKEN) return;
  const commentId = payload.comment?.node_id;
  if (typeof commentId !== "string" || commentId.length > 240) return;
  if (payload.action === "deleted") {
    await env.DB!.prepare("DELETE FROM notifications WHERE comment_id=?")
      .bind(commentId).run();
    return;
  }
  if (payload.action !== "created") return;
  // Trust the GitHub API for the author, parent and discussion, not webhook free text.
  const result = await github<{ node: GitHubComment | null }>(
    env.GITHUB_READ_TOKEN,
    `query($id:ID!){node(id:$id){... on DiscussionComment {
      id body author{login} replyTo{id author{login}} discussion{id}
    }}}`,
    { id: commentId },
  );
  const item = result.node;
  if (!item || item.discussion?.id !== discussionId || !item.author?.login) return;
  const actor = item.author.login.toLowerCase();
  const recipients = new Map<string, "reply" | "new_comment">();
  const marker = parseMarker(item.body);
  let target = item.replyTo?.author?.login?.toLowerCase();
  if (
    item.replyTo && marker?.postId === postId &&
    marker.replyTarget?.id && marker.replyTarget.login
  ) {
    // Confirm a claimed nested addressee belongs to the same Discussion.
    const found = await github<{
      node: { author: { login: string } | null; discussion: { id: string } | null } | null;
    }>(
      env.GITHUB_READ_TOKEN,
      `query($id:ID!){node(id:$id){... on DiscussionComment{author{login} discussion{id}}}}`,
      { id: marker.replyTarget.id },
    );
    if (found.node?.discussion?.id === discussionId &&
      found.node.author?.login.toLowerCase() === marker.replyTarget.login.toLowerCase())
      target = found.node.author.login.toLowerCase();
  }
  if (target && target !== actor) recipients.set(target, "reply");
  // Site owner receives new-comment activity (including replies), but never self-alerts.
  for (const login of (env.ADMIN_GITHUB_LOGINS || "").split(/[\s,]+/)) {
    const recipient = login.trim().toLowerCase();
    if (recipient && recipient !== actor && !recipients.has(recipient))
      recipients.set(recipient, "new_comment");
  }
  const timestamp = now();
  const statements = [];
  for (const [recipient, kind] of recipients) {
    const settings = await env.DB!.prepare(
      "SELECT enabled FROM notification_settings WHERE recipient_login=?",
    ).bind(recipient).first<{ enabled: number }>();
    if (settings?.enabled === 0) continue;
    statements.push(env.DB!.prepare(
      `INSERT OR IGNORE INTO notifications
       (id,recipient_login,actor_login,post_id,comment_id,kind,created_at)
       VALUES(?,?,?,?,?,?,?)`,
    ).bind(`${commentId}:${recipient}:${kind}`, recipient, actor, postId, commentId, kind, timestamp));
  }
  if (statements.length) await env.DB!.batch(statements);
}
