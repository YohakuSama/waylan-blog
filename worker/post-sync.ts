import manifest from "./generated/manifest.json";
import type { Env } from "./types";

/** Build output is the authority. IDs and discussion/annotation rows are never deleted. */
export type CatalogPost = { id: string; slug: string; title: string; version: string };
const reconciled = new WeakMap<D1Database, Promise<void>>();

export async function reconcilePostCatalog(
  db: D1Database, published: readonly CatalogPost[],
): Promise<{ changed: number }> {
  const current = (await db.prepare("SELECT id,slug,title,version FROM posts")
    .all<CatalogPost>()).results;
  const byId = new Map(current.map((item) => [item.id, item]));
  const nextById = new Map<string, CatalogPost>();
  const nextSlugs = new Set<string>();
  for (const post of published) {
    if (nextById.has(post.id) || nextSlugs.has(post.slug))
      throw new Error("Published post IDs and slugs must be unique.");
    nextById.set(post.id, post);
    nextSlugs.add(post.slug);
  }
  // Do not overwrite another post's historical metadata. A post being renamed
  // in this same transaction can release its old slug; an unpublished post
  // remains in D1 to preserve foreign keys and must be resolved separately.
  for (const post of published) {
    const holder = current.find((old) => old.slug === post.slug && old.id !== post.id);
    if (holder && nextById.get(holder.id)?.slug === holder.slug)
      throw new Error("A published slug belongs to another unchanged post.");
    if (holder && !nextById.has(holder.id))
      throw new Error("A published slug belongs to an unpublished historical post.");
  }
  const changed = published.filter((post) => {
    const old = byId.get(post.id);
    return !old || old.slug !== post.slug
      || old.title !== post.title || old.version !== post.version;
  });
  if (!changed.length) return { changed: 0 };

  // Free all changed slugs first to permit A↔B swaps under posts.slug UNIQUE.
  // D1 batch is atomic: a failed upsert leaves original rows and foreign keys.
  const release = changed.flatMap((post) => {
    const old = byId.get(post.id);
    return old && old.slug !== post.slug
      ? [db.prepare("UPDATE posts SET slug=? WHERE id=?")
          .bind(`__sync_reserved__${post.id}`, post.id)]
      : [];
  });
  const upserts = changed.map((post) => db.prepare(
    "INSERT INTO posts(id,slug,title,version) VALUES(?,?,?,?) " +
    "ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,version=excluded.version",
  ).bind(post.id, post.slug, post.title, post.version));
  await db.batch([...release, ...upserts]);
  return { changed: changed.length };
}

/** Reconcile on the first API request per isolate and in the daily scheduled task.
 * Failures can be retried; call sites must not take comments offline when D1
 * metadata cannot be synchronized.
 */
export function ensurePostCatalog(env: Env, force = false) {
  if (!env.DB) return Promise.resolve();
  const db = env.DB;
  if (force) reconciled.delete(db);
  let work = reconciled.get(db);
  if (!work) {
    work = reconcilePostCatalog(db, manifest).then(() => {});
    reconciled.set(db, work);
    void work.catch(() => {
      if (reconciled.get(db) === work) reconciled.delete(db);
    });
  }
  return work;
}
