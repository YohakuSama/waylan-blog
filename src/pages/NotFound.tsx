import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { newestFirst, posts, shortDate } from "../lib/data";
import { Link, useRouter } from "../lib/router";
import { EchoMark } from "../components/UI";

/** Character-bigram overlap; good enough to catch typos in a slug. */
const similarity = (a: string, b: string) => {
  const grams = (s: string) =>
    new Set([...s].slice(1).map((c, i) => s[i] + c));
  const x = grams(a),
    y = grams(b);
  if (!x.size || !y.size) return 0;
  let hit = 0;
  for (const g of x) if (y.has(g)) hit++;
  return (2 * hit) / (x.size + y.size);
};
export function NotFound() {
  const router = useRouter();
  // 404.html is prerendered once for every missing URL; read the real path only
  // after hydration so server and client markup agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const path = mounted ? router.path.split(/[?#]/)[0] : "/404";
  const segment = path.split("/").filter(Boolean).at(-1) || "";
  // Malformed percent escapes can appear in requested URLs; the 404 page must
  // remain usable rather than crashing while suggesting a similar article.
  let wanted = segment;
  try {
    wanted = decodeURIComponent(segment);
  } catch {
    // Keep the raw segment for a best-effort suggestion.
  }
  wanted = wanted.toLowerCase();
  const guess = wanted
    ? posts
        .map((p) => ({ p, score: similarity(wanted, p.slug) }))
        .sort((a, b) => b.score - a.score)[0]
    : undefined;
  const suggestion = guess && guess.score >= 0.45 ? guess.p : undefined;
  const latest = [...posts]
    .sort(newestFirst)
    .filter((p) => p !== suggestion)
    .slice(0, 3);
  const [echo, setEcho] = useState(0);
  return (
    <div className="not-found">
      <span className="mono">
        GET {path.length > 42 ? path.slice(0, 40) + "…" : path} → 404
      </span>
      <button
        type="button"
        className="lost-page"
        aria-label="对着空白喊一声"
        onClick={() => setEcho((n) => n + 1)}
      >
        <EchoMark />
      </button>
      {echo > 0 && (
        <span className="echo-trail mono" key={echo} aria-live="polite">
          404 <i>04</i> <i>4</i> <i>…</i>
        </span>
      )}
      <h1>页面不存在</h1>
      <p>
        链接可能已失效，或者地址输入有误。
        <br />
        这里只剩回声；不妨从下面继续。
      </p>
      {suggestion && (
        <Link className="lost-guess" href={`/post/${suggestion.slug}`}>
          <small>你是不是要找</small>
          <strong>{suggestion.title}</strong>
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
      <Link className="primary-button" href="/">
        <ArrowLeft size={17} />
        返回首页
      </Link>
      <Link className="text-button" href="/archive">
        浏览归档
        <ArrowRight size={15} />
      </Link>
      <nav className="lost-latest" aria-label="最近的文章">
        <h2 className="side-title">最近写下的</h2>
        {latest.map((p) => (
          <Link key={p.id} href={`/post/${p.slug}`}>
            <time className="mono" dateTime={p.date}>
              {shortDate(p.date).slice(5)}
            </time>
            <span>{p.title}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
