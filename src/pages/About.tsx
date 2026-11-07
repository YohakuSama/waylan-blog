import { ArrowRight } from "lucide-react";
import { shortDate, site, stats, wordsLabel } from "../lib/data";
import { Link } from "../lib/router";
import { SocialList } from "../components/Socials";
import { useViews, viewsLabel } from "../lib/views";

const stack = [
  ["站点界面", "React · TypeScript · Vite"],
  ["页面输出", "静态预渲染 · 客户端交互"],
  ["站点服务", "Cloudflare Workers · D1"],
  ["评论", "GitHub Discussions"],
];
export function About() {
  return (
    <div className="about-page">
      <header className="page-heading">
        <p className="eyebrow mono">WAYLAN / ABOUT</p>
        <h1>关于</h1>
        <p>{site.description}</p>
      </header>
      <div className="about-layout">
        <section className="about-text" aria-label="关于本站">
          <figure className="about-motto" aria-label="站点理念，Dieter Rams 的名言">
            <blockquote lang="en">Less, but better.</blockquote>
            <figcaption>— Dieter Rams</figcaption>
          </figure>
          {/* Rendered from content/about.md at build time, already sanitised. */}
          <div
            className="about-prose"
            dangerouslySetInnerHTML={{ __html: site.aboutHtml }}
          />
          <div className="about-actions" role="group" aria-label="关于本站相关链接">
            <SocialList />
            <Link className="primary-button" href="/feed">
              浏览全部内容
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          </div>
        </section>
        <aside className="about-details" aria-label="站点技术与数据">
          <section>
            <h2 className="side-title">技术实现</h2>
            <ul>
              {stack.map(([k, v]) => (
                <li key={k}>
                  <strong>{k}</strong>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="about-stats">
            <h2 className="side-title">站点数据</h2>
            <SiteStats views />
          </section>
        </aside>
      </div>
    </div>
  );
}
/** Publication metrics remain available on every viewport; readings require real Worker data. */
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
