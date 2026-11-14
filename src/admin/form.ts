// Post front matter <-> the editor form. Kept apart from the UI so tests can
// check that saving an untouched post leaves its front matter unchanged.
import { contentTypes, type ContentType } from "../../shared/types";

export const list = (text: string) =>
  text
    .split(/[,，\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

export type Form = {
  title: string;
  slug: string;
  type: ContentType;
  topic: string;
  date: string;
  updated: string;
  tags: string;
  excerpt: string;
  cover: string;
  coverAlt: string;
  featured: boolean;
  draft: boolean;
  status: string;
  stack: string;
  repo: string;
  demo: string;
  body: string;
};
const PROJECT = ["status", "stack", "repo", "demo"] as const;
export const str = (v: unknown) =>
  v === undefined || v === null ? "" : Array.isArray(v) ? v.join(", ") : String(v);
export function toForm(data: Record<string, unknown>, body: string, stem: string): Form {
  return {
    title: str(data.title),
    slug: str(data.slug) || stem,
    type: contentTypes.includes(data.type as ContentType)
      ? (data.type as ContentType)
      : "article",
    topic: str(data.topic),
    date: str(data.date),
    updated: str(data.updated),
    tags: str(data.tags),
    excerpt: str(data.excerpt),
    cover: str(data.cover),
    coverAlt: str(data.coverAlt),
    featured: !!data.featured,
    draft: !!data.draft,
    status: str(data.status),
    stack: str(data.stack),
    repo: str(data.repo),
    demo: str(data.demo),
    body,
  };
}
/**
 * Front matter to save: the original keys keep their order and any field this
 * form does not know about is kept as is. Empty values are dropped on save.
 */
export function toData(form: Form, original: Record<string, unknown>, stem: string) {
  const data: Record<string, unknown> = { ...original };
  const set = (key: string, value: unknown) => {
    if (key in data || (value !== "" && value !== false && !(Array.isArray(value) && !value.length)))
      data[key] = value;
  };
  set("title", form.title);
  if ("slug" in original || form.slug !== stem) set("slug", form.slug);
  if ("type" in original || form.type !== "article") set("type", form.type);
  set("excerpt", form.excerpt);
  set("date", form.date);
  set("updated", form.updated);
  set("topic", form.topic);
  set("tags", list(form.tags));
  set("cover", form.cover);
  set("coverAlt", form.cover ? form.coverAlt : "");
  set("featured", form.featured);
  set("draft", form.draft);
  if (form.type === "project") {
    set("status", form.status);
    set("stack", list(form.stack));
    set("repo", form.repo);
    set("demo", form.demo);
  } else for (const key of PROJECT) delete data[key];
  return data;
}

