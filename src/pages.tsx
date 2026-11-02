import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChartColumn,
  ChevronDown,
  Compass,
  Gauge,
  Hash,
  Layers,
  Search,
  X,
} from "lucide-react";
import {
  isContentType,
  newestFirst,
  posts,
  shortDate,
  site,
  stats,
  wordsLabel,
  topicName,
  typeLabels,
  usedTopics,
} from "./lib/data";
import { Link, useRouter } from "./lib/router";
import { useReveal } from "./lib/reveal";
import { SocialList } from "./components/Socials";
import { storage } from "./lib/storage";
import { EchoMark } from "./components/UI";
import { NetworkWave } from "./components/Network";
import {
  FeedList,
  TypeTabs,
  useDensity,
  ViewToggle,
  type TypeFilter,
} from "./components/Feed";
import {
  Heatmap,
  RecentBlock,
  SideTitle,
  Sidebar,
  SiteLinksBlock,
  TopicsBlock,
} from "./components/Sidebar";
import { useViews, viewsLabel } from "./lib/views";
import type { Post } from "../shared/types";
function HeroTitle() {
  const { lines, highlight } = site.hero;
  return (
    <h1 className="hero-title">
      {lines.map((line, i) => {
        const at = highlight ? line.indexOf(highlight) : -1;
        return (
          <span className="hero-line" key={i}>
            {at < 0 ? (
              line
            ) : (
              <>
                {line.slice(0, at)}
                <em className="hero-highlight">{highlight}</em>
                {line.slice(at + highlight.length)}
              </>
            )}
          </span>
        );
      })}
    </h1>
  );
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
  const [density] = useDensity();
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
    if (last && posts.some((p) => p.slug === last.slug)) setResume(last);
  }, []);
  // The home page is a reading doorway, not a second filtering interface.
  // Detailed type/topic/sort controls belong exclusively on the content page.
  const items = newestFirstList();
  return (
    <div className="content-grid home-grid">
      <div className="feed-column">
        <section className="home-hero" aria-label="站点介绍">
          <div className="intro-copy">
            <span className="hero-square" aria-hidden="true" />
            <HeroTitle />
            <p className="intro-description">{site.intro}</p>
            <Link className="primary-button" href="/feed">
              浏览全部内容
              <ArrowRight size={17} />
            </Link>
            {resume && (
              <Link
                className="resume-link"
                href={`/post/${resume.slug}?resume=1`}
              >
                <BookOpen size={15} aria-hidden="true" />
                <span>继续阅读：{resume.title}</span>
                <small>{resume.progress}%</small>
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </div>
          <div className="hero-visual">
            <NetworkWave />
            <HeroTerminal />
          </div>
        </section>
        <section className="home-feed" aria-labelledby="latest-heading">
          <div className="home-feed-heading">
            <h2 id="latest-heading">最近更新</h2>
            <span className="home-feed-count">{items.length} 篇记录</span>
          </div>
          <FeedList
            items={items}
            resetKey="latest"
            density={density}
            empty={
              <div className="empty-state">
                <h3>第一篇文字，正在路上。</h3>
                <p>这里会按发布时间显示最近的记录。</p>
              </div>
            }
          />
        </section>
      </div>
      <Sidebar />
    </div>
  );
}
const feedTitles: Record<TypeFilter, [string, string]> = {
  all: ["全部内容", "实践记录、笔记、想法、建站日志与项目，按发布时间排列。"],
  article: ["文章", "完整的长文：背景、步骤、原理，以及踩过的坑。"],
  note: ["笔记", "围绕一个具体问题的短篇记录，通常附带命令或配置。"],
  thought: ["想法", "随手记下的简短想法，还没展开成文章。"],
  journal: ["开发日志", "本站与个人工具的实现、维护和排障记录。"],
  project: ["项目", "自己做的项目与实验，注明状态与技术栈。"],
};
export function Feed() {
  const router = useRouter(),
    params = new URLSearchParams(
      router.path.split("?")[1]?.split("#")[0] || "",
    );
  const rawType = params.get("type"),
    topic = params.get("topic") || "all",
    query = params.get("q") || "",
    tag = params.get("tag") || "",
    sort = params.get("sort") || "newest";
  const type: TypeFilter =
    rawType === "all" || isContentType(rawType) ? rawType : "all";
  const [density, setDensity] = useDensity();
  const scoped = posts.filter(
    (p) =>
      (topic === "all" || p.topic === topic) &&
      (!tag || p.tags.includes(tag)) &&
      `${p.title} ${p.excerpt} ${p.text} ${p.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  const filtered = scoped
    .filter((p) => type === "all" || p.type === type)
    .sort((a, b) =>
      sort === "oldest" ? -newestFirst(a, b) : newestFirst(a, b),
    );
  function href(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(values)) {
      if (!v || v === "newest" || (k === "topic" && v === "all"))
        next.delete(k);
      else next.set(k, v);
    }
    // /feed is the canonical "all content" route; older ?type=all
    // permalinks are still accepted as a backwards-compatible alias.
    if (next.get("type") === "all") next.delete("type");
    const qs = next.toString();
    return `/feed${qs ? "?" + qs : ""}`;
  }
  const update = (values: Record<string, string>) =>
    router.navigate(href(values));
  const [title, deck] = feedTitles[type];
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow mono">WAYLAN / {type.toUpperCase()}</p>
        <h1>{title}</h1>
        <p>{deck}</p>
      </header>
      <div className="content-grid">
        <section className="feed-column" aria-label={title}>
          <div className="feed-controls">
            <div className="feed-toolbar">
              <TypeTabs
                active={type}
                source={scoped}
                hrefFor={(t) => href({ type: t })}
              />
              <ViewToggle density={density} onChange={setDensity} />
            </div>
            <div className="filter-tabs" role="group" aria-label="按主题筛选">
              <button
                type="button"
                className={topic === "all" ? "active" : ""}
                onClick={() => update({ topic: "all" })}
                aria-pressed={topic === "all"}
              >
                全部主题
              </button>
              {site.topics
                .filter((t) => t.id === topic || usedTopics.includes(t))
                .map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className={topic === t.id ? "active" : ""}
                    onClick={() => update({ topic: t.id })}
                    aria-pressed={topic === t.id}
                  >
                    {t.name}
                  </button>
                ))}
            </div>
            <div className="feed-search-row">
              <label className="topic-select">
                <span className="sr-only">按主题筛选</span>
                <select
                  aria-label="按主题筛选"
                  value={topic}
                  onChange={(e) => update({ topic: e.target.value })}
                >
                  <option value="all">全部主题</option>
                  {site.topics
                    .filter((t) => t.id === topic || usedTopics.includes(t))
                    .map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                </select>
                <ChevronDown size={13} aria-hidden="true" />
              </label>
              {query && (
                <Link className="query-chip" href={href({ q: "" })}>
                  <Search size={14} aria-hidden="true" />“{query}”
                  <X size={13} aria-label="清除搜索" />
                </Link>
              )}
              <label className="sort-control">
                <span className="sr-only">发布日期排序</span>
                <select
                  value={sort}
                  onChange={(e) => update({ sort: e.target.value })}
                >
                  <option value="newest">由新到旧</option>
                  <option value="oldest">由旧到新</option>
                </select>
                <ChevronDown size={13} />
              </label>
            </div>
          </div>
          <div className="feed-result-line" aria-live="polite">
            <span>
              {query ? `“${query}” · ` : ""}
              {topic === "all" ? "全部主题" : topicName(topic)}
              {tag && (
                <Link className="tag-chip" href={href({ tag: "" })}>
                  #{tag}
                  <X size={12} aria-label="移除标签筛选" />
                </Link>
              )}
              <span className="meta-dot">·</span>
              {filtered.length} 条
            </span>
            <Link href="/archive">
              时间归档
              <ArrowUpRight size={13} />
            </Link>
          </div>
          <FeedList
              items={filtered}
              resetKey={router.path}
              density={density}
              empty={
                <div className="empty-state">
                  <Search size={26} />
                  <h2>
                    {posts.length
                      ? "没有找到符合条件的内容。"
                      : "第一篇文字，正在路上。"}
                  </h2>
                  <p>试试短一点的关键词，或换一个分类、主题。</p>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => router.navigate("/feed?type=all")}
                  >
                    查看全部内容
                    <ArrowRight size={16} />
                  </button>
                </div>
              }
            />
        </section>
        <Sidebar current={type === "note" ? "/feed?type=note" : undefined} />
      </div>
    </>
  );
}
export function Projects() {
  const items = posts.filter((p) => p.type === "project").sort(newestFirst);
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow mono">WAYLAN / PROJECTS</p>
        <h1>项目</h1>
        <p>
          自己做的项目与实验。每个项目注明状态和技术栈，仓库与演示地址仅在真实存在时列出。
        </p>
      </header>
      <div className="content-grid">
        <section className="feed-column" aria-label="项目列表">
          <div className="feed-result-line">
            <span>{items.length} 个项目</span>
            <Link href="/feed?type=all">
              全部内容
              <ArrowUpRight size={13} />
            </Link>
          </div>
          <FeedList
            items={items}
            resetKey="projects"
            empty={
              <div className="empty-state">
                <h2>项目页还空着。</h2>
                <p>第一个项目整理好之后，会出现在这里。</p>
              </div>
            }
          />
        </section>
        <Sidebar current="/projects" />
      </div>
    </>
  );
}
export function Archive() {
  const [type, setType] = useState<TypeFilter>("all");
  const matched = posts;
  const items = matched
    .filter((p) => type === "all" || p.type === type)
    .sort(newestFirst);
  const years = [...new Set(items.map((p) => p.date.slice(0, 4)))];
  const oldest = [...posts].sort(newestFirst).at(-1);
  const tags = [...new Set(posts.flatMap((p) => p.tags))]
    .map((tag) => ({ tag, n: posts.filter((p) => p.tags.includes(tag)).length }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, "zh-CN"));
  const most = tags[0]?.n || 1;
  const [listRef] = useReveal<HTMLElement>(".archive-row", [type]);
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow mono">WAYLAN / ARCHIVE</p>
        <h1>归档</h1>
        <p>按时间排列的全部内容。每篇文章的地址发布后保持不变。</p>
      </header>
      <div className="content-grid">
        <section
          className="feed-column archive-main"
          aria-label="归档列表"
          ref={listRef}
        >
          <div className="feed-controls">
            <TypeTabs
              active={type}
              source={matched}
              onSelect={setType}
              label="按类型筛选归档"
            />
          </div>
          <div className="feed-result-line">
            <span>
              {items.length} 条内容
              <span className="meta-dot">·</span>自{" "}
              {oldest ? shortDate(oldest.date) : "今天"} 起
            </span>
            <Link href="/feed?type=all">
              列表浏览
              <ArrowUpRight size={13} />
            </Link>
          </div>
          {years.map((year) => (
            <section className="archive-year" key={year}>
              <h2 className="mono">
                {year}
                <span>
                  {items.filter((p) => p.date.startsWith(year)).length} 条
                </span>
              </h2>
              {items
                .filter((p) => p.date.startsWith(year))
                .map((p) => (
                  <Link
                    className="archive-row"
                    key={p.id}
                    href={`/post/${p.slug}`}
                  >
                    <time className="mono" dateTime={p.date}>
                      {p.date.slice(5).replace("-", ".")}
                    </time>
                    <span>
                      {p.title}
                      <small>
                        {typeLabels[p.type]} · {topicName(p.topic)}
                        {p.type === "article" && ` · ${p.readingMinutes} 分钟`}
                      </small>
                    </span>
                    <ArrowUpRight size={16} />
                  </Link>
                ))}
            </section>
          ))}
          {!items.length && (
            <div className="empty-state">这个分类下暂时没有内容。</div>
          )}
        </section>
        <aside className="site-sidebar" aria-label="归档概览">
          <section className="side-block">
            <SideTitle
              icon={<ChartColumn size={17} />}
              href="/feed?type=all"
              label="浏览全部内容"
            >
              内容概览
            </SideTitle>
            <SiteStats />
            <Heatmap />
          </section>
          <section className="side-block tag-cloud">
            <SideTitle
              icon={<Hash size={17} />}
              href="/feed?type=all"
              label="浏览全部内容"
            >
              按标签
            </SideTitle>
            <ul>
              {tags.map(({ tag, n }) => (
                <li key={tag}>
                  <Link
                    href={`/feed?tag=${encodeURIComponent(tag)}`}
                    data-weight={n === most ? 3 : n > 1 ? 2 : 1}
                  >
                    {tag}
                    <small>{n}</small>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
          <TopicsBlock />
          <SiteLinksBlock current="/archive" />
        </aside>
      </div>
    </>
  );
}
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
      <div className="content-grid">
        <section className="feed-column about-text" aria-label="关于本站">
          {/* Rendered from content/about.md at build time, already sanitised. */}
          <div
            className="about-prose"
            dangerouslySetInnerHTML={{ __html: site.aboutHtml }}
          />
          <SocialList />
          <div className="about-details">
            <div>
              <h3 className="side-title">写作主题</h3>
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
              <h3 className="side-title">技术实现</h3>
              <ul>
                {stack.map(([k, v]) => (
                  <li key={k}>
                    <strong>{k}</strong>
                    <span>{v}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="side-title">隐私与数据</h3>
              <ul>
                <li>无广告，无第三方统计与追踪脚本。</li>
                <li>评论存储在 GitHub Discussions，公开可见。</li>
                <li>私人划线只保存在你的浏览器中。</li>
              </ul>
            </div>
          </div>
          <Link className="primary-button" href="/feed">
            阅读最新文章
            <ArrowRight size={17} />
          </Link>
        </section>
        <aside className="site-sidebar" aria-label="阅读导览">
          <section className="side-block">
            <SideTitle
              icon={<Compass size={17} />}
              href="/feed?type=all"
              label="浏览全部内容"
            >
              从这里开始
            </SideTitle>
            <p className="side-text">
              想找具体的解决方案，可以按主题浏览；想了解最近的折腾，先读最新文章。
            </p>
            <ul className="explore-list">
              {usedTopics.map((t) => (
                <li key={t.id}>
                  <Link href={`/feed?type=all&topic=${t.id}`}>
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
            <SideTitle
              icon={<Gauge size={17} />}
              href="/archive"
              label="打开归档"
            >
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
          <small>篇</small>
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
  const wanted = decodeURIComponent(path.split("/").filter(Boolean).at(-1) || "")
    .toLowerCase();
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
