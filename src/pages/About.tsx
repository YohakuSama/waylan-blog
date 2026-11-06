import { ArrowRight, Compass, Gauge, Layers } from "lucide-react";
import { posts, shortDate, site, stats, usedTopics, wordsLabel } from "../lib/data";
import { Link } from "../lib/router";
import { SocialList } from "../components/Socials";
import { RecentBlock, SideTitle, SiteLinksBlock } from "../components/Sidebar";
import { useViews, viewsLabel } from "../lib/views";

const stack = [
  ["站点界面", "React · TypeScript · Vite"],
  ["页面输出", "静态预渲染 · 客户端交互"],
  ["站点服务", "Cloudflare Workers · D1"],
  ["评论", "GitHub Discussions"],
];
export function About() {
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow mono">WAYLAN / ABOUT</p>
        <h1>关于</h1>
        <p>{site.description}</p>
      </header>
      <div className="content-grid about-layout">
        <section className="feed-column about-text" aria-label="关于本站">
          <figure className="about-motto" aria-label="站点理念，Dieter Rams 的名言">
            <blockquote lang="en">Less, but better.</blockquote>
            <figcaption>— Dieter Rams</figcaption>
          </figure>
          {/* Rendered from content/about.md at build time, already sanitised. */}
          <div
            className="about-prose"
            dangerouslySetInnerHTML={{ __html: site.aboutHtml }}
          />
          <SocialList />
          <div className="about-details">
            <div>
              <h2 className="side-title">写作主题</h2>
              <ul>
                {site.topics.map((t) => (
                  <li key={t.id}>
                    <strong>{t.name}</strong>
                    <span>{t.description}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="side-title">技术实现</h2>
              <ul>
                {stack.map(([k, v]) => (
                  <li key={k}>
                    <strong>{k}</strong>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <Link className="primary-button" href="/feed">
            浏览全部内容
            <ArrowRight size={17} />
          </Link>
        </section>
        <aside className="site-sidebar" aria-label="阅读导览">
          <section className="side-block">
            <SideTitle
              icon={<Compass size={17} />}
              href="/feed"
              label="浏览全部内容"
            >
              内容分类
            </SideTitle>
            <p className="side-text">
              可按主题筛选文章，也可查看最近更新。
            </p>
            <ul className="explore-list">
              {usedTopics.map((t) => (
                <li key={t.id}>
                  <Link href={`/feed?topic=${t.id}`}>
                    <Layers size={15} className="explore-icon" aria-hidden="true" />
                    <span className="explore-name">{t.name}</span>
                    <span className="mono explore-count">
                      {posts.filter((p) => p.topic === t.id).length}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <RecentBlock heatmap={false} />
          <section className="side-block">
            <SideTitle icon={<Gauge size={17} />}>
              站点数据
            </SideTitle>
            <SiteStats views />
          </section>
          <SiteLinksBlock current="/about" />
        </aside>
      </div>
    </>
  );
}
/** One stats grid for the archive and about rails; reads appear once the Worker reports them. */
function SiteStats({ views: withViews = false }: { views?: boolean }) {
  const { enabled, views } = useViews();
  const total =
    withViews && enabled ? Object.values(views).reduce((n, v) => n + v, 0) : 0;
  return (
    <dl className="site-stats">
      <div>
        <dt>内容</dt>
        <dd>
          {stats.posts}
          <small>条</small>
        </dd>
      </div>
      <div>
        <dt>文字</dt>
        <dd>
          {wordsLabel(stats.words)}
          <small>字</small>
        </dd>
      </div>
      <div>
        <dt>标签</dt>
        <dd>
          {stats.tags}
          <small>个</small>
        </dd>
      </div>
      {withViews ? (
        <div>
          <dt>阅读</dt>
          <dd>
            {total ? viewsLabel(total) : "—"}
            <small>{total ? "次" : ""}</small>
          </dd>
        </div>
      ) : (
        <div>
          <dt>最近更新</dt>
          <dd>{shortDate(stats.latest).slice(5)}</dd>
        </div>
      )}
    </dl>
  );
}
