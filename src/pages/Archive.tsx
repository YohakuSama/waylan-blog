import { ArrowUpRight } from "lucide-react";
import { newestFirst, posts, typeLabels } from "../lib/data";
import { Link } from "../lib/router";
import { useReveal } from "../lib/reveal";
import { Heatmap } from "../components/Sidebar";

export function Archive() {
  const entries = [...posts].sort(newestFirst);
  const years = [...new Set(entries.map((p) => p.date.slice(0, 4)))];
  const [listRef] = useReveal<HTMLElement>(".archive-row", []);
  return (
    <div className="archive-page">
      <header className="page-heading archive-heading">
        <p className="eyebrow mono">WAYLAN / ARCHIVE</p>
        <h1>归档</h1>
        <p>按年月整理的技术记录、笔记和项目。</p>
        <div className="archive-summary page-heading-actions">
          <Link href="/feed">按主题浏览<ArrowUpRight size={14} aria-hidden="true" /></Link>
          <span>共 {entries.length} 条记录</span>
        </div>
      </header>
      <section className="archive-main" aria-label="归档列表" ref={listRef}>
        <div className="archive-index">
          {years.length > 1 && (
            <nav className="archive-year-nav" aria-label="跳转到年份">
              {years.map((year) => <a href={`#year-${year}`} key={year}>{year}</a>)}
            </nav>
          )}
          {years.map((year) => {
            const annual = entries.filter((p) => p.date.startsWith(year));
            const months = [...new Set(annual.map((p) => p.date.slice(5, 7)))];
            return (
              <section className="archive-year" id={`year-${year}`} key={year}>
                <h2 className="mono">{year}{years.length > 1 && <span>{annual.length} 条</span>}</h2>
                {months.map((month) => (
                  <div className="archive-month" key={month}>
                    <h3 className="archive-month-label">{Number(month)} 月</h3>
                    <ul className="archive-month-list">
                      {annual.filter((p) => p.date.slice(5, 7) === month).map((p) => (
                        <li key={p.id}>
                          <Link className="archive-row" href={`/post/${p.slug}`}>
                            <time className="mono" dateTime={p.date}>{p.date.slice(8, 10)} 日</time>
                            <span className="archive-entry-title">
                              <small className="archive-type">{typeLabels[p.type]}</small>
                              {p.title}
                            </span>
                            <ArrowUpRight size={15} aria-hidden="true" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            );
          })}
          {!entries.length && <div className="empty-state">第一篇记录发布后，会出现在这里。</div>}
        </div>
        {entries.length > 0 && (
          <aside className="archive-activity" aria-label="发布节奏">
            <div className="archive-activity-copy">
              <h2>发布节奏</h2>
              <p>截至最新记录的 16 周</p>
            </div>
            <Heatmap />
          </aside>
        )}
      </section>
    </div>
  );
}
