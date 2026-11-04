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
    assert.match(site, /\.brand \{ overflow: visible; \}/);
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
  it("keeps highlight threads in a visible phone-centered dialog", () => {
    assert.match(style, /\.discussion-dialog\.thread-dialog \{\s*--dialog-motion: sheet;/);
    assert.ok(style.includes("inset: auto 0 0;"), "desktop retains its existing layout");
    assert.ok(style.includes("inset: var(--waylan-thread-view-top, 0px) 0 var(--waylan-thread-view-bottom, 0px);"),
      "phones and tablets must center the dialog in the visual viewport");
    assert.ok(motion.includes(".discussion-dialog { --dialog-motion: panel; }"),
      "the thread-specific rule must override the generic dialog motion");
  });
  it("keeps thread actions outside scrolling excerpts on iPhone and iPad", () => {
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    assert.ok(reader.includes('className="thread-dialog-footer"'));
    assert.ok(reader.includes('aria-expanded={quoteExpanded}'));
    assert.ok(reader.includes("--waylan-thread-view-top"));
    assert.ok(reader.includes("dialog.style.top ="), "thread dialog must use explicit visual-viewport top");
    assert.ok(reader.includes("dialog.offsetHeight"), "thread centering must measure rendered height");
    assert.ok(reader.includes("new ResizeObserver(schedule)"), "expanded quotes must trigger recentering");
    assert.ok(reader.includes('dialog.style.bottom = "auto"'), "bottom docking must not override centering");
    assert.ok(style.includes("flex: 0 0 auto;"), "action footer must not scroll with paragraph content");
    assert.ok(style.includes('max-height: min(82dvh, calc(var(--waylan-thread-view-height, 100dvh) - 24px))'),
      "phone dialog needs a visual-viewport height cap");
    assert.ok(style.includes('width: min(600px, calc(100dvw - 32px))'),
      "phone dialog must not touch viewport sides");
    assert.ok(style.includes('width: min(640px, calc(100dvw - 48px))'),
      "tablet dialog must not stretch across the screen");
    assert.ok(style.includes("max-height: min(78dvh, 680px, calc(var(--waylan-thread-view-height, 100dvh) - 24px))"));
    assert.ok(style.includes("@media (max-width: 1024px), (pointer: coarse) {"),
      "iPad Pro landscape and other large touch tablets must use the centered thread layout");
    assert.ok(!style.includes(".panel-comment-entry {\n    position: sticky;"),
      "the action cannot remain inside the scrollable body");
  });
  it("keeps rounded nav dividers inside the mobile frame and terminal dividers square", () => {
    assert.ok(site.includes("--nav-divider-inset: 12px;"));
    assert.ok(site.includes("#site-nav::before,"));
    assert.ok(site.includes("#site-nav::after { bottom: 0; }"));
    assert.ok(skins.includes('--nav-divider-inset: 0px;'));
    assert.ok(skins.includes('border-radius: 0;'));
    assert.ok(site.includes("height: 35px; margin-block: 4px;"));
  });
  it("puts excerpt into existing reader controls, not its own sticky strip", () => {
    const reader=readFileSync("src/components/Reader.tsx","utf8");
    assert.ok(reader.includes('className="icon-button excerpt-toggle"'));
    assert.ok(reader.includes('aria-pressed={excerptMode}'));
    assert.ok(reader.includes('className="reader-topbar"'));
    assert.ok(!reader.includes('className={`excerpt-access'));
    assert.ok(style.includes('.reader-controls .excerpt-toggle'));
    assert.ok(style.includes('top: var(--header-height);'));
  });
  it("keeps the brand separator visible on phones", () => {
    assert.match(site, /\.brand-rule\s*\{\s*display:\s*block;/);
    assert.ok(site.includes('.brand { gap: 5px; }'));
  });
  it("keeps the identity beside the logo across mobile and tablet sizes", () => {
    assert.match(app, /<small className="brand-tagline">\{site.tagline\}<\/small>/);
    assert.doesNotMatch(app, /mobile-brand-tagline/);
    assert.doesNotMatch(site, /mobile-brand-tagline/);
    assert.ok(site.includes(".brand .brand-tagline {"), "phone and tablet must reuse the same subtitle");
    assert.ok(site.includes("grid-template-rows: var(--header-bar-height) 43px;"),
      "default mobile header must have just the brand/tools and navigation rows");
    assert.ok(site.includes("@media (max-width: 370px) {"),
      "very narrow phones should move tools instead of clipping the wordmark");
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
