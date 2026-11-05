import { locateAnchor, validAnchor } from "../shared/anchors";
import type { Anchor, Comment } from "../shared/types";
import { COMMENT_FIELDS, github, mapping, cleanComment, commentPayload, parseMarker } from "./github";
import { HttpError, json, now, readReady, type Env } from "./types";
import { clientIP, hash, limit, readBody } from "./security";
import { requireSession } from "./auth";
import { checkDiscussion, requirePost, type DiscussionNode } from "./comment-shared";
import { attach, getSingle } from "./comment-reads";

// Stable entry for worker/index.ts and existing callers.
export { emptyPage, requirePost, cursor } from "./comment-shared";
export { attach, readComments, getSingle, readReplies, feedPreviews, readAnnotations, recentEcho } from "./comment-reads";

async function persistWrite(
  env: Env,
  postId: string,
  requestId: string,
  comment: Comment,
  anchor?: Anchor,
) {
  const statements = [
    env
      .DB!.prepare(
        "UPDATE write_intents SET status='sent',comment_id=? WHERE request_id=?",
      )
      .bind(comment.id, requestId),
    env.DB!.prepare("DELETE FROM api_cache WHERE post_id=?").bind(postId),
  ];
  if (anchor)
    statements.push(
      env
        .DB!.prepare(
          "INSERT INTO annotations(comment_id,post_id,anchor_json,created_at) VALUES(?,?,?,?) ON CONFLICT(comment_id) DO UPDATE SET anchor_json=excluded.anchor_json",
        )
        .bind(comment.id, postId, JSON.stringify(anchor), now()),
    );
  await env.DB!.batch(statements);
}
/** Count clickable text links; fenced code/inline code stays usable for developers. */
function checkPublicLinks(body: string) {
  const prose = body
    .replace(/```[^]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  const links = prose.match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi) || [];
  if (links.length > 2)
    throw new HttpError(400, "LINK_LIMIT", "每条评论最多包含 2 个链接。");
}

/** Keep public comment validation identical for new posts and edits.
 * The legacy length message differs between endpoints and is part of their HTTP contract.
 */
function validatedCommentBody(value: unknown, action: "create" | "edit"): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 6000)
    throw new HttpError(400, "COMMENT_LENGTH",
      action === "create" ? "请写下 1 到 6000 字的想法。" : "评论需要 1 到 6000 字。");
  const body = value.trim();
  checkPublicLinks(body);
  if (/<!--\s*echo:/i.test(body))
    throw new HttpError(400, "RESERVED", "评论中包含了保留的内部标记。");
  return body;
}

export async function writeComment(request: Request, env: Env, postId: string) {
  const post = requirePost(postId);
  if (!readReady(env))
    throw new HttpError(503, "NOT_CONFIGURED", "评论功能尚未开放。");
  const session = await requireSession(request, env),
    data = (await readBody(request, 48000)) as {
      body?: unknown;
      anchor?: unknown;
      replyToId?: unknown;
      requestId?: unknown;
    };
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new HttpError(400, "BODY", "评论内容必须是一个 JSON 对象。");
  const body = validatedCommentBody(data.body, "create");
  if (
    typeof data.requestId !== "string" ||
    !/^[a-zA-Z0-9-]{20,80}$/.test(data.requestId)
  )
    throw new HttpError(
      400,
      "REQUEST_ID",
      "提交标识无效，请重新打开输入面板。",
    );
  if (
    data.replyToId !== undefined &&
    (typeof data.replyToId !== "string" ||
      !/^[\w=+/-]{1,200}$/.test(data.replyToId))
  )
    throw new HttpError(400, "REPLY", "回复对象无效。");
  let anchor: Anchor | undefined;
  if (data.anchor !== undefined) {
    if (!validAnchor(data.anchor, postId))
      throw new HttpError(400, "ANCHOR", "划线位置的数据不完整。");
    if (!locateAnchor(data.anchor, post.blocks, post.version))
      throw new HttpError(
        409,
        "ANCHOR_CHANGED",
        "原文已经变化。请重新选择文字，输入的想法仍会保留。",
      );
    anchor = data.anchor;
  }
  const map = await mapping(env, postId);
  if (!map)
    throw new HttpError(
      409,
      "DISCUSSION_NOT_READY",
      "这篇文章的讨论还没有开放，草稿会保留。",
    );
  // Verify the destination and reply ownership before sending the current user's token.
  const check = await github<{ node: DiscussionNode | null }>(
    env.GITHUB_READ_TOKEN!,
    `query($id:ID!){node(id:$id){... on Discussion{id repository { nameWithOwner isPrivate }}}}`,
    { id: map.discussion_id },
  );
  checkDiscussion(check.node, env, map);
  let replyToId: string | undefined;
  let replyTarget: { id: string; login: string } | undefined;
  if (data.replyToId) {
    const reply = await getSingle(env, postId, data.replyToId);
    const root = reply.parentId
      ? await getSingle(env, postId, reply.parentId)
      : reply;
    if (!root.body.trim())
      throw new HttpError(409, "PARENT_DELETED", "原评论已删除，不能继续在该楼层回复。");
    replyToId = root.id;
    if (reply.parentId && reply.author?.login)
      replyTarget = { id: reply.id, login: reply.author.login };
  }
  const requestId = data.requestId,
    payloadHash = await hash(JSON.stringify({ body, anchor, replyToId, replyTarget }));
  type Intent = {
    request_id: string;
    user_id: string;
    post_id: string;
    payload_hash: string;
    status: string;
    comment_id: string | null;
  };
  let intent = await env
    .DB!.prepare("SELECT * FROM write_intents WHERE request_id=?")
    .bind(requestId)
    .first<Intent>();
  if (
    intent &&
    (intent.user_id !== session.row.user_id ||
      intent.post_id !== postId ||
      intent.payload_hash !== payloadHash)
  )
    throw new HttpError(
      409,
      "REQUEST_CONFLICT",
      "这个提交标识已经被其他内容使用。请重新打开输入面板。",
    );
  if (intent?.status === "sent" && intent.comment_id)
    return json({ comment: await getSingle(env, postId, intent.comment_id) });
  async function recover() {
    // GitHub clientMutationId is not an idempotency guarantee. Look for our hidden request marker.
    const result = await github<{ node: { comments: { nodes: Comment[] } } }>(
      env.GITHUB_READ_TOKEN!,
      `query($id:ID!){node(id:$id){... on Discussion {comments(last:100){nodes{${COMMENT_FIELDS} replies(last:100){nodes{${COMMENT_FIELDS}}}}}}}}`,
      { id: map!.discussion_id },
    );
    const candidates = result.node.comments.nodes.flatMap((c) => [
      c,
      ...(c.replies?.nodes || []),
    ]);
    const found = candidates.find((c) => {
      const m = parseMarker(c.body);
      return (
        m?.requestId === requestId &&
        m.postId === postId &&
        c.author?.login === session.user.login
      );
    });
    if (!found)
      throw new HttpError(
        409,
        "DELIVERY_UNKNOWN",
        "还无法确认上次是否送达。请稍后点“检查是否送达”，或在 GitHub 查看；不要重复新建同一条评论。",
      );
    await persistWrite(env, postId, requestId, found, anchor);
    return json({ comment: cleanComment(found, postId) });
  }
  if (intent?.status === "sending") return recover();
  // Duplicate submissions with fresh request IDs should not create more posts.
  const recentDuplicate = await env.DB!.prepare(
    "SELECT request_id FROM write_intents WHERE user_id=? AND payload_hash=? AND request_id<>? AND status IN (\x27sent\x27,\x27sending\x27) AND created_at>? LIMIT 1",
  ).bind(session.row.user_id, payloadHash, requestId, now() - 600).first();
  if (recentDuplicate)
    throw new HttpError(429, "DUPLICATE_COMMENT", "相同内容刚刚发表过，请不要重复发送。");
  const ip = clientIP(request);
  await limit(env, `write:ip:${ip}`, 8, 60);
  await limit(env, `write:ip-hour:${ip}`, 40, 3600);
  await limit(env, `write:post-user:${session.row.user_id}:${postId}`, 12, 3600);
  await limit(env, `write:user:${session.row.user_id}`, 5, 60);
  await limit(env, `write:day:${session.row.user_id}`, 80, 86400);
  const reserved =
    intent?.status === "failed"
      ? await env
          .DB!.prepare(
            "UPDATE write_intents SET status='sending' WHERE request_id=? AND status='failed' RETURNING request_id",
          )
          .bind(requestId)
          .first()
      : await env
          .DB!.prepare(
            "INSERT INTO write_intents(request_id,post_id,user_id,payload_hash,status,created_at) VALUES(?,?,?,?,'sending',?) ON CONFLICT(request_id) DO NOTHING RETURNING request_id",
          )
          .bind(requestId, postId, session.row.user_id, payloadHash, now())
          .first();
  if (!reserved) return recover();
  let comment: Comment;
  try {
    const result = await github<{ addDiscussionComment: { comment: Comment } }>(
      session.token,
      `mutation($input:AddDiscussionCommentInput!){addDiscussionComment(input:$input){comment{${COMMENT_FIELDS}}}}`,
      {
        input: {
          discussionId: map.discussion_id,
          body: commentPayload(body, postId, requestId, anchor, replyTarget),
          ...(replyToId ? { replyToId } : {}),
          clientMutationId: requestId,
        },
      },
    );
    comment = result.addDiscussionComment.comment;
    if (!comment?.id) throw new Error("missing comment");
  } catch (error) {
    if (error instanceof HttpError && error.status < 500) {
      await env
        .DB!.prepare(
          "UPDATE write_intents SET status='failed' WHERE request_id=?",
        )
        .bind(requestId)
        .run();
      if (error.status === 401)
        await env
          .DB!.prepare("DELETE FROM sessions WHERE id_hash=?")
          .bind(session.row.id_hash)
          .run();
      throw error;
    }
    throw new HttpError(
      409,
      "DELIVERY_UNKNOWN",
      "网络中断，暂时无法确认是否送达。草稿已保留，请点“检查是否送达”，避免重复发表。",
    );
  }
  try {
    await persistWrite(env, postId, requestId, comment, anchor);
  } catch {
    throw new HttpError(
      409,
      "DELIVERY_UNKNOWN",
      "GitHub 已接收，网站正在恢复关联。请点“检查是否送达”，不要重复发表。",
    );
  }
  return json({ comment: cleanComment(comment, postId) }, 201);
}
/**
 * Editing and deleting a discussion comment always uses the signed-in
 * author's user-to-server token. The server checks the exact discussion,
 * repository and author first; the client can never choose an arbitrary
 * GitHub node as a destination.
 */
export async function manageComment(
  request: Request,
  env: Env,
  postId: string,
  commentId: string,
) {
  requirePost(postId);
  if (!readReady(env))
    throw new HttpError(503, "NOT_CONFIGURED", "评论功能尚未开放。");
  const session = await requireSession(request, env);
  const map = await mapping(env, postId);
  if (!map)
    throw new HttpError(404, "COMMENT_NOT_FOUND", "这篇文章还没有开放讨论。");
  const response = await github<{
    node: (Comment & { discussion: DiscussionNode }) | null;
  }>(
    env.GITHUB_READ_TOKEN!,
    `query($id:ID!){node(id:$id){... on DiscussionComment{ ${COMMENT_FIELDS} discussion{id repository{nameWithOwner isPrivate}} }}}`,
    { id: commentId },
  );
  const current = response.node;
  if (!current)
    throw new HttpError(404, "COMMENT_NOT_FOUND", "这条评论已被删除。");
  checkDiscussion(current.discussion, env, map);
  const author = current.author?.login?.toLowerCase() === session.user.login.toLowerCase();
  const moderator = (env.ADMIN_GITHUB_LOGINS || "")
    .split(/[\s,]+/)
    .some((login) => login.toLowerCase() === session.user.login.toLowerCase());
  // Moderators may remove spam from Waylan; they cannot edit others' words.
  if (!author && !(request.method === "DELETE" && moderator))
    throw new HttpError(403, "NOT_AUTHOR", "只能管理自己的评论，管理员可删除违规内容。");
  await limit(env, `manage:user:${session.row.user_id}`, 20, 600);
  if (request.method === "PUT") {
    const data = (await readBody(request, 48000)) as { body?: unknown };
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new HttpError(400, "COMMENT_LENGTH", "评论需要 1 到 6000 字。");
    const body = validatedCommentBody(data.body, "edit");
    // Keep the original annotation and nested-reply metadata after editing.
    const marker = parseMarker(current.body);
    const original = marker?.postId === postId
      ? current.body.match(/<!-- echo:v1:[^]*? -->/)?.[0]
      : undefined;
    const result = await github<{
      updateDiscussionComment: { comment: Comment };
    }>(
      session.token,
      `mutation($input:UpdateDiscussionCommentInput!){updateDiscussionComment(input:$input){comment{${COMMENT_FIELDS}}}}`,
      {
        input: {
          commentId,
          body: original ? `${body}\n\n${original}` : body,
        },
      },
    );
    await env.DB!.prepare("DELETE FROM api_cache WHERE post_id=?")
      .bind(postId).run();
    const [updated] = await attach(env, postId, [result.updateDiscussionComment.comment]);
    return json({ comment: updated });
  }
  if (request.method === "DELETE") {
    await github(
      session.token,
      "mutation($input:DeleteDiscussionCommentInput!){deleteDiscussionComment(input:$input){clientMutationId}}",
      { input: { id: commentId } },
    );
    await env.DB!.batch([
      env.DB!.prepare("DELETE FROM api_cache WHERE post_id=?").bind(postId),
      env.DB!.prepare("DELETE FROM annotations WHERE post_id=? AND comment_id=?")
        .bind(postId, commentId),
      env.DB!.prepare("DELETE FROM write_intents WHERE post_id=? AND comment_id=?")
        .bind(postId, commentId),
    ]);
    return json({ ok: true });
  }
  throw new HttpError(405, "METHOD", "这个操作不受支持。");
}

