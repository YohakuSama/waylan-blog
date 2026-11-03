import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const site = readFileSync("src/styles/site.css", "utf8");
const feed = readFileSync("src/components/Feed.tsx", "utf8");

/** These contracts guard layout regressions without requiring a live Worker. */
describe("home hero mobile and tablet layout", () => {
  it("keeps all content types visible and uses one accessible button layer", () => {
    const narrow = site.slice(site.indexOf("/* Five categories stay completely visible"));
    assert.ok(narrow.includes("grid-template-columns: repeat(3, minmax(0, 1fr));"));
    assert.ok(narrow.includes("width: 100%;"));
    assert.ok(narrow.includes("flex: 1 1 100%;"));
    assert.ok(site.includes(".type-tab.active"));
    assert.ok(site.includes("min-height:40px"));
    assert.equal(feed.includes('className="type-fill"'), false);
    assert.equal(feed.includes("ResizeObserver"), false);
    assert.ok(feed.includes("aria-pressed={selected}"));
  });
  it("reflows compact desktop content before fixed sidebars squeeze the feed", () => {
    const sidebar = site.slice(site.indexOf("/* At 1025–1279px"));
    assert.ok(sidebar.includes("@media (min-width:1025px) and (max-width:1279px)"));
    assert.ok(sidebar.includes(".content-grid { grid-template-columns:minmax(0,1fr); }"));
    assert.ok(sidebar.includes("grid-template-columns:repeat(2,minmax(0,1fr))"));
    assert.ok(sidebar.includes("@media (min-width:861px) and (max-width:1279px)"));
    assert.ok(sidebar.includes(".header-search-text,.header-search kbd { display:none; }"));
    assert.ok(sidebar.includes("grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)"));
  });
  it("keeps the homepage a single editorial feed rather than two filter panels", () => {
    assert.ok(site.includes(".home-feed { border-top:"));
    assert.equal(site.includes(".home-feed-heading"), false);
    assert.ok(site.includes(".home-resume .resume-link"));
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
    assert.ok(compact.includes(".feed-controls .feed-search-row .sort-control"));
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
