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
  it("docks paragraph threads at the visual-viewport bottom on phone, tablet and desktop", () => {
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    assert.ok(style.includes(".discussion-dialog.thread-dialog {"));
    assert.ok(style.includes("inset: auto 0 8px;"), "desktop thread must rise from the bottom");
    assert.ok(style.includes("inset: auto 0 calc(var(--waylan-thread-view-bottom, 0px) + 8px);"),
      "phone/tablet sheets must stop above Safari browser chrome");
    assert.ok(reader.includes('dialog.style.top = "auto"'), "old explicit centering must be removed");
    assert.ok(reader.includes("Math.ceil(obscured) + 8"), "visual viewport must determine bottom clearance");
    assert.ok(style.includes("--dialog-motion: sheet;"), "thread entrance must match composer");
    assert.ok(style.includes("width: min(640px, calc(100dvw - 48px))"), "tablet sheet keeps a readable width");
    assert.ok(style.includes("width: min(600px, calc(100dvw - 32px))"), "phone sheet keeps side margins");
  });
  it("keeps thread actions outside scrolling excerpts on iPhone and iPad", () => {
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    assert.ok(reader.includes('className="thread-dialog-footer"'));
    assert.ok(reader.includes('aria-expanded={quoteExpanded}'));
    assert.ok(!reader.includes("--waylan-thread-view-top"), "the obsolete viewport-top centering path is gone");
    assert.ok(reader.includes('dialog.style.bottom ='), "the thread bottom must update when Safari chrome moves");
    assert.ok(reader.includes("viewport?.addEventListener(\"scroll\", sync)"),
      "Safari toolbar changes must update the bottom without waiting for an animation frame");
    assert.ok(style.includes("flex: 0 0 auto;"), "action footer must not scroll with paragraph content");
    assert.ok(style.includes('max-height: min(82dvh, calc(var(--waylan-thread-view-height, 100dvh) - 16px))'),
      "phone sheet must remain short enough to show the action and browser chrome");
    assert.ok(style.includes('width: min(600px, calc(100dvw - 32px))'),
      "phone dialog must not touch viewport sides");
    assert.ok(style.includes('width: min(640px, calc(100dvw - 48px))'),
      "tablet dialog must not stretch across the screen");
    assert.ok(style.includes("max-height: min(78dvh, 680px, calc(var(--waylan-thread-view-height, 100dvh) - 16px))"));
    assert.ok(style.includes("@media (max-width: 1024px), (pointer: coarse) {"),
      "iPad Pro landscape and other large touch tablets must use the bottom sheet");
    assert.ok(!style.includes(".panel-comment-entry {\n    position: sticky;"),
      "the action cannot remain inside the scrollable body");
  });
  it("removes both editorial mobile rails while terminal keeps one square separator", () => {
    assert.doesNotMatch(site, /#site-nav::(?:before|after)/);
    assert.doesNotMatch(skins, /#site-nav::(?:before|after)/);
    assert.doesNotMatch(site, /--nav-divider-inset/);
    assert.ok(skins.includes('border-bottom-color: transparent;'),
      "editorial mobile header must not frame the rounded tab with rules");
    assert.ok(skins.includes('border-bottom: 1px dashed var(--line-strong);'),
      "terminal header retains a single bottom line");
    assert.ok(skins.includes('border-radius: 0;'));
    assert.ok(site.includes("height: 35px; margin-block: 4px;"));
  });
  it("puts excerpt into existing reader controls, not its own sticky strip", () => {
    const reader=readFileSync("src/components/Reader.tsx","utf8");
    assert.ok(reader.includes('className="icon-button excerpt-toggle"'));
    assert.ok(reader.includes('aria-pressed={excerptMode}'));
    assert.ok(reader.includes('reader-topbar-hidden'), "scroll behavior must hide only the shared tool row");
    assert.ok(!reader.includes('className={`excerpt-access'));
    assert.ok(style.includes('.reader-controls .excerpt-toggle'));
    assert.ok(site.includes('.site-header.site-header-reader {'), "Waylan logo header must remain visible");
    assert.ok(site.includes('.site-header-reader #site-nav { display: none; }'),
      "only destination navigation, not the Waylan brand, should be removed");
    assert.ok(site.includes('.site-header-reader .brand-wordmark'), "reuse the original logo on reading pages");
    assert.ok(style.includes('.reader-topbar.reader-topbar-hidden'));
    assert.ok(style.includes('top: var(--reader-brand-height);'),
      "animated actions must slide behind, not over, the retained masthead");
    assert.ok(style.includes('transform: translate3d(0, calc(-100% - 2px), 0)'),
      "keep smooth scroll hide/show animation");
    assert.ok(style.includes('top: calc(var(--reader-brand-height) - 2px)'),
      "reading progress should sit on the masthead border");
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
