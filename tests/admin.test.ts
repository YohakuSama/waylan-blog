import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import worker from "../worker/index";
import { database } from "./db";
import { hash, seal } from "../worker/security";
import type { Env } from "../worker/types";
import manifest from "../worker/generated/manifest.json";
import {
  parseFrontmatter,
  postMeta,
  stringifyFrontmatter,
} from "../shared/content-rules";
import { toBase64, uploadPath } from "../shared/uploads";

const ORIGIN = "https://echo.test",
  csrf = "admin-csrf",
  cookie = "admin-session-cookie";
const oidOf = (content: string | Buffer) => {
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
};

/** Just enough of GitHub's Git Data API to behave like a real branch. */
class FakeRepo {
  trees = new Map<string, Map<string, Buffer>>();
  commits = new Map<
    string,
    { tree: string; parent: string | null; message: string; date: string }
  >();
  blobs = new Map<string, Buffer>();
  head = "";
  n = 0;
  constructor(files: Record<string, string | Buffer>) {
    const tree = new Map(
      Object.entries(files).map(([p, v]) => [
        p,
        typeof v === "string" ? Buffer.from(v) : v,
      ]),
    );
    this.trees.set("t0", tree);
    this.commits.set("c0", {
      tree: "t0",
      parent: null,
      message: "init",
      date: "2026-11-01T00:00:00Z",
    });
    this.head = "c0";
  }
  files(at = this.head) {
    return this.trees.get(this.commits.get(at)!.tree)!;
  }
  text(path: string) {
    return this.files().get(path)?.toString("utf8");
  }
  last() {
    return this.commits.get(this.head)!;
  }
  /** Someone else pushes in between. */
  push(path: string, content: string) {
    const tree = new Map(this.files());
    tree.set(path, Buffer.from(content));
    const t = `t${++this.n}`,
      c = `c${this.n}`;
    this.trees.set(t, tree);
    this.commits.set(c, {
      tree: t,
      parent: this.head,
      message: "elsewhere",
      date: new Date().toISOString(),
    });
    this.head = c;
  }
}

let env: Env,
  db: ReturnType<typeof database>,
  repo: FakeRepo,
  calls: string[],
  tokens: string[],
  beforeRef: (() => void) | null,
  githubDown: number | null,
  discussions: { id: string; number: number; url: string; body: string }[];

function seed() {
  const files: Record<string, string | Buffer> = {
    "content/site.json": readFileSync("content/site.json", "utf8"),
    "content/about.md": readFileSync("content/about.md", "utf8"),
  };
  for (const f of readdirSync("content/posts"))
    files[`content/posts/${f}`] = readFileSync(`content/posts/${f}`, "utf8");
  for (const f of readdirSync("public/art"))
    files[`public/art/${f}`] = readFileSync(`public/art/${f}`);
  files["public/avatar.svg"] = readFileSync("public/avatar.svg");
  return new FakeRepo(files);
}

function graphql(query: string, v: Record<string, any>, token: string) {
  const blob = (b: Buffer | undefined) =>
    b ? { oid: oidOf(b), text: b.toString("utf8") } : null;
  if (query.includes("ref(qualifiedName")) {
    assert.equal(v.ref, "refs/heads/main");
    const c = repo.last();
    return {
      repository: {
        ref: {
          target: { oid: repo.head, committedDate: c.date, tree: { oid: c.tree } },
        },
      },
    };
  }
  if (query.includes("... on Tree{entries")) {
    const [at, dir] = v.path.split(":");
    const entries = [...repo.files(at)]
      .filter(([p]) => p.startsWith(dir + "/") && !p.slice(dir.length + 1).includes("/"))
      .map(([p, b]) => ({
        name: p.slice(dir.length + 1),
        type: "blob",
        oid: oidOf(b),
        object: { text: b.toString("utf8") },
      }));
    return { repository: { object: { entries } } };
  }
  if (query.includes("f0:object")) {
    const out: Record<string, unknown> = {};
    for (const [k, expr] of Object.entries(v))
      if (/^p\d+$/.test(k)) {
        const [at, path] = String(expr).split(/:(.*)/s);
        out[`f${k.slice(1)}`] = blob(repo.files(at).get(path));
      }
    return { repository: out };
  }
  // Discussions: always the admin's own token, never the content token.
  tokens.push(token);
  if (query.includes("discussionCategories"))
    return {
      repository: {
        id: "R_blog",
        isPrivate: false,
        discussionCategories: { nodes: [{ id: "DIC_blog", name: "Blog" }] },
      },
    };
  if (query.includes("discussions(first:100"))
    return {
      repository: {
        discussions: {
          nodes: discussions,
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };
  if (query.includes("createDiscussion")) {
    const d = {
      id: `D_${discussions.length + 1}`,
      number: discussions.length + 1,
      url: `https://github.com/test-owner/test-blog/discussions/${discussions.length + 1}`,
      body: v.input.body,
    };
    assert.equal(v.input.categoryId, "DIC_blog");
    discussions.push(d);
    return { createDiscussion: { discussion: d } };
  }
  throw new Error("unexpected query " + query);
}

function rest(method: string, path: string, body: any) {
  if (method === "POST" && path === "/git/blobs") {
    const bytes = Buffer.from(body.content, body.encoding);
    const sha = oidOf(bytes);
    repo.blobs.set(sha, bytes);
    return [201, { sha }];
  }
  if (method === "POST" && path === "/git/trees") {
    if (!repo.trees.has(body.base_tree)) return [422, {}];
    const tree = new Map(repo.trees.get(body.base_tree));
    for (const e of body.tree) {
      if (e.sha === null) {
        if (!tree.delete(e.path)) return [422, {}];
      } else if (typeof e.content === "string")
        tree.set(e.path, Buffer.from(e.content));
      else tree.set(e.path, repo.blobs.get(e.sha)!);
    }
    const sha = `t${++repo.n}`;
    repo.trees.set(sha, tree);
    return [201, { sha }];
  }
  if (method === "POST" && path === "/git/commits") {
    const sha = `c${++repo.n}`;
    repo.commits.set(sha, {
      tree: body.tree,
      parent: body.parents[0],
      message: body.message,
      date: new Date().toISOString(),
    });
    return [201, { sha }];
  }
  if (method === "PATCH" && path === "/git/refs/heads/main") {
    beforeRef?.();
    assert.equal(body.force, false);
    if (repo.commits.get(body.sha)?.parent !== repo.head) return [422, {}];
    repo.head = body.sha;
    return [200, { object: { sha: body.sha } }];
  }
  throw new Error(`unexpected ${method} ${path}`);
}

async function call(path: string, init: RequestInit & { json?: unknown } = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cookie", `__Host-echo_session=${cookie}`);
  if (!headers.has("X-CSRF-Token")) headers.set("X-CSRF-Token", csrf);
  if (init.method && init.method !== "GET") {
    if (!headers.has("Origin")) headers.set("Origin", ORIGIN);
    headers.set("Content-Type", "application/json");
  }
  const response = await worker.fetch(
    new Request(ORIGIN + path, {
      ...init,
      headers,
      body: init.json === undefined ? init.body : JSON.stringify(init.json),
    }),
    env,
  );
  return { status: response.status, body: (await response.json()) as any };
}
const content = () => call("/api/admin/content");
const save = (json: unknown) => call("/api/admin/post", { method: "PUT", json });
const draft = (extra: Record<string, unknown> = {}) => ({
  data: {
    title: "后台发布的第一篇",
    slug: "from-admin",
    type: "article",
    date: "2026-11-02",
    topic: "dev",
    tags: ["后台", "测试"],
    ...extra,
  },
  body: "## 开头\n\n这是从后台写下的正文。\n",
});
// Smallest valid PNG: signature, IHDR, IDAT, IEND.
const png = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082",
  "hex",
);

async function login(name: string) {
  await env.DB!.prepare("DELETE FROM sessions").run();
  db.sqlite
    .prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)")
    .run(
      await hash(cookie),
      "42",
      JSON.stringify({
        login: name,
        avatarUrl: "https://avatars.githubusercontent.com/u/42",
        url: `https://github.com/${name}`,
      }),
      await seal("admin-oauth-token", env.SESSION_SECRET!),
      csrf,
      Math.floor(Date.now() / 1000) + 3600,
    );
}

beforeEach(async () => {
  db = database();
  env = {
    DB: db.db,
    SITE_ORIGIN: ORIGIN,
    GITHUB_REPO_OWNER: "test-owner",
    GITHUB_REPO_NAME: "test-blog",
    GITHUB_READ_TOKEN: "test-read-only-token",
    GITHUB_CLIENT_ID: "test-client",
    GITHUB_CLIENT_SECRET: "test-secret",
    SESSION_SECRET: "test-only-random-secret-longer-than-32-bytes",
    ADMIN_GITHUB_LOGINS: "someone-else, Site-Owner",
    CONTENT_REPO: "site-owner/blog-source",
    GITHUB_CONTENT_TOKEN: "test-content-token",
  };
  repo = seed();
  calls = [];
  tokens = [];
  beforeRef = null;
  githubDown = null;
  discussions = [];
  await login("site-owner");
  mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)),
      method = init?.method || "GET",
      auth = new Headers(init?.headers).get("Authorization") || "",
      body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push(`${method} ${url.pathname}`);
    if (githubDown) return new Response("{}", { status: githubDown });
    if (url.pathname === "/graphql") {
      if (!body.query.includes("discussion"))
        assert.equal(auth, "Bearer test-content-token");
      return Response.json({ data: graphql(body.query, body.variables, auth) });
    }
    assert.equal(auth, "Bearer test-content-token");
    const prefix = "/repos/site-owner/blog-source";
    assert(url.pathname.startsWith(prefix), url.pathname);
    const [status, json] = rest(method, url.pathname.slice(prefix.length), body);
    return Response.json(json, { status: status as number });
  });
});
afterEach(() => {
  mock.restoreAll();
  db.sqlite.close();
});

describe("Admin: access", () => {
  it("names the missing configuration without leaking values", async () => {
    env = { DB: env.DB, SITE_ORIGIN: ORIGIN };
    const { status, body } = await call("/api/admin/session");
    assert.equal(status, 200);
    assert.equal(body.configured, false);
    assert.equal(body.admin, false);
    for (const key of ["GITHUB_CONTENT_TOKEN", "CONTENT_REPO", "ADMIN_GITHUB_LOGINS", "SESSION_SECRET"])
      assert(body.missing.includes(key), key);
    assert.equal((await content()).status, 503);
  });
  it("lets only listed GitHub logins in, case-insensitively", async () => {
    let session = await call("/api/admin/session");
    assert.deepEqual(
      { admin: session.body.admin, csrf: session.body.csrf, login: session.body.user.login },
      { admin: true, csrf, login: "site-owner" },
    );
    await login("site-owner-impostor");
    session = await call("/api/admin/session");
    assert.equal(session.body.admin, false);
    assert.equal((await content()).status, 403);
    assert.equal((await save(draft())).status, 403);
    assert.equal(calls.length, 0, "no GitHub request for a non-admin");
  });
  it("requires a session, the CSRF token and a same-origin request", async () => {
    await env.DB!.prepare("DELETE FROM sessions").run();
    assert.equal((await content()).status, 401);
    await login("site-owner");
    assert.equal(
      (await call("/api/admin/content", { headers: { "X-CSRF-Token": "forged" } })).status,
      403,
    );
    assert.equal(
      (await call("/api/admin/post", { method: "PUT", json: draft(), headers: { Origin: "https://evil.test" } })).status,
      403,
    );
    assert.equal(repo.head, "c0");
  });
});

describe("Admin: posts", () => {
  it("lists every post from the repository with its build-time metadata", async () => {
    const { status, body } = await content();
    assert.equal(status, 200);
    assert.equal(body.posts.length, readdirSync("content/posts").length);
    assert.equal(body.head.oid, "c0");
    assert.equal(body.site.oid, oidOf(repo.files().get("content/site.json")!));
    assert(body.topics.some((t: any) => t.id === "dev" && t.name));
    const first = body.posts.find((p: any) => p.id === "echo-001");
    assert.equal(first.file, "a-room-on-the-internet.md");
    assert.equal(first.slug, "a-room-on-the-internet");
    assert(!body.posts.some((p: any) => p.error));
    const dates = body.posts.map((p: any) => p.date);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });
  it("reports the branch head next to the deployed commit for the deploy status", async () => {
    const before = await call("/api/admin/status");
    assert.equal(before.status, 200);
    assert.equal(before.body.head.oid, "c0");
    assert("live" in before.body);
    await save(draft());
    const after = await call("/api/admin/status");
    assert.notEqual(after.body.head.oid, "c0");
    assert.equal(after.body.head.oid, repo.head);
  });
  it("publishes a new post in one commit, in a form the build accepts", async () => {
    const { status, body } = await save(draft());
    assert.equal(status, 201);
    assert.equal(body.file, "from-admin.md");
    const text = repo.text("content/posts/from-admin.md")!;
    assert.equal(body.oid, oidOf(text));
    assert.equal(body.commit, repo.head);
    assert.match(repo.last().message, /^发布：后台发布的第一篇[\s\S]*@site-owner$/);
    const parsed = parseFrontmatter(text);
    const meta = postMeta(parsed.data, "from-admin.md", ["dev"]);
    assert.equal(meta.id, "from-admin");
    assert.equal(meta.date, "2026-11-02");
    assert.deepEqual(meta.tags, ["后台", "测试"]);
    assert.equal(parsed.content, "## 开头\n\n这是从后台写下的正文。\n");
    // The new file shows up in the listing.
    assert((await content()).body.posts.some((p: any) => p.file === "from-admin.md"));
  });
  it("rejects what the build would reject, before committing anything", async () => {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ topic: "nope" }, /未知的 topic/],
      [{ date: "2026-13-40" }, /YYYY-MM-DD/],
      [{ slug: "Has Space" }, /slug/],
      [{ slug: "a-room-on-the-internet" }, /已有文件|已被/],
      [{ type: "poem" }, /未知的 type/],
      [{ updated: "2026-01-01" }, /updated 不能早于 date/],
      [{ cover: "/images/none.png", coverAlt: "x" }, /找不到图片/],
      [{ cover: "/art/room.svg" }, /缺少 coverAlt/],
      [{ type: "project" }, /status and stack/],
      [{ title: "" }, /标题/],
    ];
    for (const [extra, message] of cases) {
      const { status, body } = await save(draft(extra));
      assert.equal(status, 422, JSON.stringify(extra));
      assert.match(body.message, message, JSON.stringify(extra));
    }
    assert.equal((await save({ ...draft(), body: "<!-- block:x -->\n  \n" })).status, 422);
    assert.equal(repo.head, "c0", "nothing was committed");
  });
  it("refuses an id or slug another post already uses", async () => {
    const r = await save(draft({ slug: "brand-new", id: "echo-001" }));
    assert.equal(r.status, 422);
    assert.match(r.body.message, /echo-001/);
  });
  it("edits a post in place and never changes its id, even when the slug changes", async () => {
    const file = "a-room-on-the-internet.md";
    const read = await call(`/api/admin/post?file=${encodeURIComponent(file)}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.data.date, "2026-10-31", "dates arrive as plain text");
    const { id, ...data } = read.body.data;
    assert.equal(id, "echo-001");
    const saved = await save({
      file,
      oid: read.body.oid,
      data: { ...data, slug: "static-first", title: "静态优先（修订）" },
      body: read.body.body,
    });
    assert.equal(saved.status, 200);
    const after = parseFrontmatter(repo.text(`content/posts/${file}`)!);
    assert.equal(after.data.id, "echo-001");
    assert.equal(after.data.slug, "static-first");
    assert.match(repo.text("public/_redirects")!,
      /^\/post\/a-room-on-the-internet \/post\/static-first 301$/m,
      "the permalink redirect is committed atomically with the post");
    assert.equal(after.content, read.body.body, "body is kept byte for byte");
    assert.match(repo.last().message, /^更新：静态优先（修订）/);
    // Saving again with the returned oid works; the stale one conflicts.
    const reread = (await call(`/api/admin/post?file=${encodeURIComponent(file)}`)).body;
    assert.equal(reread.oid, saved.body.oid);
    assert.equal(reread.data.date, "2026-10-31");
    const again = await save({ file, oid: saved.body.oid, data: reread.data, body: reread.body });
    assert.equal(again.status, 200);
    const stale = await save({ file, oid: read.body.oid, data: reread.data, body: reread.body });
    assert.equal(stale.status, 409);
  });
  it("flattens successive renames and prevents reusing another article's old link", async () => {
    const file = "a-room-on-the-internet.md";
    const first = (await call(`/api/admin/post?file=${file}`)).body;
    const one = await save({ file, oid: first.oid, data: { ...first.data, slug: "new-first" }, body: first.body });
    assert.equal(one.status, 200);
    const two = await save({ file, oid: one.body.oid, data: { ...first.data, slug: "new-second" }, body: first.body });
    assert.equal(two.status, 200);
    const rules = repo.text("public/_redirects")!;
    assert.match(rules, /^\/post\/a-room-on-the-internet \/post\/new-second 301$/m);
    assert.match(rules, /^\/post\/new-first \/post\/new-second 301$/m);
    assert.doesNotMatch(rules, /\/post\/a-room-on-the-internet \/post\/new-first/);
    const blocked = await save(draft({ slug: "new-first" }));
    assert.equal(blocked.status, 422);
    assert.match(blocked.body.message, /历史旧地址/);
    const restored = await save({ file, oid: two.body.oid, data: { ...first.data, slug: "a-room-on-the-internet" }, body: first.body });
    assert.equal(restored.status, 200);
    assert.doesNotMatch(repo.text("public/_redirects")!, /^\/post\/a-room-on-the-internet /m);
  });
  it("does not redirect unpublished drafts and clears aliases on unpublish", async () => {
    const first = await save(draft({ slug: "unpublished-note", draft: true }));
    assert.equal(first.status, 201);
    assert.equal(repo.text("public/_redirects"), undefined);
    const pending = await save({ file: "unpublished-note.md", oid: first.body.oid,
      data: draft({ slug: "public-note", draft: true }).data, body: draft().body });
    assert.equal(pending.status, 200);
    assert.equal(repo.text("public/_redirects"), undefined);
    const published = await save({ file: "unpublished-note.md", oid: pending.body.oid,
      data: draft({ slug: "public-note", draft: false }).data, body: draft().body });
    assert.equal(published.status, 200);
    assert.equal(repo.text("public/_redirects"), undefined,
      "first publication is not a rename of an already public URL");
    const renamed = await save({ file: "unpublished-note.md", oid: published.body.oid,
      data: draft({ slug: "renamed-public-note" }).data, body: draft().body });
    assert.equal(renamed.status, 200);
    assert.match(repo.text("public/_redirects")!, /\/post\/public-note \/post\/renamed-public-note 301/);
    const unpublished = await save({ file: "unpublished-note.md", oid: renamed.body.oid,
      data: draft({ slug: "renamed-public-note", draft: true }).data, body: draft().body });
    assert.equal(unpublished.status, 200);
    assert.doesNotMatch(repo.text("public/_redirects")!, /\/post\/public-note/);
  });
  it("re-saving any existing post unchanged keeps its meaning and body", async () => {
    const topics = JSON.parse(readFileSync("content/site.json", "utf8")).topics.map((t: any) => t.id);
    for (const file of readdirSync("content/posts")) {
      const source = readFileSync(`content/posts/${file}`, "utf8");
      const before = parseFrontmatter(source);
      const plain = JSON.parse(JSON.stringify(before.data, (k, v) => v));
      for (const k of Object.keys(plain))
        if (before.data[k] instanceof Date) plain[k] = (before.data[k] as Date).toISOString().slice(0, 10);
      const after = parseFrontmatter(stringifyFrontmatter(plain, before.content));
      assert.deepEqual(postMeta(after.data, file, topics), postMeta(before.data, file, topics), file);
      assert.equal(after.content, before.content.replace(/^\r?\n*/, "").replace(/\r\n/g, "\n"), file);
    }
  });
  it("deletes a post, guarded by the version the admin saw", async () => {
    const file = "slow-tools.md";
    const oid = oidOf(repo.files().get(`content/posts/${file}`)!);
    assert.equal((await call("/api/admin/post", { method: "DELETE", json: { file, oid: "0".repeat(40) } })).status, 409);
    const r = await call("/api/admin/post", { method: "DELETE", json: { file, oid } });
    assert.equal(r.status, 200);
    assert.equal(repo.text(`content/posts/${file}`), undefined);
    assert.match(repo.last().message, /^删除：/);
    assert.equal((await call("/api/admin/post", { method: "DELETE", json: { file, oid } })).status, 404);
  });
  it("removes old URL aliases in the same commit when an article is deleted", async () => {
    const file = "slow-tools.md";
    const before = (await call(`/api/admin/post?file=${file}`)).body;
    const renamed = await save({ file, oid: before.oid,
      data: { ...before.data, slug: "slower-tools" }, body: before.body });
    assert.equal(renamed.status, 200);
    assert.match(repo.text("public/_redirects")!, /\/post\/slow-tools \/post\/slower-tools 301/);
    const deleted = await call("/api/admin/post", {
      method: "DELETE", json: { file, oid: renamed.body.oid },
    });
    assert.equal(deleted.status, 200);
    assert.equal(repo.text(`content/posts/${file}`), undefined);
    assert.doesNotMatch(repo.text("public/_redirects")!, /\/post\/slow-tools/);
  });
  it("rejects path tricks in file names", async () => {
    for (const file of ["../site.json", "a/b.md", ".hidden.md", "x.txt"]) {
      assert.equal((await call(`/api/admin/post?file=${encodeURIComponent(file)}`)).status, 422, file);
      assert.equal((await call("/api/admin/post", { method: "DELETE", json: { file, oid: "x" } })).status, 422, file);
    }
  });
  it("turns a branch that moved during the save into a clear conflict", async () => {
    beforeRef = () => repo.push("README.md", "edited on github.com");
    const r = await save(draft());
    assert.equal(r.status, 409);
    assert.match(r.body.message, /刷新/);
    assert.equal(repo.text("content/posts/from-admin.md"), undefined);
  });
  it("explains token problems instead of failing silently", async () => {
    githubDown = 401;
    const r = await content();
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "CONTENT_TOKEN");
  });
});

describe("Admin: images", () => {
  it("commits a referenced image under its content-hash path with the post", async () => {
    const path = (await uploadPath(png))!;
    assert.match(path, /^\/images\/[0-9a-f]{16}\.png$/);
    const r = await save({
      ...draft({ cover: path, coverAlt: "一张图" }),
      body: `正文\n\n![图](${path})\n`,
      uploads: [
        { path, data: toBase64(png) },
        { path: "/images/0000000000000000.png", data: toBase64(png) },
      ],
    });
    assert.equal(r.status, 201);
    assert.deepEqual(repo.files().get(`public${path}`), png);
    assert(!repo.files().has("public/images/0000000000000000.png"), "unreferenced upload skipped");
    assert.equal(repo.last().parent, "c0", "post and image land in a single commit");
  });
  it("refuses SVG, mislabelled and oversized files", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const cases = [
      { path: "/images/0123456789abcdef.png", data: toBase64(svg) },
      { path: "/images/0123456789abcdef.png", data: toBase64(png) },
      { path: "/images/../../worker/x.png", data: toBase64(png) },
    ];
    for (const upload of cases) {
      const r = await save({ ...draft({ cover: upload.path, coverAlt: "x" }), uploads: [upload] });
      assert.equal(r.status, 422, upload.path);
    }
    const big = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]);
    const path = (await uploadPath(big))!;
    const r = await save({ ...draft({ cover: path, coverAlt: "x" }), uploads: [{ path, data: toBase64(big) }] });
    assert.equal(r.status, 422);
    assert.equal(repo.head, "c0");
  });
});

describe("Admin: site profile", () => {
  const profile = async () => {
    const { body } = await content();
    return { oid: body.site.oid, aboutOid: body.about.oid, site: body.site.data, about: body.about.text };
  };
  it("renames the site, changes the avatar and keeps every other field", async () => {
    const p = await profile();
    const path = (await uploadPath(png))!;
    const r = await call("/api/admin/site", {
      method: "PUT",
      json: {
        ...p,
        site: { ...p.site, name: "新名字", author: "新作者", avatar: path, socials: [{ url: "me@example.com" }, { label: "代码", url: "https://github.com/x" }] },
        uploads: [{ path, data: toBase64(png) }],
      },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const saved = JSON.parse(repo.text("content/site.json")!);
    assert.equal(saved.name, "新名字");
    assert.equal(saved.author, "新作者");
    assert.equal(saved.avatar, path);
    assert.deepEqual(saved.socials, [{ url: "me@example.com" }, { label: "代码", url: "https://github.com/x" }]);
    assert.deepEqual(saved.topics, p.site.topics);
    assert.deepEqual(saved.hero, p.site.hero);
    assert.equal(r.body.oid, oidOf(repo.text("content/site.json")!));
    assert.equal(repo.text("content/about.md"), readFileSync("content/about.md", "utf8"), "about untouched");
    assert.deepEqual(repo.files().get(`public${path}`), png);
  });
  it("edits the About page, and reports no commit when nothing changed", async () => {
    let p = await profile();
    const r = await call("/api/admin/site", { method: "PUT", json: { ...p, about: "# 关于我\n\n新的介绍。" } });
    assert.equal(r.status, 200);
    assert.equal(repo.text("content/about.md"), "# 关于我\n\n新的介绍。\n");
    assert.equal(r.body.aboutOid, oidOf("# 关于我\n\n新的介绍。\n"));
    p = await profile();
    const head = repo.head;
    const same = await call("/api/admin/site", { method: "PUT", json: p });
    assert.equal(same.status, 200);
    assert.equal(same.body.commit, null);
    assert.equal(repo.head, head);
  });
  it("validates profile fields and refuses stale versions", async () => {
    const p = await profile();
    const bad = [
      { name: "" },
      { avatar: "/nope.png" },
      { avatar: "javascript:alert(1)" },
      { socials: [{ url: "http://insecure.example" }] },
      { name: "x".repeat(41) },
    ];
    for (const change of bad) {
      const r = await call("/api/admin/site", { method: "PUT", json: { ...p, site: { ...p.site, ...change } } });
      assert.equal(r.status, 422, JSON.stringify(change));
    }
    repo.push("content/site.json", JSON.stringify({ ...p.site, name: "改过" }));
    assert.equal((await call("/api/admin/site", { method: "PUT", json: p })).status, 409);
  });
});

describe("Admin: discussions", () => {
  it("registers posts and opens a discussion for each, ten per call, with the admin's login", async () => {
    let { body } = await content();
    assert.equal(body.discussions.pending.length, manifest.length);
    discussions.push({
      id: "D_existing",
      number: 99,
      url: "https://github.com/test-owner/test-blog/discussions/99",
      body: `old\n<!-- echo:post:${manifest[0].id} -->`,
    });
    const first = await call("/api/admin/discussions", { method: "POST", json: {} });
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { mapped: 10, created: 9, remaining: manifest.length - 10 });
    const second = await call("/api/admin/discussions", { method: "POST", json: {} });
    assert.equal(second.body.remaining, 0);
    assert(tokens.every((t) => t === "Bearer admin-oauth-token"));
    assert.equal(
      db.sqlite.prepare("SELECT COUNT(*) n FROM posts").get()!.n,
      manifest.length,
    );
    assert.equal(
      db.sqlite.prepare("SELECT discussion_id FROM discussions WHERE post_id=?").get(manifest[0].id)!.discussion_id,
      "D_existing",
      "an existing discussion is reused, not duplicated",
    );
    ({ body } = await content());
    assert.equal(body.discussions.pending.length, 0);
    const created = discussions.find((d) => d.id === "D_2")!;
    assert.match(created.body, new RegExp(`${ORIGIN}/post/`));
  });
});
