import type { ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChartColumn,
  Flame,
  Info,
  Layers,
  Link2,
  Rss,
} from "lucide-react";
import { Link } from "../lib/router";
import { assetURL, offlinePreview } from "../lib/runtime";
import { posts, shortDate, site, typeLabels, usedTopics } from "../lib/data";
import { SocialIcons } from "./Socials";
import { Avatar } from "./Avatar";
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
export function Heatmap() {
  const { weeks, months, total, latest } = activity();
  return (
    <div className="heatmap">
      <div
        className="heatmap-grid"
        role="img"
        aria-label={`最近 ${WEEKS} 周共更新 ${total} 条内容，最新一条在 ${latest}`}
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
  href: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="side-head">
      <h2 className="side-title">
        {icon}
        {children}
      </h2>
      <Link href={href} className="side-more" aria-label={label}>
        <ArrowRight size={16} />
      </Link>
    </div>
  );
}
/** Most-read posts; appears only once the Worker reports real counts. */
function Popular() {
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
      <SideTitle icon={<Flame size={17} />} href="/archive" label="打开归档">
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
const siteLinks = [
  { href: "/archive", label: "归档", hint: "按时间浏览全部内容" },
  { href: "/projects", label: "项目", hint: "实践项目与工具实验" },
  { href: "/feed?type=note", label: "笔记", hint: "短篇技术片段" },
  { href: "/about", label: "关于", hint: "写作方向与实践方式" },
];
/** Rail blocks shared by every index page, so the right column reads as one system. */
export function TopicsBlock() {
  return (
    <section className="side-block">
      <SideTitle
        icon={<Layers size={17} />}
        href="/feed?type=all"
        label="浏览全部内容"
      >
        写作主题
      </SideTitle>
      <ul className="explore-list">
        {usedTopics.map((t) => {
          const count = posts.filter((p) => p.topic === t.id).length;
          return (
            <li key={t.id}>
              <Link href={`/feed?type=all&topic=${t.id}`}>
                <Layers size={15} className="explore-icon" aria-hidden="true" />
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
export function RecentBlock({ heatmap = true }: { heatmap?: boolean }) {
  const recent = [...posts]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 3);
  return (
    <section className="side-block">
      <SideTitle
        icon={<ChartColumn size={17} />}
        href="/archive"
        label="打开归档"
      >
        近期更新
      </SideTitle>
      {heatmap && <Heatmap />}
      <ol className="recent-list">
        {recent.map((p) => (
          <li key={p.id}>
            <Link href={`/post/${p.slug}`}>
              <span className="mono">{shortDate(p.date).slice(5)}</span>
              <span className="recent-title">{p.title}</span>
              <span className="recent-type">{typeLabels[p.type]}</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
/** Sibling pages; the current one is left out rather than linking to itself. */
export function SiteLinksBlock({ current }: { current?: string }) {
  return (
    <section className="side-block">
      <SideTitle icon={<Link2 size={17} />} href="/feed?type=all" label="浏览全部内容">
        站内导航
      </SideTitle>
      <ul className="link-list">
        {siteLinks
          .filter((l) => l.href !== current)
          .map((l) => (
            <li key={l.href}>
              <Link href={l.href}>
                <span>
                  {l.label}
                  <small>{l.hint}</small>
                </span>
                <ArrowUpRight size={14} />
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );
}
export function Sidebar({ current }: { current?: string }) {
  return (
    <aside className="site-sidebar" aria-label="侧栏">
      <section className="side-block profile-block">
        <div className="profile-head">
          <Avatar size={60} className="profile-mark" />
          <div>
            <h2>{site.name}</h2>
            <p className="mono">{site.tagline}</p>
          </div>
        </div>
        <p className="profile-text">{site.description}</p>
        <div className="profile-tags" aria-label="本站主题标签">
          {(site.profileTags || []).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
        <div className="profile-links">
          <a
            className="icon-button"
            href={assetURL("/rss.xml")}
            download={offlinePreview() ? `${site.name}-rss.xml` : undefined}
            aria-label="订阅 RSS"
            data-tip="RSS 订阅"
          >
            <Rss size={17} />
          </a>
          <Link
            className="icon-button"
            href="/about"
            aria-label="关于本站"
            data-tip="关于本站"
          >
            <Info size={17} />
          </Link>
          <SocialIcons />
        </div>
        <details className="sidebar-note">
          <summary>给好奇读者的小纸条</summary>
          <p>选中喜欢的文字可以私人划线；想先把一篇文章放好，点一下书签就行。它们都不会上传到服务器。</p>
        </details>
      </section>
      <TopicsBlock />
      <RecentBlock />
      <SiteLinksBlock current={current} />
      <Popular />
    </aside>
  );
}
