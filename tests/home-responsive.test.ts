import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const site = readFileSync("src/styles/site.css", "utf8");

/** These contracts guard layout regressions without requiring a live Worker. */
describe("home hero mobile and tablet layout", () => {
  it("keeps the decorative wave compact and visible below 860px", () => {
    assert.ok(site.includes('@media (max-width: 860px)'));
    assert.ok(site.includes(':root:not([data-skin="terminal"]) .home-hero .hero-visual'));
    assert.ok(site.includes("height: clamp(114px, 18vw, 168px);"));
    assert.ok(site.includes("height: clamp(94px, 25vw, 112px);"));
    assert.ok(site.includes("transform: translateY(-50%);"));
    assert.ok(site.includes("mask-image: linear-gradient"));
  });

  it("shows every filter on phones without an overflowing horizontal scroller", () => {
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

  it("prevents tablet hero art from creating side-scrolling", () => {
    const bp = site.indexOf("@media (max-width: 1024px)");
    assert.ok(bp > 0);
    const next = site.indexOf("/* Navigation collapses into a menu. */", bp);
    const tablet = site.slice(bp, next);
    assert.ok(tablet.includes("right: 0;"));
    assert.ok(tablet.includes("width: min(56%, 480px);"));
  });
});
