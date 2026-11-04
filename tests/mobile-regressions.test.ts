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
  it("does not translate native search dialogs during soft-keyboard focus", () => {
    const animateDialog = readFileSync("src/lib/motion.ts", "utf8");
    const dialogs = readFileSync("src/components/UI.tsx", "utf8");
    assert.ok(dialogs.includes("initialFocus?.current?.focus({ preventScroll: true })"),
      "opening search must not scroll the page while raising the keyboard");
    assert.match(motion, /@media \(max-width: 700px\), \(pointer: coarse\) \{/);
    assert.match(motion, /\.search-dialog \{ --dialog-motion: instant; \}/);
    assert.match(animateDialog, /if \(kind === "instant"\) return null;/,
      "instant overlays must not create transform animations");
    assert.match(motion, /\.discussion-dialog,\s*\.search-dialog,\s*\.settings-dialog \{ --dialog-motion: sheet; \}/,
      "other mobile sheets should preserve their existing motion");
  });
  it("anchors the mobile search overlay to the viewport after page scroll", () => {
    const base = skins.match(/\.search-dialog \{[\s\S]*?\n\}/)?.[0] || "";
    const phone = skins.slice(skins.indexOf("@media (max-width: 700px) {", skins.indexOf("/* ---------- Search dialog ---------- */")));
    assert.match(base, /inset: 0 0 auto;/, "desktop and tablet search needs a fixed top offset");
    assert.match(phone, /\.search-dialog \{ inset: 0; \}/, "phone search must cover viewport from top");
  });
  it("reserves the resolved discussion height during loading", () => {
    assert.ok(style.includes(".discussion-results {"));
    assert.ok(style.includes("min-height: 268px;"));
    assert.ok(motion.includes(".comment-skeleton {"));
    assert.ok(motion.includes("min-height: 218px;"));
  });
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
  it("gives both mobile skins a separated navigation layer without rails touching content", () => {
    assert.doesNotMatch(site, /#site-nav::(?:before|after)/);
    assert.doesNotMatch(skins, /#site-nav::(?:before|after)/);
    assert.doesNotMatch(site, /--nav-divider-inset/);
    assert.ok(site.includes('.site-header .header-inner::before'),
      "rounded skin gets a brand/navigation separator");
    assert.ok(skins.includes('.site-header .header-inner::before'),
      "terminal skin also gets its own brand/navigation separator");
    assert.ok(skins.includes('border-top: 1px dashed color-mix(in srgb, var(--line-strong) 40%, transparent);'),
      "terminal divider is muted and does not touch content");
    assert.ok(site.includes('.site-header #site-nav {') &&
      site.includes('background: transparent;') && site.includes('padding-inline: 0;'),
      "both navigation rows must stay visually integrated with their toolbars");
    assert.doesNotMatch(skins, /:root\[data-skin="terminal"\] \.site-header:not\(\.site-header-reader\) #site-nav/);
    assert.ok(skins.includes('border-bottom-color: transparent;'),
      "terminal masthead must not draw a dash across first paragraph");
    assert.ok(site.includes('.site-header + .site-body .home-hero {') &&
      site.includes('padding-top: 22px;'),
      "both skins must share identical 22px intro spacing without modifying article layout");
    assert.ok(site.includes('height: 40px; margin-block: 1px;') &&
      skins.includes('border-radius: 0;'),
      "both skins must share the same 40px nav height with terminal square corners");
    assert.match(skins, /\.header-inner::before\s*\{\s*content:\s*none;/,
      "narrow phone tools cannot be crossed by the divider");
  });
  it("uses identical navigation on reading and browsing routes", () => {
    assert.ok(site.includes('.site-header .header-inner::before'));
    assert.ok(site.includes('top: calc(var(--header-bar-height) - 5px);'));
    assert.ok(site.includes('background: linear-gradient(90deg,'));
    assert.ok(site.includes('color-mix(in srgb, var(--line-strong) 35%, transparent)'));
    assert.ok(site.includes('.site-header #site-nav'));
    assert.ok(site.includes('padding-inline: 0;') && site.includes('background: transparent;'));
    assert.doesNotMatch(site, /#site-nav::(?:before|after)/);
    assert.ok(site.includes('.header-inner::before { content: none; }'));
    assert.doesNotMatch(site, /\.site-header-reader\s+#site-nav/,
      "article pages must not hide global navigation");
  });
  it("keeps quiet article actions without a moving overlay", () => {
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    const app = readFileSync("src/App.tsx", "utf8");
    const shelf = readFileSync("src/components/Shelf.tsx", "utf8");
    const settings = readFileSync("src/components/Settings.tsx", "utf8");
    assert.ok(reader.includes('className="article-actions"') &&
      reader.includes('aria-label="本文操作"'), "article actions must live in the document");
    assert.ok(reader.includes('showLabel />') && shelf.includes('"收藏本文"'),
      "saving the current article needs a visible label");
    assert.ok(reader.includes('className="article-action article-action-toc"'),
      "the directory remains directly reachable on phones and tablets");
    assert.ok(reader.includes('className="article-action article-action-more"') &&
      reader.includes('aria-label="更多阅读操作"') && reader.includes('hidden={!moreOpen}'),
      "the optional reader actions stay in a dismissible inline menu");
    assert.ok(reader.includes('void copyArticleLink()') && reader.includes('onClick={jumpToDiscussion}') &&
      reader.includes('changeFontSize(size)'),
      "direct copy, comment shortcut and font-size controls must be usable");
    assert.ok(style.includes(".article-more-panel[hidden] { display: none; }") &&
      style.includes(".discussion-section { scroll-margin-top:"),
      "the action menu must hide reliably and the comment jump must avoid the sticky header");
    assert.ok(reader.includes('className="toc-excerpt-toggle"'),
      "whole-paragraph mode remains discoverable inside the contents panel");
    assert.doesNotMatch(reader, /reader-floating|floatingVisible|floatingTucked|floatingOpen/,
      "scrolling must never summon or animate a floating reader ball");
    assert.doesNotMatch(style, /\.reader-floating-tools|\.reader-floating-trigger/);
    assert.ok(!reader.includes('className={\x60reader-topbar'), "no duplicate sticky reader row");
    assert.ok(settings.includes('name="reader-font-size"') &&
      settings.includes('waylan:font-size-changed') &&
      reader.includes('addEventListener("waylan:font-size-changed"'),
      "font controls must be in reading settings and update the active article");
    assert.ok(settings.includes('addEventListener("waylan:font-size-changed", sync)') &&
      settings.includes('"echo:font-size"'),
      "the global settings and inline size control must stay synchronized");
    assert.ok(!reader.includes('aria-label={`正文字号'),
      "font control must not clutter the byline");
    assert.doesNotMatch(app, /reader-global-menu-trigger|reader-global-menu/);
    assert.doesNotMatch(site, /\.reader-global-menu/);
    assert.ok(!app.includes('className="brand-tagline"'),
      "readers keep their single Waylan logo, without a crowded slogan");
    assert.doesNotMatch(site, /\.site-header-reader\s+(?:\.header-inner|\.brand|\.header-tools|\.header-search)/,
      "articles cannot override the common header geometry");
    assert.ok(site.includes('repeating-linear-gradient(90deg, var(--brand) 0 14px'));
    assert.ok(site.includes('.site-header-reader + .site-body .reading-progress > span::after {'));
    assert.doesNotMatch(site, /\.site-header-reader\s+#site-nav/,
      "article pages must not hide global navigation");
    assert.ok(site.includes('top: calc(var(--header-height) - 2px);'));
  });
  it("uses the header width for navigation and search instead of an extra motto", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    assert.ok(!app.includes('className="brand-rule"') &&
      !app.includes('className="brand-tagline"'), "no small inline slogan beside the logo");
    assert.ok(site.includes("grid-template-columns: auto minmax(0, 1fr) auto;"),
      "desktop masthead should flex the navigation between logo and actions");
    assert.ok(site.includes('.site-header .header-search-text { display: inline; }'),
      "tablet and wider phone header should use available width for a labeled search");
    assert.ok(site.includes('grid-template-rows: var(--header-bar-height) 52px 43px;'),
      "320px phones preserve full-size action targets in a dedicated row");
    assert.doesNotMatch(site, /\.site-header-reader\s+#site-nav/,
      "article pages must not hide global navigation");
  });
  it("keeps a distinct footer and separately attributed About quote in each skin", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const pages = readFileSync("src/pages.tsx", "utf8");
    assert.ok(app.includes('className="footer-blog-script" aria-hidden="true">Blog</span>'));
    assert.ok(app.includes('className="footer-terminal-wordmark" aria-hidden="true"'));
    assert.ok(app.includes('footer-terminal-cursor'));
    assert.ok(!app.includes('className="brand-tagline"'));
    assert.ok(pages.includes('className="about-motto"') &&
      pages.includes('<blockquote lang="en">Less, but better.</blockquote>') &&
      pages.includes('— Dieter Rams</figcaption>'));
    assert.ok(site.includes('great-vibes-latin-400-normal.woff2') &&
      site.includes('.footer-blog-script {'), "Editorial keeps its self-hosted script footer");
    assert.ok(skins.includes(':root[data-skin="terminal"] .footer-terminal-wordmark {') &&
      skins.includes(':root[data-skin="terminal"] .footer-blog-script { display: none; }'),
      "Terminal uses its own monospace footer rather than Editorial lettering");
    assert.ok(skins.includes('.about-motto blockquote::before,'),
      "Terminal's attribution appears in the form of code comments");
    assert.doesNotMatch(app, /mobile-brand-tagline|brand-motto-quote/);
  });
  it("uses one footer geometry for signed-in and logged-out composer actions", () => {
    assert.ok(style.includes(".discussion-dialog.composer-dialog .composer-bottom {"));
    assert.ok(style.includes("position: relative; flex: 0 0 auto"));
    assert.ok(style.includes(".discussion-dialog.composer-dialog .login-invitation {"));
    assert.ok(style.includes(".comment-composer[data-preview=\"true\"] > textarea"));
  });
  it("keeps long selected quotes on one scroll surface and pins composer actions", () => {
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    const composerCSS = style.slice(style.indexOf("/* Waylan immersive comment composer.")).replace(/\r\n/g, "\n");
    assert.ok(composerCSS.includes("overflow-y: auto; overflow-x: hidden;"),
      "the editor content, including long quotes, must own one scroll area");
    assert.ok(composerCSS.includes(".panel-original blockquote {\n  max-height: none; overflow: visible;"),
      "the quoted text must not own a nested scrollbar");
    assert.ok(composerCSS.includes(".composer-bottom {\n  /* A normal flex footer"),
      "the publish/login footer must be a separate flex child");
    assert.ok(reader.includes("        {!panelIds.length && (session.loading ? ("),
      "publish/login controls must be siblings of the scrolling editor body");
    assert.ok(!composerCSS.includes("min-height: min(38dvh, 320px)"),
      "a forced fullscreen textarea minimum must not push the publish action off-screen");
  });
  it("runs every selection action directly for touch and deduplicates compatibility clicks", () => {
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    for (const action of ["privateMark", "newComment(selection.anchor)", "copySelected()", "share(selection.anchor)", "dismissToolbar"]) {
      assert.ok(reader.includes("onToolbarTouchEnd"), "touch toolbar activation must be explicit");
      assert.ok(reader.includes(action), "missing selection action " + action);
    }
    assert.ok(reader.includes("lastToolbarTouch.current = { target: event.currentTarget"),
      "the following compatibility click must not repeat the same operation");
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
