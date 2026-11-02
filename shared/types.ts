export type ContentBlock = {
  id: string;
  html: string;
  text: string;
  type: string;
  lang?: string;
};
export const contentTypes = [
  "article",
  "note",
  "thought",
  "journal",
  "project",
] as const;
export type ContentType = (typeof contentTypes)[number];
export const typeLabels: Record<ContentType, string> = {
  article: "文章",
  note: "笔记",
  thought: "想法",
  journal: "开发日志",
  project: "项目",
};
export type ProjectInfo = {
  status: string;
  stack: string[];
  repo?: string;
  demo?: string;
};
export type Post = {
  id: string;
  slug: string;
  /** Older Markdown files have no type and stay long-form articles. */
  type: ContentType;
  title: string;
  excerpt: string;
  /** Excerpt was cut from the body, so the reader does not repeat it as a deck. */
  autoExcerpt?: boolean;
  date: string;
  /** Last substantive revision, shown next to the publication date. */
  updated?: string;
  topic: string;
  tags: string[];
  /** Covers are optional for every type except where the author provides one. */
  cover?: string;
  coverAlt?: string;
  /** First code block of a note, used as a compact thumbnail in lists. */
  snippet?: { lang: string; code: string };
  project?: ProjectInfo;
  readingMinutes: number;
  featured: boolean;
  sample: boolean;
  version: string;
  blocks: ContentBlock[];
  toc: { id: string; title: string; level: number }[];
  text: string;
};
export type Segment = {
  blockId: string;
  quote: {
    type: "TextQuoteSelector";
    exact: string;
    prefix: string;
    suffix: string;
  };
  position: { type: "TextPositionSelector"; start: number; end: number };
};
export type Anchor = {
  schema: 1;
  postId: string;
  version: string;
  segments: Segment[];
};
export type Annotation = { id: string; commentId: string; anchor: Anchor };
export type Author = { login: string; avatarUrl: string; url: string };
export type Comment = {
  stale?: boolean;
  id: string;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  author: Author | null;
  annotation?: Annotation;
  parentId?: string;
  /** The specific reader addressed inside a GitHub Discussions reply thread. */
  replyTarget?: { id: string; login: string };
  replies?: { nodes: Comment[]; totalCount: number; pageInfo: PageInfo };
};
export type PageInfo = { hasNextPage: boolean; endCursor: string | null };
export type CommentPage = {
  nodes: Comment[];
  totalCount: number;
  pageInfo: PageInfo;
  discussionUrl: string | null;
  mapped: boolean;
  stale?: boolean;
};
export type Session = {
  user: Author | null;
  csrf?: string;
  configured: boolean;
};
