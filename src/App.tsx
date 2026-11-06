import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import type { Post } from "../shared/types";
import { getReader } from "./lib/reader-loader";
import { ArrowUpRight, CornerDownLeft, Search, X } from "lucide-react";
import { RouterProvider, Link, useRouter } from "./lib/router";
import { posts, shortDate, site, stats, topicName, typeLabels, wordsLabel } from "./lib/data";
import { BackToTop, ShelfTrigger } from "./components/Shelf";
import { assetURL, offlinePreview } from "./lib/runtime";
import { Settings } from "./components/Settings";
import { NotificationBell } from "./components/NotificationBell";
import { Dialog, markHydrated } from "./components/UI";
import { Wordmark } from "./components/Wordmark";
import { PageScrollbar } from "./components/Scrollbar";
import { Tooltips } from "./components/Tooltip";
import { Home, Feed, Projects, About, Archive, NotFound } from "./pages";
import Privacy from "./pages/Privacy";
const SEARCH_LIMIT = 8;
// Derived from content rather than the clock so prerendered HTML and hydration agree.
const postYears = posts.map((p) => p.date.slice(0, 4)).sort();
const copyrightYears =
  postYears.length && postYears[0] !== postYears.at(-1)
    ? `${postYears[0]}–${postYears.at(-1)}`
    : postYears[0] || "";
function searchPosts(needle: string) {
  return posts
    .map((p) => {
      const title = p.title.toLowerCase(),
        body = `${p.excerpt} ${p.text} ${p.tags.join(" ")}`.toLowerCase();
      // Title matches rank above body matches; ties keep the newest first.
      const score = title.includes(needle) ? 2 : body.includes(needle) ? 1 : 0;
      return { p, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || b.p.date.localeCompare(a.p.date))
    .map((r) => r.p);
}
function Highlight({ text, needle }: { text: string; needle: string }) {
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}
function Shell({ reader }: { reader?: ComponentType<{ post: Post }> }) {
  const ReaderView = reader || getReader();
  const router = useRouter(),
    pathname = router.path.split(/[?#]/)[0];
  const [search, setSearch] = useState(false),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(-1),
    [shortcut, setShortcut] = useState("⌘K");
  const searchInput = useRef<HTMLInputElement>(null);
  const pendingSearchRoute = useRef<string | null>(null);
  useEffect(() => {
    markHydrated();
    if (!/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent))
      setShortcut("Ctrl K");
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const target = e.target as HTMLElement | null;
        // Leave the shortcut to editors and to other open dialogs.
        if (
          target?.closest("textarea, [contenteditable='true']") ||
          document.querySelector("dialog[open]:not(.search-dialog)")
        )
          return;
        e.preventDefault();
        setSearch((s) => !s);
      }
      // "/" opens search too, unless the reader is typing somewhere.
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !(e.target as HTMLElement | null)?.closest(
          "input, textarea, select, [contenteditable='true']",
        ) &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    pendingSearchRoute.current = null;
    setSearch(false);
  }, [router.path]);
  const post = posts.find((p) => pathname === `/post/${p.slug}`);
  // Primary navigation is for destinations, not content-type filters.
  // Every type (article, note, thought, journal, project) lives in /feed.
  const nav = [
    { url: "/", label: "首页", description: "站点介绍与最新内容", term: "~", active: pathname === "/" },
    {
      url: "/feed",
      label: "内容",
      description: "按类型与主题浏览",
      term: "content",
      active: pathname === "/feed" || (!!post && post.type !== "project"),
    },
    {
      url: "/archive",
      label: "归档",
      description: "按日期浏览记录",
      term: "archive",
      active: pathname === "/archive",
    },
    {
      url: "/projects",
      label: "项目",
      description: "项目与实验记录",
      term: "projects",
      active: pathname === "/projects" || post?.type === "project",
    },
    {
      url: "/about",
      label: "关于",
      description: "本站介绍与内容范围",
      term: "about",
      active: pathname === "/about",
    },
  ];
  const needle = query.trim().toLowerCase();
  const results = needle ? searchPosts(needle) : [];
  const shown = results.slice(0, SEARCH_LIMIT);
  const allResults = `/feed?q=${encodeURIComponent(query.trim())}`;
  function closeSearch() {
    pendingSearchRoute.current = null;
    setSearch(false);
    setQuery("");
    setActive(-1);
  }
  function navigateFromSearch(href: string) {
    // Search is a native top-layer modal. Starting the route snapshot before
    // its closing animation ends captures a dimmed/blurred old page, causing
    // the post to flash or appear under the backdrop during navigation.
    pendingSearchRoute.current = href;
    setSearch(false);
  }
  function onSearchClosed() {
    const href = pendingSearchRoute.current;
    pendingSearchRoute.current = null;
    if (href) {
      setQuery("");
      setActive(-1);
      void router.navigate(href);
    }
  }
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          // Same-document jump: move focus without involving the router.
          e.preventDefault();
          const main = document.getElementById("main");
          main?.focus({ preventScroll: true });
          main?.scrollIntoView({ block: "start" });
        }}
      >
        跳到主要内容
      </a>
      <header key={post ? "reader-masthead" : "site-masthead"} className={post ? "site-header site-header-reader" : "site-header"}>
        <div className="header-inner">
          <Link href="/" className="brand">
            <Wordmark className="brand-wordmark" />
            <span className="brand-term">
              <b>{site.name.toLowerCase()}</b>
            </span>
            <span className="brand-name">{site.name}</span>
            <span className="sr-only">首页</span>
          </Link>
          <nav
            id="site-nav"
            aria-label="主要导航"
          >
            {nav.map((n, i) => (
              <Link
                key={n.url}
                href={n.url}
                className={n.active ? "nav-link selected" : "nav-link"}
                aria-current={n.active && !post ? "page" : undefined}
                data-term={n.term}
                title={n.description}
              >
                {n.active && <span className="nav-indicator" aria-hidden="true" />}
                <span
                  className="nav-label"
                  data-term={n.term}
                  style={{ "--vt-label": `nav-${i}` } as CSSProperties}
                >
                  {n.label}
                </span>
                <span className="nav-description" aria-hidden="true">{n.description}</span>
              </Link>
            ))}
          </nav>
          <div className="header-tools" role="group" aria-label="全站工具">
            <button
              type="button"
              className="header-search"
              onClick={() => setSearch(true)}
              aria-label={`搜索 ${shortcut}`}
              aria-haspopup="dialog"
            >
              <Search size={16} aria-hidden="true" />
              <span className="header-search-text">搜索</span>
              <kbd>{shortcut}</kbd>
            </button>
            <ShelfTrigger />
            <NotificationBell />
            <Settings />
          </div>
        </div>
      </header>
      <div className="site-body">
          <noscript>
          <p className="no-script">
            正文可以直接阅读。搜索、划线和评论需要启用 JavaScript。
          </p>
        </noscript>
        <main
          id="main"
          tabIndex={-1}
          className={post ? "reader-main" : "site-main"}
        >
          {post ? (
            ReaderView ? (
              <ReaderView key={post.id} post={post} />
            ) : (
              <div className="reader-skeleton" role="status">
                <span className="sr-only">正在加载文章…</span>
                <span className="skeleton-line" aria-hidden="true" />
                <span className="skeleton-line" aria-hidden="true" />
                <span className="skeleton-line" aria-hidden="true" />
                <span className="skeleton-line" aria-hidden="true" />
                <span className="skeleton-line" aria-hidden="true" />
              </div>
            )
          ) : pathname === "/" ? (
            <Home />
          ) : pathname === "/feed" ? (
            <Feed />
          ) : pathname === "/projects" ? (
            <Projects />
          ) : pathname === "/archive" ? (
            <Archive />
          ) : pathname === "/about" ? (
            <About />
          ) : pathname === "/privacy" ? (
            <Privacy />
          ) : (
            <NotFound />
          )}
        </main>
        <PageScrollbar />
        <Tooltips />
        <footer className="site-footer">
          <div className="footer-inner">
            <span className="footer-copy">
              © {copyrightYears} {site.author}. All rights reserved.
              <span className="footer-stats mono">
                {stats.posts} 条内容 · {wordsLabel(stats.words)} 字
                {stats.first && <> · 始于 {shortDate(stats.first)}</>}
              </span>
            </span>
            <nav className="footer-links" aria-label="页脚导航">
              <Link href="/archive">归档</Link>
              <Link href="/about">关于</Link>
              <Link href="/privacy">隐私</Link>
              <a
                href={assetURL("/rss.xml")}
                download={offlinePreview() ? `${site.name}-rss.xml` : undefined}
              >
                RSS
                <ArrowUpRight size={12} />
              </a>
            </nav>
          </div>
        </footer>
      </div>
      <BackToTop />
      <Dialog
        open={search}
        onClose={closeSearch}
        onClosed={onSearchClosed}
        label="搜索"
        className="search-dialog"
        initialFocus={searchInput}
      >
        <div className="global-search">
          <Search size={20} aria-hidden="true" />
          <input
            ref={searchInput}
            type="search"
            role="combobox"
            placeholder="搜索文章、笔记、项目或标签"
            value={query}
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            aria-label="全文搜索"
            aria-expanded={shown.length > 0}
            aria-controls={shown.length ? "search-results" : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              active >= 0 ? `search-option-${active}` : undefined
            }
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                // Native <input type="search"> consumes Escape to clear its value
                // before <dialog> receives cancel. Our UI explicitly promises
                // "Esc 关闭", so close it on the first keypress instead.
                e.preventDefault();
                closeSearch();
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                if (!shown.length) return;
                e.preventDefault();
                const step = e.key === "ArrowDown" ? 1 : -1;
                const next =
                  (active + step + shown.length + 1) % (shown.length + 1);
                // Index shown.length means "no option": Enter then opens all results.
                const value = next === shown.length ? -1 : next;
                setActive(value);
                if (value >= 0)
                  document
                    .getElementById(`search-option-${value}`)
                    ?.scrollIntoView({ block: "nearest" });
              } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (active >= 0 && shown[active])
                  navigateFromSearch(`/post/${shown[active].slug}`);
                else if (needle) navigateFromSearch(allResults);
              }
            }}
          />
        </div>
        <div
          className="search-results"
        >
          {!needle && (
            <div className="search-hint-state">
              <p>输入关键词搜索标题、正文和标签。</p>
              <div className="search-suggestions">
                {[...new Set(posts.flatMap((p) => p.tags))]
                  .slice(0, 6)
                  .map((tag) => (
                    <button
                      type="button"
                      key={tag}
                      onClick={() => {
                        setQuery(tag);
                        searchInput.current?.focus();
                      }}
                    >
                      #{tag}
                    </button>
                  ))}
              </div>
            </div>
          )}
          {needle && !results.length && (
            <div className="search-empty-state">
              <p>
                没有找到与“<strong>{query.trim()}</strong>”相关的内容。
              </p>
              <small>试试更短的关键词，或换一个说法。</small>
            </div>
          )}
          {shown.length > 0 && (
            <div id="search-results" role="listbox" aria-label="搜索结果">
              {shown.map((p, i) => (
            <Link
              key={p.id}
              id={`search-option-${i}`}
              href={`/post/${p.slug}`}
              onClick={(event) => {
                if (event.button || event.metaKey || event.ctrlKey ||
                    event.shiftKey || event.altKey) return;
                event.preventDefault();
                navigateFromSearch(`/post/${p.slug}`);
              }}
              role="option"
              aria-selected={i === active}
              className={
                i === active ? "search-option active" : "search-option"
              }
              onMouseEnter={() => setActive(i)}
              tabIndex={-1}
            >
              <span className="search-topic">
                {typeLabels[p.type]}
                {p.topic && ` · ${topicName(p.topic)}`}
              </span>
              <strong>
                <Highlight text={p.title} needle={needle} />
              </strong>
              <small>{p.excerpt}</small>
              <CornerDownLeft
                size={15}
                aria-hidden="true"
                className="search-enter"
              />
            </Link>
              ))}
            </div>
          )}
          {results.length > 0 && (
            <Link className="search-all" href={allResults}
              onClick={(event) => {
                if (event.button || event.metaKey || event.ctrlKey ||
                    event.shiftKey || event.altKey) return;
                event.preventDefault();
                navigateFromSearch(allResults);
              }}>
              在列表中查看全部 {results.length} 条结果
              <ArrowUpRight size={14} />
            </Link>
          )}
        </div>
        <div className="search-footer" aria-hidden="true">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 选择 <kbd>↵</kbd> 打开 <kbd>Esc</kbd> 关闭
          </span>
          <span>
            {needle ? `${results.length} 条结果` : `共 ${posts.length} 条内容`}
          </span>
        </div>
      </Dialog>
    </>
  );
}
export default function App({
  initialPath = "/",
  reader,
}: {
  initialPath?: string;
  reader?: ComponentType<{ post: Post }>;
}) {
  return (
    <RouterProvider initialPath={initialPath}>
      <Shell reader={reader} />
    </RouterProvider>
  );
}
