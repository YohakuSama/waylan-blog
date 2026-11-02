import type { Anchor, Annotation, Comment } from "../shared/types";
import { validAnchor } from "../shared/anchors";
import { HttpError, type Env, type DiscussionMap } from "./types";
export const COMMENT_FIELDS = `id body url createdAt updatedAt author { login avatarUrl url }`;
export const REPLY_FIELDS = `replies(first:3) { totalCount pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } }`;
export async function github<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "ECHO-Blog/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new HttpError(
      503,
      "GITHUB_NETWORK",
      "GitHub 暂时没有回应，请稍后重试。",
    );
  }
  if (response.status === 401)
    throw new HttpError(401, "GITHUB_AUTH", "GitHub 登录已过期，请重新登录。");
  if (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0")
  )
    throw new HttpError(
      503,
      "GITHUB_RATE_LIMIT",
      "GitHub 正在限流，请稍后再来。",
    );
  const body = (await response.json()) as {
    data: T;
    errors?: { message: string; type?: string }[];
  };
  if (!response.ok || body.errors?.length) {
    const denied = body.errors?.some((e) => e.type === "FORBIDDEN");
    throw new HttpError(
      denied ? 403 : 502,
      "GITHUB_REJECTED",
      denied
        ? "GitHub 不允许这个操作。请检查仓库的讨论权限。"
        : "GitHub 未能完成这次请求，请稍后重试。",
    );
  }
  return body.data;
}
export async function mapping(env: Env, postId: string) {
  return env
    .DB!.prepare("SELECT * FROM discussions WHERE post_id=?")
    .bind(postId)
    .first<DiscussionMap>();
}
export function commentPayload(
  body: string,
  postId: string,
  requestId: string,
  anchor?: Anchor,
  replyTarget?: { id: string; login: string },
) {
  const data = { v: 1, postId, requestId, ...(anchor ? { anchor } : {}), ...(replyTarget ? { replyTarget } : {}) };
  // URI-encoded JSON, not HTML. GitHub hides it, allowing safe retry recovery and metadata reconstruction.
  return `${body}\n\n<!-- echo:v1:${encodeURIComponent(JSON.stringify(data))} -->`;
}
export function parseMarker(
  body: string,
): { v: number; postId: string; requestId: string; anchor?: Anchor; replyTarget?: { id: string; login: string } } | null {
  const match = body.match(/<!-- echo:v1:([^]*?) -->/);
  if (!match || match[1].length > 60000) return null;
  try {
    const data = JSON.parse(decodeURIComponent(match[1]));
    return data.v === 1 &&
      typeof data.postId === "string" &&
      typeof data.requestId === "string"
      ? data
      : null;
  } catch {
    return null;
  }
}
export function cleanComment(
  comment: Comment,
  postId: string,
  annotation?: Annotation,
): Comment {
  const marker = parseMarker(comment.body);
  const fromMarker =
    marker?.postId === postId && validAnchor(marker.anchor, postId)
      ? { id: comment.id, commentId: comment.id, anchor: marker.anchor }
      : undefined;
  return {
    ...comment,
    body: comment.body.replace(/<!-- echo:v1:[^]*? -->/g, "").trim(),
    annotation: annotation || fromMarker,
    ...(marker?.postId === postId && marker.replyTarget &&
      typeof marker.replyTarget.id === "string" &&
      typeof marker.replyTarget.login === "string" &&
      marker.replyTarget.login.length <= 39 &&
      /^[a-zA-Z0-9-]+$/.test(marker.replyTarget.login)
      ? { replyTarget: marker.replyTarget }
      : {}),
    replies: comment.replies
      ? {
          ...comment.replies,
          nodes: comment.replies.nodes.map((c) => cleanComment(c, postId)),
        }
      : undefined,
  };
}
export async function cacheGet<T>(
  env: Env,
  key: string,
  load: () => Promise<T>,
  postId: string,
  ttl = 60,
): Promise<T & { stale?: boolean }> {
  const time = Math.floor(Date.now() / 1000);
  const cached = await env
    .DB!.prepare(
      "SELECT payload,expires_at,stale_until FROM api_cache WHERE cache_key=?",
    )
    .bind(key)
    .first<{ payload: string; expires_at: number; stale_until: number }>();
  if (cached && cached.expires_at > time) return JSON.parse(cached.payload);
  try {
    const result = await load();
    await env
      .DB!.prepare(
        "INSERT INTO api_cache(cache_key,post_id,payload,expires_at,stale_until) VALUES(?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at,stale_until=excluded.stale_until",
      )
      .bind(key, postId, JSON.stringify(result), time + ttl, time + 900)
      .run();
    return result as T & { stale?: boolean };
  } catch (error) {
    if (
      cached &&
      cached.stale_until > time &&
      error instanceof HttpError &&
      error.status >= 500
    )
      return { ...JSON.parse(cached.payload), stale: true };
    throw error;
  }
}
