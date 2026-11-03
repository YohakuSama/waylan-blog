// Site administration. The site stays static: every change is a commit to the
// source repository, and Cloudflare Workers Builds rebuilds and deploys it.
// Identity comes from the existing GitHub login; only ADMIN_GITHUB_LOGINS get
// in. Writes use GITHUB_CONTENT_TOKEN, scoped to the source repository.
import manifest from "./generated/manifest.json";
import build from "./generated/build.json";
import site from "../src/generated/site.json";
import {
  authReady,
  HttpError,
  json,
  present,
  readReady,
  type Env,
} from "./types";
import { getSession, requireSession } from "./auth";
import { limit, readBody } from "./security";
import { github } from "./github";
import {
  checkAvatar,
  hasBody,
  parseFrontmatter,
  postMeta,
  SLUG,
  slugRule,
  social,
  stringifyFrontmatter,
  type Frontmatter,
  type PostMeta,
} from "../shared/content-rules";
import {
  discussionBody,
  discussionMarker,
  discussionTitle,
} from "../shared/discussions";
import { fromBase64, MAX_IMAGE, UPLOAD_PATH, uploadPath } from "../shared/uploads";
import { updatePostRedirects, removePostRedirects, validatePostRedirects } from "../shared/redirects";

const POSTS = "content/posts",
  SITE = "content/site.json",
  ABOUT = "content/about.md",
  MAX_BODY = 16 * 1024 * 1024,
  MAX_UPLOADS = 8,
  FILE = /^(?!\.)[^/\\\x00-\x1f]{1,120}\.md$/;

const admins = (env: Env) =>
  (env.ADMIN_GITHUB_LOGINS || "")
    .split(/[\s,]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
const repo = (env: Env) => {
  const [owner = "", name = ""] = (env.CONTENT_REPO || "").split("/");
  return { owner, name, branch: env.CONTENT_BRANCH || "main" };
};

/** Configuration the admin still needs; names only, never values. */
export function adminMissing(env: Env) {
  const missing: string[] = [];
  if (!authReady(env))
    missing.push(
      ...(
        [
          ["DB", !!env.DB],
          ["GITHUB_CLIENT_ID", present(env.GITHUB_CLIENT_ID)],
          ["GITHUB_CLIENT_SECRET", present(env.GITHUB_CLIENT_SECRET)],
          ["SESSION_SECRET", (env.SESSION_SECRET || "").length >= 32],
          ["SITE_ORIGIN", present(env.SITE_ORIGIN)],
        ] as const
      )
        .filter(([, ok]) => !ok)
        .map(([name]) => name),
    );
  if (!present(env.GITHUB_CONTENT_TOKEN)) missing.push("GITHUB_CONTENT_TOKEN");
  if (!/^[\w.-]+\/[\w.-]+$/.test(env.CONTENT_REPO || "") || !present(env.CONTENT_REPO))
    missing.push("CONTENT_REPO");
  if (!admins(env).length || !present(env.ADMIN_GITHUB_LOGINS))
    missing.push("ADMIN_GITHUB_LOGINS");
  return missing;
}

async function requireAdmin(request: Request, env: Env) {
  if (adminMissing(env).length)
    throw new HttpError(503, "ADMIN_NOT_CONFIGURED", "后台尚未配置完成。");
  const session = await requireSession(request, env);
  if (!admins(env).includes(session.user.login.toLowerCase()))
    throw new HttpError(403, "NOT_ADMIN", "这个 GitHub 账号没有管理权限。");
  return session;
}

// ---------------------------------------------------------------- GitHub I/O

const tokenError = () =>
  new HttpError(
    503,
    "CONTENT_TOKEN",
    "无法访问源码仓库：请检查 CONTENT_REPO，以及 GITHUB_CONTENT_TOKEN 是否有效、是否对该仓库有 Contents 读写权限。",
  );
const conflict = () =>
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

type Head = { oid: string; tree: string; date: string };
async function head(env: Env): Promise<Head> {
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

type Blob = { oid: string; text: string | null } | null;
/** Reads files at one commit; missing paths come back as null. */
async function files(env: Env, at: string, paths: string[]) {
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

type Source = { file: string; oid: string; text: string };
async function posts(env: Env, at: string): Promise<Source[]> {
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

type Change =
  | { path: string; text: string }
  | { path: string; base64: string }
  | { path: string; remove: true };
/** One commit on top of `base`; fails with 409 if the branch moved. */
async function commit(env: Env, base: Head, message: string, changes: Change[]) {
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
async function blobOid(text: string) {
  const bytes = new TextEncoder().encode(text),
    head = new TextEncoder().encode(`blob ${bytes.length}\0`),
    all = new Uint8Array(head.length + bytes.length);
  all.set(head);
  all.set(bytes, head.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ helpers

const invalid = (message: string) => new HttpError(422, "INVALID", message);
const text = (value: unknown, label: string, max: number, required = false) => {
  if (value !== undefined && value !== null && typeof value !== "string")
    throw invalid(`${label}格式不正确。`);
  const s = String(value ?? "").trim();
  if (required && !s) throw invalid(`请填写${label}。`);
  if (s.length > max) throw invalid(`${label}太长了（最多 ${max} 字）。`);
  return s;
};
const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
/** YAML dates become YYYY-MM-DD strings so the browser edits plain text. */
const plain = (data: Frontmatter) =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      v instanceof Date ? v.toISOString().slice(0, 10) : v,
    ]),
  );
const topicsOf = (siteJson: { topics?: { id: string }[] }) =>
  (siteJson.topics || []).map((t) => t.id);
function parseSite(blob: Blob) {
  try {
    const data = JSON.parse(blob?.text || "");
    if (isObject(data)) return data as Record<string, any>;
  } catch {}
  throw new HttpError(
    500,
    "SITE_JSON",
    "仓库里的 content/site.json 无法解析，请先在仓库中修复。",
  );
}
function summary(source: Source, topics: string[]) {
  try {
    const { data, content } = parseFrontmatter(source.text);
    const meta = postMeta(data, source.file, topics);
    return {
      file: source.file,
      oid: source.oid,
      ...meta,
      ...(hasBody(content) ? {} : { error: "正文是空的" }),
    };
  } catch (error) {
    return {
      file: source.file,
      oid: source.oid,
      title: source.file,
      error: (error as Error).message.replace(`${source.file}: `, ""),
    };
  }
}

/** Uploaded images referenced by `used`; each is checked against its path. */
async function images(raw: unknown, used: string) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_UPLOADS)
    throw invalid(`一次最多上传 ${MAX_UPLOADS} 张图片。`);
  const out: { path: string; base64: string }[] = [];
  for (const item of raw) {
    if (!isObject(item) || typeof item.path !== "string" || typeof item.data !== "string")
      throw invalid("图片数据不完整。");
    if (!UPLOAD_PATH.test(item.path)) throw invalid("图片地址不正确。");
    if (!used.includes(item.path) || out.some((x) => x.path === item.path)) continue;
    let bytes: Uint8Array;
    try {
      bytes = fromBase64(item.data);
    } catch {
      throw invalid("图片数据已损坏，请重新选择。");
    }
    if (bytes.length > MAX_IMAGE) throw invalid("单张图片不能超过 5 MB。");
    if ((await uploadPath(bytes)) !== item.path)
      throw invalid("只支持 PNG、JPG、GIF、WebP、AVIF 图片，且文件需完整。");
    out.push({ path: item.path, base64: item.data });
  }
  return out;
}

/** Fails unless every site path is either uploaded now or already in the repo. */
async function requireFiles(env: Env, at: string, paths: string[], uploaded: string[]) {
  const missing = paths.filter((p) => p && !uploaded.includes(p));
  const found = await files(env, at, missing.map((p) => `public${p}`));
  for (const p of missing)
    if (!found[`public${p}`]) throw invalid(`找不到图片 ${p}，请重新上传。`);
}

const by = (login: string) => `\n\n通过 /admin 提交，操作者 @${login}`;

// ---------------------------------------------------------------- endpoints

async function overview(env: Env) {
  const at = await head(env);
  const [list, meta] = await Promise.all([
    posts(env, at.oid),
    files(env, at.oid, [SITE, ABOUT]),
  ]);
  const siteJson = parseSite(meta[SITE]);
  const topics = topicsOf(siteJson);
  let pending: { id: string; title: string }[] = [];
  if (readReady(env)) {
    const mapped = new Set(
      (
        await env.DB!.prepare("SELECT post_id FROM discussions").all<{
          post_id: string;
        }>()
      ).results.map((r) => r.post_id),
    );
    pending = manifest
      .filter((p) => !mapped.has(p.id))
      .map(({ id, title }) => ({ id, title }));
  }
  return json({
    repo: { name: env.CONTENT_REPO, branch: repo(env).branch },
    head: { oid: at.oid, date: at.date },
    live: build.commit,
    site: { oid: meta[SITE]!.oid, data: siteJson },
    about: { oid: meta[ABOUT]?.oid ?? null, text: meta[ABOUT]?.text ?? "" },
    topics: (siteJson.topics || []).map((t: { id: string; name: string }) => ({
      id: t.id,
      name: t.name,
    })),
    posts: list
      .map((p) => summary(p, topics))
      .sort(
        (a, b) =>
          ("date" in b ? b.date : "").localeCompare("date" in a ? a.date : "") ||
          a.file.localeCompare(b.file),
      ),
    discussions: { enabled: readReady(env), pending },
  });
}

async function readPost(env: Env, file: string) {
  if (!FILE.test(file)) throw invalid("文件名不正确。");
  const at = await head(env);
  const blob = (await files(env, at.oid, [`${POSTS}/${file}`]))[`${POSTS}/${file}`];
  if (!blob) throw new HttpError(404, "POST_NOT_FOUND", "这篇文章已不在仓库里。");
  let parsed;
  try {
    parsed = parseFrontmatter(blob.text || "");
  } catch (error) {
    throw invalid(`这篇文章的 front matter 无法解析：${(error as Error).message}`);
  }
  return json({ file, oid: blob.oid, data: plain(parsed.data), body: parsed.content });
}

async function savePost(request: Request, env: Env, login: string) {
  const input = await readBody(request, MAX_BODY);
  if (!isObject(input) || !isObject(input.data)) throw invalid("内容格式不正确。");
  const editing = input.file !== undefined && input.file !== null;
  if (editing && (typeof input.file !== "string" || !FILE.test(input.file)))
    throw invalid("文件名不正确。");
  if (typeof input.body !== "string") throw invalid("正文格式不正确。");
  const body = input.body.replace(/\r\n?/g, "\n");
  if (body.length > 400_000) throw invalid("正文太长了。");
  if (!hasBody(body)) throw invalid("正文不能为空。");
  const data: Frontmatter = {};
  for (const [key, value] of Object.entries(input.data)) {
    if (!/^[A-Za-z][\w-]{0,40}$/.test(key)) throw invalid(`字段名「${key}」不正确。`);
    data[key] = typeof value === "string" ? value.trim() : value;
  }
  if (Object.keys(data).length > 40 || JSON.stringify(data).length > 40_000)
    throw invalid("文章属性太多了。");
  text(data.title, "标题", 200, true);
  if (data.excerpt !== undefined) text(data.excerpt, "摘要", 600);

  const at = await head(env);
  const [all, meta] = await Promise.all([posts(env, at.oid), files(env, at.oid, [SITE])]);
  const topics = topicsOf(parseSite(meta[SITE]));
  let file: string;
  let previousSlug: string | null = null;
  if (editing) {
    file = input.file as string;
    const current = all.find((p) => p.file === file);
    if (!current) throw new HttpError(404, "POST_NOT_FOUND", "这篇文章已不在仓库里。");
    if (current.oid !== input.oid) throw conflict();
    // The id carries comments and highlights: it never changes once published.
    const before = parseFrontmatter(current.text).data,
      stem = file.replace(/\.md$/, ""),
      id = String(before.id || before.slug || stem);
    previousSlug = String(before.slug || stem);
    if (String(data.id || data.slug || stem) !== id) data.id = id;
  } else {
    const slug = text(data.slug, "链接名（slug）", 80, true);
    if (!SLUG.test(slug))
      throw invalid(`链接名（slug）${slugRule}，例如 my-first-post。`);
    file = `${slug}.md`;
    if (all.some((p) => p.file === file))
      throw invalid(`已有文件 ${file}，请换一个链接名。`);
  }
  let post: PostMeta;
  try {
    post = postMeta(data, file, topics);
  } catch (error) {
    throw invalid((error as Error).message.replace(`${file}: `, ""));
  }
  for (const other of all) {
    if (other.file === file) continue;
    const o = summary(other, topics);
    if ("id" in o && o.id === post.id) throw invalid(`id「${post.id}」已被 ${other.file} 使用。`);
    if ("slug" in o && o.slug === post.slug)
      throw invalid(`链接名「${post.slug}」已被 ${other.file} 使用。`);
  }
  const uploads = await images(input.uploads, `${body}\n${post.cover || ""}`);
  if (post.cover)
    await requireFiles(env, at.oid, [post.cover], uploads.map((u) => u.path));
  // Keep old article URLs alive. This asset rule is committed together with the
  // markdown edit so Cloudflare can never publish the new slug without its 301.
  let redirectText: string | null = null;
  if (previousSlug !== post.slug) {
    const old = (await files(env, at.oid, ["public/_redirects"]))["public/_redirects"];
    try {
      redirectText = updatePostRedirects(old?.text || "", previousSlug, post.slug);
      if (redirectText) {
        const active = all.filter((p) => p.file !== file).map((p) => summary(p, topics));
        validatePostRedirects(redirectText, [
          ...active.filter((p): p is ReturnType<typeof summary> & { slug: string } => "slug" in p)
            .map((p) => p.slug),
          post.slug,
        ]);
      }
    } catch (error) {
      throw invalid((error as Error).message);
    }
  }
  const markdown = stringifyFrontmatter(data, body);
  const sha = await commit(
    env,
    at,
    `${editing ? "更新" : "发布"}：${post.title}${by(login)}`,
    [
      { path: `${POSTS}/${file}`, text: markdown },
      ...(redirectText ? [{ path: "public/_redirects", text: redirectText }] : []),
      ...uploads.map((u) => ({ path: `public${u.path}`, base64: u.base64 })),
    ],
  );
  return json({ file, oid: await blobOid(markdown), commit: sha }, editing ? 200 : 201);
}

async function deletePost(request: Request, env: Env, login: string) {
  const input = await readBody(request);
  if (!isObject(input) || typeof input.file !== "string" || !FILE.test(input.file))
    throw invalid("文件名不正确。");
  const at = await head(env);
  const path = `${POSTS}/${input.file}`;
  const blob = (await files(env, at.oid, [path]))[path];
  if (!blob) throw new HttpError(404, "POST_NOT_FOUND", "这篇文章已不在仓库里。");
  if (blob.oid !== input.oid) throw conflict();
  let title = input.file;
  try {
    title = String(parseFrontmatter(blob.text || "").data.title || title);
  } catch {}
  const sha = await commit(env, at, `删除：${title}${by(login)}`, [
    { path, remove: true },
  ]);
  return json({ commit: sha });
}

async function saveSite(request: Request, env: Env, login: string) {
  const input = await readBody(request, MAX_BODY);
  if (!isObject(input) || !isObject(input.site)) throw invalid("内容格式不正确。");
  const s = input.site;
  const at = await head(env);
  const current = await files(env, at.oid, [SITE, ABOUT]);
  if (current[SITE]?.oid !== input.oid || (current[ABOUT]?.oid ?? null) !== (input.aboutOid ?? null))
    throw conflict();
  const next = parseSite(current[SITE]);
  next.name = text(s.name, "站点名称", 40, true);
  next.author = text(s.author, "作者名", 40, true);
  next.tagline = text(s.tagline, "一句话介绍", 80, true);
  next.description = text(s.description, "站点描述", 300, true);
  next.intro = text(s.intro, "首页介绍", 800);
  if (!Array.isArray(s.profileTags) || s.profileTags.length > 12)
    throw invalid("个人标签最多 12 个。");
  next.profileTags = s.profileTags
    .map((t: unknown) => text(t, "标签", 20))
    .filter(Boolean);
  if (!Array.isArray(s.socials) || s.socials.length > 12)
    throw invalid("联系方式最多 12 个。");
  next.socials = s.socials.map((x: unknown, i: number) => {
    if (!isObject(x)) throw invalid("联系方式格式不正确。");
    const url = text(x.url, "联系方式地址", 300, true),
      label = text(x.label, "联系方式名称", 30);
    try {
      social({ url, label }, i);
    } catch {
      throw invalid(`联系方式「${url}」必须是 https:// 链接或邮箱地址。`);
    }
    return label ? { label, url } : { url };
  });
  try {
    next.avatar = checkAvatar(text(s.avatar, "头像", 200));
  } catch {
    throw invalid("头像地址不正确，请重新上传。");
  }
  const about = text(input.about, "关于页", 60_000).replace(/\r\n?/g, "\n");
  const uploads = await images(input.uploads, next.avatar);
  if (next.avatar)
    await requireFiles(env, at.oid, [next.avatar], uploads.map((u) => u.path));
  const siteText = JSON.stringify(next, null, 2) + "\n",
    aboutText = about ? about + "\n" : "";
  const changes: Change[] = [
    ...(siteText !== current[SITE]!.text ? [{ path: SITE, text: siteText }] : []),
    ...(aboutText !== (current[ABOUT]?.text ?? "") ? [{ path: ABOUT, text: aboutText }] : []),
    ...uploads.map((u) => ({ path: `public${u.path}`, base64: u.base64 })),
  ];
  const result = {
    oid: await blobOid(siteText),
    aboutOid: changes.some((c) => c.path === ABOUT)
      ? await blobOid(aboutText)
      : (current[ABOUT]?.oid ?? null),
  };
  if (!changes.length) return json({ ...result, commit: null });
  const sha = await commit(env, at, `更新站点资料${by(login)}`, changes);
  return json({ ...result, commit: sha });
}

/**
 * Gives every published post a GitHub Discussion, like `npm run setup:github`
 * but from the browser, with the admin's own GitHub login. Also registers
 * published posts in D1, which the comment tables reference.
 */
async function syncDiscussions(env: Env, token: string) {
  if (!readReady(env))
    throw new HttpError(503, "COMMENTS_NOT_CONFIGURED", "评论仓库尚未配置。");
  await env.DB!.batch(
    manifest.map((p) =>
      env.DB!.prepare(
        "INSERT INTO posts (id,slug,title,version) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,version=excluded.version",
      ).bind(p.id, p.slug, p.title, p.version),
    ),
  );
  const mapped = new Set(
    (
      await env.DB!.prepare("SELECT post_id FROM discussions").all<{ post_id: string }>()
    ).results.map((r) => r.post_id),
  );
  const pending = manifest.filter((p) => !mapped.has(p.id));
  if (!pending.length) return json({ mapped: 0, created: 0, remaining: 0 });
  const owner = env.GITHUB_REPO_OWNER!,
    name = env.GITHUB_REPO_NAME!,
    categoryName = env.GITHUB_CATEGORY_NAME || "Blog";
  type Found = { id: string; number: number; url: string; body: string };
  const info = await github<{
    repository: {
      id: string;
      isPrivate: boolean;
      discussionCategories: { nodes: { id: string; name: string }[] };
    } | null;
  }>(
    token,
    `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id isPrivate discussionCategories(first:100){nodes{id name}}}}`,
    { owner, name },
  );
  if (!info.repository || info.repository.isPrivate)
    throw new HttpError(503, "REPOSITORY", "评论仓库必须是公开仓库。");
  const category = info.repository.discussionCategories.nodes.find(
    (c) => c.name === categoryName,
  );
  if (!category)
    throw new HttpError(
      503,
      "CATEGORY",
      `评论仓库里没有名为「${categoryName}」的 Discussions 分类，请先创建。`,
    );
  const found: Found[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const result: {
      repository: {
        discussions: {
          nodes: Found[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
    } = await github(
      token,
      `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){discussions(first:100,after:$after){nodes{id number url body} pageInfo{hasNextPage endCursor}}}}`,
      { owner, name, after },
    );
    found.push(...result.repository.discussions.nodes);
    if (!result.repository.discussions.pageInfo.hasNextPage) break;
    after = result.repository.discussions.pageInfo.endCursor;
  }
  let created = 0,
    done = 0;
  const origin = env.SITE_ORIGIN!;
  // Bounded per call to stay well inside the Worker's subrequest budget.
  for (const post of pending.slice(0, 10)) {
    let discussion = found.find((d) => d.body.includes(discussionMarker(post.id)));
    if (!discussion) {
      discussion = (
        await github<{ createDiscussion: { discussion: Found } }>(
          token,
          `mutation($input:CreateDiscussionInput!){createDiscussion(input:$input){discussion{id number url body}}}`,
          {
            input: {
              repositoryId: info.repository.id,
              categoryId: category.id,
              title: discussionTitle(post),
              body: discussionBody(post, origin, site.name),
            },
          },
        )
      ).createDiscussion.discussion;
      created++;
    }
    await env.DB!.prepare(
      "INSERT INTO discussions(post_id,discussion_id,discussion_number,url) VALUES(?,?,?,?) ON CONFLICT(post_id) DO UPDATE SET discussion_id=excluded.discussion_id,discussion_number=excluded.discussion_number,url=excluded.url",
    )
      .bind(post.id, discussion.id, discussion.number, discussion.url)
      .run();
    done++;
  }
  return json({ mapped: done, created, remaining: pending.length - done });
}

export async function admin(request: Request, env: Env, path: string) {
  if (path === "/api/admin/session" && request.method === "GET") {
    const missing = adminMissing(env);
    const session = await getSession(request, env);
    return json({
      configured: !missing.length,
      missing,
      user: session?.user || null,
      admin: !!session && admins(env).includes(session.user.login.toLowerCase()),
      ...(session ? { csrf: session.row.csrf } : {}),
    });
  }
  const session = await requireAdmin(request, env),
    login = session.user.login;
  if (request.method !== "GET")
    await limit(env, `admin:${login.toLowerCase()}`, 60, 600);
  const url = new URL(request.url);
  if (path === "/api/admin/content" && request.method === "GET") return overview(env);
  if (path === "/api/admin/status" && request.method === "GET") {
    const at = await head(env);
    return json({ head: { oid: at.oid, date: at.date }, live: build.commit });
  }
  if (path === "/api/admin/post" && request.method === "GET")
    return readPost(env, url.searchParams.get("file") || "");
  if (path === "/api/admin/post" && request.method === "PUT")
    return savePost(request, env, login);
  if (path === "/api/admin/post" && request.method === "DELETE")
    return deletePost(request, env, login);
  if (path === "/api/admin/site" && request.method === "PUT")
    return saveSite(request, env, login);
  if (path === "/api/admin/discussions" && request.method === "POST")
    return syncDiscussions(env, session.token);
  throw new HttpError(404, "API_NOT_FOUND", "没有找到这个接口。");
}
