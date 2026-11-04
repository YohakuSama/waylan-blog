import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { posts } from "../src/lib/data";

const style = readFileSync("src/styles.css", "utf8");
const site = readFileSync("src/styles/site.css", "utf8");
const motion = readFileSync("src/styles/motion.css", "utf8");
const skins = readFileSync("src/styles/skins.css", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const boot = readFileSync("src/components/Boot.tsx", "utf8");

describe("mobile reader regression contracts", () => {
  it("does not clip the script wordmark in the narrow header", () => {
    assert.match(site, /\.brand \{ max-width: min\(112px, 100%\); overflow: visible; \}/);
    assert.match(site, /\.brand-wordmark \{ max-width: 100%; overflow: visible; \}/);
  });
  it("gives phone feed rows their full width without a spare arrow column", () => {
    const narrow = site.slice(site.indexOf("@media (max-width: 767px)"));
    assert.ok(narrow.includes(".feed-item .feed-arrow { display: none; }"));
    assert.ok(narrow.includes('grid-template-areas: "body" "media";'));
    assert.ok(narrow.includes("grid-template-columns: minmax(0, 1fr);"));
  });
  it("uses current theme tokens for the selection tray", () => {
    const tray = style.slice(style.indexOf(".selection-toolbar {"), style.indexOf(".selection-toolbar-context {"));
    for (const declaration of [
      "background: var(--surface);",
      "color: var(--ink);",
      "border: 1px solid var(--line-strong);",
    ]) assert.ok(tray.includes(declaration), declaration);
  });
  it("docks highlight threads at the bottom instead of using a right-hand panel", () => {
    assert.match(style, /\.discussion-dialog\.thread-dialog \{ --dialog-motion: sheet; \}/);
    assert.ok(style.includes("inset: auto 0 0;"));
    assert.ok(motion.includes(".discussion-dialog { --dialog-motion: panel; }"),
      "the thread-specific rule must override the generic dialog motion");
  });
  it("renders an actual subtitle slot at mobile and narrow-phone sizes", () => {
    assert.match(app, /className="mobile-brand-tagline"/);
    assert.match(site, /\.mobile-brand-tagline \{\n    display: block;/);
    assert.ok(site.includes("grid-template-rows: var(--header-bar-height) 26px 44px;"));
  });
  it("uses one footer geometry for signed-in and logged-out composer actions", () => {
    assert.ok(style.includes(".discussion-dialog.composer-dialog .composer-bottom {"));
    assert.ok(style.includes("position: relative; flex: 0 0 auto"));
    assert.ok(style.includes(".discussion-dialog.composer-dialog .login-invitation {"));
    assert.ok(style.includes(".comment-composer[data-preview=\"true\"] > textarea"));
  });
  it("maintains readable selection contrast in the syntax-highlighted code block", () => {
    assert.ok(skins.includes(".reader-prose .block-code code *::selection"));
    assert.ok(skins.includes("background: var(--code-ink);"));
    assert.ok(skins.includes("color: var(--code-bg);"));
  });
  it("keeps the loading mark and track legible on both skins", () => {
    assert.ok(boot.includes('className="boot-label"'));
    assert.ok(style.includes("width: clamp(92px, 13vmin, 140px);"));
    assert.ok(style.includes("width: clamp(176px, 26vmin, 252px);"));
  });
  it("keeps built table-of-contents entries identical to the corresponding text blocks", () => {
    for (const post of posts) {
      const blocks = new Map(post.blocks.map((block) => [block.id, block]));
      for (const section of post.toc) {
        const block = blocks.get(section.id);
        assert.ok(block, `${post.slug}: missing heading ${section.id}`);
        assert.equal(block.type, "heading", `${post.slug}: non-heading TOC target`);
        assert.equal(section.title, block.text.trim(), `${post.slug}: stale TOC title`);
      }
    }
  });
});
