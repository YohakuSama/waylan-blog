import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const site = readFileSync("src/styles/site.css", "utf8");
const skin = readFileSync("src/styles/skins.css", "utf8");
const motion = readFileSync("src/styles/motion.css", "utf8");

function rule(source: string, selector: string): string {
  const start = source.indexOf(selector + " {");
  assert.ok(start >= 0, `Missing rule: ${selector}`);
  return source.slice(start, source.indexOf("}", start) + 1);
}

describe("both visual themes share home geometry and focus treatments", () => {
  it("keeps the terminal decoration behind intro instead of adding a feed row", () => {
    const hero = rule(skin, ':root[data-skin="terminal"] .home-hero');
    const visual = rule(skin, ':root[data-skin="terminal"] .home-hero .hero-visual');
    const copy = rule(skin, ':root[data-skin="terminal"] .home-hero .intro-copy');
    assert.ok(hero.includes("grid-template-columns: minmax(0, 1fr);"));
    assert.ok(hero.includes("isolation: isolate;"));
    for (const expected of [
      "position: absolute;",
      "z-index: 0;",
      "height: 100%;",
      "overflow: hidden;",
      "pointer-events: none;",
      "mask-image: radial-gradient",
    ]) assert.ok(visual.includes(expected), expected);
    assert.ok(copy.includes("z-index: 1;"));
    assert.equal(visual.includes("mask-image: none;"), false);
    assert.equal(skin.includes("grid-template-columns: minmax(0, 1fr) minmax(0, 440px)"), false);
    const editorial = rule(site, ".hero-visual");
    assert.ok(editorial.includes("position: absolute;"));
    assert.ok(editorial.includes("pointer-events: none;"));
  });

  it("uses the same compact phone content-type selector for both skins", () => {
    // More phone breakpoints occur later in the file. Select the rule that
    // actually owns the six-type native picker rather than the last 767px rule.
    const phoneStart = site.indexOf("@media (max-width: 767px) {\n  .feed-controls .type-tabs");
    assert.ok(phoneStart >= 0, "missing phone category-selector breakpoint");
    const phone = site.slice(phoneStart, site.indexOf("\n}", phoneStart) + 2);
    assert.ok(phone.includes(".feed-controls .type-tabs { display: none; }"),
      "the six desktop category links must not occupy two phone rows");
    assert.ok(phone.includes(".feed-controls .mobile-type-select { display: inline-flex; }"),
      "phone category picker must remain visible");
    assert.ok(site.includes(".mobile-type-select select {"),
      "the shared phone picker needs a real native select control");
    assert.ok(site.includes("min-height: 44px;"),
      "phone picker must retain a touch target");
    assert.equal(skin.includes(':root[data-skin="terminal"] .type-tabs {'), false,
      "terminal must not restore a legacy phone grid over the shared layout");
    assert.ok(skin.includes(':root[data-skin="terminal"] .type-tab.active'),
      "terminal desktop tabs must retain their own selected color");
    assert.equal(skin.includes(".type-tabs[data-pill]"), false);
  });

  it("uses the same blurred modal veil for the terminal and editorial skins", () => {
    const veil = rule(skin, ".echo-dialog::backdrop");
    assert.ok(veil.includes("background: var(--veil);"));
    assert.ok(veil.includes("backdrop-filter: blur(3px);"));
    assert.ok(veil.includes("-webkit-backdrop-filter: blur(3px);"));
    assert.equal(skin.includes(':root[data-skin="terminal"] .echo-dialog::backdrop {'), false);
  });

  it("keeps the terminal header translucent and inherits shared motion curves", () => {
    const header = rule(skin, ':root[data-skin="terminal"] .site-header');
    // The first matching header rule only changes the dashed border. Look for
    // the later shared-blur override explicitly.
    assert.ok(header.includes("border-bottom:"));
    assert.ok(skin.includes("background: color-mix(in srgb, var(--paper) 92%, transparent);"));
    assert.ok(skin.includes("-webkit-backdrop-filter: saturate(1.4) blur(10px);"));
    assert.equal(motion.includes("--ease-spring: var(--ease-out);"), false);
    assert.ok(motion.includes("--motion-page: 320ms;"));
    assert.ok(motion.includes("--ease-out: cubic-bezier(.22, 1, .36, 1);"));
  });
});
