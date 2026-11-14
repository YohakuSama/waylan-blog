// Content rules shared by the build (scripts/content.ts) and the admin API, so
// anything the admin accepts is guaranteed to build, and vice versa.
import yaml from "js-yaml";
import { contentTypes, type ContentType, type ProjectInfo } from "./types";

export type Frontmatter = Record<string, unknown>;

const FENCE = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/;

/** Splits `---` YAML front matter from a Markdown file. */
export function parseFrontmatter(source: string): {
  data: Frontmatter;
  content: string;
} {
  const match = source.match(FENCE);
  if (!match) return { data: {}, content: source.replace(/^﻿/, "") };
  const data = match[1].trim() ? yaml.safeLoad(match[1]) : {};
  if (data === null || typeof data !== "object" || Array.isArray(data))
    throw new Error("front matter 必须是键值对");
  return { data: data as Frontmatter, content: source.slice(match[0].length) };
}

/** Writes front matter back; empty values are dropped, key order is kept. */
export function stringifyFrontmatter(data: Frontmatter, content: string) {
  const clean = Object.fromEntries(
    Object.entries(data).filter(
      ([, v]) =>
        v !== undefined &&
        v !== null &&
        v !== "" &&
        v !== false &&
        !(Array.isArray(v) && !v.length),
    ),
  );
  // Dates arrive as YYYY-MM-DD strings; write them bare, as authors do, so a
  // re-saved file only differs where it was edited.
  const head = yaml
    .safeDump(clean, { lineWidth: -1, flowLevel: 1 })
    .replace(/^(date|updated): '(\d{4}-\d{2}-\d{2})'$/gm, "$1: $2");
  return `---\n${head}---\n${content.replace(/^\r?\n*/, "")}`.replace(
    /\r\n/g,
    "\n",
  );
}

export const SLUG = /^[a-z0-9-]+$/;
export const slugRule = "只能用小写英文、数字和连字符";
export const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|svg)$/i;

export function toDate(value: unknown, label: string) {
  const d =
    value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))
    throw new Error(`${label} 必须是 YYYY-MM-DD 格式`);
  return d;
}

export type PostMeta = {
  id: string;
  slug: string;
  type: ContentType;
  title: string;
  date: string;
  updated?: string;
  topic: string;
  tags: string[];
  cover?: string;
  project?: ProjectInfo;
  draft: boolean;
};

/**
 * Validates one post's front matter. `file` is the file name in content/posts;
 * slug defaults to it and id defaults to slug. Uniqueness and file existence
 * are checked by the caller, which knows the whole collection.
 */
export function postMeta(data: Frontmatter, file: string, topics: string[]) {
  const fail = (message: string): never => {
    throw new Error(`${file}: ${message}`);
  };
  const slug = String(data.slug || file.replace(/\.md$/, ""));
  const id = String(data.id || slug);
  const type = (data.type || "article") as ContentType;
  if (!contentTypes.includes(type))
    fail(`未知的 type「${data.type}」，可选：${contentTypes.join(" / ")}`);
  for (const key of ["title", "date", "topic", ...(data.cover ? ["coverAlt"] : [])])
    if (!data[key]) fail(`缺少 ${key}`);
  const tags = Array.isArray(data.tags)
    ? data.tags.map(String)
    : data.tags
      ? [String(data.tags)]
      : [];
  let project: ProjectInfo | undefined;
  if (type === "project") {
    if (!data.status || !Array.isArray(data.stack) || !data.stack.length)
      fail("projects need status and stack");
    for (const key of ["repo", "demo"])
      if (data[key] && !/^https:\/\/[^\s]+$/.test(String(data[key])))
        fail(`${key} must be an https URL`);
    project = {
      status: String(data.status),
      stack: (data.stack as unknown[]).map(String),
      ...(data.repo ? { repo: String(data.repo) } : {}),
      ...(data.demo ? { demo: String(data.demo) } : {}),
    };
  }
  if (!SLUG.test(id)) fail(`id「${id}」格式不对（${slugRule}）`);
  if (!SLUG.test(slug))
    fail(
      `slug「${slug}」格式不对（${slugRule}）。文件名不是英文时请在 frontmatter 写 slug`,
    );
  if (!topics.includes(String(data.topic)))
    fail(`未知的 topic「${data.topic}」，可选：${topics.join(" / ")}`);
  const at = (value: unknown, key: string) => {
    try {
      return toDate(value, key);
    } catch (error) {
      return fail((error as Error).message);
    }
  };
  const date = at(data.date, "date");
  const updated = data.updated ? at(data.updated, "updated") : undefined;
  if (updated && updated < date) fail("updated 不能早于 date");
  const cover = data.cover ? String(data.cover) : undefined;
  if (cover && (!/^\/(art|images)\//.test(cover) || cover.includes("..")))
    fail("cover 必须是 public/art/ 或 public/images/ 下的图片");
  return {
    id,
    slug,
    type,
    title: String(data.title),
    date,
    ...(updated ? { updated } : {}),
    topic: String(data.topic),
    tags,
    ...(cover ? { cover } : {}),
    ...(project ? { project } : {}),
    draft: !!data.draft,
  } satisfies PostMeta as PostMeta;
}

/** A Markdown body has content once HTML comments (block ids) are removed. */
export const hasBody = (content: string) =>
  !!content.replace(/<!--[\s\S]*?-->/g, "").trim();

/** `site.avatar` is a path under public/, e.g. "/avatar.jpg". */
export function checkAvatar(avatar: unknown) {
  if (!avatar) return "";
  const path = String(avatar);
  if (!/^\/[\w./-]+\.(png|jpe?g|webp|avif|gif|svg)$/i.test(path) || path.includes(".."))
    throw new Error(
      `content/site.json avatar: 请填 public/ 下的图片路径，例如 "/avatar.jpg"`,
    );
  return path;
}

// Contact links: icon and default label are inferred from the address, so the
// author only writes { "url": ... }. A bare e-mail address becomes mailto:.
const socialKinds: [RegExp, string, string][] = [
  [/^mailto:/, "email", "邮箱"],
  [/^tel:/, "phone", "电话"],
  [/^https:\/\/(www\.)?(x|twitter)\.com\//, "x", "X"],
  [/^https:\/\/(t\.me|telegram\.me)\//, "telegram", "Telegram"],
  [/^https:\/\/(www\.)?(discord\.com|discord\.gg|discordapp\.com)\//, "discord", "Discord"],
  [/^https:\/\/signal\.me\//, "signal", "Signal"],
  [/^https:\/\/(www\.)?github\.com\//, "github", "GitHub"],
];
export function social(s: { label?: string; url?: string }, i: number) {
  let url = String(s.url || "").trim();
  if (/^[^\s@/:]+@[^\s@/]+\.[^\s@/]+$/.test(url)) url = "mailto:" + url;
  if (!/^(https:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+|tel:\+?[0-9][0-9(). -]{4,24})$/.test(url))
    throw new Error(
      `content/site.json socials[${i}]: url 必须是 https:// 链接、邮箱地址或 tel: 电话号码，现在是「${s.url}」`,
    );
  const [, kind, label] = socialKinds.find(([re]) => re.test(url)) || [
    null,
    "link",
    new URL(url).hostname.replace(/^www\./, ""),
  ];
  return { url, kind, label: s.label || label };
}
