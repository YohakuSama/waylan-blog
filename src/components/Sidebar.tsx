import type { ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Code2,
  Compass,
  Flame,
  MonitorCog,
  Network,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";
import { Link } from "../lib/router";
import { posts, usedTopics } from "../lib/data";
import { useViews, viewsLabel } from "../lib/views";
const WEEKS = 16;
const DAY = 86_400_000;
const utc = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/**
 * Contribution-style calendar built from real publication dates. It ends at the
 * newest entry (not "today") so prerendered HTML and hydration always agree.
 */
function activity() {
  const counts = new Map<string, number>();
  for (const p of posts) counts.set(p.date, (counts.get(p.date) || 0) + 1);
  const latest = posts.reduce(
    (max, p) => (p.date > max ? p.date : max),
    posts[0]?.date || "2026-01-01",
  );
  const end = utc(latest);
  // Align the final column to the week (Mon–Sun) containing the latest entry.
  const weekday = (new Date(end).getUTCDay() + 6) % 7;
  const start = end - (weekday + (WEEKS - 1) * 7) * DAY;
  const weeks = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const t = start + (w * 7 + d) * DAY;
      const date = iso(t);
      return { date, count: t > end ? -1 : counts.get(date) || 0 };
    }),
  );
  const months = weeks.map((week, i) => {
    const month = Number(week[0].date.slice(5, 7));
    const prev = i ? Number(weeks[i - 1][0].date.slice(5, 7)) : 0;
    return month !== prev ? `${month}月` : "";
  });
  const inRange = posts.filter(
    (p) => utc(p.date) >= start && utc(p.date) <= end,
  );
  return { weeks, months, total: inRange.length, latest };
}
const level = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3);
export function Heatmap({ showDates = false }: { showDates?: boolean } = {}) {
  const { weeks, months, total, latest } = activity();
  return (
    <div className="heatmap">
      <div
        className="heatmap-grid"
        role="img"
        aria-label={`截至 ${latest} 的 ${WEEKS} 周共更新 ${total} 条内容`}
      >
        {weeks.map((week, w) => (
          <div className="heatmap-week" key={w}>
            <span className="heatmap-month mono" aria-hidden="true">
              {months[w]}
            </span>
            {week.map((day) => (
              <span
                key={day.date}
                className={`heat-cell level-${level(day.count)}${day.count < 0 ? " future" : ""}`}
                data-tip={
                  day.count < 0
                    ? undefined
                    : `${day.date} · ${day.count ? `${day.count} 条更新` : "无更新"}`
                }
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-legend mono">
        <span>
          {WEEKS} 周 · {total} 条
        </span>
        <span className="legend-scale" aria-hidden="true">
          少
          {[0, 1, 2, 3].map((l) => (
            <span key={l} className={`heat-cell level-${l}`} />
          ))}
          多
        </span>
      </div>
      {showDates && (
        <>
          <details className="heatmap-details">
            <summary>查看具体更新日期与图例说明</summary>
            <p className="heatmap-explanation">
              每格代表一天；色阶依次表示 0、1、2、3 条及以上更新。
            </p>
            <ul>
              {weeks.flat().filter((day) => day.count > 0).reverse().map((day) => (
                <li key={day.date}>
                  <time dateTime={day.date}>{day.date}</time>
                  <span>{day.count} 条更新</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
export function SideTitle({
  icon,
  href,
  label,
  children,
}: {
  icon: ReactNode;
  href?: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <div className="side-head">
      <h2 className="side-title">
        {href ? (
          <Link href={href} className="side-heading-link" title={label}>
            <span className="side-heading-icon" aria-hidden="true">{icon}</span>
            <span className="side-heading-text">{children}</span>
            <span className="side-more" aria-hidden="true">
              <ArrowRight size={16} />
            </span>
          </Link>
        ) : (
          <span className="side-heading-link side-heading-static">
            <span className="side-heading-icon" aria-hidden="true">{icon}</span>
            <span className="side-heading-text">{children}</span>
          </span>
        )}
      </h2>
    </div>
  );
}
/** Most-read posts; appears only once the Worker reports real counts. */
export function PopularBlock() {
  const { enabled, views } = useViews();
  const top = enabled
    ? posts
        .filter((p) => views[p.id] > 0)
        .sort((a, b) => views[b.id] - views[a.id])
        .slice(0, 4)
    : [];
  if (top.length < 2) return null;
  return (
    <section className="side-block popular-block">
      <SideTitle icon={<Flame size={17} />}>
        读得最多
      </SideTitle>
      <ol className="popular-list">
        {top.map((p, i) => (
          <li key={p.id}>
            <Link href={`/post/${p.slug}`}>
              <span className="popular-rank mono" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="popular-title">{p.title}</span>
              <span className="popular-views mono">{viewsLabel(views[p.id])}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
/** Distinct topic marks, with a readable fallback for future topics. */
const topicIcons: Record<string, LucideIcon> = {
  system: MonitorCog,
  network: Network,
  dev: Code2,
  explore: Compass,
  notes: NotebookPen,
};
/** Rail blocks shared by every index page, so the right column reads as one system. */
export function TopicsBlock({ linkHeading = true, className }: { linkHeading?: boolean; className?: string } = {}) {
  return (
    <section className={`side-block${className ? ` ${className}` : ""}`}>
      <SideTitle
        icon={<BookOpen size={17} />}
        href={linkHeading ? "/feed" : undefined}
        label={linkHeading ? "浏览全部内容" : undefined}
      >
        写作主题
      </SideTitle>
      <ul className="explore-list">
        {usedTopics.map((t) => {
          const TopicIcon = topicIcons[t.id] ?? BookOpen;
          const count = posts.filter((p) => p.topic === t.id).length;
          return (
            <li key={t.id}>
              <Link href={`/feed?topic=${t.id}`}>
                <TopicIcon size={15} className="explore-icon" aria-hidden="true" />
                <span className="explore-name">{t.name}</span>
                <span className="mono explore-count">{count}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
