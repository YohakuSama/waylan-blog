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
    const editorial = rule(site, ':root:not([data-skin="terminal"]) .home-hero .hero-visual');
    assert.ok(editorial.includes("position: absolute;"));
    assert.ok(editorial.includes("pointer-events: none;"));
  });

  it("uses the same uncut two-row categories on narrow phones", () => {
    const mobile = skin.slice(skin.indexOf("@media (max-width: 480px)"));
    assert.ok(mobile.includes('grid-template-columns: repeat(3, minmax(0, 1fr));'));
    assert.ok(mobile.includes("overflow: visible;"));
    assert.ok(site.includes("grid-template-columns: repeat(3, minmax(0, 1fr));"));
    const touch = skin.slice(skin.indexOf("@media (max-width: 767px)"));
    assert.ok(touch.includes(".type-tabs[data-pill] .type-tab.active"));
    assert.ok(touch.includes("background: var(--brand);"));
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
