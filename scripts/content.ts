import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { JSDOM } from "jsdom";
import { parseAnnouncements } from "../shared/announcements";
import { contentTypes } from "../shared/types";
import type { Post, ContentBlock } from "../shared/types";
import {
  checkAvatar,
  parseFrontmatter,
  postMeta,
  social,
} from "../shared/content-rules";
import hljs from "highlight.js";
import { validatePostRedirects } from "../shared/redirects";
const escapeHTML = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const shells = new Set(["bash", "sh", "shell", "zsh", "console"]);
function languageLabel(lang = "") {
  const key = lang.trim().split(/\s+/)[0].toLowerCase();
  return shells.has(key) ? "bash" : key || "text";
}
// Highlight at build time so readers download no highlighter. The shell prompt
// is wrapped separately so it can be styled and left out of copied commands.
function codeHTML(code: string, lang = "") {
  const language = languageLabel(lang),
    highlight = (source: string) =>
      hljs.getLanguage(language)
        ? hljs.highlight(source, { language, ignoreIllegals: true }).value
        : escapeHTML(source);
  // Prompt/output styling only applies when the snippet uses "$ " prompts;
  // a plain list of commands is highlighted as ordinary shell code.
  const body =
    language === "bash" && /^\$ /m.test(code)
      ? code
          .split("\n")
          .map((line) =>
            line.startsWith("$ ")
              ? `<span class="code-prompt">$ </span>${highlight(line.slice(2))}`
              : `<span class="code-output">${escapeHTML(line)}</span>`,
          )
          .join("\n")
      : highlight(code);
  return `<pre><code class="hljs language-${language}">${body}\n</code></pre>`;
}
const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    "img",
    "figure",
    "figcaption",
    "span",
    "input",
  ],
  allowedAttributes: {
    input: ["type", "checked", "disabled"],
    a: ["href", "title"],
    img: ["src", "alt", "width", "height", "loading"],
    code: ["class"],
    span: ["class"],
    th: ["align"],
    td: ["align"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    a: (tag, attrs) => ({
      tagName: tag,
      attribs: {
        ...attrs,
        ...(attrs.href?.startsWith("https://")
          ? { rel: "noopener noreferrer", target: "_blank" }
          : {}),
      },
    }),
    img: (tag, attrs) => ({
      tagName: tag,
      attribs: { ...attrs, loading: "lazy" },
    }),
    // Only GFM task-list checkboxes survive, always read-only.
    input: (tag, attrs) => ({
      tagName: attrs.type === "checkbox" ? tag : "span",
      attribs:
        attrs.type === "checkbox"
          ? {
              type: "checkbox",
              disabled: "",
              ...("checked" in attrs ? { checked: "" } : {}),
            }
          : {},
    }),
  },
};
const digest = (x: string) => createHash("sha256").update(x).digest("hex");
try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const site = JSON.parse(await readFile("content/site.json", "utf8"));
site.socials = (site.socials || []).map(social);
site.avatar = checkAvatar(site.avatar);
site.announcements = parseAnnouncements(site.announcements);
if (site.avatar)
  await readFile(`public${site.avatar}`).catch(() => {
    throw new Error(`content/site.json avatar: 找不到 public${site.avatar}`);
  });
const origin = (process.env.SITE_URL || "https://YOUR_DOMAIN.example").replace(
  /\/$/,
  "",
);
if (!/^https?:\/\/[^/]+$/.test(origin))
  throw new Error("SITE_URL must be an absolute origin without a path");
// The About page body is plain Markdown, editable without touching code.
const about = await readFile("content/about.md", "utf8").catch(() => "");
site.aboutHtml = sanitizeHtml(
  marked.parse(about, { gfm: true, async: false }) as string,
  sanitizeOptions,
);
const posts: Post[] = [];
const ids = new Set<string>(),
  slugs = new Set<string>();
for (const file of (await readdir("content/posts"))
  .filter((x) => x.endsWith(".md"))
  .sort()) {
  const { data, content } = parseFrontmatter(
    await readFile(`content/posts/${file}`, "utf8"),
  );
  if (data.draft) continue;
  // slug defaults to the file name; id defaults to slug. Once published, keep id
  // unchanged: comments and highlights are attached to it.
  const meta = postMeta(
    data,
    file,
    site.topics.map((t: { id: string }) => t.id),
  );
  const { type, date, updated, project } = meta;
  if (ids.has(meta.id)) throw new Error(`${file}: id「${meta.id}」重复`);
  if (slugs.has(meta.slug))
    throw new Error(`${file}: slug「${meta.slug}」重复`);
  if (meta.cover)
    await readFile(`public${meta.cover}`).catch(() => {
      throw new Error(`${file}: 找不到封面图 public${meta.cover}`);
    });
  Object.assign(data, { id: meta.id, slug: meta.slug, tags: meta.tags });
  ids.add(meta.id);
  slugs.add(meta.slug);
  const blocks: ContentBlock[] = [],
    toc: Post["toc"] = [];
  let pending = "",
    snippet: Post["snippet"];
  const seen = new Set<string>();
  for (const token of marked.lexer(content, { gfm: true })) {
    if (token.type === "space") continue;
    if (token.type === "code" && !snippet)
      snippet = {
        lang: token.lang || "text",
        code: token.text.split("\n").slice(0, 8).join("\n"),
      };
    const explicit = token.raw.match(/^<!--\s*block:([\w-]+)\s*-->\s*$/);
    if (explicit) {
      pending = explicit[1];
      continue;
    }
    if (token.type === "html" && token.raw.trim().startsWith("<!--")) continue;
    const html = sanitizeHtml(
      token.type === "code"
        ? codeHTML(token.text, token.lang)
        : marked.parser([token]),
      sanitizeOptions,
    );
    const fragment = JSDOM.fragment(html);
    const text = fragment.textContent || "";
    const baseId = pending || `b-${digest(token.raw).slice(0, 12)}`;
    pending = "";
    let id = baseId,
      n = 1;
    while (seen.has(id)) {
      if (!id.startsWith("b-"))
        throw new Error(`${file}: duplicate block id ${id}`);
      id = `${baseId}-${++n}`;
    }
    seen.add(id);
    blocks.push({
      id,
      html,
      text,
      type: token.type,
      ...(token.type === "code" ? { lang: languageLabel(token.lang) } : {}),
    });
    if (token.type === "heading" && token.depth <= 3)
      toc.push({ id, title: text.trim(), level: token.depth });
  }
  if (!blocks.length) throw new Error(`${file}: 正文是空的`);
  const text = blocks.map((b) => b.text).join("\n");
  // Project fields live under `project`; keep the top level identical for older posts.
  const fields = { ...data };
  for (const key of ["status", "stack", "repo", "demo", "draft", "updated"])
    delete fields[key];
  posts.push({
    ...fields,
    type,
    excerpt:
      data.excerpt ||
      (text.length > 90 ? text.slice(0, 88).trim() + "…" : text.trim()),
    ...(data.excerpt ? {} : { autoExcerpt: true }),
    date,
    ...(updated ? { updated } : {}),
    tags: data.tags,
    ...(type === "note" && snippet ? { snippet } : {}),
    ...(project ? { project } : {}),
    featured: !!data.featured,
    sample: !!data.sample,
    readingMinutes: Math.max(1, Math.ceil(text.length / 420)),
    version: digest(content).slice(0, 24),
    blocks,
    toc,
    text,
  } as Post);
}
// A typo in permanent redirects must fail the build before going live.
validatePostRedirects(
  await readFile("public/_redirects", "utf8").catch(() => ""),
  slugs,
);
posts.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
await mkdir("src/generated", { recursive: true });
await mkdir("worker/generated", { recursive: true });
await writeFile("src/generated/posts.json", JSON.stringify(posts));
await writeFile("src/generated/site.json", JSON.stringify({ ...site, origin }));
// Workers Builds names the commit it builds; the admin compares it with the
// branch head to tell whether the latest edit is live yet.
await writeFile(
  "worker/generated/build.json",
  JSON.stringify({ commit: process.env.WORKERS_CI_COMMIT_SHA || null }),
);
await writeFile(
  "worker/generated/manifest.json",
  JSON.stringify(
    posts.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      version: p.version,
      blocks: p.blocks.map((b) => ({ id: b.id, text: b.text })),
    })),
  ),
);
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
await mkdir(".echo", { recursive: true });
await writeFile(
  ".echo/posts.sql",
  "-- Generated on every build. Apply for content changes; stable IDs preserve Discussions.\n" +
    posts
      .map(
        (p) =>
          `INSERT INTO posts (id,slug,title,version) VALUES (${[p.id, p.slug, p.title, p.version].map(quote).join(",")}) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,version=excluded.version;`,
      )
      .join("\n") +
    "\n",
);
console.log(
  `Content: ${posts.length} entries (${contentTypes.map((t) => `${posts.filter((p) => p.type === t).length} ${t}`).join(", ")}), ${posts.reduce((n, p) => n + p.blocks.length, 0)} stable blocks`,
);
