import { ArrowRight, ChevronDown, Search, X } from "lucide-react";
import { isContentType, newestFirst, posts, site, topicName, typeLabels, typeOrder, usedTopics } from "../lib/data";
import { Link, useRouter } from "../lib/router";
import { FeedList, TypeTabs, useDensity, ViewToggle, type TypeFilter } from "../components/Feed";

const feedTitles: Record<TypeFilter, [string, string]> = {
  all: ["全部内容", "文章、笔记、想法、开发日志和项目，按发布时间排列。"],
  article: ["文章", "较长的技术记录，包含背景、操作过程与结果。"],
  note: ["笔记", "具体问题的简短记录，包括命令、配置和排查步骤。"],
  thought: ["想法", "简短的观点与观察。"],
  journal: ["开发日志", "本站和个人项目的开发、维护及问题排查记录。"],
  project: ["项目", "项目与实验记录，包含状态和所用技术。"],
};
export function Feed() {
  const router = useRouter(),
    params = new URLSearchParams(
      router.path.split("?")[1]?.split("#")[0] || "",
    );
  const rawType = params.get("type"),
    rawTopic = params.get("topic"),
    // Old or manually edited links must not leave the filter controls in an invalid state.
    topic = rawTopic && site.topics.some((t) => t.id === rawTopic) ? rawTopic : "all",
    query = params.get("q") || "",
    tag = params.get("tag") || "",
    sort = params.get("sort") === "oldest" ? "oldest" : "newest";
  const type: TypeFilter =
    rawType === "all" || isContentType(rawType) ? rawType : "all";
  const hasActiveFilters =
    type !== "all" || topic !== "all" || !!query || !!tag || sort !== "newest";
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
    <div className="feed-page">
      <header className="page-heading">
        <p className="eyebrow mono">WAYLAN / {type.toUpperCase()}</p>
        <h1>{title}</h1>
        <p>{deck}</p>
      </header>
      <div className="feed-layout">
        <section className="feed-column" aria-label={title}>
          <div className="feed-controls" role="region" aria-label="内容筛选与排序">
            <div className="feed-toolbar">
              <span className="feed-filter-label" aria-hidden="true">内容类型</span>
              <TypeTabs
                active={type}
                source={scoped}
                hrefFor={(t) => href({ type: t })}
              />
              <label className="mobile-type-select">
                <span className="sr-only">按内容类型筛选</span>
                <select
                  value={type}
                  onChange={(event) => update({ type: event.target.value })}
                >
                  {(["all", ...typeOrder] as TypeFilter[]).map((item) => {
                    const count = item === "all"
                      ? scoped.length
                      : scoped.filter((post) => post.type === item).length;
                    return (
                      <option key={item} value={item}>
                        {item === "all" ? "全部内容" : typeLabels[item]}（{count}）
                      </option>
                    );
                  })}
                </select>
                <ChevronDown size={14} aria-hidden="true" />
              </label>
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
            <div className="filter-tabs" role="group" aria-label="按主题筛选">
              <span className="feed-filter-label" aria-hidden="true">写作主题</span>
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
            <div className="feed-result-line" aria-live="polite">
            <span>
              <span className="sr-only">{topic === "all" ? "全部主题" : topicName(topic)}</span>
              {query && (
                <Link className="query-chip" href={href({ q: "" })}>
                  <Search size={14} aria-hidden="true" />“{query}”
                  <X size={13} aria-hidden="true" />
                  <span className="sr-only">清除搜索</span>
                </Link>
              )}
              {tag && (
                <Link className="tag-chip" href={href({ tag: "" })}>
                  #{tag}
                  <X size={12} aria-label="移除标签筛选" />
                </Link>
              )}
              <span className="meta-dot">·</span>
              共 {filtered.length} 条内容
              {hasActiveFilters && (
                <Link className="feed-clear-filters" href="/feed">
                  清除筛选
                </Link>
              )}
            </span>
              <ViewToggle density={density} onChange={setDensity} />
            </div>
          </div>
          <FeedList
              items={filtered}
              resetKey={router.path}
              density={density}
              tagHref={(selectedTag) => href({ tag: selectedTag })}
              empty={
                <div className="empty-state">
                  <Search size={26} />
                  <h2>
                    {posts.length
                      ? "没有找到符合条件的内容。"
                      : "暂无内容"}
                  </h2>
                  <p>试试短一点的关键词，或换一个分类、主题。</p>
                  <button
                    type="button"
                    className="quiet-button"
                    onClick={() => router.navigate("/feed")}
                  >
                    查看全部内容
                    <ArrowRight size={16} />
                  </button>
                </div>
              }
            />
        </section>
      </div>
    </div>
  );
}
