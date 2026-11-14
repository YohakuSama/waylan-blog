import { ArrowRight } from "lucide-react";
import { newestFirst, posts, typeLabels } from "../lib/data";
import { Link } from "../lib/router";
import { useReveal } from "../lib/reveal";
import { Heatmap } from "../components/Sidebar";

/** The timeline accepts data so multiple-year and empty states can be tested
 * without changing generated content or the live archive route. */
export function ArchiveIndex({ entries }: { entries: typeof posts }) {
  const years = [...new Set(entries.map((p) => p.date.slice(0, 4)))];

  return (
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
                        <span className="archive-entry-copy">
                          <span className="archive-entry-title">{p.title}</span>
                          <small className="archive-type">{typeLabels[p.type]}</small>
                        </span>
                        <ArrowRight size={15} aria-hidden="true" />
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
  );
}

export function Archive() {
  const entries = [...posts].sort(newestFirst);
  const [listRef] = useReveal<HTMLElement>(".archive-row", []);

  return (
    <div className="archive-page">
      <header className="page-heading archive-heading">
        <p className="eyebrow mono">WAYLAN / ARCHIVE</p>
        <h1>归档</h1>
        <p>按年月整理的技术记录、笔记和项目。</p>
        <div className="archive-summary page-heading-actions">
          <Link href="/feed">按主题浏览<ArrowRight size={14} aria-hidden="true" /></Link>
          <a href="#publication-activity">发布节奏</a>
          <span>共 {entries.length} 条记录</span>
        </div>
      </header>
      <section className="archive-main" aria-label="归档列表" ref={listRef}>
        <ArchiveIndex entries={entries} />
        {entries.length > 0 && (
          <aside className="archive-activity" id="publication-activity" aria-label="发布节奏">
            <div className="archive-activity-copy">
              <h2 className="section-title">发布节奏</h2>
            </div>
            <Heatmap showDates />
          </aside>
        )}
      </section>
    </div>
  );
}
