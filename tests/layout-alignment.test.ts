import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (name: string) => readFileSync(name, "utf8");
it("sidebars share numeric and arrow columns across both skins", () => {
  const css = read("src/styles/sidebar.css");
  const skin = read("src/styles/skins.css");
  const shell = read("src/styles/shell.css");
  assert.match(css, /--sidebar-start-slot: 24px;/);
  assert.match(css, /--sidebar-end-slot: 28px;/);
  assert.match(css, /grid-template-columns: var\(--sidebar-start-slot\) minmax\(0, 1fr\) var\(--sidebar-end-slot\);/);
  assert.match(css, /align-items: baseline;/);
  assert.match(css, /\.popular-views\s*\{[^}]*text-align: center;/s);
  // Project rows now render their own icon in the shared left slot.
  assert.match(css, /\.site-sidebar \.home-projects a\s*\{[^}]*padding-left: 0;/s);
  assert.match(shell, /\.home-project-icon\s*\{[^}]*var\(--sidebar-start-slot\)/s);
  assert.doesNotMatch(shell, /\.home-sidebar \.popular-list a\s*\{/);
  assert.doesNotMatch(skin, /\.popular-list a\s*\{/);
  assert.match(skin, /\.site-sidebar \.side-heading-link::before\s*\{[^}]*flex: 0 0 var\(--sidebar-start-slot\)/s);
});
it("desktop reading tools remain below the sticky masthead", () => {
  const css = read("src/styles.css");
  assert.match(css, /\.reader-toc\s*\{[^}]*padding-top: var\(--space-12\)/s);
  assert.match(css, /top: calc\(var\(--header-height\) \+ var\(--space-6\)\)/);
  assert.match(css, /@media \(min-width: 1041px\)/);
  assert.match(css, /max-height: calc\(100dvh - var\(--header-height\) - var\(--space-10\)\)/);
  assert.match(css, /\.toc-visible \.toc-inner\s*\{\s*position: static;/);
});
it("About keeps expandable contacts without duplicating main navigation at the footer", () => {
  const page = read("src/pages/About.tsx");
  const css = read("src/styles/site.css");
  assert.match(page, /<SocialList\s*\/>/);
  assert.match(page, /className="about-contact"/);
  assert.doesNotMatch(page, /className="about-explore"/);
  assert.doesNotMatch(css, /\.about-explore\s*\{/);
  assert.match(css, /\.about-contact \.social-links\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap;/s);
  assert.match(css, /@media \(max-width: 600px\)\s*\{\s*\.about-contact \.social-links\s*\{\s*display: grid;/s);
  assert.match(css, /\.about-contact \.social-links a\s*\{[^}]*min-height: 44px;/s);
});
it("small-size Waylan mark is consistent in tab and avatar", () => {
  const svg = read("public/favicon.svg");
  assert.equal(read("public/avatar.svg"), svg);
  assert.match(svg, /class="letter"/);
  assert.match(svg, /scale\(1\.15 1\.44\)/);
  assert.doesNotMatch(svg, /class="tile"/);
  assert.match(svg, /prefers-color-scheme:\s*dark/);
});
