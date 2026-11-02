import manifest from "./generated/manifest.json";
import { locateAnchor, validAnchor } from "../shared/anchors";
import type {
  Anchor,
  Annotation,
  Comment,
  CommentPage,
  PageInfo,
} from "../shared/types";
import {
  COMMENT_FIELDS,
  REPLY_FIELDS,
  github,
  mapping,
  cacheGet,
  cleanComment,
  commentPayload,
  parseMarker,
} from "./github";
import {
  HttpError,
  json,
  now,
  readReady,
  type Env,
  type DiscussionMap,
} from "./types";
import { hash, limit, readBody } from "./security";
import { requireSession } from "./auth";
export const emptyPage: CommentPage = {
  nodes: [],
  totalCount: 0,
  pageInfo: { hasNextPage: false, endCursor: null },
  discussionUrl: null,
  mapped: false,
};
export function requirePost(postId: string) {
  const post = manifest.find((p) => p.id === postId);
  if (!post)
    throw new HttpError(404, "POST_NOT_FOUND", "这篇文字暂时找不到了。");
  return post;
}
export function cursor(value: string | null) {
  if (!value) return null;
  if (value.length > 256 || !/^[a-zA-Z0-9=+/_-]+$/.test(value))
    throw new HttpError(400, "CURSOR", "分页位置无效，请重新读取。");
  return value;
}
type DiscussionNode = {
  id: string;
  repository: { nameWithOwner: string; isPrivate: boolean };
};
function checkDiscussion(
  node: DiscussionNode | null,
  env: Env,
  map: DiscussionMap,
) {
  if (!node)
    throw new HttpError(
      404,
      "DISCUSSION_NOT_FOUND",
      "这篇文章的讨论已被移除。",
    );
  if (
    node.id !== map.discussion_id ||
    node.repository.isPrivate ||
    node.repository.nameWithOwner.toLowerCase() !==
      `${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`.toLowerCase()
  )
    throw new HttpError(403, "REPOSITORY", "讨论来源未通过公开仓库校验。");
}
export async function attach(
  env: Env,
  postId: string,
  comments: Comment[],
): Promise<Comment[]> {
  if (!comments.length) return [];
  const ids = comments.flatMap((c) => [
    c.id,
    ...(c.replies?.nodes.map((r) => r.id) || []),
  ]);
  const rows = (
    await env
      .DB!.prepare(
        `SELECT comment_id,anchor_json FROM annotations WHERE post_id=? AND comment_id IN (${ids.map(() => "?").join(",")})`,
      )
      .bind(postId, ...ids)
      .all<{ comment_id: string; anchor_json: string }>()
  ).results;
  const lookup = new Map<string, Annotation>(
    rows.map((r) => [
      r.comment_id,
      {
        id: r.comment_id,
        commentId: r.comment_id,
        anchor: JSON.parse(r.anchor_json),
      },
    ]),
  );
  return comments.map((c) => {
    const result = cleanComment(c, postId, lookup.get(c.id));
    if (result.replies)
      result.replies.nodes = result.replies.nodes.map((reply) => ({
        ...reply,
        annotation: lookup.get(reply.id) || reply.annotation,
        parentId: c.id,
      }));
    return result;
  });
}
export async function readComments(
  env: Env,
  postId: string,
  after: string | null,
) {
  requirePost(postId);
  if (!readReady(env)) return json(emptyPage);
  const map = await mapping(env, postId);
  if (!map) return json(emptyPage);
  const result = await cacheGet(
    env,
    `comments:${map.discussion_id}:${after || "first"}`,
    async () => {
      const data = await github<{
        node:
          | (DiscussionNode & {
              url: string;
              comments: {
                nodes: Comment[];
                totalCount: number;
                pageInfo: PageInfo;
              };
            })
          | null;
      }>(
        env.GITHUB_READ_TOKEN!,
        `query($id:ID!,$after:String){node(id:$id){... on Discussion { id url repository { nameWithOwner isPrivate } comments(first:20,after:$after){ totalCount pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} ${REPLY_FIELDS} } } }}}`,
        { id: map.discussion_id, after },
      );
      checkDiscussion(data.node, env, map);
      return {
        nodes: await attach(env, postId, data.node!.comments.nodes),
        totalCount: data.node!.comments.totalCount,
        pageInfo: data.node!.comments.pageInfo,
        discussionUrl: data.node!.url,
        mapped: true,
      };
    },
    postId,
  );
  return json(result);
}
export async function getSingle(env: Env, postId: string, id: string) {
  requirePost(postId);
  if (!readReady(env))
    throw new HttpError(503, "NOT_CONFIGURED", "评论功能尚未开放。");
  const map = await mapping(env, postId);
  if (!map)
    throw new HttpError(404, "COMMENT_NOT_FOUND", "这篇文章还没有开放讨论。");
  return cacheGet(
    env,
    `single:${map.discussion_id}:${id}`,
    async () => {
      const data = await github<{
        node:
          | (Comment & {
              discussion: DiscussionNode;
              replyTo: { id: string } | null;
            })
          | null;
      }>(
        env.GITHUB_READ_TOKEN!,
        `query($id:ID!){node(id:$id){... on DiscussionComment { ${COMMENT_FIELDS} ${REPLY_FIELDS} replyTo { id } discussion { id repository { nameWithOwner isPrivate } } }}}`,
        { id },
      );
      if (!data.node)
        throw new HttpError(404, "COMMENT_NOT_FOUND", "这条回声可能已被删除。");
      checkDiscussion(data.node.discussion, env, map);
      const [comment] = await attach(env, postId, [data.node]);
      return {
        ...comment,
        ...(data.node.replyTo ? { parentId: data.node.replyTo.id } : {}),
      };
    },
    postId,
  );
}
export async function readReplies(
  env: Env,
  postId: string,
  id: string,
  after: string | null,
) {
  requirePost(postId);
  if (!readReady(env))
    return json({
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    });
  const map = await mapping(env, postId);
  if (!map)
    throw new HttpError(404, "COMMENT_NOT_FOUND", "这条回声暂时找不到了。");
  return json(
    await cacheGet(
      env,
      `replies:${map.discussion_id}:${id}:${after || "first"}`,
      async () => {
        const data = await github<{
          node: {
            discussion: DiscussionNode;
            replies: { nodes: Comment[]; pageInfo: PageInfo };
          } | null;
        }>(
          env.GITHUB_READ_TOKEN!,
          `query($id:ID!,$after:String){node(id:$id){... on DiscussionComment { discussion { id repository { nameWithOwner isPrivate } } replies(first:20,after:$after){ pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } } }}}`,
          { id, after },
        );
        if (!data.node)
          throw new HttpError(
            404,
            "COMMENT_NOT_FOUND",
            "这条回声可能已被删除。",
          );
        checkDiscussion(data.node.discussion, env, map);
        return {
          nodes: (await attach(env, postId, data.node.replies.nodes)).map(
            (c) => ({ ...c, parentId: id }),
          ),
          pageInfo: data.node.replies.pageInfo,
        };
      },
      postId,
    ),
  );
}
export async function feedPreviews(env: Env, ids: string[]) {
  if (ids.length > 20)
    throw new HttpError(400, "POSTS", "一次最多读取 20 篇文章。");
  ids.forEach(requirePost);
  if (!readReady(env))
    return json({
      posts: Object.fromEntries(ids.map((id) => [id, emptyPage])),
    });
  const results: Record<string, unknown> = {};
  const missing: { id: string; map: DiscussionMap; key: string }[] = [];
  for (const id of ids) {
    const map = await mapping(env, id);
    if (!map) {
      results[id] = emptyPage;
      continue;
    }
    const key = `preview:${map.discussion_id}`;
    const cached = await env
      .DB!.prepare(
        "SELECT payload FROM api_cache WHERE cache_key=? AND expires_at>?",
      )
      .bind(key, now())
      .first<{ payload: string }>();
    if (cached) results[id] = JSON.parse(cached.payload);
    else missing.push({ id, map, key });
  }
  if (missing.length) {
    const query = `query { ${missing.map((x, i) => `p${i}:node(id:${JSON.stringify(x.map.discussion_id)}){... on Discussion { id repository { nameWithOwner isPrivate } comments(last:2){totalCount nodes { ${COMMENT_FIELDS} } }}}`).join(" ")} }`;
    try {
      const data = await github<
        Record<
          string,
          | (DiscussionNode & {
              comments: { nodes: Comment[]; totalCount: number };
            })
          | null
        >
      >(env.GITHUB_READ_TOKEN!, query);
      const statements: D1PreparedStatement[] = [];
      for (let i = 0; i < missing.length; i++) {
        const x = missing[i],
          node = data[`p${i}`];
        checkDiscussion(node, env, x.map);
        const result = {
          nodes: (await attach(env, x.id, node!.comments.nodes)).reverse(),
          totalCount: node!.comments.totalCount,
          mapped: true,
        };
        results[x.id] = result;
        statements.push(
          env
            .DB!.prepare(
              "INSERT INTO api_cache(cache_key,post_id,payload,expires_at,stale_until) VALUES(?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,stale_until=excluded.stale_until",
            )
            .bind(x.key, x.id, JSON.stringify(result), now() + 60, now() + 900),
        );
      }
      if (statements.length) await env.DB!.batch(statements);
    } catch (error) {
      // A failure must remain visible. Do not turn an outage into fabricated zero comments.
      throw error;
    }
  }
  return json({ posts: results });
}
export async function readAnnotations(
  env: Env,
  postId: string,
  after: string | null,
) {
  requirePost(postId);
  if (!readReady(env)) return json({ nodes: [], nextCursor: null });
  const map = await mapping(env, postId);
  if (!map) return json({ nodes: [], nextCursor: null });
  if (after && !/^[\w=+/-]{1,200}$/.test(after))
    throw new HttpError(400, "CURSOR", "批注分页位置无效。");
  return json(
    await cacheGet(
      env,
      `annotations:${map.discussion_id}:${after || "first"}`,
      async () => {
        const rows = (
          await env
            .DB!.prepare(
              "SELECT comment_id,anchor_json FROM annotations WHERE post_id=? AND comment_id>? ORDER BY comment_id LIMIT 101",
            )
            .bind(postId, after || "")
            .all<{ comment_id: string; anchor_json: string }>()
        ).results;
        const page = rows.slice(0, 100);
        if (!page.length) return { nodes: [], nextCursor: null };
        const data = await github<{
          nodes: ({ id: string; discussion: DiscussionNode } | null)[];
        }>(
          env.GITHUB_READ_TOKEN!,
          `query($ids:[ID!]!){ nodes(ids:$ids){... on DiscussionComment { id discussion { id repository { nameWithOwner isPrivate } } }}}`,
          { ids: page.map((r) => r.comment_id) },
        );
        const visible = new Set<string>();
        for (const node of data.nodes) {
          if (!node) continue;
          checkDiscussion(node.discussion, env, map);
          visible.add(node.id);
        }
        const deleted = page.filter((row) => !visible.has(row.comment_id));
        if (deleted.length)
          await env.DB!.batch(
            deleted.map((row) =>
              env
                .DB!.prepare(
                  "DELETE FROM annotations WHERE comment_id=? AND post_id=?",
                )
                .bind(row.comment_id, postId),
            ),
          );

        return {
          nodes: page
            .filter((r) => visible.has(r.comment_id))
            .map((r) => ({
              id: r.comment_id,
              commentId: r.comment_id,
              anchor: JSON.parse(r.anchor_json),
            })),
          nextCursor: rows.length > 100 ? page.at(-1)!.comment_id : null,
        };
      },
      postId,
    ),
  );
}
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
  if (
    typeof data.body !== "string" ||
    data.body.trim().length < 1 ||
    data.body.trim().length > 6000
  )
    throw new HttpError(400, "COMMENT_LENGTH", "请写下 1 到 6000 字的想法。");
  const body = data.body.trim();
  if (/<!--\s*echo:/i.test(body))
    throw new HttpError(400, "RESERVED", "评论中包含了保留的内部标记。");
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
    replyToId = reply.parentId || reply.id;
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
  if (
    !current.author?.login ||
    current.author.login.toLowerCase() !== session.user.login.toLowerCase()
  )
    throw new HttpError(403, "NOT_AUTHOR", "只能编辑或删除自己发表的评论。");
  await limit(env, `manage:user:${session.row.user_id}`, 20, 600);
  if (request.method === "PUT") {
    const data = (await readBody(request, 48000)) as { body?: unknown };
    if (!data || typeof data !== "object" || Array.isArray(data) ||
      typeof data.body !== "string" ||
      !data.body.trim() || data.body.trim().length > 6000)
      throw new HttpError(400, "COMMENT_LENGTH", "评论需要 1 到 6000 字。");
    const body = data.body.trim();
    if (/<!--\s*echo:/i.test(body))
      throw new HttpError(400, "RESERVED", "评论中包含了保留的内部标记。");
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

export async function recentEcho(env: Env) {
  if (!readReady(env)) return json({ comment: null });
  // Only real indexed discussions; no synthetic readers or engagement numbers.
  const rows = (
    await env
      .DB!.prepare(
        "SELECT comment_id,post_id FROM write_intents WHERE status='sent' AND comment_id IS NOT NULL ORDER BY created_at DESC LIMIT 8",
      )
      .all<{ comment_id: string; post_id: string }>()
  ).results;
  for (const row of rows) {
    const post = manifest.find((p) => p.id === row.post_id);
    if (!post) continue;
    try {
      const result = await cacheGet(
        env,
        `echo:${row.comment_id}`,
        async () => ({
          comment: await getSingle(env, row.post_id, row.comment_id),
          post: { slug: post.slug, title: post.title },
        }),
        row.post_id,
        60,
      );
      return json(result);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) continue;
      throw error;
    }
  }
  return json({ comment: null });
}
