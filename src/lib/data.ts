import rawPosts from "../generated/posts.json";
import site from "../generated/site.json";
import { contentTypes, typeLabels } from "../../shared/types";
import type { ContentType, Post } from "../../shared/types";
export const posts = rawPosts as Post[];
export { site };
export const topicName = (id: string) =>
  site.topics.find((t) => t.id === id)?.name || id;
/** Topics that have at least one post; empty ones stay out of filters and the sidebar. */
export const usedTopics = site.topics.filter((t) =>
  posts.some((p) => p.topic === t.id),
);
export { typeLabels };
export const typeOrder = contentTypes;
export const isContentType = (value: string | null): value is ContentType =>
  !!value && (contentTypes as readonly string[]).includes(value);
export const countByType = (type: ContentType | "all") =>
  type === "all" ? posts.length : posts.filter((p) => p.type === type).length;
export const dateLabel = (d: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Taipei",
  }).format(new Date(`${d}T12:00:00+08:00`));
export const shortDate = (d: string) => d.replaceAll("-", ".");
const pageTitles: Record<string, string> = {
  "/": "首页",
  "/feed": "全部内容",
  "/projects": "项目",
  "/archive": "归档",
  "/about": "关于",
  "/privacy": "隐私说明",
};
export function metadata(path: string) {
  const pathname = path.split(/[?#]/)[0];
  const post = posts.find((p) => `/post/${p.slug}` === pathname);
  const title = post?.title || pageTitles[pathname] || "这一页，暂时走散了";
  return {
    title: `${title} · ${site.name}`,
    description: post?.excerpt ||
      (pathname === "/privacy"
        ? "了解本站在访问统计、GitHub 登录、公开评论和浏览器本地记录中如何处理信息。"
        : site.description),
    canonical: `${site.origin}${pathname === "/" ? "" : pathname}`,
    image: `${site.origin}${post?.cover || "/art/room.svg"}`,
    post,
  };
}
/** A single schema builder is used by static HTML and client-side navigation.
 * Otherwise the article JSON-LD loses fields after the first SPA transition. */
export function structuredData(m: ReturnType<typeof metadata>) {
  const image = m.image.replace(".svg", ".png");
  return m.post
    ? {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: m.post.title,
        description: m.post.excerpt,
        datePublished: m.post.date,
        dateModified: m.post.updated || m.post.date,
        author: { "@type": "Person", name: site.author },
        mainEntityOfPage: m.canonical,
        url: m.canonical,
        image,
        inLanguage: "zh-CN",
        isAccessibleForFree: true,
      }
    : {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: site.name,
        url: site.origin,
        description: site.description,
        inLanguage: "zh-CN",
        image,
      };
}
/** Sort comparator: newest date first, slug as a stable tie-breaker. */
export const newestFirst = (a: Post, b: Post) =>
  b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug);
/** Counts a CJK character as one word and a Latin run as one word. */
export const wordCount = (text: string) =>
  (text.match(/[㐀-鿿豈-﫿]/g)?.length || 0) +
  (text.replace(/[㐀-鿿豈-﫿]/g, " ").match(/[A-Za-z0-9][\w'.-]*/g)?.length || 0);
const byDate = [...posts].sort((a, b) => a.date.localeCompare(b.date));
/** Build-time figures; derived from content only, so prerender and hydration agree. */
export const stats = {
  posts: posts.length,
  words: posts.reduce((n, p) => n + wordCount(p.text), 0),
  tags: new Set(posts.flatMap((p) => p.tags)).size,
  first: byDate[0]?.date || "",
  latest: byDate.at(-1)?.date || "",
};
export const wordsLabel = (n: number) =>
  n >= 10_000 ? `${(n / 10_000).toFixed(1).replace(/\.0$/, "")} 万` : n.toLocaleString("en-US");
