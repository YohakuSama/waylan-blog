import manifest from "./generated/manifest.json";
import { HttpError, json, now, type Env } from "./types";
import { clientIP, hash, limit } from "./security";

const known = new Set(manifest.map((p) => p.id));
const BOT = /bot|crawl|spider|slurp|preview|fetch|monitor|headless|lighthouse|curl|wget|python|axios|node-fetch/i;

/** All counters in one small payload, so lists never fan out into per-post requests. */
export async function readViews(env: Env) {
  if (!env.DB) return json({ enabled: false, views: {} });
  const { results } = await env.DB.prepare(
    "SELECT post_id, views FROM post_views",
  ).all<{ post_id: string; views: number }>();
  const views: Record<string, number> = {};
  for (const row of results || [])
    if (known.has(row.post_id)) views[row.post_id] = row.views;
  return json({ enabled: true, views });
}

/**
 * Counts a read at most once per visitor, post and UTC day. No cookie is set
 * and the raw IP never reaches storage — only a salted, expiring hash does.
 */
export async function recordView(request: Request, env: Env, postId: string) {
  if (!known.has(postId))
    throw new HttpError(404, "POST_NOT_FOUND", "没有找到这篇文章。");
  if (!env.DB) return json({ enabled: false, views: null });
  const current = async () =>
    (
      await env.DB!.prepare("SELECT views FROM post_views WHERE post_id=?")
        .bind(postId)
        .first<{ views: number }>()
    )?.views || 0;
  if (BOT.test(request.headers.get("User-Agent") || ""))
    return json({ enabled: true, views: await current() });
  const ip = clientIP(request);
  await limit(env, `view:${ip}`, 30, 60);
  const t = now(),
    day = Math.floor(t / 86400);
  const mark = await hash(
    `${env.SESSION_SECRET || "echo-views"}:view:${ip}:${postId}:${day}`,
  );
  const fresh = await env.DB.prepare(
    "INSERT OR IGNORE INTO view_marks(mark, expires_at) VALUES(?, ?)",
  )
    .bind(mark, (day + 2) * 86400)
    .run();
  if (!fresh.meta.changes)
    return json({ enabled: true, views: await current() });
  const row = await env.DB.prepare(
    "INSERT INTO post_views(post_id, views, updated_at) VALUES(?, 1, ?) ON CONFLICT(post_id) DO UPDATE SET views=views+1, updated_at=excluded.updated_at RETURNING views",
  )
    .bind(postId, t)
    .first<{ views: number }>();
  return json({ enabled: true, views: row?.views || 1 });
}
