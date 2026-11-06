import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const shell = readFileSync("src/styles/shell.css", "utf8");
const responsive = readFileSync("src/styles/responsive.css", "utf8");
const skin = readFileSync("src/styles/skins.css", "utf8");
const motion = readFileSync("src/styles/motion.css", "utf8");

function rule(source: string, selector: string): string {
  const start = source.indexOf(selector + " {");
  assert.ok(start >= 0, `Missing rule: ${selector}`);
  return source.slice(start, source.indexOf("}", start) + 1);
}

describe("both visual themes share home geometry and focus treatments", () => {
  it("keeps both hero illustrations inside their own bounded column", () => {
    const layout = rule(shell, ".home-hero");
    const editorial = rule(shell, ".hero-visual");
    const terminal = rule(skin, ':root[data-skin="terminal"] .home-hero .hero-visual');
    const terminalCopy = rule(skin, ':root[data-skin="terminal"] .home-hero .intro-copy');
    const tablet = rule(responsive, ".home-hero");
    assert.ok(layout.includes("grid-template-columns: minmax(0, 1fr) minmax(220px, 34%);"));
    assert.ok(layout.includes("align-items: start;"));
    assert.ok(editorial.includes("position: relative;"));
    assert.ok(editorial.includes("height: clamp(168px, 20vw, 220px);"));
    assert.ok(editorial.includes("pointer-events: none;"));
    assert.ok(terminal.includes("position: relative;"));
    assert.ok(terminal.includes("width: 100%;"));
    assert.ok(terminal.includes("pointer-events: none;"));
    assert.ok(terminalCopy.includes("z-index: 1;"));
    assert.ok(responsive.includes(".home-hero .hero-visual { display: none; }"));
    assert.ok(tablet.includes("grid-template-columns: minmax(0, 1fr);"));
    assert.equal(terminal.includes("mask-image: none;"), false);
  });

  it("uses the same compact phone content-type selector for both skins", () => {
    // More phone breakpoints occur later in the file. Select the rule that
    // actually owns the six-type native picker rather than the last 767px rule.
    const pickerRule = responsive.indexOf(".feed-controls .type-tabs { display: none; }");
    const phoneStart = responsive.lastIndexOf("@media (max-width: 767px)", pickerRule);
    assert.ok(phoneStart >= 0, "missing phone category-selector breakpoint");
    const phone = responsive.slice(phoneStart, responsive.indexOf("\n}", phoneStart) + 2);
    assert.ok(phone.includes(".feed-controls .type-tabs { display: none; }"),
      "the six desktop category links must not occupy two phone rows");
    assert.ok(phone.includes(".feed-controls .mobile-type-select { display: inline-flex; }"),
      "phone category picker must remain visible");
    assert.ok(responsive.includes(".mobile-type-select select {"),
      "the shared phone picker needs a real native select control");
    assert.ok(responsive.includes("min-height: 44px;"),
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
