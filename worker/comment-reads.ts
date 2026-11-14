import manifest from "./generated/manifest.json";
import type { Annotation, Comment, PageInfo } from "../shared/types";
import { COMMENT_FIELDS, REPLY_FIELDS, github, mapping, cacheGet, cleanComment } from "./github";
import { HttpError, json, now, readReady, type Env, type DiscussionMap } from "./types";
import { emptyPage, requirePost, checkDiscussion, type DiscussionNode } from "./comment-shared";

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
        // A null GitHub node can mean deleted OR temporarily inaccessible.
        // Keep its D1 anchor for a later read; exclude it from the response.
        // Explicit author deletion and verified webhooks handle durable cleanup.
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
