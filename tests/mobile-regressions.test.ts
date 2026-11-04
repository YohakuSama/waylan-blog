import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
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
  it("removes obsolete animation presets and respects system accessibility", () => {
    const settings = readFileSync("src/components/Settings.tsx", "utf8");
    const bootScript = readFileSync("public/theme.js", "utf8");
    assert.ok(!settings.includes('name="motion-preference"') &&
      !settings.includes('<legend>动效</legend>') &&
      !settings.includes('const motions:'),
      "the three unused animation presets should not clutter reading settings");
    assert.ok(settings.includes('applyMotionPreference("system")') &&
      settings.includes('storage.remove("motion")'),
      "old stored overrides must not silently defeat system reduced motion");
    assert.ok(bootScript.includes("dataset.motionPreference='system'") &&
      bootScript.includes("prefers-reduced-motion: reduce") &&
      !bootScript.includes("localStorage.getItem('echo:motion')"),
      "first paint must follow the operating system before React hydrates");
  });
  it("matches terminal wordmark scale to the shared editorial logo slot", () => {
    const css = skins;
    assert.ok(css.includes('font: 700 calc(var(--masthead-wordmark-height) * .9)/1.05 var(--font-mono);'),
      "the terminal logo must use the same responsive masthead size token");
    assert.ok(!css.includes('font: 600 15px var(--font-mono);') &&
      !css.includes('font-size: 13px;\n    min-width: 0;'),
      "small legacy terminal font-size overrides must be removed");
    assert.ok(site.includes('--masthead-wordmark-height: 38px;') &&
      site.includes('--masthead-wordmark-height: 32px;'));
  });
  it("keeps notification readiness and inbox refresh responsive to real configuration", () => {
    const bell = readFileSync("src/components/NotificationBell.tsx", "utf8");
    const worker = readFileSync("worker/notifications.ts", "utf8");
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    assert.match(wrangler, /"NOTIFICATIONS_ENABLED"\s*:\s*"true"/);
    assert.ok(worker.includes('notificationsAvailable(env)') &&
      worker.includes("sqlite_master") && worker.includes("GITHUB_WEBHOOK_SECRET"));
    assert.ok(bell.includes('document.addEventListener("visibilitychange", onVisible)') &&
      bell.includes('if (open) void refreshInbox.current()') &&
      bell.includes("serial !== requestSerial"),
      "opening notifications and resuming the phone must refresh without stale requests racing");
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
  it("keeps the selected-text actions above Safari expanding browser chrome", () => {
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    const mobileDock = style.slice(style.indexOf("@media (max-width: 1024px), (pointer: coarse) {"));
    assert.ok(mobileDock.includes("var(--waylan-selection-view-bottom, 0px)") &&
      mobileDock.includes("max(88px, 60px + env(safe-area-inset-bottom))"),
      "the selection tray must leave a buffer above Safari's expanded native bottom bar");
    assert.ok(mobileDock.includes("var(--waylan-selection-view-height, 100dvh)") &&
      mobileDock.includes("max-height: min(220px") &&
      mobileDock.includes("var(--waylan-selection-tray-clearance) - 28px"),
      "the tray must fit within the actual visual viewport when browser chrome expands");
    const phoneDock = style.slice(style.indexOf("@media (max-width: 600px) and (pointer: coarse) {"));
    assert.ok(phoneDock.includes("--waylan-selection-tray-clearance: max(148px, 114px + env(safe-area-inset-bottom))"),
      "iPhone tray needs extra clearance even before Safari publishes an expanded viewport");
    assert.ok(reader.includes('root.style.setProperty("--waylan-selection-view-bottom"') &&
      reader.includes('root.style.setProperty("--waylan-selection-view-height"') &&
      reader.includes('viewport?.addEventListener("resize", sync)') &&
      reader.includes('viewport?.addEventListener("scroll", sync)'),
      "scrolling or expanding browser chrome must immediately update the tray's offset");
    assert.ok(reader.includes("setPointerCapture?.(event.pointerId)") &&
      reader.includes("completeToolbarTouch(event.currentTarget, action)"),
      "copy/share should retain the original pressed button even if Safari moves the tray");
  });
  it("keeps the reading-list icon distinct from the article bookmark", () => {
    const shelf = readFileSync("src/components/Shelf.tsx", "utf8");
    assert.ok(shelf.includes('import { ArrowUp, Bookmark, LibraryBig, Shuffle, X }'),
      "the list trigger must use a library icon in place of the article bookmark");
    assert.ok(shelf.includes('<LibraryBig size={18} aria-hidden="true" />'),
      "the header should show the library icon");
    assert.ok(shelf.includes('<Bookmark size={17} aria-hidden="true" />'),
      "article save action must retain its bookmark icon and storage semantics");
  });
  it("uses four contrast-checked toast palettes and preserves popover borders", () => {
    const selectors = [
      ':root {', ':root[data-theme="dark"] {',
      ':root[data-skin="terminal"] {', ':root[data-skin="terminal"][data-theme="dark"] {',
    ];
    const luminance = (hex: string) => {
      const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
      const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const backgrounds = new Set<string>();
    for (const selector of selectors) {
      const start = skins.indexOf(selector);
      assert.ok(start >= 0, `missing palette for ${selector}`);
      const block = skins.slice(start, skins.indexOf("}", start));
      const background = block.match(/--toast-bg:\s*(#[\da-f]{6})/i)?.[1];
      const foreground = block.match(/--toast-ink:\s*(#[\da-f]{6})/i)?.[1];
      const border = block.match(/--toast-border:\s*(#[\da-f]{6})/i)?.[1];
      assert.ok(background && foreground && border, `incomplete toast palette for ${selector}`);
      backgrounds.add(background);
      const a = luminance(background), b = luminance(foreground);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(ratio >= 7, `toast text contrast ${ratio.toFixed(2)}:1 too low for ${selector}`);
    }
    assert.equal(backgrounds.size, 4, "all four theme/skin combinations should look distinct");
    assert.ok(style.includes("background: var(--toast-bg, var(--ink))") &&
      style.includes("color: var(--toast-ink, var(--paper))") &&
      style.includes("border: 1px solid var(--toast-border, var(--line-strong))"));
    const popover = skins.slice(skins.indexOf(".toast[popover] {"), skins.indexOf(".toast[popover]:not("));
    assert.ok(!popover.includes("border: 0;"), "popover rules must not erase the toast border");
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
    assert.ok(site.includes('.site-header:not(.site-header-reader) .header-inner::before'),
      "rounded skin gets a brand/navigation separator");
    assert.ok(skins.includes('.site-header:not(.site-header-reader) .header-inner::before'),
      "terminal skin also gets its own brand/navigation separator");
    assert.ok(skins.includes('border-top: 1px dashed color-mix(in srgb, var(--line-strong) 40%, transparent);'),
      "terminal divider is muted and does not touch content");
    assert.ok(site.includes('.site-header:not(.site-header-reader) #site-nav {') &&
      site.includes('background: transparent;') && site.includes('padding-inline: 0;'),
      "both navigation rows must stay visually integrated with their toolbars");
    assert.doesNotMatch(skins, /:root\[data-skin="terminal"\] \.site-header:not\(\.site-header-reader\) #site-nav/);
    assert.ok(skins.includes('border-bottom-color: transparent;'),
      "terminal masthead must not draw a dash across first paragraph");
    assert.ok(site.includes('.site-header:not(.site-header-reader) + .site-body .home-hero {') &&
      site.includes('padding-top: 22px;'),
      "both skins must share identical 22px intro spacing without modifying article layout");
    assert.ok(site.includes('height: 40px; margin-block: 1px;') &&
      skins.includes('border-radius: 0;'),
      "both skins must share the same 40px nav height with terminal square corners");
    assert.match(skins, /\.header-inner::before\s*\{\s*content:\s*none;/,
      "narrow phone tools cannot be crossed by the divider");
  });
  it("keeps mobile navigation visually unified while leaving the reader masthead untouched", () => {
    assert.ok(site.includes('.site-header:not(.site-header-reader) .header-inner::before'));
    assert.ok(site.includes('top: calc(var(--header-bar-height) - 5px);'));
    assert.ok(site.includes('background: linear-gradient(90deg,'));
    assert.ok(site.includes('color-mix(in srgb, var(--line-strong) 35%, transparent)'));
    assert.ok(site.includes('.site-header:not(.site-header-reader) #site-nav'));
    assert.ok(site.includes('padding-inline: 0;') && site.includes('background: transparent;'));
    assert.doesNotMatch(site, /#site-nav::(?:before|after)/);
    assert.ok(site.includes('.header-inner::before { content: none; }'));
    assert.ok(site.includes('.site-header-reader #site-nav { display: none; }'),
      "the immersive reader must retain its own logo/progress rather than receiving a nav divider");
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
    assert.ok(reader.includes('className="excerpt-mode-hint"') &&
      reader.includes('className="selection-toolbar-mode-exit"'),
      "active excerpt mode needs direct exits both at the article and in the selected-text tray");
    assert.ok(style.includes('.excerpt-mode-hint > button {') &&
      style.includes('.selection-toolbar-context > .selection-toolbar-mode-exit {') &&
      !style.includes('outline: 1px dashed transparent;'),
      "active excerpt mode must not be mistaken for a short-lived dashed animation");
    assert.ok(reader.includes('className="toc-footer"') &&
      reader.includes('tocButton.current?.focus({ preventScroll: true })'),
      "TOC actions must share a separate footer and restore focus when closing");
    assert.ok(style.includes('.toc-visible .toc-footer {') &&
      style.includes('overflow-y: auto;') &&
      style.includes('bottom: calc(12px + env(safe-area-inset-bottom));'),
      "phone contents must be bottom-docked with a separately scrolling list");
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
    assert.ok(site.includes('.site-header-reader .header-tools .icon-button'));
    assert.ok(site.includes('.site-header-reader .header-tools .notification-root'));
    assert.ok(!app.includes('className="brand-tagline"'),
      "readers keep their single Waylan logo, without a crowded slogan");
    assert.ok(site.includes('.site-header-reader .header-tools .notification-root'),
      "all four direct reader shortcuts remain available on phones");
    assert.ok(site.includes('repeating-linear-gradient(90deg, var(--brand) 0 14px'));
    assert.ok(site.includes('.site-header-reader + .site-body .reading-progress > span::after {'));
    assert.ok(site.includes('.site-header-reader #site-nav { display: none; }'));
    assert.ok(site.includes('.site-header-reader .brand-wordmark'));
  });
  it("uses the header width for navigation and search instead of an extra motto", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    assert.ok(!app.includes('className="brand-rule"') &&
      !app.includes('className="brand-tagline"'), "no small inline slogan beside the logo");
    assert.ok(site.includes("grid-template-columns: auto minmax(0, 1fr) auto;"),
      "desktop masthead should flex the navigation between logo and actions");
    assert.ok(site.includes('.site-header:not(.site-header-reader) .header-search-text { display: inline; }'),
      "tablet and wider phone header should use available width for a labeled search");
    assert.ok(site.includes('grid-template-rows: var(--header-bar-height) 43px;'),
      "320px phones share the same logo/controls row and a separate navigation row");
    assert.ok(site.includes('.site-header-reader #site-nav { display: none; }'),
      "article masthead must not duplicate the global destinations");
  });
  it("shares masthead sizing across the home and immersive article views", () => {
    assert.ok(app.includes('post ? "site-header site-header-reader" : "site-header"'),
      "the same App Shell should render both headers");
    assert.ok(site.includes('--header-control-size: 44px;') &&
      site.includes('--masthead-wordmark-height: 38px;') &&
      site.includes('--header-bar-height: 68px;'),
      "logo, row and tap sizes must be shared tokens");
    assert.ok(site.includes('--header-height: 104px; --header-bar-height: 60px;'),
      "phone header must use a 60px masthead plus the home navigation");
    assert.ok(site.includes('--masthead-wordmark-height: 32px;'),
      "the same 32px wordmark must apply to both phone views");
    assert.ok(site.includes('height: var(--header-bar-height);') &&
      site.includes('height: var(--masthead-wordmark-height);'),
      "article header and logo must inherit the same dimensions as home");
    assert.ok(site.includes('flex: 0 0 var(--header-control-size);'),
      "notification icon must not be narrower in reader mode");
    assert.ok(!site.includes('height: 56px;\n    position: sticky;') &&
      !site.includes('.site-header-reader .brand-wordmark { height: 26px; }'),
      "remove old 56px reader header and squeezed 26px logo overrides");
    assert.ok(style.includes('--reader-brand-height: var(--header-bar-height);'),
      "toc, reading-progress and scroll offsets should track the same masthead height");
  });
  it("uses the header as the sole branded logo across both skins and all routes", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const pages = readFileSync("src/pages.tsx", "utf8");
    const footer = app.slice(app.indexOf('<footer className="site-footer">'));
    assert.ok(footer.startsWith('<footer className="site-footer">'));
    assert.doesNotMatch(footer, /<Wordmark\s*\/>|footer-(?:brand|identity|blog-script|terminal-wordmark)/,
      "the shared footer may not duplicate the masthead identity");
    assert.ok(footer.includes('className="footer-copy"') &&
      footer.includes('className="footer-stats mono"') &&
      footer.includes('className="footer-links"'),
      "the footer must remain a practical site colophon");
    assert.ok(site.includes('grid-template-areas: "copy links";') &&
      site.includes('grid-template-areas: "copy" "links";'),
      "desktop/tablet and phone footers must follow one coherent two-row system");
    assert.ok(!site.includes('Waylan Great Vibes') &&
      !site.includes('"copy brand"') && !site.includes('"links brand"') &&
      !skins.includes('.footer-terminal-wordmark'),
      "obsolete second-brand typography and layouts should be removed");
    assert.ok(pages.includes('className="about-motto"') &&
      pages.includes('<blockquote lang="en">Less, but better.</blockquote>') &&
      pages.includes('— Dieter Rams</figcaption>'));
    assert.ok(skins.includes('.about-motto blockquote::before,'),
      "terminal About attribution should keep its code-comment style");
    assert.doesNotMatch(app, /mobile-brand-tagline|brand-motto-quote/);
  });
  it("aligns index-page sidebar labels and trailing controls as one design system", () => {
    const pages = readFileSync("src/pages.tsx", "utf8");
    const sidebar = readFileSync("src/components/Sidebar.tsx", "utf8");
    const shelf = readFileSync("src/components/Shelf.tsx", "utf8");
    assert.ok(pages.includes('className="home-project-copy"') &&
      pages.includes('className="home-project-state"') &&
      pages.includes('className="home-project-end"'),
      "homepage project rows need a shared trailing arrow column");
    assert.ok(sidebar.includes('className="sidebar-row-end"') &&
      !sidebar.includes('ArrowUpRight'),
      "internal sidebar navigation must use one right-arrow convention");
    assert.ok(site.includes('--sidebar-end-slot: 28px;') &&
      site.includes('.site-sidebar .explore-count {') &&
      site.includes('.site-sidebar .sidebar-note summary::after {') &&
      site.includes('.site-sidebar .sidebar-row-end {'),
      "theme-independent side-rail controls must align");
    assert.ok(site.includes('.home-sidebar .home-reading-note summary { min-height: 44px; }'));
    assert.ok(site.includes('@media (min-width: 768px) and (max-width: 1119px)') &&
      site.includes('grid-column: 1 / -1;'),
      "tablet discovery disclosure spans both columns");
    assert.ok(shelf.includes('footerTop > visibleBottom - 56') &&
      shelf.includes('window.visualViewport?.addEventListener("resize", check)'),
      "back-to-top must not overlap the now smaller footer");
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
      assert.ok(reader.includes("onToolbarPointerDown") && reader.includes("onToolbarTouchStart"),
        "a first touch must act before Safari suppresses touchend and click");
      assert.ok(reader.includes(action), "missing selection action " + action);
    }
    assert.ok(reader.includes("lastToolbarTouch.current = { target: event.currentTarget") &&
      reader.includes("event.detail !== 0"),
      "touch pointerdown and compatibility click must not execute twice");
    assert.ok(reader.includes('new host.Highlight(native.getRangeAt(0).cloneRange())') &&
      reader.includes('native.removeAllRanges()') &&
      style.includes('::highlight(waylan-selected-quote)'),
      "supported touch browsers must transfer a native selection to a visual custom highlight");
    assert.ok(style.includes('-webkit-touch-callout: none;') &&
      style.includes('touch-action: none;'),
      "the action tray must not invoke Safari native selection interactions");
  });
  it("maintains readable selection contrast in the syntax-highlighted code block", () => {
    assert.ok(skins.includes(".reader-prose .block-code code *::selection"));
    assert.ok(skins.includes("background: var(--code-ink);"));
    assert.ok(skins.includes("color: var(--code-bg);"));
  });
  it("keeps prerendered content visible instead of flashing a W mask on reload", () => {
    const script = readFileSync("public/theme.js", "utf8");
    for (const readyState of ["loading", "complete"]) {
      const names = new Set(["font-wait", "font-loader", "font-loader-out"]);
      let bootRemoved = false;
      let onReady: (() => void) | undefined;
      const document = {
        documentElement: {
          dataset: {} as Record<string, string>,
          classList: {
            remove: (...items: string[]) => items.forEach((item) => names.delete(item)),
            add: (...items: string[]) => items.forEach((item) => names.add(item)),
          },
        },
        querySelector: () => null,
        getElementById: (id: string) => id === "boot" ? { remove: () => { bootRemoved = true; } } : null,
        readyState,
        addEventListener: (name: string, callback: () => void) => {
          assert.equal(name, "DOMContentLoaded");
          onReady = callback;
        },
      };
      runInNewContext(script, {
        document,
        localStorage: { getItem: () => null },
        matchMedia: () => ({ matches: false }),
      });
      assert.deepEqual([...names], [], "the root may not be hidden on reload");
      if (readyState === "loading") {
        assert.equal(bootRemoved, false);
        assert.ok(onReady);
        onReady();
      }
      assert.equal(bootRemoved, true, "the inert boot node should be discarded");
    }
    assert.ok(style.includes(".boot {") && style.includes("display: none;"));
    assert.ok(boot.includes('className="boot"'));
    assert.doesNotMatch(script, /classList\.add\(["\x27]font-wait/);
  });
  it("preserves the homepage reading-card height and text on Safari reload", () => {
    const script = readFileSync("public/theme.js", "utf8");
    const page = readFileSync("src/pages.tsx", "utf8");
    assert.ok(page.includes('className="home-resume home-resume-placeholder"'),
      "prerendered home must reserve an empty reading slot until hydration");
    assert.ok(page.includes('className="resume-preview-title"') &&
      page.includes('className="resume-progress resume-preview-progress"'),
      "the placeholder must render the remembered card without changing server markup");
    assert.ok(site.includes(':root[data-resume-pending="true"] .home-resume-placeholder {') &&
      site.includes("min-height: 56px;") &&
      site.includes("--resume-preload-title") &&
      site.includes("--resume-preload-progress"),
      "first-paint placeholder must hold the real card geometry and text");
    const sample = { slug: "test-post", title: "静态优先 · 阅读进度", progress: 12 };
    for (const saved of [sample, null, { ...sample, progress: 100 }]) {
      const dataset: Record<string, string> = {};
      const variables = new Map<string, string>();
      const document = {
        documentElement: {
          dataset,
          style: { setProperty: (name: string, value: string) => variables.set(name, value) },
          classList: { remove: () => {} },
        },
        querySelector: () => null,
        getElementById: () => null,
        readyState: "complete",
      };
      runInNewContext(script, {
        document,
        localStorage: { getItem: (key: string) => key === "echo:reading" ? JSON.stringify(saved) : null },
        matchMedia: () => ({ matches: false }),
      });
      if (saved?.progress === 12) {
        assert.equal(dataset.resumePending, "true");
        assert.equal(variables.get("--resume-preload-title"), JSON.stringify(saved.title));
        assert.equal(variables.get("--resume-preload-progress"), JSON.stringify("12%"));
      } else {
        assert.equal(dataset.resumePending, undefined,
          "new visitors and completed articles must not have empty reserved space");
      }
    }
  });
  it("does not fade the entire reading surface when navigating on touch devices", () => {
    const source = readFileSync("src/lib/motion.ts", "utf8");
    assert.ok(source.includes('!motionAllowed() || matchMedia("(pointer: coarse)").matches'));
    assert.ok(source.includes('!matchMedia("(pointer: coarse)").matches'),
      "touch-device list transitions must not request root snapshots");
    assert.ok(source.includes('[{ opacity: 0.25 }, { opacity: 1 }]'),
      "non-touch desktop navigation keeps its previous animation");
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
