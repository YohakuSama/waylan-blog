/** CI-only Chromium checks. Production ships no browser-testing dependency. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:4173";
const out = "visual-report";
// Keep full breakpoint-boundary coverage for manually requested audits.
// Normal PRs cover desktop/tablet, 1024/1025 and 767/768 layout switches,
// the former 600/601 image boundary and phone sizes in all four appearances.
const fullWidths = [1440, 1280, 1279, 1200, 1120, 1119, 1025, 1024, 861, 860, 768, 767, 701, 700, 601, 600, 390, 320];
const smokeWidths = [1440, 1025, 1024, 860, 768, 767, 601, 390, 320];
const matrix = process.env.WAYLAN_VISUAL_MATRIX || "full";
assert.ok(matrix === "smoke" || matrix === "full", `Unknown visual matrix: ${matrix}`);
const widths = matrix === "smoke" ? smokeWidths : fullWidths;
const headerControls = [".header-search", ".shelf-trigger", ".notification-trigger", ".header-tools .settings-button"];
const routes = ["/", "/feed", "/archive", "/projects", "/about", "/privacy", "/post/a-room-on-the-internet", "/404"];
const canonicalReaderExcerpt = JSON.parse(readFileSync(new URL("../src/generated/posts.json", import.meta.url), "utf8"))
  .find(post => post.slug === "a-room-on-the-internet")?.excerpt;
assert.ok(canonicalReaderExcerpt, "article excerpt fixture is missing");
const variants = [
  { skin: "editorial", theme: "light" },
  { skin: "editorial", theme: "dark" },
  { skin: "terminal", theme: "light" },
  { skin: "terminal", theme: "dark" },
];
await mkdir(out, { recursive: true });
const preview = spawn(process.execPath,
  ["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
  { stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
for (const stream of [preview.stdout, preview.stderr])
  stream.on("data", (chunk) => { serverLog = (serverLog + chunk).slice(-3000); });
async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (preview.exitCode !== null) throw new Error("Preview stopped: " + serverLog);
    try { if ((await fetch(origin)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Preview not ready: " + serverLog);
}
function sameBox(actual, expected, label) {
  assert.ok(actual && expected, `${label}: missing control`);
  for (const key of ["left", "top", "width", "height"])
    assert.ok(Math.abs(actual[key] - expected[key]) <= 1,
      `${label}: ${key} moved from ${expected[key]} to ${actual[key]}`);
}
const results = [], notificationResults = [], baselines = new Map();
const mastheadBaselines = new Map();
const pageHeadingBaselines = new Map();
const indexListWidthBaselines = new Map();
const editorialLogoBaselines = new Map();
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  for (const variant of variants) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: 900 }, deviceScaleFactor: 1,
        reducedMotion: "reduce", hasTouch: width <= 1024, isMobile: width <= 1024,
      });
      await context.addInitScript(({ skin, theme }) => {
        localStorage.setItem("echo:skin", JSON.stringify(skin));
        localStorage.setItem("echo:theme", JSON.stringify(theme));
        localStorage.setItem("echo:motion", JSON.stringify("reduced"));
        if (localStorage.getItem("echo:density") === null)
          localStorage.setItem("echo:density", JSON.stringify("compact"));
        localStorage.setItem("echo:reading", JSON.stringify({ slug: "a-room-on-the-internet", title: "静态优先：内容站的预渲染、水合与边缘 API", progress: 13 }));
      }, variant);
      const page = await context.newPage(), errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/session", (route) => route.fulfill({ json: { user: null } }));
      // Keep one deterministic route while simulating unavailable and recovered services.
      let notificationsStatus = "disabled";
      await page.route("**/api/status", (route) =>
        notificationsStatus === "error"
          ? route.fulfill({ status: 503, json: { error: "unavailable" } })
          : route.fulfill({ json: { notifications: notificationsStatus === "enabled" } }),
      );
      try {
        for (const route of routes) {
          const target = origin + (route === "/" ? "/" : route === "/404" ? "/404.html" : route + "/");
          const response = await page.goto(target, { waitUntil: "domcontentloaded" });
          const label = `${route === "/" ? "home" : route.slice(1).replaceAll("/", "-")}-${width}-${variant.skin}-${variant.theme}`;
          assert.ok(response?.ok(), `${label}: HTTP response failed`);
          const isImmersive = route.startsWith("/post/") && width <= 1024;
          // Article pages keep destination navigation hidden while exposing
          // the same four global shortcuts and independent inline reader actions.
          if (isImmersive) await page.locator(".article-actions").waitFor({state:"visible"});
          else await page.getByRole("button", { name: "搜索 Ctrl K", exact: true }).waitFor();
          await page.evaluate(() => document.fonts.ready);
          await page.waitForFunction(() => !document.documentElement.classList.contains("font-wait") && !document.documentElement.classList.contains("font-loader-out"));
          // The initial saved preference exercises homepage isolation. Inspect
          // the full library layout at every width before testing compact mode.
          if (route === "/feed") {
            await page.getByRole("button", { name: "图文 · 详细列表", exact: true }).click();
            await page.locator(".feed-list.density-full").waitFor();
          }
          const geometry = await page.evaluate((headerControls) => {
            const rect = (element) => {
              if (!element || getComputedStyle(element).display === "none" || !element.getClientRects().length) return null;
              const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
              return { left, top, right, bottom, width, height };
            };
            const select = (selector) => rect(document.querySelector(selector));
            const luminance = (color) => {
              const hex = color.trim().match(/^#([\da-f]{6})$/i)?.[1];
              const channels = hex
                ? [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
                : color.match(/[\d.]+/g).slice(0, 3).map(Number);
              return channels.map((channel) => {
                const value = channel / 255;
                return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
              }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
            };
            const contrast = (a, b) => {
              const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
              return (values[1] + .05) / (values[0] + .05);
            };
            const tokens = getComputedStyle(document.documentElement);
            return {
              viewport: document.documentElement.clientWidth,
              touch: matchMedia("(pointer: coarse)").matches,
              documentWidth: document.documentElement.scrollWidth,
              skin: document.documentElement.dataset.skin,
              theme: document.documentElement.dataset.theme,
              brand: select(".brand"),
              brandWordmark: select(".brand .brand-wordmark") || select(".brand .brand-term"),
              headerHasTagline: !!document.querySelector(".brand .brand-tagline, .brand-motto-quote"),
              editorialLogo: select(".brand .brand-wordmark"),
              terminalLogo: select(".brand .brand-term"),
              searchLabel: select(".header-search-text"),
              footerLogoCount: document.querySelectorAll(
                ".site-footer .wordmark, .site-footer .footer-brand, .site-footer .footer-blog-script, .site-footer .footer-terminal-wordmark"
              ).length,
              aboutQuote: select(".about-motto blockquote"),
              aboutQuoteText: document.querySelector(".about-motto blockquote")?.textContent?.trim(),
              aboutQuoteStyle: document.querySelector(".about-motto blockquote") &&
                getComputedStyle(document.querySelector(".about-motto blockquote")).fontStyle,
              mobileTagline: select(".mobile-brand-tagline"),
              nav: select("#site-nav"),
              mobileNavChrome: (() => {
                const nav = document.querySelector("#site-nav");
                const header = document.querySelector(".site-header");
                const selected = nav?.querySelector(".nav-link.selected");
                const brandRow = document.querySelector(".header-inner");
                const brandDivider = brandRow ? getComputedStyle(brandRow, "::before") : null;
                const navStyle = getComputedStyle(nav);
                return nav && header ? {
                  brandDividerContent: brandDivider?.content,
                  brandDividerImage: brandDivider?.backgroundImage,
                  brandDividerTopStyle: brandDivider?.borderTopStyle,
                  navBackground: navStyle.backgroundColor,
                  navRadius: parseFloat(navStyle.borderTopLeftRadius),
                  navPaddingLeft: parseFloat(navStyle.paddingLeft),
                  selectedHeight: selected ? selected.getBoundingClientRect().height : null,
                  beforeContent: getComputedStyle(nav, "::before").content,
                  afterContent: getComputedStyle(nav, "::after").content,
                  headerBottomStyle: getComputedStyle(header).borderBottomStyle,
                  headerBottomColor: getComputedStyle(header).borderBottomColor,
                  headerShadow: getComputedStyle(header).boxShadow,
                  selectedRadius: selected ? parseFloat(getComputedStyle(selected).borderTopLeftRadius) : null,
                } : null;
              })(),
              tools: select(".header-tools"),
              header: select(".site-header"), articleActions: select(".article-actions"), globalMenuButton: select(".reader-global-menu-trigger"), body: select(".site-body"),
              navigation: [...document.querySelectorAll(".nav-label")].map((el) => el.textContent),
              controls: headerControls.map(select),
              column: select(".content-grid .feed-column"), sidebar: select(".content-grid .site-sidebar"),
              pageFrame: select(".site-main"),
              homePage: select(".home-page"),
              homeHero: select(".home-page > .home-hero"),
              homeGrid: select(".home-page .home-grid"),
              indexPage: select(".feed-page, .projects-page, .archive-page, .about-page, .privacy-frame"),
              indexHeading: select(".feed-page > .page-heading, .projects-page > .page-heading, .archive-page > .page-heading, .about-page > .page-heading, .privacy-frame > .page-heading"),
              indexContent: select(".feed-layout, .projects-layout, .archive-main, .about-layout, .privacy-page"),
              heroAction: select(".hero-browse"),
              pageHeadingEyebrow: select(".page-heading .eyebrow"),
              pageHeadingTitle: select(".page-heading h1"),
              types: [...document.querySelectorAll(".type-tab")].filter((el) => el.getClientRects().length).map(rect),
              mobileType: select(".mobile-type-select"),
              mobileTypeOptions: document.querySelector(".mobile-type-select select")?.options.length,
              feedControls: select(".feed-controls"),
              feedToolbarBox: select(".feed-controls > .feed-toolbar"),
              feedSortBox: select(".feed-controls .sort-control"),
              feedTopicsBox: select(".feed-controls > .filter-tabs"),
              feedResultsBox: select(".feed-controls > .feed-result-line"),
              feedFilterLabels: [...document.querySelectorAll(".feed-filter-label")].filter(el =>
                el.getClientRects().length > 0).map(el => el.textContent.trim()),
              feedFilterSurface: (() => {
                const el = document.querySelector(".feed-controls");
                if (!el) return null;
                const style = getComputedStyle(el);
                return { topBorder: style.borderTopWidth, background: style.backgroundColor };
              })(),
              filterBoundaries: [...document.querySelectorAll(".feed-controls select")]
                .filter((el) => rect(el))
                .map((el) => {
                  const style = getComputedStyle(el);
                  return { name: el.getAttribute("aria-label") || el.closest("label")?.textContent.trim(),
                    contrast: contrast(style.borderTopColor, style.backgroundColor) };
                }),
              chipContrast: contrast(tokens.getPropertyValue("--brand"), tokens.getPropertyValue("--brand-soft")),
              terminalPrefixes: document.documentElement.dataset.skin === "terminal"
                ? [...document.querySelectorAll(".page-heading h1, .article-heading h1, .reader-prose h2, .reader-prose h3")]
                  .filter((el) => rect(el) && getComputedStyle(el, "::before").display !== "none")
                  .map((el) => {
                    const style = getComputedStyle(el, "::before"), box = rect(el);
                    return { text: el.textContent.trim(), left: box.right - parseFloat(style.right) - parseFloat(style.width) };
                  }) : [],
              cardTitleGaps: [...document.querySelectorAll(".feed-list .feed-item")].map((el) => {
                const meta = rect(el.querySelector(".entry-meta"));
                const title = rect(el.querySelector("h2, .thought-text"));
                return meta && title ? title.top - meta.bottom : null;
              }).filter((gap) => gap !== null),
              phoneCovers: [...document.querySelectorAll(".feed-layout .feed-item.is-article .feed-media")].map(rect),
              meta: select(".entry-meta"), bookmark: select(".feed-tail .card-bookmark"),
              cardActions: [...document.querySelectorAll(".feed-list .feed-item")].map((card) => ({
                bookmark: rect(card.querySelector(".feed-actions .card-bookmark")),
                arrow: rect(card.querySelector(".feed-actions .feed-arrow")),
                actions: rect(card.querySelector(".feed-actions")),
              })),
              tagTargets: [...document.querySelectorAll(".feed-list .tag-list a")].map(rect).filter(Boolean),
              tagActionOverlaps: [...document.querySelectorAll(".feed-list .feed-item")].flatMap((card) => {
                const actions = rect(card.querySelector(".feed-actions"));
                return [...card.querySelectorAll(".tag-list a")].map(rect).filter((tag) =>
                  tag && actions && Math.min(tag.right, actions.right) - Math.max(tag.left, actions.left) > 1 &&
                  Math.min(tag.bottom, actions.bottom) - Math.max(tag.top, actions.top) > 1);
              }),
              popularTitles: [...document.querySelectorAll(".popular-title")].map((title) => ({
                whiteSpace: getComputedStyle(title).whiteSpace,
                overflowWrap: getComputedStyle(title).overflowWrap,
              })),
              bookmarkOpacity: document.querySelector(".card-bookmark") && getComputedStyle(document.querySelector(".card-bookmark")).opacity,
              years: document.querySelectorAll(".archive-year").length,
              yearLinks: document.querySelectorAll(".archive-year-nav a").length,
              archiveOverview: !!document.querySelector(".timeline-overview"),
              archiveTitle: document.querySelector(".archive-heading h1")?.textContent,
              hero: select(".home-hero"),
              heroVisual: select(".home-hero .hero-visual"),
              resume: select(".home-resume .resume-link"),
              entryFacts: select(".feed-list .entry-meta-facts"),
              homeFeaturedMedia: select(".home-feed .feed-item.has-media .feed-media-link"),
              homeFeaturedBody: select(".home-feed .feed-item.has-media .feed-body"),
              firstHeading: select(".home-feed .feed-body h2"),
              firstMedia: select(".feed-list .feed-media-link"),
              entryHeading: select(".feed-list .feed-body h2"),
              latestHeading: select("#latest-heading"),
              identity: select(".home-hero .intro-copy"),
              homeLinks: [...document.querySelectorAll(".home-links a")].map((el) => el.getAttribute("href")),
              homeTopicLink: select(".home-topic-link"),
              homeShortcuts: select(".home-topic-shortcuts"),
              homeShortcutLinks: [...document.querySelectorAll(".home-topic-shortcuts a")].map(rect).filter(Boolean),
              homeSideTopics: select(".home-side-topics"),
              sideHeadingLinks: [...document.querySelectorAll(".content-grid .site-sidebar .side-heading-link")].filter((el) => rect(el)).map((el) => ({
                ...rect(el), href: el.getAttribute("href"), text: el.textContent.trim(),
              })),
              sidebarEndSlots: [...document.querySelectorAll(
                ".content-grid .site-sidebar .side-more, .content-grid .site-sidebar .explore-count, .content-grid .site-sidebar .home-project-end, .content-grid .site-sidebar .sidebar-row-end, .content-grid .site-sidebar .popular-views"
              )].filter((el) => rect(el)).map((el) => {
                const box = el.getBoundingClientRect();
                const parent = el.closest(".side-block")?.getBoundingClientRect();
                return { width: box.width, rightGap: parent ? parent.right - box.right : null };
              }),
              sideHeadingRows: [...document.querySelectorAll(".content-grid .site-sidebar .side-head")]
                .filter((head) => head.getClientRects().length)
                .map((head) => {
                  const arrow = head.querySelector(".side-more svg");
                  return {
                    top: rect(head)?.top,
                    linkTop: rect(head.querySelector(".side-heading-link"))?.top,
                    isLink: !!head.querySelector("a.side-heading-link"),
                    arrowDisplay: arrow ? getComputedStyle(arrow).display : null,
                  };
                }),
              homeDensity: document.querySelector(".home-list")?.className,
              homeEntryCount: document.querySelectorAll(".home-list .feed-item").length,
              homeSecondEntry: rect(document.querySelectorAll(".home-list .feed-item")[1]),
              homeCardTags: [...document.querySelectorAll(".home-list .feed-item")].map((card) => ({
                links: [...card.querySelectorAll(".tag-list a")].map(rect).filter(Boolean),
                bookmark: rect(card.querySelector(".feed-tail .card-bookmark")),
                arrow: rect(card.querySelector(".feed-tail .feed-arrow")),
                tail: rect(card.querySelector(".feed-tail")),
              })),
              homeProjectRows: [...document.querySelectorAll(".home-sidebar .home-projects a")].map(rect),
              homeReadingNote: select(".home-sidebar .home-reading-note"),
              resume: select(".home-resume"),
              densityControls: [...document.querySelectorAll(".view-toggle button")].map(rect),
              resetLink: select(".feed-clear-filters"),
              homeHeadingBars: document.querySelectorAll(".home-feed-heading").length,
              archiveRows: document.querySelectorAll(".archive-row").length,
              archiveTypeCount: document.querySelectorAll(".archive-row .archive-type").length,
              archiveRowTarget: select(".archive-row"),
              archiveTopicTarget: select(".archive-summary a"),
              archiveJumpTargets: [...document.querySelectorAll(".archive-summary a")].map(rect),
              archiveYearTargets: [...document.querySelectorAll(".archive-year-nav a")].map(rect),
              archiveSummaryText: document.querySelector(".archive-summary")?.textContent || "",
              archiveIndex: select(".archive-index"),
              archiveActivity: select(".archive-activity"),
              archiveActivityCopy: select(".archive-activity-copy"),
              archiveHeatmap: select(".archive-activity .heatmap"),
              projectCount: document.querySelectorAll(".projects-layout .feed-item.is-project").length,
              projectCards: [...document.querySelectorAll(".projects-layout .feed-item.is-project")].map(rect),
              projectStatusCount: document.querySelectorAll(".projects-layout .project-status").length,
              projectCodeLabels: [...document.querySelectorAll(".projects-layout .project-code")].map((el) => el.textContent.trim()),
              // A desktop preview and a compact responsive row share tag data.
              // Only visible links have usable hit targets at a given width.
              projectTags: [...document.querySelectorAll(".projects-layout .tag-list a")].map(rect).filter(Boolean),
              projectTagActionRows: [...document.querySelectorAll(".projects-layout .feed-item.is-project")].map((card) => ({
                tags: [...card.querySelectorAll(".feed-tail-tags .tag-list a")].map(rect).filter(Boolean),
                actions: rect(card.querySelector(".feed-tail .feed-actions")),
              })),
              projectMedia: select(".projects-layout .project-media"),
              projectInlineTags: select(".projects-layout .project-compact-tags"),
              projectExternal: [...document.querySelectorAll(".projects-layout .project-facts a")].map(rect),
              projectStackItems: [...document.querySelectorAll(".projects-layout .project-facts .stack-list li")].map(rect).filter(Boolean),
              footerLinks: select(".site-footer .footer-links"),
              footerCopy: select(".site-footer .footer-copy"),
              footerTargets: [...document.querySelectorAll(".footer-links a")].map(rect),
              footerCountText: document.querySelector(".footer-stats")?.textContent?.trim(),
              notFoundHeading: document.querySelector(".not-found h1")?.textContent?.trim(),
              notFoundGlyphContrast: (() => {
                const icon = document.querySelector(".not-found .lost-page svg");
                return icon ? contrast(getComputedStyle(icon).color, tokens.getPropertyValue("--paper")) : null;
              })(),
              notFoundCodeGap: (() => {
                const code = select(".not-found > .mono"), masthead = select(".site-header");
                return code && masthead ? code.top - masthead.bottom : null;
              })(),
              notFoundLatest: [...document.querySelectorAll(".not-found .lost-latest a")].map(rect),
              notFoundActions: [...document.querySelectorAll(".not-found > a")].map(rect),
              aboutText: select(".about-text"),
              aboutDetails: select(".about-details"),
              aboutHeadingLevels: [...document.querySelectorAll(".about-details > section > h2")].map((el) => el.textContent.trim()),
              aboutStatsHeadingIsLink: !!document.querySelector(".about-stats .side-title a"),
              aboutStatsLabel: document.querySelector(".about-layout .site-stats > div:first-child dd")?.textContent?.trim(),
              aboutSocialTargets: [...document.querySelectorAll(".about-text .social-links a")].map(rect),
              aboutCtaBox: select(".about-text > .primary-button"),
              aboutCta: {
                text: document.querySelector(".about-text > .primary-button")?.textContent?.trim(),
                href: document.querySelector(".about-text > .primary-button")?.getAttribute("href"),
              },
              aboutSectionCount: document.querySelectorAll(".about-details > section").length,
              archiveFilters: document.querySelectorAll(".archive-main .type-tabs").length,
              articleNeighbors: select(".article-neighbors"),
              siteFooter: select(".site-footer"),
              readerFont: document.querySelector(".reader-prose") && getComputedStyle(document.querySelector(".reader-prose")).fontSize,
              readerProgress: (() => {
                const track = document.querySelector(".reading-progress");
                const fill = track?.querySelector("span");
                if (!track || !fill) return null;
                const marker = getComputedStyle(fill, "::after");
                return {
                  role: track.getAttribute("role"),
                  value: Number(track.getAttribute("aria-valuenow")),
                  trackPattern: getComputedStyle(track).backgroundImage,
                  fillPattern: getComputedStyle(fill).backgroundImage,
                  markerRadius: marker.borderRadius,
                  markerAnimation: marker.animationName,
                  markerColor: marker.backgroundColor,
                  markerDisplay: marker.display,
                };
              })(),
              headingTextWrap: (() => {
                const element = document.querySelector(".reading-article .article-heading h1, .feed-list .feed-body h2");
                return element ? getComputedStyle(element).textWrap : null;
              })(),
              deckTextWrap: (() => {
                const element = document.querySelector(".reading-article .article-deck");
                return element ? getComputedStyle(element).textWrap : null;
              })(),
              readerIntro: (() => {
                const deck = document.querySelector(".reading-article .article-deck");
                const author = document.querySelector(".reading-article .article-author");
                const byline = document.querySelector(".reading-article .article-byline");
                const meta = document.querySelector(".reading-article .article-meta");
                if (!deck || !author || !byline || !meta) return null;
                const style = getComputedStyle(deck);
                return {
                  text: deck.textContent.trim(),
                  clamp: style.webkitLineClamp,
                  visibleHeight: deck.clientHeight,
                  totalHeight: deck.scrollHeight,
                  gapAfterDeck: byline.getBoundingClientRect().top - deck.getBoundingClientRect().bottom,
                  authorBottom: author.getBoundingClientRect().bottom,
                  metadataTop: meta.getBoundingClientRect().top,
                  metadataRight: meta.getBoundingClientRect().right,
                };
              })(),
            };
          }, headerControls);
          // Keep decorative graphics inside the heading's own grid column.
          if (route === "/" && width > 860 && geometry.heroVisual) {
            assert.ok(geometry.pageHeadingEyebrow &&
              geometry.heroVisual.top >= geometry.pageHeadingEyebrow.top - 1,
              `${label}: hero illustration climbs above WAYLAN / HOME`);
            assert.ok(geometry.heroVisual.bottom <= geometry.hero.bottom + 1,
              `${label}: hero illustration escapes its section`);
            if (geometry.resume) assert.ok(geometry.heroVisual.bottom <= geometry.resume.top + 1,
              `${label}: hero illustration overlaps continue-reading`);
            // A tall illustration must not create a vacant band beneath
            // the introduction's final 44px link row.
            if (geometry.resume && geometry.identity) {
              const gap = geometry.resume.top - geometry.identity.bottom;
              assert.ok(gap >= 0 && gap <= 38,
                `${label}: hero artwork pushes continue-reading too far down (${gap}px)`);
            }
          }
          assert.ok(geometry.filterBoundaries.every((sample) => sample.contrast >= 3),
            `${label}: weak filter boundary: ${JSON.stringify(geometry.filterBoundaries)}`);
          assert.ok(geometry.chipContrast >= 4.5, `${label}: filter text lacks contrast (${geometry.chipContrast})`);
          assert.ok(geometry.terminalPrefixes.every((prefix) => prefix.left >= 0),
            `${label}: terminal prefix clipped: ${JSON.stringify(geometry.terminalPrefixes)}`);
          assert.ok(geometry.cardTitleGaps.every((gap) => gap >= -1 && gap <= 12),
            `${label}: inconsistent metadata-to-title spacing: ${geometry.cardTitleGaps}`);
          if (route === "/feed" && width <= 767) {
            assert.ok(geometry.phoneCovers.length && geometry.phoneCovers.every((box) => box && box.width <= 144.5 && box.height <= 91),
              `${label}: a full-width cover displaced phone content`);
          }
          if (route === "/404") {
            assert.ok(geometry.notFoundGlyphContrast !== null && geometry.notFoundGlyphContrast >= 3,
              `${label}: 404 action icon lacks non-text contrast (${geometry.notFoundGlyphContrast})`);
          }
          if (route === "/404" && width <= 767) {
            assert.ok(geometry.notFoundCodeGap !== null &&
              geometry.notFoundCodeGap >= -1 && geometry.notFoundCodeGap <= 64,
              `${label}: 404 entry is too far below mobile header (${geometry.notFoundCodeGap}px)`);
          }
          // The save shortcut follows the card details instead of interrupting
          // the publication facts (date, status and reading count).
          if ((route === "/" || route === "/feed") && geometry.entryFacts && geometry.bookmark) {
            assert.ok(geometry.bookmark.top >= geometry.entryFacts.bottom - 1,
              `${label}: save action overlaps publication metadata`);
          }
          if (route === "/" && width > 767 &&
              geometry.homeFeaturedMedia && geometry.homeFeaturedBody) {
            const img = geometry.homeFeaturedMedia, text = geometry.homeFeaturedBody;
            const dy = (img.top + img.bottom - text.top - text.bottom) / 2;
            assert.ok(Math.abs(dy) <= 14,
              `${label}: featured cover is vertically misaligned with text (${dy}px)`);
          }
          // Regression for premature, balanced Chinese title wrapping.
          // Applied to all sampled viewport widths and editorial/terminal x light/dark.
          if (route === "/" || route === "/feed" || route.startsWith("/post/")) {
            assert.equal(geometry.headingTextWrap, "wrap",
              `${label}: article heading must fill each line naturally, not text-wrap: balance/pretty`);
          }
          if (route.startsWith("/post/")) {
            assert.equal(geometry.deckTextWrap, "wrap",
              `${label}: article excerpt must use normal line wrapping`);
            const intro = geometry.readerIntro;
            assert.ok(intro, `${label}: article introduction and byline must be visible`);
            assert.equal(intro.text, canonicalReaderExcerpt,
              `${label}: detail-page summary must use the complete original excerpt`);
            assert.equal(intro.clamp, "none",
              `${label}: article detail must not inherit list-card line clamping`);
            assert.ok(intro.totalHeight <= intro.visibleHeight + 1,
              `${label}: summary is vertically clipped`);
            assert.ok(intro.gapAfterDeck >= 8,
              `${label}: introduction overlaps the byline`);
            if (width <= 700) {
              assert.ok(intro.metadataTop >= intro.authorBottom - 1,
                `${label}: mobile author and publication data must use separate rows`);
              assert.ok(intro.metadataRight <= width + 1,
                `${label}: publication metadata overflows the viewport`);
            }
            const bar = geometry.readerProgress;
            assert.ok(bar && bar.role === "progressbar" &&
              bar.value >= 0 && bar.value <= 100,
              `${label}: scroll progress semantics must remain intact`);
            assert.match(bar.fillPattern, /repeating-linear-gradient/,
              `${label}: progress fill must remain visible`);
            if (variant.skin === "terminal") {
              assert.notEqual(bar.trackPattern, "none",
                `${label}: Terminal must show its subtle empty-cell track`);
              assert.equal(bar.markerRadius, "0px",
                `${label}: Terminal cursor must remain square`);
              assert.equal(bar.markerAnimation, "none",
                `${label}: Terminal cursor must not pulse`);
            } else {
              assert.equal(bar.trackPattern, "none",
                `${label}: Editorial must retain a clear unfilled track`);
              assert.equal(bar.markerRadius, "50%",
                `${label}: Editorial must keep its round marker`);
            }
          }
          results.push({ route, width, ...variant, ...geometry });
          // Capture before assertions so a failing state is available to review.
          if ([1440, 768, 390, 320].includes(width))
            await page.screenshot({ path: `${out}/${label}.png`, animations: "disabled" });
          if (route.startsWith("/post/") && [390, 768, 1440].includes(width)) {
            const cover = page.locator('.article-cover-image img[role="button"]').first();
            assert.ok(await cover.count(), `${label}: image zoom entry missing`);
            await cover.click();
            const overlay = page.locator("dialog.image-dialog[open]");
            await overlay.waitFor();
            await overlay.locator("img").evaluate(image => image.decode().catch(() => {}));
            await page.waitForTimeout(550);
            const zoom = await overlay.evaluate(dialog => {
              const box = dialog.getBoundingClientRect();
              const image = dialog.querySelector("img").getBoundingClientRect();
              const pseudo = getComputedStyle(dialog, "::after");
              const footer = pseudo.display === "none" ? 0 :
                (parseFloat(pseudo.height) || 0) +
                (parseFloat(pseudo.paddingTop) || 0) +
                (parseFloat(pseudo.paddingBottom) || 0) +
                (parseFloat(pseudo.borderTopWidth) || 0);
              return {
                blank: box.bottom - image.bottom - footer,
                centerOffset: Math.abs(box.top + box.height / 2 - innerHeight / 2),
                radius: getComputedStyle(dialog).borderTopLeftRadius,
                imageRight: image.right,
                dialogRight: box.right,
              };
            });
            assert.ok(Math.abs(zoom.blank) < 20,
              `${label}: image viewer left blank space below image (${zoom.blank}px)`);
            assert.ok(zoom.centerOffset < 30,
              `${label}: image viewer is not vertically centered (${zoom.centerOffset}px)`);
            assert.ok(zoom.imageRight <= zoom.dialogRight + 1,
              `${label}: zoomed image extends outside the dialog`);
            if (variant.skin === "terminal") {
              assert.equal(zoom.radius, "0px", `${label}: Terminal image viewer must keep square corners`);
            }
            await page.keyboard.press("Escape");
            await overlay.waitFor({ state: "hidden" });
          }
          assert.equal(geometry.skin, variant.skin, `${label}: incorrect skin`);
          assert.equal(geometry.theme, variant.theme, `${label}: incorrect color mode`);
          // Primary pages and Privacy share one outer frame and heading origin;
          // only the inner reading columns retain separate maximum widths.
          if (["/", "/feed", "/archive", "/projects", "/about", "/privacy"].includes(route)) {
            assert.ok(geometry.pageHeadingEyebrow && geometry.pageHeadingTitle,
              `${label}: index page heading is missing`);
            const key = `${width}:${variant.skin}:${variant.theme}`;
            if (route === "/") {
              pageHeadingBaselines.set(key, {
                eyebrow: geometry.pageHeadingEyebrow,
                title: geometry.pageHeadingTitle,
                frame: geometry.homePage,
              });
            } else {
              const home = pageHeadingBaselines.get(key);
              assert.ok(home, `${label}: homepage baseline is missing`);
              for (const part of ["eyebrow", "title"]) {
                const actual = part === "eyebrow" ? geometry.pageHeadingEyebrow : geometry.pageHeadingTitle;
                const expected = home[part];
                for (const axis of ["left", "top"]) {
                  assert.ok(Math.abs(actual[axis] - expected[axis]) <= 1,
                    `${label}: ${part} ${axis} differs from Home (${actual[axis]} vs ${expected[axis]})`);
                }
              }
              assert.ok(geometry.indexPage && Math.abs(geometry.indexPage.width - home.frame.width) <= 1,
                `${label}: index frame width differs from Home`);
            }
          }
          if (["/", "/feed", "/projects", "/archive", "/about", "/privacy"].includes(route)) {
            const measure = route === "/" ? geometry.homePage : geometry.indexPage;
            assert.ok(measure && geometry.pageFrame, `${label}: centered page frame missing`);
            assert.ok(Math.abs((measure.left + measure.right - geometry.pageFrame.left - geometry.pageFrame.right) / 2) <= 1,
              `${label}: page content is not centered within the site frame`);
            if (route === "/") {
              assert.ok(geometry.homeHero && geometry.homeGrid,
                `${label}: homepage hero or editorial list grid missing`);
              assert.ok(geometry.homeHero.bottom <= geometry.homeGrid.top + 1,
                `${label}: homepage rail overlaps the introduction`);
            }
          }
          assert.equal(geometry.footerTargets.length, 4, `${label}: footer links missing`);
          assert.ok(geometry.footerTargets.every((box) => box && box.height >= 44 &&
            box.left >= 0 && box.right <= geometry.viewport + 1),
            `${label}: footer link has a small or clipped touch target`);
          assert.equal(geometry.footerLogoCount, 0,
            `${label}: footer duplicated the masthead logo`);
          assert.ok(geometry.footerCopy && geometry.footerLinks,
            `${label}: footer must contain copyright/statistics and navigation`);
          if (width >= 768) {
            assert.ok(geometry.footerLinks.left >= geometry.footerCopy.right - 2,
              `${label}: footer navigation must align right of copyright on tablet/desktop`);
          } else {
            assert.ok(geometry.footerCopy.bottom <= geometry.footerLinks.top + 2,
              `${label}: phone footer rows overlap`);
          }
          if (isImmersive && width <= 700 && geometry.articleNeighbors && geometry.siteFooter) {
            const gap = geometry.siteFooter.top - geometry.articleNeighbors.bottom;
            assert.ok(gap >= 0 && gap <= 76,
              `${label}: article footer has excessive dead space (${gap}px)`);
          }
          assert.match(geometry.footerCountText || "", /\d+ 条内容/,
            `${label}: mixed content mislabeled as articles`);
          assert.ok(geometry.documentWidth <= geometry.viewport + 1, `${label}: horizontal overflow`);
          assert.equal(geometry.headerHasTagline, false,
            `${label}: no second slogan may clutter the logo`);
          if (variant.skin === "editorial") {
            assert.ok(geometry.editorialLogo && geometry.terminalLogo === null,
              `${label}: editorial header must have one handwritten Waylan logo`);
          } else {
            assert.ok(geometry.terminalLogo && geometry.editorialLogo === null,
              `${label}: terminal header must have one monospace identity`);
          }
          if (route === "/about") {
            assert.equal(geometry.aboutQuoteText, "Less, but better.",
              `${label}: the attributed motto belongs in About`);
            assert.ok(geometry.aboutQuote?.height >= 20,
              `${label}: the standalone About quote is missing`);
            assert.equal(geometry.aboutQuoteStyle, variant.skin === "editorial" ? "italic" : "normal",
              `${label}: the quote must use its own theme's typography`);
          } else {
            assert.equal(geometry.aboutQuote, null,
              `${label}: the motto must not turn into repeated site chrome`);
          }
          assert.deepEqual(geometry.navigation, ["首页", "内容", "归档", "项目", "关于"], `${label}: destination names changed`);
          const mastheadKey = `${width}:${variant.skin}:${variant.theme}`;
          if (route === "/") {
            mastheadBaselines.set(mastheadKey, geometry);
            const styleKey = `${width}:${variant.theme}`;
            if (variant.skin === "editorial") {
              editorialLogoBaselines.set(styleKey, geometry.brandWordmark);
            } else {
              const editorial = editorialLogoBaselines.get(styleKey);
              assert.ok(editorial && geometry.terminalLogo &&
                geometry.terminalLogo.width >= editorial.width * .85 &&
                geometry.terminalLogo.height >= editorial.height * .75,
                `${label}: terminal logo still reads much smaller than editorial`);
            }
          }
          if (isImmersive) {
            const home = mastheadBaselines.get(mastheadKey);
            assert.ok(home, `${label}: home masthead baseline missing`);
            const expectedHeight = width <= 860 ? 60 : 68;
            assert.ok(geometry.header && Math.abs(geometry.header.height-expectedHeight)<=1,
              `${label}: article masthead must match the ${expectedHeight}px home first row`);
            assert.ok(Math.abs(geometry.brandWordmark.height - home.brandWordmark.height) <= 1 &&
              Math.abs(geometry.brandWordmark.left - home.brandWordmark.left) <= 1 &&
              Math.abs(geometry.brandWordmark.top - home.brandWordmark.top) <= 1,
              `${label}: home and reader must render the same logo size and position`);
            for (let i = 0; i < 4; i++) {
              const actual = geometry.controls[i], original = home.controls[i];
              assert.ok(actual && original &&
                Math.abs(actual.height - original.height) <= 1 &&
                Math.abs(actual.width - original.width) <= 1 &&
                Math.abs(actual.left - original.left) <= 1 &&
                Math.abs(actual.top - original.top) <= 1,
                `${label}: global action ${i} differs from the home masthead`);
            }
            assert.ok(geometry.brand && geometry.brandWordmark,
              `${label}: original Waylan logo or brand identity disappeared`);
            assert.equal(geometry.nav,null,`${label}: article must not restore the duplicate destination row`);
            assert.ok(geometry.tools && geometry.controls.length===4 &&
              geometry.controls.every(box=>box && box.height>=40 && box.width>=36),
              `${label}: compact masthead must show four direct global shortcuts`);
            assert.equal(geometry.globalMenuButton,null,
              `${label}: compact masthead must not add a collapsed site menu`);
            assert.ok(geometry.controls.every(box=>box.left>=-1 && box.right<=geometry.viewport+1),
              `${label}: global shortcut overflows the iPhone viewport`);
            assert.ok(geometry.brand.right<=geometry.tools.left+3,
              `${label}: wordmark intersects the masthead actions`);
            assert.ok(geometry.articleActions && geometry.articleActions.height>=40 &&
              geometry.articleActions.left>=0 && geometry.articleActions.right<=geometry.viewport+1,
              `${label}: inline article actions overflow or disappeared`);
            assert.ok(["none", "normal"].includes(geometry.mobileNavChrome?.brandDividerContent),
              `${label}: the reader masthead must not inherit the site nav's decorative separator`);
          } else {
            if (width > 860) {
              assert.ok(geometry.brand.right <= geometry.nav.left + 1, `${label}: brand overlaps navigation`);
            } else {
              assert.ok(geometry.brand.right <= geometry.tools.left + 1,
                `${label}: logo and controls must share one non-overlapping phone row`);
            }
            assert.ok(geometry.brandWordmark && geometry.brandWordmark.height >= 20,
              `${label}: the standalone brand must remain legible`);
            assert.equal(geometry.mobileTagline, null, `${label}: no detached mobile subtitle`);
            if (!route.startsWith("/post/") && ((width >= 480 && width <= 860) || (width >= 1100 && width <= 1279))) {
              assert.ok(geometry.searchLabel?.width >= 18,
                `${label}: expand genuine search into available header space`);
            }
            assert.ok(Math.abs(geometry.header.bottom - geometry.body.top) <= 1,
              `${label}: an unwanted gap appeared below the header`);
            assert.ok(geometry.nav, `${label}: primary destinations are hidden`);
            if (width > 860) assert.ok(geometry.nav.right <= geometry.tools.left + 1, `${label}: navigation overlaps actions`);
            else {
              assert.ok(geometry.nav.top >= geometry.tools.bottom && geometry.nav.height >= 43,
                `${label}: destinations not separated from utilities`);
              const chrome = geometry.mobileNavChrome;
              assert.ok(chrome, `${label}: missing mobile nav chrome`);
              assert.ok(["none", "normal"].includes(chrome.beforeContent) &&
                ["none", "normal"].includes(chrome.afterContent),
                `${label}: double horizontal rules still frame the nav tabs: ${JSON.stringify(chrome)}`);
              if (route === "/" && width <= 480) {
                assert.ok(geometry.identity && geometry.identity.top - geometry.header.bottom >= 18,
                  `${label}: introductory copy touches the mobile navigation`);
              }
              assert.ok(["transparent", "rgba(0, 0, 0, 0)"].includes(chrome.navBackground),
                `${label}: a tinted nav slab still separates the original logo/tools from the destinations`);
              assert.equal(chrome.navRadius, 0,
                `${label}: navigation wrapper must not become a decorative pill`);
              assert.equal(chrome.navPaddingLeft, 0,
                `${label}: navigation row must not inset links away from the original grid`);
              if (chrome.selectedHeight !== null) {
                assert.ok(Math.abs(chrome.selectedHeight - 40) <= 1,
                  `${label}: theme-specific nav target height differs from the unified 40px controls`);
              }
              if (variant.skin === "editorial") {
                assert.ok(!["transparent", "rgba(0, 0, 0, 0)"].includes(chrome.headerBottomColor) &&
                  chrome.headerBottomStyle === "solid" && chrome.headerShadow !== "none",
                  `${label}: Editorial needs a quiet masthead lower edge, not a frame around the tab`);
                if (width > 370) {
                  assert.ok(!["none", "normal"].includes(chrome.brandDividerContent) &&
                    chrome.brandDividerImage?.includes("linear-gradient"),
                    `${label}: missing the single fading brand/navigation separator`);
                } else {
                  assert.ok(["none", "normal"].includes(chrome.brandDividerContent),
                    `${label}: narrow phone divider should not cross the second tool row`);
                }
                if (chrome.selectedRadius !== null) assert.ok(chrome.selectedRadius >= 8,
                  `${label}: rounded nav tab lost its rounded corners`);
              } else {
                assert.ok(!["transparent", "rgba(0, 0, 0, 0)"].includes(chrome.headerBottomColor) &&
                  chrome.headerBottomStyle === "dashed" && chrome.headerShadow === "none",
                  `${label}: Terminal needs one dashed lower edge without a floating shadow`);
                if (width > 370) {
                  assert.ok(!["none", "normal"].includes(chrome.brandDividerContent) &&
                    chrome.brandDividerTopStyle === "dashed",
                    `${label}: terminal needs one brand/navigation dashed divider`);
                } else {
                  assert.ok(["none", "normal"].includes(chrome.brandDividerContent),
                    `${label}: do not draw a divider across very narrow phone tools`);
                }
                if (chrome.selectedRadius !== null) assert.equal(chrome.selectedRadius, 0,
                  `${label}: terminal nav tab must stay rectangular`);
              }
            }
            for (const control of geometry.controls) {
              assert.ok(control && control.width >= 44 && control.height >= 44, `${label}: small header target`);
              assert.ok(control.left >= 0 && control.right <= geometry.viewport, `${label}: clipped header action`);
            }
            }
          // Hidden sidebars retain DOM descendants with zero-size boxes.
          // Only visible sidebars have trailing-column geometry to verify.
          if (geometry.sidebar) {
            assert.ok(geometry.sidebarEndSlots.every((slot) =>
              Math.abs(slot.width - 28) <= 1 && slot.rightGap !== null &&
              Math.abs(slot.rightGap) <= (width < 768 ? 6 : 3)),
              `${label}: shared sidebar counts and arrows drift from the trailing column`);
          }
          if (route === "/about" && geometry.aboutSocialTargets.length) {
            assert.ok(geometry.aboutCtaBox && geometry.aboutCtaBox.height >= 44 &&
              geometry.aboutSocialTargets.every(box =>
                box && box.height >= 44 && Math.abs(box.height - geometry.aboutCtaBox.height) <= 1),
              `${label}: About action targets are not equally sized`);
          }
          if (geometry.sideHeadingRows.length) {
            assert.ok(geometry.sideHeadingRows.every((row) =>
              Math.abs(row.linkTop - row.top) <= 2 &&
              (row.isLink ? row.arrowDisplay !== "none" && row.arrowDisplay !== null : row.arrowDisplay === null)),
              `${label}: sidebar heading prefix wrapped or destination arrow hidden`);
          }
          if (geometry.column && geometry.sidebar) {
            assert.ok(width >= 1120
              ? geometry.column.right <= geometry.sidebar.left + 1
              : geometry.column.bottom <= geometry.sidebar.top + 1, `${label}: sidebar overlaps content`);
          }
          if (geometry.cardActions.length) {
            assert.ok(geometry.cardActions.every((card) => card.bookmark && card.arrow && card.actions &&
              card.bookmark.width >= 40 && card.bookmark.height >= 40 &&
              card.arrow.width >= 40 && card.arrow.height >= 40 &&
              Math.abs(card.bookmark.top - card.arrow.top) <= 2 &&
              card.bookmark.right <= card.arrow.left + 1 &&
              card.arrow.right <= card.actions.right + 1),
              `${label}: bookmark and open buttons are misaligned or clipped`);
          }
          assert.ok(geometry.popularTitles.every((title) => title.whiteSpace === "normal" && title.overflowWrap === "anywhere"),
            `${label}: popular-post titles are still truncated instead of wrapping`);
          if (geometry.bookmark) {
            assert.ok(geometry.bookmark.width >= 40 && geometry.bookmark.height >= 40, `${label}: small save target`);
            assert.equal(geometry.bookmarkOpacity, "1", `${label}: save target hidden`);
            assert.ok(geometry.bookmark.left >= geometry.meta.left && geometry.bookmark.right <= geometry.meta.right + 1,
              `${label}: save target escaped its content column`);
          }
          if (["/feed", "/projects", "/archive", "/about", "/privacy"].includes(route)) {
            assert.ok(geometry.indexPage && geometry.indexHeading && geometry.indexContent,
              `${label}: index heading or content measure missing`);
            assert.ok(geometry.indexPage.width <= 1141,
              `${label}: index content exceeds the page reading measure`);
            assert.ok(Math.abs(geometry.indexHeading.left - geometry.indexPage.left) <= 1 &&
              Math.abs(geometry.indexContent.left - geometry.indexPage.left) <= 1,
              `${label}: heading, content and index measure have different left edges`);
          }
          assert.equal(geometry.tagActionOverlaps.length, 0, `${label}: tag targets overlap the save/open actions`);
          if (width <= 767 || geometry.touch) {
            assert.ok(geometry.tagTargets.every((tag) => tag.height >= 40 &&
              tag.left >= 0 && tag.right <= geometry.viewport + 1),
              `${label}: inconsistent or clipped touch tag targets`);
          }
          // Each index route uses the same outer horizontal origin.
          // Feed fills that frame; stacked Archive keeps its narrower timeline.
          if (["/feed", "/archive", "/projects"].includes(route)) {
            const key = `${width}:${variant.skin}:${variant.theme}`;
            if (route === "/feed") {
              indexListWidthBaselines.set(key, geometry.indexContent.width);
              assert.ok(geometry.indexContent.width <= 1141,
                `${label}: Feed exceeded the shared 1140px page frame`);
            } else if (route === "/archive" && width < 1120) {
              const feedWidth = indexListWidthBaselines.get(key);
              assert.ok(feedWidth && Math.abs(geometry.indexContent.width - Math.min(feedWidth, 960)) <= 1,
                `${label}: stacked archive must keep its 960px reading measure`);
            } else if (width >= 1120) {
              assert.ok(Math.abs(geometry.indexContent.width - geometry.indexPage.width) <= 1,
                `${label}: page-specific desktop layout fails to use its outer frame`);
            }
          }
          if (route === "/privacy") {
            assert.ok(geometry.indexContent.width <= 721, `${label}: privacy prose lost its 720px reading measure`);
          }
          if (route === "/feed" && width >= 1120) {
            // Feed fills the same centered 1140px frame as Home's heading.
            const expectedLeft = (geometry.viewport - geometry.indexPage.width) / 2;
            assert.ok(Math.abs(geometry.indexPage.left - expectedLeft) <= 2,
              `${label}: feed index is off-center: ${JSON.stringify({left: geometry.indexPage.left, expectedLeft})}`);
            assert.ok(geometry.feedToolbarBox && geometry.feedSortBox &&
              geometry.feedTopicsBox && geometry.feedResultsBox,
              `${label}: one of the desktop filter bands is missing`);
            assert.ok(geometry.feedSortBox.top >= geometry.feedToolbarBox.top - 1 &&
              geometry.feedSortBox.bottom <= geometry.feedToolbarBox.bottom + 1,
              `${label}: sorting escaped the type-filter band`);
            assert.ok(Math.abs(geometry.feedTopicsBox.top - geometry.feedResultsBox.top) <= 3,
              `${label}: results and topics no longer share the second filter band`);
            assert.ok(geometry.feedResultsBox.right <= geometry.feedControls.right + 1,
              `${label}: view-switch and result count escape the filter measure`);
          }
          if (route === "/feed") {
            assert.equal(geometry.sidebar, null, `${label}: feed sidebar duplicates the search and filters`);
            assert.equal(geometry.resetLink, null, `${label}: reset filter appears without active filters`);
            assert.ok(geometry.feedFilterSurface &&
              geometry.feedFilterSurface.topBorder === "2px" &&
              ["rgba(0, 0, 0, 0)", "transparent"].includes(geometry.feedFilterSurface.background),
              `${label}: filters lost their editorial control rule or regained a disconnected card`);
            if (width >= 768) {
              assert.deepEqual(geometry.feedFilterLabels,
                width <= 1024 ? ["内容类型"] : ["内容类型", "写作主题"],
                `${label}: filter groups have no visible purpose labels`);
            }
            if (width <= 767) {
              assert.equal(geometry.types.length, 0, `${label}: desktop type pills duplicate the phone picker`);
              assert.equal(geometry.mobileTypeOptions, 6, `${label}: phone picker lost content types`);
              assert.ok(geometry.feedControls && geometry.feedControls.height < 150,
                `${label}: phone filters consume too much of the first screen (${geometry.feedControls?.height ?? "missing"}px)`);
              assert.ok(geometry.mobileType && geometry.mobileType.height >= 44 &&
                geometry.mobileType.left >= 0 && geometry.mobileType.right <= geometry.viewport,
                `${label}: missing/clipped phone type picker`);
            } else {
              assert.equal(geometry.types.length, 6, `${label}: missing tablet/desktop type filters`);
              assert.equal(geometry.mobileType, null, `${label}: duplicated type filter on wider screen`);
              if (width <= 1024) {
                assert.ok(geometry.feedControls && geometry.feedControls.height <= 160,
                  `${label}: tablet filters waste the first screen (${geometry.feedControls?.height ?? "missing"}px)`);
                assert.ok(geometry.types.every((tab) => tab.height >= 44) &&
                  geometry.feedSortBox && geometry.feedSortBox.height >= 44,
                  `${label}: tablet filtering lost its 44px targets`);
              }
              assert.ok(geometry.types.every((tab) => tab && tab.left >= 0 &&
                tab.right <= geometry.viewport && tab.height >= 40), `${label}: clipped/small filter`);
            }
            assert.ok(geometry.densityControls.length === 2 && geometry.densityControls.every((box) => box && box.width >= 40 && box.height >= (width <= 767 || geometry.touch ? 44 : 40)), `${label}: density preference cannot be changed`);
          }
          if (route === "/" && width >= 1120 && geometry.resume && geometry.column) {
            assert.ok(Math.abs(geometry.resume.right - geometry.column.right) <= 1,
              `${label}: continue-reading width differs from the article column`);
          }
          if (route === "/projects") {
            assert.equal(geometry.projectCount, 2, `${label}: missing project entries`);
            assert.equal(geometry.projectStatusCount, 2, `${label}: missing project status`);
            assert.equal(geometry.projectCards.length, geometry.projectCount,
              `${label}: project comparison cards disappeared`);
            if (width >= 1120) {
              const [first, second] = geometry.projectCards;
              assert.ok(first && second &&
                Math.abs(first.top - second.top) <= 1 &&
                second.left >= first.right + 16 &&
                Math.abs(first.width - second.width) <= 1,
                `${label}: project entries are not a comparable two-column collection`);
            } else if (geometry.projectCards.length > 1) {
              assert.ok(geometry.projectCards[1].top >= geometry.projectCards[0].bottom,
                `${label}: project entries overlap in the single-column view`);
            }
            assert.ok(geometry.projectCodeLabels.every((text) => text.startsWith("项目 · ")),
              `${label}: unpublished slug looks like a public repository`);
            if (width <= 1040) {
              assert.equal(geometry.projectMedia, null, `${label}: oversized project preview remains visible`);
              assert.ok(geometry.projectInlineTags, `${label}: compact project tags disappeared`);
            } else {
              assert.ok(geometry.projectMedia, `${label}: desktop project preview disappeared`);
              assert.equal(geometry.projectInlineTags, null, `${label}: desktop duplicates compact project tags`);
            }
            assert.equal(geometry.sidebar, null, `${label}: project page reintroduced the global navigation rail`);
            assert.ok(geometry.projectStackItems.length > 0,
              `${label}: project technologies vanish with the responsive preview`);
            if (width <= 767) {
              assert.ok(geometry.projectTags.length > 0 &&
                geometry.projectTags.every((box) => box && box.height >= 40 &&
                  box.left >= 0 && box.right <= geometry.viewport),
                `${label}: small or clipped project tags`);
              assert.ok(geometry.projectExternal.every((box) => box && box.height >= 44),
                `${label}: future project links need 44px targets`);
              if (width <= 480) {
                assert.ok(geometry.projectTagActionRows.length === geometry.projectCount &&
                  geometry.projectTagActionRows.every(({ tags, actions }) => tags.length > 0 && actions &&
                    Math.abs(actions.bottom - Math.max(...tags.map((tag) => tag.bottom))) <= 2),
                  `${label}: project actions float above the last wrapped topic row`);
              }
            }
          }
          if (route === "/about") {
            assert.deepEqual(geometry.aboutHeadingLevels, ["技术实现", "站点数据"],
              `${label}: about section heading levels are inconsistent`);
            assert.equal(geometry.aboutStatsHeadingIsLink, false,
              `${label}: site statistics heading incorrectly navigates to archive`);
            assert.match(geometry.aboutStatsLabel || "", /^\d+条$/,
              `${label}: about statistics count excludes mixed content`);
            assert.deepEqual(geometry.aboutCta, { text: "浏览全部内容", href: "/feed" },
              `${label}: about action implies article-only filtering`);
            assert.ok(geometry.aboutSocialTargets.length > 0 &&
              geometry.aboutSocialTargets.every((box) => box && box.height >= 44 &&
                box.left >= 0 && box.right <= geometry.viewport),
              `${label}: about social link has a small or clipped click target`);
            assert.equal(geometry.sidebar, null,
              `${label}: about page repeats the site's global navigation`);
            assert.equal(geometry.aboutSectionCount, 2,
              `${label}: about technical facts and statistics must remain visible on every device`);
            assert.ok(geometry.aboutText && geometry.aboutDetails,
              `${label}: About article or contextual facts are missing`);
            if (width >= 1120) {
              assert.ok(geometry.aboutDetails.left >= geometry.aboutText.right + 20 &&
                Math.abs(geometry.aboutDetails.top - geometry.aboutText.top) <= 1,
                `${label}: About data is not in its supporting rail`);
            } else {
              assert.ok(geometry.aboutDetails.top >= geometry.aboutText.bottom - 1,
                `${label}: narrow About facts overlap the reading column`);
            }
          }
          if (route === "/404") {
            assert.equal(geometry.notFoundHeading, "页面不存在", `${label}: missing 404 heading`);
            assert.equal(geometry.notFoundLatest.length, 3, `${label}: missing fallback content links`);
            assert.ok(geometry.notFoundLatest.every((box) => box && box.height >= 44 &&
              box.left >= 0 && box.right <= geometry.viewport + 1),
              `${label}: 404 recent link is too small or clipped`);
            assert.ok(geometry.notFoundActions.length >= 2,
              `${label}: 404 page lost its recovery links`);
          }
          if (route === "/archive") {
            assert.equal(geometry.archiveFilters, 0, `${label}: duplicated archive filters`);
            assert.ok(geometry.years > 0 && geometry.archiveRows > 0, `${label}: missing archive entries`);
            assert.equal(geometry.archiveTypeCount, geometry.archiveRows, `${label}: an archive item lacks its type label`);
            assert.match(geometry.archiveSummaryText, /共 \d+ 条记录/, `${label}: incorrect mixed-content counter`);
            assert.ok(geometry.archiveRowTarget?.height >= 54, `${label}: archive row has a small click target`);
            assert.ok(geometry.archiveTopicTarget?.height >= 44, `${label}: archive theme link has a small click target`);
            assert.ok(geometry.archiveJumpTargets.length === 2 &&
              geometry.archiveJumpTargets.every(box => box && box.height >= 44) &&
              geometry.archiveJumpTargets[1].left - geometry.archiveJumpTargets[0].right >= 12 &&
              geometry.archiveJumpTargets[1].left - geometry.archiveJumpTargets[0].right <= 32,
              `${label}: archive auxiliary actions are scattered or too small`);
            assert.ok(geometry.archiveYearTargets.every((box) => box?.height >= 44), `${label}: archive year link has a small click target`);
            assert.equal(geometry.archiveTitle, "归档", `${label}: archive label inconsistent`);
            assert.equal(geometry.archiveOverview, false, `${label}: obsolete archive card returned`);
            assert.ok(geometry.archiveActivity && geometry.archiveActivityCopy && geometry.archiveHeatmap &&
              geometry.archiveHeatmap.width <= 320 && geometry.archiveHeatmap.right <= geometry.indexContent.right + 1,
              `${label}: publishing activity disappeared or breaks the archive width`);
            assert.ok(geometry.archiveIndex, `${label}: chronological archive is missing`);
            if (width >= 1120) {
              assert.ok(geometry.archiveIndex.right + 20 <= geometry.archiveActivity.left &&
                Math.abs(geometry.archiveIndex.top - geometry.archiveActivity.top) <= 1,
                `${label}: timeline and its supporting activity rail are not aligned`);
              assert.ok(geometry.archiveHeatmap.left >= geometry.archiveActivity.left &&
                geometry.archiveHeatmap.right <= geometry.archiveActivity.right + 1,
                `${label}: chart exceeds the supporting rail`);
            } else {
              assert.ok(geometry.archiveActivity.top >= geometry.archiveIndex.bottom - 1 &&
                geometry.archiveActivityCopy.height <= 110,
                `${label}: narrow archive puts a secondary chart before or over the timeline`);
            }
            if (geometry.years === 1) assert.equal(geometry.yearLinks, 0, `${label}: isolated year button returned`);
          }
          if (route === "/") {
            assert.equal(geometry.homeHeadingBars, 0, `${label}: detached update bar returned`);
            assert.ok(geometry.hero && geometry.hero.height <= 380, `${label}: introduction dominates the first screen`);
            assert.ok(geometry.identity && geometry.identity.height > 10, `${label}: blog identity missing`);
            assert.ok(geometry.latestHeading && geometry.latestHeading.height > 20, `${label}: latest section heading hidden`);
            assert.ok(geometry.homeLinks.includes("/about") && geometry.homeLinks.includes("/rss.xml"), `${label}: essential blog entry points buried in sidebar`);
            if (width <= 767) {
              assert.equal(geometry.sideHeadingLinks.length, 0,
                `${label}: hidden phone rail exposes a redundant sidebar heading`);
            } else {
              assert.ok(geometry.sideHeadingLinks.length >= (width >= 1120 ? 2 : 1) &&
                geometry.sideHeadingLinks.every((link) => link.width > 44 && link.height >= 44),
                `${label}: tablet/desktop sidebar heading not fully tappable`);
            }
            if (width < 1120) {
              assert.ok(geometry.homeShortcuts &&
                geometry.homeShortcuts.bottom <= geometry.latestHeading.top &&
                geometry.homeShortcutLinks.length > 0 &&
                geometry.homeShortcutLinks.every((link) => link.height >= 44 &&
                  link.left >= 0 && link.right <= geometry.viewport + 1),
                `${label}: compact topic discovery is missing, clipped or below the feed`);
              assert.equal(geometry.homeSideTopics, null,
                `${label}: duplicated home topic rail appears below the feed`);
            } else {
              assert.equal(geometry.homeShortcuts, null, `${label}: mobile topic picker leaked onto desktop`);
              assert.ok(geometry.homeSideTopics, `${label}: desktop topic discovery disappeared`);
            }
            // The hero's primary "Browse all" CTA remains available at every
            // width. Sidebar discovery supplements rather than replaces it.
            assert.ok(geometry.homeTopicLink && geometry.homeTopicLink.height >= 44 &&
              geometry.homeLinks.includes("/feed"),
              `${label}: primary browse entry point is hidden or too small`);
            assert.ok(geometry.homeDensity?.includes("density-full"), `${label}: library density leaked into home`);
            assert.equal(geometry.homeEntryCount, 6, `${label}: homepage became a full library`);
            assert.ok(geometry.homeCardTags.length === geometry.homeEntryCount &&
              geometry.homeCardTags.every((card) =>
                card.links.length > 0 && card.links.every((tag) =>
                  tag.left >= 0 && tag.right <= geometry.viewport + 1) &&
                card.bookmark && card.arrow && card.tail &&
                card.bookmark.top >= card.tail.top - 1 &&
                card.bookmark.bottom <= card.tail.bottom + 1 &&
                Math.abs(card.bookmark.top - card.arrow.top) <= 2),
              `${label}: home cards have invisible tags, orphaned bookmarks or clipped tag links`);
            assert.ok(geometry.resume && geometry.resume.width <= geometry.viewport, `${label}: resume entry missing or clipped`);
            assert.ok(geometry.column && Math.abs(geometry.resume.right - geometry.column.right) <= 1,
              `${label}: resume entry and the latest-content column do not align`);
            assert.equal(geometry.homeReadingNote, null,
              `${label}: redundant reading-tip sidebar panel remains`);
            if (width <= 767) {
              assert.equal(geometry.sidebar, null,
                `${label}: desktop discovery rail was stacked onto the phone homepage`);
            } else {
              assert.ok(geometry.homeProjectRows.length >= 2,
                `${label}: project directory should contain the real projects`);
              assert.ok(geometry.homeProjectRows.every((row) => row &&
                row.height >= 44 && row.height <= 104 && row.right <= geometry.viewport + 1),
                `${label}: project rows are too tall or are clipped`);
            }
            if (width === 390) {
              await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
              await page.waitForTimeout(110);
              assert.equal(await page.locator(".back-to-top").evaluate((el) => el.classList.contains("visible")), false,
                `${label}: floating back-to-top must not cover the footer`);
              await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
            }
            if (width <= 390) {
              // The 13%-progress fixture must still expose the first story title
              // on a short 568px phone; keep the resume card and 44px links.
              assert.ok(geometry.firstHeading && geometry.firstHeading.top <= 560,
                `${label}: first article title starts below a short phone viewport (${geometry.firstHeading?.top ?? "missing"}px)`);
              assert.ok(geometry.resume && geometry.resume.height >= 56,
                `${label}: mobile reading progress entry was compressed or removed`);
            }
            if (width <= 768) assert.ok(geometry.homeSecondEntry?.top < 820, `${label}: second entry is buried below the first screen`);
            if (geometry.firstHeading) assert.ok(geometry.firstHeading.top < 660, `${label}: first article pushed below the first screen`);
          }
          if (width < 768 && geometry.entryHeading && geometry.firstMedia) {
            assert.ok(geometry.entryHeading.bottom < geometry.firstMedia.top, `${label}: cover precedes article identity on phone`);
          }
          const key = `${width}:${route}`, baseline = baselines.get(key);
          if (!baseline) baselines.set(key, geometry);
          else {
            if (!isImmersive) geometry.controls.forEach((box, i) => sameBox(box, baseline.controls[i], `${label}: header action ${i}`));
            if (geometry.nav) sameBox(geometry.nav, baseline.nav, `${label}: navigation`);
            if (geometry.heroAction) sameBox(geometry.heroAction, baseline.heroAction, `${label}: homepage action`);
            if (geometry.readerFont) assert.equal(geometry.readerFont, baseline.readerFont, `${label}: reader font size changed with skin`);
          }

          if (route === "/feed" && [320, 768, 1440].includes(width)) {
            const newest = await page.locator(".feed-item time").first().getAttribute("datetime");
            await page.getByRole("button", { name: "图文 · 详细列表", exact: true }).click();
            await page.locator(".feed-list.density-full").waitFor();
            assert.equal(await page.locator(".feed-media-link").first().isVisible(), true, `${label}: cannot restore detailed view`);
            if (width <= 767) {
              const tag = await page.locator(".feed-layout .tag-list a").first().boundingBox();
              assert.ok(tag && tag.height >= 40, `${label}: tag tap target too small`);
              const more = await page.locator(".feed-layout .load-more").boundingBox();
              assert.ok(more && more.height >= 44, `${label}: load-more target too small`);
            }
            await page.locator(".sort-control select").selectOption("oldest");
            await page.waitForURL("**sort=oldest");
            assert.notEqual(await page.locator(".feed-item time").first().getAttribute("datetime"), newest, `${label}: sort not applied`);
            await page.getByRole("button", { name: "紧凑列表", exact: true }).click();
            // Vite preview resolves prerendered directory indexes with a
            // trailing slash; use that existing page for the full reload.
            // The production Worker canonicalizes these same routes itself.
            const reloadURL = new URL(page.url());
            reloadURL.pathname = "/feed/";
            await page.goto(reloadURL.href, { waitUntil: "domcontentloaded" });
            await page.locator(".feed-list.density-compact").waitFor();
            await page.locator('#site-nav a[href="/"]').click();
            await page.locator(".home-list.density-full").waitFor();
            assert.equal(await page.locator(".home-list time").first().getAttribute("datetime"), newest, `${label}: library sorting leaked into home`);
            await page.locator('#site-nav a[href="/feed"]').click();
            await page.locator(".feed-list.density-compact").waitFor();
            await page.getByRole("button", { name: "图文 · 详细列表", exact: true }).click();
            await page.locator(".feed-list.density-full").waitFor();
            if ([320, 768, 1440].includes(width)) await page.screenshot({ path: `${out}/${label}-detailed.png`, animations: "disabled" });
            if (variant.skin === "editorial" && variant.theme === "light") {
              await page.goto(origin + "/feed/?sort=oldest", { waitUntil: "domcontentloaded" });
              const tagLink = page.locator(".feed-layout .tag-list a").first();
              await tagLink.waitFor();
              const destination = await tagLink.getAttribute("href");
              assert.ok(destination?.includes("sort=oldest") && destination.includes("tag="),
                `${label}: tag navigation discards existing sort`);
              await tagLink.click();
              await page.waitForURL(/\/feed\?[^#]*tag=/);
              assert.equal(new URL(page.url()).searchParams.get("sort"), "oldest",
                `${label}: tag click lost sort filter`);
              await page.locator(".feed-clear-filters").click();
              await page.waitForURL(/\/feed$/);
              assert.equal(new URL(page.url()).search, "", `${label}: reset did not clear all filters`);
            }
          }
          if (route.startsWith("/post/") && [320, 768, 1024].includes(width)) {
            await page.setViewportSize({ width, height: 480 });
            await page.getByRole("button", { name: "本文目录", exact: true }).click();
            const toc = page.locator(".reader-toc.toc-visible");
            await toc.waitFor();
            const bounds = await toc.boundingBox();
            assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 60 && bounds.y + bounds.height <= 480, `${label}: directory escapes a short viewport`);
            const tocLayout = await toc.evaluate((el) => {
              const nav = el.querySelector("nav");
              const footer = el.querySelector(".toc-footer");
              const buttons = [...(footer?.querySelectorAll("button") || [])];
              const navRect = nav?.getBoundingClientRect();
              const footerRect = footer?.getBoundingClientRect();
              return {
                navBottom: navRect?.bottom,
                footerTop: footerRect?.top,
                footerBottom: footerRect?.bottom,
                buttons: buttons.map((button) => {
                  const r = button.getBoundingClientRect();
                  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
                }),
                navScrollable: nav ? getComputedStyle(nav).overflowY === "auto" : false,
              };
            });
            assert.ok(tocLayout.navScrollable && tocLayout.navBottom <= tocLayout.footerTop + 1,
              `${label}: directory list must scroll separately from the footer`);
            assert.equal(tocLayout.buttons.length, 2, `${label}: directory requires two distinct footer actions`);
            assert.ok(tocLayout.buttons.every((b) => b.height >= 44) &&
              (tocLayout.buttons[0].bottom <= tocLayout.buttons[1].top + 1 ||
                tocLayout.buttons[0].right <= tocLayout.buttons[1].left + 1) &&
              tocLayout.footerBottom <= 480,
              `${label}: directory actions overlap or escape the viewport`);
            if (width <= 700) assert.ok(bounds.y >= 100,
              `${label}: phone directory should open near the bottom, not over the article heading`);
            assert.equal(await toc.locator("nav a").first().evaluate((el) => el === document.activeElement), true, `${label}: directory focus missing`);
            await page.screenshot({ path: `${out}/${label}-directory.png`, animations: "disabled" });
            await page.keyboard.press("Escape");
            await toc.waitFor({ state: "hidden" });
            assert.equal(await page.locator(".article-action-toc").evaluate((el) => el === document.activeElement), true, `${label}: directory Escape lost focus`);
            await page.getByRole("button", { name: "本文目录", exact: true }).click();
            await toc.getByRole("button", { name: "回到页首" }).click();
            await toc.waitFor({ state: "hidden" });
            assert.equal(await page.locator(".article-action-toc").evaluate((el) => el === document.activeElement), true,
              `${label}: back-to-top must close the directory and restore focus`);
            await page.setViewportSize({ width, height: 900 });
          }
          if (route.startsWith("/post/") && [320, 390, 768, 1440].includes(width) &&
              variant.skin === "editorial" && variant.theme === "light") {
            // Font size belongs to site-wide reading settings, not an article menu.
            await page.getByRole("button", { name: "阅读设置", exact: true }).click();
            const settings = page.getByRole("dialog", { name: "阅读设置", exact: true });
            await settings.waitFor();
            await settings.locator('.reader-font-choices label:has(input[value="20"])').click();
            await page.waitForFunction(() =>
              document.querySelector(".reader-prose")?.style.getPropertyValue("--reader-font") === "20px");
            assert.equal(await page.evaluate(() => localStorage.getItem("echo:font-size")), "20",
              `${label}: font size selected in reading settings did not persist`);
            await settings.getByRole("button", { name: "关闭", exact: true }).click();
            await settings.waitFor({ state: "hidden" });
            // The two completion actions are deliberately outside the reading intro.
            const completion = page.getByRole("group", { name: "读完后的操作" });
            await completion.scrollIntoViewIfNeeded();
            assert.equal(await completion.locator("button").count(), 2,
              `${label}: completion should offer only saving and sharing`);
            assert.ok(await completion.getByRole("button", { name: "分享文章" }).isVisible(),
              `${label}: completion share action not visible`);
            assert.equal(await page.locator(".article-action-more").count(), 0,
              `${label}: old intro action menu returned unexpectedly`);
          }
          if (route === "/" && [320, 768, 1440].includes(width)) {
            await page.getByRole("button", { name: "阅读设置", exact: true }).click();
            const settings = page.getByRole("dialog", { name: "阅读设置", exact: true });
            await settings.waitFor();
            const close = settings.getByRole("button", { name: "关闭", exact: true });
            const closeBox = await close.boundingBox();
            assert.ok(closeBox && closeBox.width >= 44 && closeBox.height >= 44 && closeBox.x >= 0 && closeBox.x + closeBox.width <= width, `${label}: dialog close target clipped`);
            const other = variant.skin === "editorial" ? "terminal" : "editorial";
            await settings.locator(`.skin-choice-${other}`).click();
            assert.equal(await page.locator("html").getAttribute("data-skin"), other, `${label}: theme switch failed`);
            sameBox(await close.boundingBox().then((b) => b && ({ left: b.x, top: b.y, width: b.width, height: b.height })),
              { left: closeBox.x, top: closeBox.y, width: closeBox.width, height: closeBox.height }, `${label}: close moved after theme switch`);
            await settings.locator(`.skin-choice-${variant.skin}`).click();
            const options = await settings.locator(".segmented label").evaluateAll((labels) =>
              labels.map((label) => {
                const r = label.getBoundingClientRect();
                return { text: label.textContent.trim(), height: r.height, left: r.left, right: r.right };
              }));
            assert.equal(options.length, 6, `${label}: settings lost a theme or font option`);
            assert.ok(options.every((option) => Math.abs(option.height - 44) <= 1 &&
              option.left >= 0 && option.right <= width + 1),
              `${label}: settings segmented options must share 44px targets`);
            await writeFile(`${out}/${label}-settings.json`, JSON.stringify(options, null, 2));
            await page.screenshot({ path: `${out}/${label}-settings.png`, animations: "disabled" });
            await close.click();
            await settings.waitFor({ state: "hidden" });
          }
          // On the phone, verify the heading text itself and the compact hero
          // topic doorway navigate, not just the small arrow glyph.
          if (route === "/" && width === 390 && variant.skin === "editorial" && variant.theme === "light") {
            await page.locator(".home-topic-shortcuts a").first().click();
            await page.waitForURL(/\/feed\?topic=/);
            await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
            await page.locator(".home-topic-link").click();
            await page.waitForURL("**/feed");
          }
          // Regression: opening search on a scrolled feed must never position
          // the native full-screen dialog midway down the document.
          if (route === "/feed" && width === 390 &&
              variant.skin === "editorial" && variant.theme === "light") {
            await page.evaluate(() => window.scrollTo(0, 650));
            assert.ok(await page.evaluate(() => window.scrollY) > 100,
              "search regression requires a scrolled source page");
            await page.locator(".header-search").evaluate((button) => button.click());
            const search = page.locator(".search-dialog[open]");
            await search.waitFor();
            const bounds = await search.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return { top: rect.top, left: rect.left, right: rect.right, height: rect.height,
                width: window.innerWidth, viewportHeight: window.innerHeight };
            });
            assert.ok(Math.abs(bounds.top) <= 1 && Math.abs(bounds.left) <= 1 &&
              Math.abs(bounds.right - bounds.width) <= 1 &&
              Math.abs(bounds.height - bounds.viewportHeight) <= 2,
              `scrolled mobile search must cover viewport: ${JSON.stringify(bounds)}`);
            const field = search.locator('input[type="search"]');
            assert.equal(await field.evaluate((element) => document.activeElement === element), true,
              "search field should receive initial focus");
            await field.fill("D1");
            assert.ok(await search.locator('[role="option"]').count() > 0,
              "typing after scroll should reveal search results");
            await page.keyboard.press("Escape");
            await search.waitFor({ state: "hidden" });
          }
          if (route === "/404" && (width === 320 || width === 390)) {
            await page.locator(".header-search").click();
            const dialog = page.locator(".search-dialog[open]");
            await dialog.waitFor();
            assert.equal(await dialog.locator('[role="listbox"]').count(), 0,
              `${label}: empty search incorrectly exposes a listbox`);
            const suggestions = await dialog.locator(".search-suggestions button").evaluateAll((els) =>
              els.map((el) => {
                const r = el.getBoundingClientRect();
                return { height: r.height, left: r.left, right: r.right };
              }));
            assert.ok(suggestions.length > 0 && suggestions.every((box) =>
              box.height >= 44 && box.left >= 0 && box.right <= width + 1),
              `${label}: small or clipped search recommendations`);
            await dialog.locator('input[type="search"]').fill("D1");
            assert.ok(await dialog.locator('[role="listbox"] [role="option"]').count() > 0,
              `${label}: matching options not exposed`);
            assert.equal(await dialog.locator('[role="listbox"] .search-all').count(), 0,
              `${label}: listbox contains a nonoption navigation link`);
            await page.screenshot({ path: `${out}/${label}-search.png`, animations: "disabled" });
            await page.keyboard.press("Escape");
            await dialog.waitFor({ state: "hidden" });
          }
          assert.deepEqual(errors, [], `${label}: browser runtime error`);
        }
        // All four header actions stay in place when the service is enabled,
        // disabled or unavailable. No signed-in user or messages are invented.
        if ([320, 768].includes(width)) {
          notificationsStatus = "enabled";
          await page.goto(origin + "/", { waitUntil: "domcontentloaded" });
          const bell = page.getByRole("button", { name: "消息通知，0 条未读", exact: true });
          await bell.waitFor();
          await page.waitForFunction(() => !document.documentElement.classList.contains("font-wait") && !document.documentElement.classList.contains("font-loader-out"));
          await bell.click();
          const inbox = page.getByRole("dialog", { name: "消息通知", exact: true });
          assert.equal(await bell.getAttribute("aria-haspopup"), "dialog");
          assert.equal(await bell.getAttribute("aria-controls"), "notification-panel");
          await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "关闭消息");
          const bounds = await inbox.boundingBox();
          const label = `inbox-${width}-${variant.skin}-${variant.theme}`;
          await page.screenshot({ path: `${out}/${label}.png`, animations: "disabled" });
          notificationResults.push({ width, ...variant, state: "enabled", bounds });
          assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 900,
            `${label}: inbox escaped viewport`);
          for (const [index, selector] of headerControls.entries()) {
            const box = await page.locator(selector).boundingBox();
            sameBox(box && { left: box.x, top: box.y, width: box.width, height: box.height },
              baselines.get(`${width}:/`).controls[index], `${label}: header action ${index} moved with service state`);
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
            `${label}: inbox introduced horizontal scrolling`);
          await inbox.getByRole("button", { name: "关闭消息", exact: true }).click();
          await page.waitForFunction(() => document.activeElement?.classList.contains("notification-trigger"));
          await bell.press("Enter");
          await inbox.waitFor({ state: "visible" });
          await page.keyboard.press("Escape");
          await inbox.waitFor({ state: "hidden" });
          await page.waitForFunction(() => document.activeElement?.classList.contains("notification-trigger"));
          notificationsStatus = "error";
          await page.reload({ waitUntil: "domcontentloaded" });
          const retryBell = page.getByRole("button", { name: "消息通知", exact: true });
          await retryBell.click();
          await page.getByText("暂时无法读取通知，请重试。", { exact: true }).waitFor();
          const errorBounds = await inbox.boundingBox();
          notificationResults.push({ width, ...variant, state: "error", bounds: errorBounds });
          assert.ok(errorBounds && errorBounds.x >= 0 && errorBounds.x + errorBounds.width <= width && errorBounds.y + errorBounds.height <= 900,
            `${label}: error panel escaped viewport`);
          // Keep a reference to the original retry node: recovery must unmount it
          // rather than mutate the same clickable element into OAuth login.
          const retryNode = await inbox.getByRole("button", { name: "重试", exact: true }).elementHandle();
          assert.ok(retryNode, `${label}: retry action missing in error state`);
          notificationsStatus = "enabled";
          const recoveredStatus = page.waitForResponse(response =>
            new URL(response.url()).pathname === "/api/status" && response.status() === 200,
            { timeout: 14000 });
          // This checks recovery state, not pointer hit-testing (covered above).
          // A physical Playwright click can land on the login button replacing
          // Retry in the same position during a concurrent status refresh.
          // Dispatch to the exact mounted Retry element synchronously.
          await inbox.getByRole("button", { name: "重试", exact: true })
            .evaluate(button => button.click());
          await recoveredStatus;
          try {
            await inbox.getByRole("button", { name: "使用 GitHub 登录", exact: true }).waitFor({ timeout: 12000 });
            assert.equal(new URL(page.url()).pathname, "/", `${label}: recovery must not initiate GitHub OAuth`);
            assert.equal(await retryNode.evaluate(button => button.isConnected), false,
              `${label}: React reused Retry as a live GitHub login button`);
          } catch (error) {
            // The accessible dialog may have been unmounted. Inspect the page,
            // not the locator that already failed, to preserve the real cause.
            const state = await page.evaluate(() => ({
              url: location.href,
              dialog: document.querySelector("#notification-panel")?.textContent?.trim() ?? null,
              trigger: document.querySelector(".notification-trigger")?.getAttribute("aria-label"),
              triggerExpanded: document.querySelector(".notification-trigger")?.getAttribute("aria-expanded"),
              focused: document.activeElement?.getAttribute("aria-label"),
            }));
            await page.screenshot({ path: `${out}/${label}-retry-failure.png`, animations: "disabled" });
            throw new Error(`${label}: notification recovery did not render login state: ${JSON.stringify(state)}; ${error}`);
          }
          assert.deepEqual(errors, [], `${label}: browser runtime error`);
        }
      } finally { await context.close(); }
    }
  }
  console.log(`Visual geometry checks passed [${matrix}, ${widths.length} widths]: ${results.length} page/viewport/appearance combinations plus ${notificationResults.length} enabled/error inbox states and retry, including persistent navigation, page-state isolation and theme position parity.`);
} catch (error) {
  await writeFile(`${out}/failure.txt`, error.stack || String(error));
  throw error;
} finally {
  await writeFile(`${out}/geometry.json`, JSON.stringify(results, null, 2));
  await writeFile(`${out}/notifications.json`, JSON.stringify(notificationResults, null, 2));
  await browser?.close();
  preview.kill("SIGTERM");
  preview.stdout.destroy(); preview.stderr.destroy();
}
