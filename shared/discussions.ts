// How a post's GitHub Discussion is recognised and introduced. Shared by
// `npm run setup:github` and the admin's "开启讨论" so both find each other's.
export const discussionMarker = (id: string) => `<!-- echo:post:${id} -->`;

export const discussionTitle = (post: { id: string; title: string }) =>
  `${post.title} [echo:${post.id}]`;

export const discussionBody = (
  post: { id: string; slug: string },
  origin: string,
  siteName: string,
) =>
  `这篇文章的公开讨论。\n\n[在 ${siteName} 阅读原文](${origin.replace(/\/$/, "")}/post/${post.slug})\n\n你可以在网站选择一段文字留下回声，也可以直接在这里讨论。请尊重每一位读者。\n\n${discussionMarker(post.id)}`;
