import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { listTransition } from "../lib/motion";
import { useReveal } from "../lib/reveal";
import {
  ArrowRight,
  ArrowUpRight,
  Github,
  Globe,
  LayoutList,
  List,
  Quote,
} from "lucide-react";
import { storage, transient } from "../lib/storage";
import { Link } from "../lib/router";
import { useApi } from "../lib/api";
import { posts, shortDate, typeLabels, typeOrder } from "../lib/data";
import { ArtImage } from "./UI";
import { BookmarkButton } from "./Shelf";
import { useViews, viewsLabel } from "../lib/views";
import type { ContentType, Post } from "../../shared/types";
type Discussion = { totalCount: number; mapped: boolean };
type FeedPreviews = { posts: Record<string, Discussion> };
export type TypeFilter = ContentType | "all";
/** Stable, accessible type filters. A single label and one selected state
 * avoid duplicating text in a measured overlay that breaks when tabs wrap. */
export function TypeTabs({
  active,
  source = posts,
  onSelect,
  hrefFor,
  label = "按内容类型筛选",
}: {
  active: TypeFilter;
  source?: Post[];
  onSelect?: (type: TypeFilter) => void;
  hrefFor?: (type: TypeFilter) => string;
  label?: string;
}) {
  const options: TypeFilter[] = ["all", ...typeOrder];
  return (
    <div className="type-tabs" role="group" aria-label={label}>
      {options.map((type) => {
        const count = type === "all" ? source.length : source.filter((p) => p.type === type).length;
        const selected = active === type;
        const content = (
          <span className="type-tab-label">
            <span>{type === "all" ? "全部" : typeLabels[type]}</span>
            <span className="tab-count mono">{count}</span>
          </span>
        );
        const props = {
          className: `type-tab${selected ? " active" : ""}${count ? "" : " empty"}`,
          title: count ? undefined : "暂无内容",
        };
        return hrefFor ? (
          <Link key={type} href={hrefFor(type)} {...props} aria-current={selected ? "page" : undefined}>
            {content}
          </Link>
        ) : (
          <button
            key={type}
            type="button"
            {...props}
            aria-pressed={selected}
            onClick={() => listTransition(() => flushSync(() => onSelect?.(type)))}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
export function TagList({
  tags,
  hrefForTag,
}: {
  tags: string[];
  hrefForTag?: (tag: string) => string;
}) {
  return tags.length ? (
    <ul className="tag-list" aria-label="标签">
      {tags.map((tag) => (
        <li key={tag}>
          <Link href={hrefForTag?.(tag) ?? `/feed?tag=${encodeURIComponent(tag)}`}>#{tag}</Link>
        </li>
      ))}
    </ul>
  ) : null;
}
function EntryMeta({
  post,
  discussion,
}: {
  post: Post;
  discussion?: Discussion;
}) {
  const views = useViews(),
    count = views.enabled ? views.views[post.id] : 0;
  return (
    <div className="entry-meta">
      <div className="entry-meta-facts">
        <span className={`type-label type-${post.type}`}>
        <span className="type-mark" aria-hidden="true" />
        {typeLabels[post.type]}
      </span>
      <time dateTime={post.date}>{shortDate(post.date)}</time>
      {(post.type === "article" || post.type === "note") && (
        <span>{post.readingMinutes} 分钟阅读</span>
      )}
      {post.type === "project" && post.project && (
        <span className="project-status">{post.project.status}</span>
      )}
      {discussion?.mapped && discussion.totalCount > 0 && (
        <Link href={`/post/${post.slug}#discussion`}>
          {discussion.totalCount} 条评论
        </Link>
      )}
        {!!count && <span className="entry-views">{viewsLabel(count)} 阅读</span>}
      </div>
      <BookmarkButton post={post} className="card-bookmark" />
    </div>
  );
}
function Media({ post, children }: { post: Post; children: ReactNode }) {
  return (
    <Link
      href={`/post/${post.slug}`}
      className="feed-media-link"
      tabIndex={-1}
      aria-hidden="true"
    >
      {children}
    </Link>
  );
}
export function FeedEntry({
  post,
  discussion,
  priority = false,
  showMedia = true,
  tagHref,
}: {
  post: Post;
  discussion?: Discussion;
  priority?: boolean;
  showMedia?: boolean;
  tagHref?: (tag: string) => string;
}) {
  const href = `/post/${post.slug}`;
  let media: ReactNode = null;
  if (showMedia && post.cover)
    media = (
      <Media post={post}>
        <div
          className="feed-media"
          data-shared-cover={post.id}
          style={{ viewTransitionName: `visual-${post.id}` }}
        >
          <ArtImage
            src={post.cover}
            alt={post.coverAlt}
            width="1200"
            height="750"
            loading={priority ? undefined : "lazy"}
          />
        </div>
      </Media>
    );
  else if (showMedia && post.type === "note" && post.snippet)
    media = (
      <Media post={post}>
        <div className="feed-media code-thumb">
          <span className="code-dots" aria-hidden="true" />
          <span className="code-lang mono">{post.snippet.lang}</span>
          <pre>
            <code>
              {post.snippet.code
                .split("\n")
                .slice(0, 5)
                .map((line, i) => (
                  <span className="code-line" key={i}>
                    {line || " "}
                  </span>
                ))}
            </code>
          </pre>
        </div>
      </Media>
    );
  else if (showMedia && post.type === "project")
    media = (
      // Project tags are real navigation links, not nested in a cover link.
      <div className="feed-media-link project-media">
        <div className="feed-media project-thumb">
          <Link href={href} className="project-head">
            <span className="project-initial">{post.title.slice(0, 1)}</span>
            <span className="mono project-code">
              {post.project?.repo
                ? `仓库 · ${post.project.repo.replace(/^https?:\/\/(www\.)?github\.com\//, "")}`
                : `项目 · ${post.slug.replace(/^project-/, "")}`}
            </span>
          </Link>
          <div className="project-thumb-tags">
            <TagList tags={post.tags} hrefForTag={tagHref} />
          </div>
          <span className="project-langs" aria-hidden="true">
            {post.project?.stack.slice(0, 4).map((s, i, all) => (
              <i key={s} style={{ flexGrow: all.length - i + 1 }} />
            ))}
          </span>
          <span className="mono">
            {post.project?.stack.slice(0, 3).join(" · ")}
          </span>
        </div>
      </div>
    );
  if (post.type === "thought")
    return (
      <article
        className="feed-item post-card is-thought"
        id={`card-${post.id}`}
      >
        <Quote className="thought-mark" size={20} aria-hidden="true" />
        <div className="feed-body">
          <EntryMeta post={post} discussion={discussion} />
          <p className="thought-text">
            <Link href={href} className="post-card-link">
              {post.text.trim()}
            </Link>
          </p>
          <TagList tags={post.tags} hrefForTag={tagHref} />
        </div>
        <Link
          className="feed-arrow"
          href={href}
          aria-label={`打开：${post.title}`}
        >
          <ArrowRight size={18} />
        </Link>
      </article>
    );
  return (
    <article
      className={`feed-item post-card is-${post.type}${media ? " has-media" : ""}`}
      id={`card-${post.id}`}
    >
      <div className="feed-body">
        <EntryMeta post={post} discussion={discussion} />
        <h2 style={{ viewTransitionName: `title-${post.id}` }}>
          <Link href={href} className="post-card-link">
            {post.title}
          </Link>
        </h2>
        <p className="feed-excerpt">{post.excerpt}</p>
        {post.project && (
          <div className="project-facts">
            <ul className="stack-list" aria-label="技术栈">
              {post.project.stack.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            {post.project.repo && (
              <a href={post.project.repo} target="_blank" rel="noreferrer">
                <Github size={14} />
                仓库
              </a>
            )}
            {post.project.demo && (
              <a href={post.project.demo} target="_blank" rel="noreferrer">
                <Globe size={14} />
                演示
              </a>
            )}
          </div>
        )}
        {(post.type !== "project" || !media) &&
          <TagList tags={post.tags} hrefForTag={tagHref} />}
      </div>
      {media}
      <Link
        className="feed-arrow"
        href={href}
        aria-label={`打开：${post.title}`}
      >
        <ArrowRight size={18} />
      </Link>
    </article>
  );
}
/** Renders entries in batches; discussion counts come from the Worker when it is configured. */
export type Density = "full" | "compact";
/** Reader-chosen list density, remembered on this device after hydration. */
export function useDensity() {
  const [density, set] = useState<Density>("full");
  // Restore saved density before the hydration commit is painted, while
  // keeping SSR's initial markup deterministic.
  useLayoutEffect(() => {
    if (storage.get<Density>("density", "full") === "compact") set("compact");
  }, []);
  return [
    density,
    (next: Density) => {
      set(next);
      storage.set("density", next);
    },
  ] as const;
}
export function ViewToggle({
  density,
  onChange,
}: {
  density: Density;
  onChange: (d: Density) => void;
}) {
  return (
    <div className="view-toggle" role="group" aria-label="列表密度">
      <button
        type="button"
        aria-pressed={density === "full"}
        aria-label="图文 · 详细列表"
        data-tip="详细列表"
        onClick={() => onChange("full")}
      >
        <LayoutList size={16} />
        <span>图文</span>
      </button>
      <button
        type="button"
        aria-pressed={density === "compact"}
        aria-label="紧凑列表"
        data-tip="紧凑列表"
        onClick={() => onChange("compact")}
      >
        <List size={16} />
        <span>列表</span>
      </button>
    </div>
  );
}
export function FeedList({
  items,
  batch = 8,
  resetKey,
  empty,
  density = "full",
  variant = "index",
  tagHref,
}: {
  items: Post[];
  batch?: number;
  resetKey: string;
  empty: ReactNode;
  density?: Density;
  variant?: "index" | "home";
  tagHref?: (tag: string) => string;
}) {
  // A sort/filter change must reset pagination *before* the first paint.
  // Resetting limit only in useEffect allows the new order to briefly render
  // with the previous page's extended count, then snap back to eight items
  // in the middle of a View Transition.
  const [paging, setPaging] = useState({ key: resetKey, batch, limit: batch });
  const limit =
    paging.key === resetKey && paging.batch === batch ? paging.limit : batch;
  const loadingMore = useRef(false);
  // This component unmounts when a reader opens. Cache the expanded count by
  // canonical filter URL and restore in a layout effect, so React's initial
  // hydration stays deterministic and the router can restore scroll after
  // the expanded list actually exists in the DOM.
  useLayoutEffect(() => {
    if (variant === "home") return;
    const saved = transient.get<number>(`feed-limit:${resetKey}`, batch);
    if (!Number.isSafeInteger(saved) || saved <= batch) return;
    const restored = Math.min(items.length, Math.max(batch, saved));
    setPaging({ key: resetKey, batch, limit: restored });
  }, []);
  useEffect(() => {
    loadingMore.current = false;
    setPaging((current) =>
      current.key === resetKey && current.batch === batch
        ? current
        : { key: resetKey, batch, limit: batch },
    );
  }, [resetKey, batch]);
  const visible = items.slice(0, limit);
  const [listRef, grow] = useReveal<HTMLDivElement>(".feed-item", [
    resetKey,
    visible.length,
  ]);
  useEffect(() => {
    if (!loadingMore.current) return;
    let active = true;
    const unlock = () => { if (active) loadingMore.current = false; };
    // Safety release if an animation is suspended by the browser.
    const timeout = window.setTimeout(unlock, 1500);
    const frame = window.requestAnimationFrame(() => {
      const motions = [...(listRef.current?.querySelectorAll<HTMLElement>(".feed-item") || [])]
        .flatMap((item) => item.getAnimations?.() || [])
        .filter((animation) => animation.playState !== "finished" &&
          animation.effect?.getComputedTiming().iterations !== Infinity);
      if (!motions.length) unlock();
      else void Promise.allSettled(motions.map((animation) => animation.finished))
        .then(unlock);
    });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(frame);
    };
  }, [visible.length, resetKey]);
  const previews = useApi<FeedPreviews>(
    visible.length
      ? `/api/feed/comments?ids=${visible
          .slice(0, 20)
          .map((p) => p.id)
          .join(",")}`
      : null,
  );
  if (!items.length) return <>{empty}</>;
  return (
    <>
      <div className={`feed-list density-${density}${variant === "home" ? " home-list" : ""}`} ref={listRef}>
        {visible.map((p, i) => (
          <FeedEntry
            key={p.id}
            post={p}
            priority={i < 2}
            showMedia={variant !== "home" || i === 0}
            discussion={previews.data?.posts[p.id]}
            tagHref={tagHref}
          />
        ))}
      </div>
      <div className="feed-footer">
        {variant === "home" ? (
          <Link className="load-more" href="/feed">浏览全部内容<span className="mono">{items.length} 条</span><ArrowRight size={16} aria-hidden="true" /></Link>
        ) : limit < items.length ? (
          <button
            type="button"
            className="load-more"
            onClick={() => {
              if (loadingMore.current) return;
              loadingMore.current = true;
              grow();
              const expanded = Math.min(items.length, limit + batch);
              transient.set(`feed-limit:${resetKey}`, expanded);
              setPaging({ key: resetKey, batch, limit: expanded });
            }}
          >
            加载更多
            <span className="mono">还有 {items.length - limit} 条</span>
          </button>
        ) : (
          <span className="feed-end">已显示全部 {items.length} 条</span>
        )}
      </div>
    </>
  );
}
export function ArrowLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link className="arrow-link" href={href}>
      {children}
      <ArrowUpRight size={14} />
    </Link>
  );
}
