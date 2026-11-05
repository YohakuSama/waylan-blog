/** GitHub source-repository boundary for admin reads and atomic writes.
 * No OAuth/session/CSRF logic: admin.ts checks authorization before invoking it.
 * Keep optimistic head checks, REST/GraphQL errors, and content hashing here.
 */
import { HttpError, type Env } from "./types";
import { github } from "./github";

export const POSTS = "content/posts";
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
export async function head(env: Env): Promise<Head> {
  const data = await query<{
    repository: {
      ref: {
        target: { oid: string; committedDate: string; tree: { oid: string } };
      } | null;
    } | null;
  }>(
    env,
    `query($owner:String!,$name:String!,$ref:String!){repository(owner:$owner,name:$name){ref(qualifiedName:$ref){target{... on Commit{oid committedDate tree{oid}}}}}}`,
    { ref: `refs/heads/${repo(env).branch}` },
  );
  if (!data.repository) throw tokenError();
  const target = data.repository.ref?.target;
  if (!target?.oid)
    throw new HttpError(
      503,
      "CONTENT_BRANCH",
      `源码仓库里找不到分支「${repo(env).branch}」，请检查 CONTENT_BRANCH。`,
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
/** One commit on top of `base`; fails with 409 if the branch moved. */
export async function commit(env: Env, base: Head, message: string, changes: Change[]) {
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
  const ref = repo(env)
    .branch.split("/")
    .map(encodeURIComponent)
    .join("/");
  await rest(env, "PATCH", `/git/refs/heads/${ref}`, {
    sha: next.sha,
    force: false,
  });
  return next.sha;
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

