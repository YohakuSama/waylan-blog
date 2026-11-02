import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const site = readFileSync("src/styles/site.css", "utf8");

/** These contracts guard layout regressions without requiring a live Worker. */
describe("home hero mobile and tablet layout", () => {
  it("layers the dotted wave behind hero copy without taking a new row on touch devices", () => {
    assert.ok(site.includes('@media (max-width: 860px)'));
    const begin = site.indexOf('  /* The wave is a background, not a card');
    assert.ok(begin > 0);
    const region = site.slice(begin, begin + 1250);
    assert.ok(region.includes("position: absolute;"));
    assert.ok(region.includes("z-index: 0;"));
    assert.ok(region.includes("height: 100%;"));
    assert.ok(region.includes("margin: 0;"));
    assert.ok(region.includes("pointer-events: none;"));
    assert.ok(region.includes("mask-image: radial-gradient"));
    assert.ok(region.includes(".home-hero .intro-copy"));
    assert.ok(region.includes("z-index: 1;"));
    const mobile = site.slice(site.indexOf('@media (max-width: 480px)'));
    assert.ok(mobile.includes("opacity: .25;"));
    assert.ok(mobile.includes("width: 100%;"));
    assert.ok(mobile.includes("right: 0;"));
    assert.equal(mobile.includes("height: clamp(94px, 25vw, 112px)"), false);
  });

  it("shows every content-page type on phones without horizontal clipping", () => {
    const start = site.indexOf("/* A two-row wrap is easier");
    assert.ok(start > 0);
    const region = site.slice(start, start + 1300);
    assert.ok(region.includes("flex-wrap: wrap;"));
    assert.ok(region.includes("overflow: visible;"));
    assert.ok(region.includes(".type-tabs[data-pill] .type-fill"));
    assert.ok(region.includes("display: none;"));
    const narrow = site.slice(site.indexOf("/* Five categories stay completely visible"));
    assert.ok(narrow.includes("grid-template-columns: repeat(3, minmax(0, 1fr));"));
    assert.ok(narrow.includes("width: 100%;"));
    assert.ok(narrow.includes("flex: 1 1 100%;"));
  });

  it("keeps the homepage a single editorial feed rather than two filter panels", () => {
    assert.ok(site.includes(".home-feed-heading"));
    assert.ok(site.includes(".home-feed-count"));
    assert.ok(site.includes(".home-hero .resume-link"));
  });
  it("reduces tablet and phone content filtering to adjacent selects", () => {
    const start = site.indexOf("/* Tablets and phones use the same compact");
    assert.ok(start > 0);
    const compact = site.slice(start, site.indexOf("/* Navigation collapses", start));
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
    const next = site.indexOf("/* Navigation collapses into a menu. */", bp);
    const tablet = site.slice(bp, next);
    assert.ok(tablet.includes("right: 0;"));
    assert.ok(tablet.includes("width: min(56%, 480px);"));
  });
});
