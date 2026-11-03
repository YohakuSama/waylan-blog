/** Static-asset redirects for published post slug changes (Cloudflare _redirects). */
const postRule = /^\/post\/([a-z0-9-]+)\s+\/post\/([a-z0-9-]+)\s+301\s*$/;
type Rule = { from: string; to: string; line: number };
const scan = (source: string) => {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const rules: Rule[] = [];
  for (let line = 0; line < lines.length; line++) {
    const match = lines[line].trim().match(postRule);
    if (match) rules.push({ from: match[1], to: match[2], line });
  }
  return { lines, rules };
};
export function validatePostRedirects(source: string, currentSlugs: Iterable<string>) {
  const current = new Set(currentSlugs);
  const { lines, rules } = scan(source);
  const seen = new Set<string>();
  if (lines.filter((line) => line.trim() && !line.trim().startsWith("#")).length > 2000)
    throw new Error("_redirects: Cloudflare 最多支持 2000 条静态重定向。");
  for (const rule of rules) {
    if (seen.has(rule.from)) throw new Error(`_redirects: /post/${rule.from} 重复。`);
    seen.add(rule.from);
    if (current.has(rule.from))
      throw new Error(`_redirects: /post/${rule.from} 与当前已发布文章冲突。`);
    if (!current.has(rule.to))
      throw new Error(`_redirects: /post/${rule.to} 不存在，旧链接目标必须是已发布文章。`);
  }
}
/** Remove aliases for a deleted article to avoid deployed 301 rules leading to 404. */
export function removePostRedirects(source: string, removedSlug: string): string | null {
  const { lines, rules } = scan(source);
  const excluded = new Set(rules
    .filter((rule) => rule.to === removedSlug || rule.from === removedSlug)
    .map((rule) => rule.line));
  if (!excluded.size) return null;
  const updated = lines.filter((_, index) => !excluded.has(index));
  while (updated.length && !updated[updated.length - 1].trim()) updated.pop();
  return updated.join("\n") + "\n";
}
/** Null means no update is needed. previousSlug=null checks a new publication. */
export function updatePostRedirects(
  source: string, previousSlug: string | null, nextSlug: string,
): string | null {
  const { lines, rules } = scan(source);
  const redirect = rules.find((rule) => rule.from === nextSlug);
  if (!previousSlug) {
    if (redirect) throw new Error(`链接名「${nextSlug}」是历史旧地址，请换一个链接名。`);
    return null;
  }
  if (previousSlug === nextSlug) return null;
  if (rules.some((rule) => rule.from === previousSlug))
    throw new Error(`当前链接名「${previousSlug}」与现有重定向冲突，请检查 _redirects。`);
  // A historical alias may be reclaimed only by its own post (a revert).
  if (redirect && redirect.to !== previousSlug)
    throw new Error(`链接名「${nextSlug}」已经是另一篇文章的历史地址。`);
  const revised = lines.flatMap((line, index) => {
    const rule = rules.find((candidate) => candidate.line === index);
    if (!rule) return [line];
    if (rule.from === nextSlug) return []; // Reclaim a previous alias.
    if (rule.to === previousSlug)
      return [`/post/${rule.from} /post/${nextSlug} 301`];
    return [line];
  });
  while (revised.length && !revised[revised.length - 1].trim()) revised.pop();
  revised.push(`/post/${previousSlug} /post/${nextSlug} 301`);
  const updated = revised.join("\n") + "\n";
  if (updated.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#")).length > 2000)
    throw new Error("_redirects: 已达到 Cloudflare 静态重定向数量限制。");
  return updated;
}
