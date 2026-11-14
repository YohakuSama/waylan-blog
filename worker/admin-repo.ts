/** GitHub source-repository boundary for admin reads and atomic writes.
 * No OAuth/session/CSRF logic: admin.ts checks authorization before invoking it.
 * Keep optimistic head checks, REST/GraphQL errors, and content hashing here.
 */
import { HttpError, type Env } from "./types";
import { github } from "./github";

export const POSTS = "content/posts";
export type Review = { number: number; url: string; branch: string };
export type Publication = { commit: string; review?: Review };
export type ReviewEdit = { number: number; commit: string };
export type ReviewTarget = { kind: "post" | "site" | "delete"; file?: string };
export type ReviewState = Review & {
  title: string;
  state: "open" | "merged" | "closed";
  draft: boolean;
  target: ReviewTarget | null;
  updatedAt: string;
};
function targetOf(changes: Change[]): ReviewTarget {
  const post = changes.find((c) => c.path.startsWith(POSTS + "/"));
  if (!post) return { kind: "site" };
  return { kind: "remove" in post ? "delete" : "post", file: post.path.slice(POSTS.length + 1) };
}
function targetMarker(target: ReviewTarget) {
  return `<!-- waylan-admin-review-target:${target.kind}:${encodeURIComponent(target.file || "")} -->`;
}
function targetFromBody(body: string | null): ReviewTarget | null {
  const match = (body || "").match(/<!-- waylan-admin-review-target:(post|site|delete):([^<\n]*) -->/);
  if (!match) return null;
  try {
    const file = decodeURIComponent(match[2]);
    if (match[1] === "site") return file ? null : { kind: "site" };
    if (!file.endsWith(".md") || file.includes("/") || file.includes("\\")) return null;
    return { kind: match[1] as "post" | "delete", file };
  } catch { return null; }
}
const ADMIN_REVIEW_MARKER = "<!-- waylan-admin-review -->";
const REVIEW_BRANCH = /^content\/review-\d+-[0-9a-f]{8}$/;

/** Read-only review queue: only PRs created by this admin workflow in this repository. */
export async function recentReviews(env: Env): Promise<{ reviews: ReviewState[]; truncated: boolean }> {
  if (publicationMode(env) !== "review-pr") return { reviews: [], truncated: false };
  type Pull = {
    number: number;
    title: string;
    body: string | null;
    state: string;
    merged_at: string | null;
    updated_at: string;
    head: { ref: string; sha: string; repo: { full_name: string } | null };
    draft: boolean;
    base: { ref: string };
  };
  const items = await rest<Pull[]>(env, "GET",
    "/pulls?state=all&base=main&sort=updated&direction=desc&per_page=100");
  const { owner, name } = repo(env);
  const reviews = items.filter((pr) =>
    Number.isInteger(pr.number) && pr.number > 0 && pr.base?.ref === "main" &&
    pr.head?.repo?.full_name === `${owner}/${name}` &&
    REVIEW_BRANCH.test(pr.head.ref) &&
    (pr.body || "").includes(ADMIN_REVIEW_MARKER),
  ).map((pr) => ({
    number: pr.number,
    title: pr.title,
    branch: pr.head.ref,
    url: `https://github.com/${owner}/${name}/pull/${pr.number}`,
    state: pr.merged_at ? "merged" as const :
      pr.state === "closed" ? "closed" as const : "open" as const,
    draft: pr.draft,
    target: targetFromBody(pr.body),
    updatedAt: pr.updated_at,
  }));
  return { reviews, truncated: items.length === 100 };
}
/** Revalidate the GitHub PR before reading or updating its branch. */
export async function reviewBase(env: Env, number: number) {
  if (publicationMode(env) !== "review-pr" || !Number.isSafeInteger(number) || number < 1)
    throw new HttpError(422, "CONTENT_REVIEW", "审核 PR 编号无效或审核模式尚未启用。");
  type Pull = {
    number: number; state: string; draft: boolean; body: string | null;
    head: { ref: string; sha: string; repo: { full_name: string } | null };
    base: { ref: string };
  };
  const pr = await rest<Pull>(env, "GET", `/pulls/${number}`);
  const { owner, name } = repo(env);
  const target = targetFromBody(pr.body);
  if (pr.number !== number || pr.state !== "open" || !pr.draft ||
    pr.base?.ref !== "main" || pr.head?.repo?.full_name !== `${owner}/${name}` ||
    !REVIEW_BRANCH.test(pr.head.ref) ||
    !(pr.body || "").includes(ADMIN_REVIEW_MARKER) || !target)
    throw new HttpError(409, "CONTENT_REVIEW_CLOSED",
      "此 PR 已合并、关闭或进入正式审核，不能再从后台改动。请刷新审核队列。");
  const at = await head(env, pr.head.ref);
  if (at.oid !== pr.head.sha) throw conflict();
  return {
    at, target,
    review: { number, branch: pr.head.ref, url: `https://github.com/${owner}/${name}/pull/${number}` },
  };
}
export function publicationMode(env: Env): "direct" | "review-pr" {
  const mode = env.CONTENT_PUBLISH_MODE || "direct";
  if (mode !== "direct" && mode !== "review-pr")
    throw new HttpError(503, "CONTENT_PUBLISH_MODE", "内容发布模式不正确，请检查 CONTENT_PUBLISH_MODE。");
  if (mode === "review-pr" && repo(env).branch !== "main")
    throw new HttpError(503, "CONTENT_PUBLISH_BRANCH", "PR 审核模式必须以 main 作为内容读取分支。");
  return mode;
}
export const repo = (env: Env) => {
  const [owner = "", name = ""] = (env.CONTENT_REPO || "").split("/");
  return { owner, name, branch: env.CONTENT_BRANCH || "main" };
};

// ---------------------------------------------------------------- GitHub I/O

const tokenError = () =>
  new HttpError(
    503,
    "CONTENT_TOKEN",
    "无法访问源码仓库：请检查 CONTENT_REPO，以及 GITHUB_CONTENT_TOKEN 是否有效、是否对该仓库有 Contents 读写权限。",
  );
export const conflict = () =>
  new HttpError(
    409,
    "CONFLICT",
    "仓库刚刚在别处被修改过。请刷新后台，确认最新内容后再保存。",
  );

async function rest<T>(env: Env, method: string, path: string, body?: unknown) {
  const { owner, name } = repo(env);
  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${owner}/${name}${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${env.GITHUB_CONTENT_TOKEN}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "ECHO-Blog/1.0",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      },
    );
  } catch {
    throw new HttpError(503, "GITHUB_NETWORK", "GitHub 暂时没有回应，请稍后重试。");
  }
  if (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get("x-ratelimit-remaining") === "0")
  )
    throw new HttpError(503, "GITHUB_RATE_LIMIT", "GitHub 正在限流，请稍后再来。");
  if ([401, 403, 404].includes(response.status)) throw tokenError();
  if (response.status === 409 || response.status === 422) throw conflict();
  if (!response.ok)
    throw new HttpError(502, "GITHUB_REJECTED", "GitHub 未能完成这次保存，请稍后重试。");
  return (await response.json()) as T;
}

async function query<T>(env: Env, text: string, variables: Record<string, unknown>) {
  const { owner, name } = repo(env);
  try {
    return await github<T>(env.GITHUB_CONTENT_TOKEN!, text, {
      owner,
      name,
      ...variables,
    });
  } catch (error) {
    if (
      error instanceof HttpError &&
      ["GITHUB_AUTH", "GITHUB_REJECTED"].includes(error.code)
    )
      throw tokenError();
    throw error;
  }
}

export type Head = { oid: string; tree: string; date: string };
export async function head(env: Env, branch = repo(env).branch): Promise<Head> {
  const data = await query<{
    repository: {
      ref: {
        target: { oid: string; committedDate: string; tree: { oid: string } };
      } | null;
    } | null;
  }>(
    env,
    `query($owner:String!,$name:String!,$ref:String!){repository(owner:$owner,name:$name){ref(qualifiedName:$ref){target{... on Commit{oid committedDate tree{oid}}}}}}`,
    { ref: `refs/heads/${branch}` },
  );
  if (!data.repository) throw tokenError();
  const target = data.repository.ref?.target;
  if (!target?.oid)
    throw new HttpError(
      503,
      "CONTENT_BRANCH",
      `源码仓库里找不到分支「${branch}」，请检查 CONTENT_BRANCH。`,
    );
  return { oid: target.oid, tree: target.tree.oid, date: target.committedDate };
}

export type Blob = { oid: string; text: string | null } | null;
/** Reads files at one commit; missing paths come back as null. */
export async function files(env: Env, at: string, paths: string[]) {
  if (!paths.length) return {} as Record<string, Blob>;
  const vars: Record<string, string> = {};
  const fields = paths.map((p, i) => {
    vars[`p${i}`] = `${at}:${p}`;
    return `f${i}:object(expression:$p${i}){... on Blob{oid text}}`;
  });
  const data = await query<{ repository: Record<string, Blob> | null }>(
    env,
    `query($owner:String!,$name:String!,${paths.map((_, i) => `$p${i}:String!`).join(",")}){repository(owner:$owner,name:$name){${fields.join(" ")}}}`,
    vars,
  );
  if (!data.repository) throw tokenError();
  return Object.fromEntries(
    paths.map((p, i) => {
      const blob = data.repository![`f${i}`];
      return [p, blob?.oid ? blob : null];
    }),
  ) as Record<string, Blob>;
}

export type Source = { file: string; oid: string; text: string };
export async function posts(env: Env, at: string): Promise<Source[]> {
  const data = await query<{
    repository: {
      object: {
        entries?: {
          name: string;
          type: string;
          oid: string;
          object: { text: string | null } | null;
        }[];
      } | null;
    } | null;
  }>(
    env,
    `query($owner:String!,$name:String!,$path:String!){repository(owner:$owner,name:$name){object(expression:$path){... on Tree{entries{name type oid object{... on Blob{text}}}}}}}`,
    { path: `${at}:${POSTS}` },
  );
  if (!data.repository) throw tokenError();
  return (data.repository.object?.entries || [])
    .filter((e) => e.type === "blob" && e.name.endsWith(".md"))
    .map((e) => ({ file: e.name, oid: e.oid, text: e.object?.text ?? "" }));
}

export type Change =
  | { path: string; text: string }
  | { path: string; base64: string }
  | { path: string; remove: true };
/** Materialize one atomic Git commit, without changing any branch reference. */
async function createCommit(env: Env, base: Head, message: string, changes: Change[]) {
  const tree = [];
  for (const change of changes) {
    const entry = { path: change.path, mode: "100644", type: "blob" };
    if ("remove" in change) tree.push({ ...entry, sha: null });
    else if ("text" in change) tree.push({ ...entry, content: change.text });
    else {
      const blob = await rest<{ sha: string }>(env, "POST", "/git/blobs", {
        content: change.base64,
        encoding: "base64",
      });
      tree.push({ ...entry, sha: blob.sha });
    }
  }
  const created = await rest<{ sha: string }>(env, "POST", "/git/trees", {
    base_tree: base.tree,
    tree,
  });
  const next = await rest<{ sha: string }>(env, "POST", "/git/commits", {
    message,
    tree: created.sha,
    parents: [base.oid],
  });
  return next.sha;
}

/** Default path: one fast-forward commit to the configured content branch. */
export async function commit(env: Env, base: Head, message: string, changes: Change[]) {
  const sha = await createCommit(env, base, message, changes);
  const ref = repo(env).branch.split("/").map(encodeURIComponent).join("/");
  await rest(env, "PATCH", `/git/refs/heads/${ref}`, { sha, force: false });
  return sha;
}

/** Explicit opt-in: create an isolated review branch and draft PR; never update main. */
export async function publishChange(
  env: Env, base: Head, message: string, changes: Change[], editing?: ReviewEdit,
): Promise<Publication> {
  if (editing) {
    const existing = await reviewBase(env, editing.number);
    if (existing.at.oid !== editing.commit || base.oid !== editing.commit) throw conflict();
    const target = targetOf(changes);
    if (existing.target.kind !== target.kind || existing.target.file !== target.file)
      throw new HttpError(422, "CONTENT_REVIEW_TARGET", "不能在同一 PR 中改动其他内容。");
    const sha = await createCommit(env, base, message, changes);
    // GitHub rejects a non-fast-forward update if another editor changed this PR.
    const ref = existing.review.branch.split("/").map(encodeURIComponent).join("/");
    await rest(env, "PATCH", `/git/refs/heads/${ref}`, { sha, force: false });
    return { commit: sha, review: existing.review };
  }
  if (publicationMode(env) === "direct") return { commit: await commit(env, base, message, changes) };
  // An unrelated main update must not make an already-edited draft silently stale.
  if ((await head(env)).oid !== base.oid) throw conflict();
  const sha = await createCommit(env, base, message, changes);
  const branch = `content/review-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  await rest(env, "POST", "/git/refs", { ref: `refs/heads/${branch}`, sha });
  const { owner, name } = repo(env);
  let number: number;
  try {
    const pr = await rest<{ number: number }>(env, "POST", "/pulls", {
      title: `内容审核：${message.split("\n")[0].slice(0, 120)}`,
      head: branch,
      base: "main",
      draft: true,
      body: [
        "此草稿 PR 由 Waylan Blog 后台创建；需通过人工审核和 CI 后才能合并至 main。",
        ADMIN_REVIEW_MARKER,
        targetMarker(targetOf(changes)),
        "",
        "变更文件：",
        ...changes.map((change) => `- \`${change.path}\``),
      ].join("\n"),
    });
    if (!Number.isInteger(pr.number) || pr.number < 1) throw new Error("Invalid GitHub PR number");
    number = pr.number;
  } catch {
    // The review branch already holds the complete commit; preserve it so no edit is lost.
    throw new HttpError(503, "CONTENT_REVIEW_PR",
      `变更已安全保存到分支「${branch}」，但自动创建 PR 失败。请检查 GITHUB_CONTENT_TOKEN 的 Pull requests 写权限，并从 GitHub 手动创建 PR。`);
  }
  return {
    commit: sha,
    review: { number, branch, url: `https://github.com/${owner}/${name}/pull/${number}` },
  };
}

/** Git's object id for a text file, so the client can keep editing after a save. */
export async function blobOid(text: string) {
  const bytes = new TextEncoder().encode(text),
    head = new TextEncoder().encode(`blob ${bytes.length}\0`),
    all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

