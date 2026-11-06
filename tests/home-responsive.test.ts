import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync("src/styles/shell.css", "utf8");
const feedCss = readFileSync("src/styles/feed.css", "utf8");
const sideCss = readFileSync("src/styles/sidebar.css", "utf8");
const pagesCss = readFileSync("src/styles/site.css", "utf8");
const responsive = readFileSync("src/styles/responsive.css", "utf8");
// Absence checks cover all former site.css sections; positive checks use their owner.
const allSite = [shell, feedCss, sideCss, pagesCss, responsive].join("\n");
const feed = readFileSync("src/components/Feed.tsx", "utf8");
const pages = ["Home", "Feed", "Projects", "Archive", "About", "NotFound"]
  .map((name) => readFileSync(`src/pages/${name}.tsx`, "utf8")).join("\n");
const sidebarComponent = readFileSync("src/components/Sidebar.tsx", "utf8");
const skins = readFileSync("src/styles/skins.css", "utf8");

/** These contracts guard layout regressions without requiring a live Worker. */
describe("home hero mobile and tablet layout", () => {
  it("shares the index-page heading geometry and 44px action rows with archive", () => {
    assert.ok(pages.includes('className="home-hero page-heading"'));
    assert.ok(pages.includes('className="eyebrow mono">WAYLAN / HOME'));
    assert.ok(pages.includes('className="eyebrow mono">WAYLAN / ARCHIVE'));
    assert.ok(pages.includes('className="home-links page-heading-actions"'));
    assert.ok(pages.includes('className="archive-summary page-heading-actions"'));
    assert.ok(pagesCss.includes(".page-heading-actions > a {"));
    assert.ok(responsive.includes("min-height: 44px;"));
    assert.ok(responsive.includes(".page-heading { padding: 32px 0 20px; }"));
    assert.equal(allSite.includes(".archive-heading h1 {"), false);
    assert.equal(allSite.includes(".home-links > .home-topic-link { display: none; }"), false);
    assert.ok(pages.includes("浏览全部内容<ArrowRight"));
  });
  it("uses one native type picker on phones and accessible tabs on wider screens", () => {
    assert.ok(responsive.includes("@media (max-width: 767px) {"));
    assert.ok(responsive.includes(".feed-controls .type-tabs { display: none; }"));
    assert.ok(responsive.includes(".feed-controls .mobile-type-select { display: inline-flex; }"));
    assert.ok(pages.includes('className="mobile-type-select"'));
    assert.ok(pages.includes('value={type}'));
    assert.ok(responsive.includes("min-height: 44px;"));
    assert.ok(feed.includes("aria-pressed={selected}"));
    assert.equal(feed.includes('className="type-fill"'), false);
  });
  it("keeps two columns from 1120px and stacks the sidebar below that width", () => {
    const sidebar = responsive.slice(responsive.indexOf("/* At 1025–1119px"));
    assert.ok(sidebar.includes("@media (min-width:1025px) and (max-width:1119px)"));
    assert.ok(sidebar.includes(".content-grid { grid-template-columns:minmax(0,1fr); }"));
    assert.ok(sidebar.includes("grid-template-columns:repeat(2,minmax(0,1fr))"));
    assert.ok(sidebar.includes("@media (min-width:861px) and (max-width:1279px)"));
    assert.ok(sidebar.includes(".header-search-text,.header-search kbd { display:none; }"));
    assert.ok(sidebar.includes("grid-template-columns:auto minmax(0,1fr) auto"));
  });
  it("keeps the homepage a single editorial feed with a compact topic doorway", () => {
    assert.ok(shell.includes(".home-feed { border-top:"));
    assert.equal(allSite.includes(".home-feed-heading"), false);
    assert.ok(shell.includes(".home-resume .resume-link"));
    assert.ok(pages.includes('href="/feed" className="home-topic-link"'));
    assert.ok(responsive.includes("@media (max-width: 1119px)"));
  });
  it("makes the entire sidebar heading a keyboard-reachable 44px link", () => {
    assert.ok(sidebarComponent.includes('className="side-heading-link"'));
    assert.ok(sidebarComponent.includes('className="side-heading-text"'));
    assert.ok(sideCss.includes(".side-heading-link:focus-visible"));
    assert.ok(sideCss.includes("min-height: 44px;"));
    assert.ok(sidebarComponent.includes('href={`/feed?topic=${t.id}`}'));
    assert.ok(sidebarComponent.includes('className="side-heading-link side-heading-static"'));
    assert.ok(pages.includes('mode="feed"'));
    assert.equal(sidebarComponent.includes("/feed?type=all"), false);
    assert.ok(skins.includes('.side-heading-link::before { content: "##"'));
    assert.ok(skins.includes(".side-heading-link .side-more svg { display: block; }"));
  });
  it("reduces tablet and phone content filtering to adjacent selects", () => {
    const start = responsive.indexOf("/* Tablets and phones use the same compact");
    assert.ok(start > 0);
    const compact = responsive.slice(start, responsive.indexOf("/* Narrow screens keep destinations", start));
    assert.ok(compact.includes("@media (max-width: 1024px)"));
    assert.ok(compact.includes(".feed-controls .filter-tabs"));
    assert.ok(compact.includes("display: none;"));
    assert.ok(compact.includes(".feed-controls .topic-select"));
    assert.ok(compact.includes("display: inline-flex;"));
    assert.ok(compact.includes(".feed-controls .feed-search-row"));
    assert.ok(compact.includes("flex-direction: row;"));
    assert.ok(responsive.includes(".feed-layout .site-sidebar { display: none; }"));
    assert.ok(compact.includes(".feed-controls .feed-search-row .sort-control"));
  });
  it("preserves existing filters on card tag clicks and provides a reset affordance", () => {
    assert.ok(feed.includes("hrefForTag?.(tag)"));
    assert.ok(feed.includes("tagHref={tagHref}"));
    assert.ok(pages.includes('tagHref={(selectedTag) => href({ tag: selectedTag })}'));
    assert.ok(pages.includes('className="feed-clear-filters"'));
    assert.ok(responsive.includes(".feed-layout .tag-list a"));
    assert.ok(responsive.includes(".feed-layout .load-more"));
  });
  it("retains the header and notification instance while moving between reader routes", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const articleHeader = readFileSync("src/features/reader/ArticleHeader.tsx", "utf8");
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    const readerStyles = readFileSync("src/styles.css", "utf8");
    assert.doesNotMatch(app, /header key=\{post \?/,
      "a route-dependent key remounts NotificationBell and briefly loses unread state");
    assert.ok(app.includes("<NotificationBell announcements="));
    assert.ok(reader.includes('bookmark={<BookmarkButton post={post}'));
    assert.ok(articleHeader.includes('className="article-heading-bottom"'));
    assert.ok(articleHeader.includes('className="article-heading-save"'));
    assert.ok(readerStyles.includes(".reading-article .article-heading-bottom"));
    assert.match(readerStyles, /\.reading-article \.article-actions \{\s*display: none;/);
  });
  it("keeps desktop project previews while replacing bulky phone/tablet cards with usable tags", () => {
    assert.ok(feed.includes('className="project-thumb-tags"'));
    assert.ok(feed.includes('className="project-compact-tags"'));
    assert.ok(feed.includes('<TagList tags={post.tags} hrefForTag={tagHref} />'));
    assert.ok(feed.includes('(post.type !== "project" || !media)'));
    assert.ok(feedCss.includes(".project-thumb-tags .tag-list a {"));
    assert.ok(responsive.includes("@media (max-width: 1040px)"));
    assert.ok(responsive.includes(".feed-item.is-project.has-media .project-media"));
    assert.ok(responsive.includes(".feed-item.is-project .project-compact-tags"));
    assert.ok(responsive.includes("@media (min-width: 768px) and (max-width: 1040px)"));
    assert.ok(feed.includes('onClick={() => onChange("compact")}'));
    assert.ok(feed.includes('onClick={() => onChange("full")}'));
  });
  it("keeps hero art bounded and save actions separate from publication facts", () => {
    const page = readFileSync("src/pages/Home.tsx", "utf8");
    const mark = readFileSync("src/components/Wordmark.tsx", "utf8");
    assert.ok(shell.includes("grid-template-columns: minmax(0, 1fr) minmax(220px, 34%);"));
    assert.ok(shell.includes(".home-list .feed-item.has-media > .feed-media-link { align-self: center; }"));
    assert.doesNotMatch(page, /className="home-motto"/);
    assert.ok(feed.includes('className="entry-meta-facts"'));
    assert.ok(feedCss.includes(".entry-meta-facts > * {"));
    assert.ok(feed.includes('className="feed-tail"'));
    assert.ok(!feed.includes('<BookmarkButton post={post} className="card-bookmark" />\n    </div>'));
    assert.match(skins, /\.feed-tail \.card-bookmark \{\s*position: static;/);
    assert.ok(mark.includes('viewBox="-3.7 -83.3 313.4 117.2"'));
    assert.ok(skins.includes(".brand-term-prompt"));
  });
  it("prevents tablet hero art from creating side-scrolling", () => {
    const bp = responsive.indexOf("@media (max-width: 1024px)");
    assert.ok(bp > 0);
    const next = responsive.indexOf("/* Narrow screens keep destinations into a menu. */", bp);
    const tablet = responsive.slice(bp, next);
    assert.ok(tablet.includes("right: auto;"));
    assert.ok(tablet.includes(".home-hero > .hero-visual {"));
  });
});
