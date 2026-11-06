import { useEffect, useState } from "react";
import { ArrowRight, BookOpen, Layers, Rss } from "lucide-react";
import { newestFirst, posts, site, usedTopics } from "../lib/data";
import { Link } from "../lib/router";
import { storage } from "../lib/storage";
import { assetURL, offlinePreview } from "../lib/runtime";
import { NetworkWave } from "../components/Network";
import { FeedList } from "../components/Feed";
import { PopularBlock, SideTitle, TopicsBlock } from "../components/Sidebar";

function HeroTitle() {
  return <h1 className="hero-title">首页</h1>;
}
const newestFirstList = () => [...posts].sort(newestFirst);
/** Terminal-skin hero: the same real data, printed as a shell session. */
function HeroTerminal() {
  const latest = newestFirstList().slice(0, 4);
  return (
    <div className="hero-terminal" aria-hidden="true">
      <div className="term-bar">
        <span className="win-dots">
          <i />
          <i />
          <i />
        </span>
        <span>waylan@blog: ~</span>
      </div>
      <div className="term-body">
        <p>
          <span className="t-prompt">$</span> whoami
        </p>
        <p className="t-out">
          {site.author} · {site.tagline}
        </p>
        <p>
          <span className="t-prompt">$</span> ls topics/
        </p>
        <p className="t-out">{site.topics.map((t) => `${t.id}/`).join("  ")}</p>
        <p>
          <span className="t-prompt">$</span> tail -n 4 posts.log
        </p>
        {latest.map((p) => (
          <p className="t-out t-log" key={p.id}>
            <span className="t-dim">{p.date}</span>
            <span className="t-type">[{p.type}]</span>
            <span className="t-title">{p.title}</span>
          </p>
        ))}
        <p>
          <span className="t-prompt">$</span> <span className="term-cursor" />
        </p>
      </div>
    </div>
  );
}
export function Home() {
  const [resume, setResume] = useState<{
    slug: string;
    title: string;
    progress: number;
  } | null>(null);
  useEffect(() => {
    const last = storage.get<{
      slug: string;
      title: string;
      progress: number;
    } | null>("reading", null);
    if (last && last.progress > 0 && last.progress < 100 &&
        posts.some((p) => p.slug === last.slug)) setResume(last);
    else delete document.documentElement.dataset.resumePending;
  }, []);
  // The home page is a reading doorway, not a second filtering interface.
  // Detailed type/topic/sort controls belong exclusively on the content page.
  const items = newestFirstList();
  return (
    <div className="content-grid home-grid">
      <div className="feed-column">
        <section className="home-hero page-heading" aria-label="站点介绍">
          <div className="intro-copy">
            <p className="eyebrow mono">WAYLAN / HOME</p>
            <HeroTitle />
            <p className="intro-description">{site.description}</p>
            <nav className="home-links page-heading-actions" aria-label="博客导览">
              <Link href="/feed" className="home-topic-link">
                浏览全部内容<ArrowRight size={15} aria-hidden="true" />
              </Link>
              <Link href="/about">关于本站</Link>
              <a href={assetURL("/rss.xml")}
                download={offlinePreview() ? `${site.name}-rss.xml` : undefined}>
                <Rss size={15} aria-hidden="true" />订阅 RSS
              </a>
            </nav>
          </div>
          <div className="hero-visual" aria-hidden="true">
            <NetworkWave />
            <HeroTerminal />
          </div>
        </section>
        {resume ? (
          <aside className="home-resume" aria-label="继续阅读">
            <Link className="resume-link" href={`/post/${resume.slug}?resume=1`}>
              <BookOpen size={17} aria-hidden="true" />
              <span><small>继续阅读</small><strong>{resume.title}</strong></span>
              <small className="resume-progress">{resume.progress}%</small>
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </aside>
        ) : (
          // SSR cannot read this visitor's progress. A head-script marker
          // reserves the exact card height until hydration fills the slot.
          <div className="home-resume home-resume-placeholder" aria-hidden="true">
            <div className="resume-link">
              <BookOpen size={17} aria-hidden="true" />
              <span><small>继续阅读</small><strong className="resume-preview-title" /></span>
              <small className="resume-progress resume-preview-progress" />
              <ArrowRight size={16} aria-hidden="true" />
            </div>
          </div>
        )}
        {usedTopics.length > 0 && (
          <nav className="home-topic-shortcuts" aria-label="按主题浏览文章">
            <h2>主题</h2>
            {usedTopics.map((topic) => (
              <Link href={`/feed?topic=${topic.id}`} key={topic.id}>
                {topic.name}
              </Link>
            ))}
          </nav>
        )}
        <section className="home-feed" aria-labelledby="latest-heading">
          <div className="home-section-head">
            <h2 id="latest-heading">最新内容</h2>
            <Link className="hero-browse" href="/feed">全部内容<ArrowRight size={15} aria-hidden="true" /></Link>
          </div>
          <FeedList
            items={items}
            resetKey="latest"
            variant="home"
            batch={6}
            density="full"
            empty={
              <div className="empty-state">
                <h3>暂无内容</h3>
                <p>这里会按发布时间显示最近的记录。</p>
              </div>
            }
          />
        </section>
      </div>
      <aside className="site-sidebar home-sidebar" aria-label="博客导览">
        <TopicsBlock className="home-side-topics" />
        <section className="side-block">
          <SideTitle icon={<Layers size={17} />} href="/projects" label="浏览项目">实践项目</SideTitle>
          <ul className="home-projects">
            {items.filter((p) => p.type === "project").slice(0, 3).map((p) => (
              <li key={p.id}>
                <Link href={`/post/${p.slug}`}>
                  <span className="home-project-copy">
                    <strong>{p.title}</strong>
                    <span className="home-project-state">{p.project?.status}</span>
                  </span>
                  <span className="home-project-end" aria-hidden="true">
                    <ArrowRight className="home-project-arrow" size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <PopularBlock />
        <details className="sidebar-note home-reading-note">
          <summary>阅读与收藏小技巧</summary>
          <p>点书签可保存待读内容，选中文字可以划线。阅读进度保存在当前浏览器，方便下次继续。</p>
        </details>
      </aside>
    </div>
  );
}
