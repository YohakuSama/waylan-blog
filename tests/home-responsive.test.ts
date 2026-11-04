import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const site = readFileSync("src/styles/site.css", "utf8");
const feed = readFileSync("src/components/Feed.tsx", "utf8");
const pages = readFileSync("src/pages.tsx", "utf8");
const sidebarComponent = readFileSync("src/components/Sidebar.tsx", "utf8");
const skins = readFileSync("src/styles/skins.css", "utf8");

/** These contracts guard layout regressions without requiring a live Worker. */
describe("home hero mobile and tablet layout", () => {
  it("uses one native type picker on phones and accessible tabs on wider screens", () => {
    assert.ok(site.includes("@media (max-width: 767px) {"));
    assert.ok(site.includes(".feed-controls .type-tabs { display: none; }"));
    assert.ok(site.includes(".feed-controls .mobile-type-select { display: inline-flex; }"));
    assert.ok(pages.includes('className="mobile-type-select"'));
    assert.ok(pages.includes('value={type}'));
    assert.ok(site.includes("min-height: 44px;"));
    assert.ok(feed.includes("aria-pressed={selected}"));
    assert.equal(feed.includes('className="type-fill"'), false);
  });
  it("keeps two columns from 1120px and stacks the sidebar below that width", () => {
    const sidebar = site.slice(site.indexOf("/* At 1025–1119px"));
    assert.ok(sidebar.includes("@media (min-width:1025px) and (max-width:1119px)"));
    assert.ok(sidebar.includes(".content-grid { grid-template-columns:minmax(0,1fr); }"));
    assert.ok(sidebar.includes("grid-template-columns:repeat(2,minmax(0,1fr))"));
    assert.ok(sidebar.includes("@media (min-width:861px) and (max-width:1279px)"));
    assert.ok(sidebar.includes(".header-search-text,.header-search kbd { display:none; }"));
    assert.ok(sidebar.includes("grid-template-columns:auto minmax(0,1fr) auto"));
  });
  it("keeps the homepage a single editorial feed with a compact topic doorway", () => {
    assert.ok(site.includes(".home-feed { border-top:"));
    assert.equal(site.includes(".home-feed-heading"), false);
    assert.ok(site.includes(".home-resume .resume-link"));
    assert.ok(pages.includes('href="/feed" className="home-topic-link"'));
    assert.ok(site.includes("@media (max-width: 1119px)"));
  });
  it("makes the entire sidebar heading a keyboard-reachable 44px link", () => {
    assert.ok(sidebarComponent.includes('className="side-heading-link"'));
    assert.ok(sidebarComponent.includes('className="side-heading-text"'));
    assert.ok(site.includes(".side-heading-link:focus-visible"));
    assert.ok(site.includes("min-height: 44px;"));
    assert.ok(sidebarComponent.includes('href={`/feed?topic=${t.id}`}'));
    assert.ok(sidebarComponent.includes('className="side-heading-link side-heading-static"'));
    assert.ok(pages.includes('mode="feed"'));
    assert.equal(sidebarComponent.includes("/feed?type=all"), false);
    assert.ok(skins.includes('.side-heading-link::before { content: "##"'));
    assert.ok(skins.includes(".side-heading-link .side-more svg { display: block; }"));
  });
  it("reduces tablet and phone content filtering to adjacent selects", () => {
    const start = site.indexOf("/* Tablets and phones use the same compact");
    assert.ok(start > 0);
    const compact = site.slice(start, site.indexOf("/* Narrow screens keep destinations", start));
    assert.ok(compact.includes("@media (max-width: 1024px)"));
    assert.ok(compact.includes(".feed-controls .filter-tabs"));
    assert.ok(compact.includes("display: none;"));
    assert.ok(compact.includes(".feed-controls .topic-select"));
    assert.ok(compact.includes("display: inline-flex;"));
    assert.ok(compact.includes(".feed-controls .feed-search-row"));
    assert.ok(compact.includes("flex-direction: row;"));
    assert.ok(site.includes(".feed-layout .site-sidebar { display: none; }"));
    assert.ok(compact.includes(".feed-controls .feed-search-row .sort-control"));
  });
  it("preserves existing filters on card tag clicks and provides a reset affordance", () => {
    assert.ok(feed.includes("hrefForTag?.(tag)"));
    assert.ok(feed.includes("tagHref={tagHref}"));
    assert.ok(pages.includes('tagHref={(selectedTag) => href({ tag: selectedTag })}'));
    assert.ok(pages.includes('className="feed-clear-filters"'));
    assert.ok(site.includes(".feed-layout .tag-list a"));
    assert.ok(site.includes(".feed-layout .load-more"));
  });
  it("prevents tablet hero art from creating side-scrolling", () => {
    const bp = site.indexOf("@media (max-width: 1024px)");
    assert.ok(bp > 0);
    const next = site.indexOf("/* Narrow screens keep destinations into a menu. */", bp);
    const tablet = site.slice(bp, next);
    assert.ok(tablet.includes("right: 0;"));
    assert.ok(tablet.includes("width: min(30%, 300px);"));
  });
});
