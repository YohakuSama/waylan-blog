/** CI-only Chromium checks. Production ships no browser-testing dependency. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const origin = "http://127.0.0.1:4173";
const out = "visual-report";
const widths = [1440, 1280, 1279, 1200, 1120, 1119, 1024, 861, 860, 768, 767, 701, 700, 600, 390, 320];
const headerControls = [".header-search", ".shelf-trigger", ".notification-trigger", ".header-tools .settings-button"];
const routes = ["/", "/feed", "/archive", "/projects", "/about", "/post/a-room-on-the-internet", "/404"];
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
      await page.route("**/api/status", (route) => route.fulfill({ json: { notifications: false } }));
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
            return {
              viewport: document.documentElement.clientWidth,
              documentWidth: document.documentElement.scrollWidth,
              skin: document.documentElement.dataset.skin,
              theme: document.documentElement.dataset.theme,
              brand: select(".brand"),
              brandWordmark: select(".brand .brand-wordmark") || select(".brand .brand-term"),
              brandTagline: select(".brand .brand-tagline"),
              mottoQuote: select(".brand-motto-quote"),
              mottoText: document.querySelector(".brand-motto-quote")?.textContent?.trim(),
              mottoFont: getComputedStyle(document.querySelector(".brand-motto-quote")).fontFamily,
              footerBlog: select(".footer-blog-script"),
              footerBlogText: document.querySelector(".footer-blog-script")?.textContent?.trim(),
              footerBlogFont: getComputedStyle(document.querySelector(".footer-blog-script")).fontFamily,
              footerWordmark: select(".footer-brand .wordmark"),
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
                  selectedRadius: selected ? parseFloat(getComputedStyle(selected).borderTopLeftRadius) : null,
                } : null;
              })(),
              tools: select(".header-tools"),
              header: select(".site-header"), articleActions: select(".article-actions"), globalMenuButton: select(".reader-global-menu-trigger"), body: select(".site-body"),
              navigation: [...document.querySelectorAll(".nav-label")].map((el) => el.textContent),
              controls: headerControls.map(select),
              column: select(".content-grid .feed-column"), sidebar: select(".content-grid .site-sidebar"),
              heroAction: select(".hero-browse"),
              types: [...document.querySelectorAll(".type-tab")].filter((el) => el.getClientRects().length).map(rect),
              mobileType: select(".mobile-type-select"),
              mobileTypeOptions: document.querySelector(".mobile-type-select select")?.options.length,
              feedControls: select(".feed-controls"),
              meta: select(".entry-meta"), bookmark: select(".entry-meta .card-bookmark"),
              bookmarkOpacity: document.querySelector(".card-bookmark") && getComputedStyle(document.querySelector(".card-bookmark")).opacity,
              years: document.querySelectorAll(".archive-year").length,
              yearLinks: document.querySelectorAll(".archive-year-nav a").length,
              archiveOverview: !!document.querySelector(".timeline-overview"),
              archiveTitle: document.querySelector(".archive-heading h1")?.textContent,
              hero: select(".home-hero"),
              firstHeading: select(".home-feed .feed-body h2"),
              firstMedia: select(".feed-list .feed-media-link"),
              entryHeading: select(".feed-list .feed-body h2"),
              latestHeading: select("#latest-heading"),
              identity: select(".home-identity"),
              homeLinks: [...document.querySelectorAll(".home-links a")].map((el) => el.getAttribute("href")),
              homeTopicLink: select(".home-topic-link"),
              sideHeadingLinks: [...document.querySelectorAll(".content-grid .site-sidebar .side-heading-link")].map((el) => ({
                ...rect(el), href: el.getAttribute("href"), text: el.textContent.trim(),
              })),
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
              resume: select(".home-resume"),
              densityControls: [...document.querySelectorAll(".view-toggle button")].map(rect),
              resetLink: select(".feed-clear-filters"),
              homeHeadingBars: document.querySelectorAll(".home-feed-heading").length,
              archiveRows: document.querySelectorAll(".archive-row").length,
              archiveTypeCount: document.querySelectorAll(".archive-row .archive-type").length,
              archiveRowTarget: select(".archive-row"),
              archiveTopicTarget: select(".archive-summary a"),
              archiveYearTargets: [...document.querySelectorAll(".archive-year-nav a")].map(rect),
              archiveSummaryText: document.querySelector(".archive-summary")?.textContent || "",
              projectCount: document.querySelectorAll(".projects-layout .feed-item.is-project").length,
              projectStatusCount: document.querySelectorAll(".projects-layout .project-status").length,
              projectCodeLabels: [...document.querySelectorAll(".projects-layout .project-code")].map((el) => el.textContent.trim()),
              projectTags: [...document.querySelectorAll(".projects-layout .tag-list a")].map(rect),
              projectExternal: [...document.querySelectorAll(".projects-layout .project-facts a")].map(rect),
              projectSidebarBlockCount: document.querySelectorAll(".projects-layout .site-sidebar > .side-block").length,
              footerTargets: [...document.querySelectorAll(".footer-links a")].map(rect),
              footerCountText: document.querySelector(".footer-stats")?.textContent?.trim(),
              notFoundHeading: document.querySelector(".not-found h1")?.textContent?.trim(),
              notFoundLatest: [...document.querySelectorAll(".not-found .lost-latest a")].map(rect),
              notFoundActions: [...document.querySelectorAll(".not-found > a")].map(rect),
              aboutHeadingLevels: [...document.querySelectorAll(".about-details > div > h2")].map((el) => el.textContent.trim()),
              aboutStatsHeadingIsLink: !![...document.querySelectorAll(".about-layout .side-block .side-title")]
                .find((el) => el.textContent.trim() === "站点数据")?.querySelector("a"),
              aboutStatsLabel: document.querySelector(".about-layout .site-stats > div:first-child dd")?.textContent?.trim(),
              aboutSocialTargets: [...document.querySelectorAll(".about-text .social-links a")].map(rect),
              aboutCta: {
                text: document.querySelector(".about-text > .primary-button")?.textContent?.trim(),
                href: document.querySelector(".about-text > .primary-button")?.getAttribute("href"),
              },
              aboutSidebarBlockCount: document.querySelectorAll(".about-layout .site-sidebar > .side-block").length,
              archiveFilters: document.querySelectorAll(".archive-main .type-tabs").length,
              readerFont: document.querySelector(".reader-prose") && getComputedStyle(document.querySelector(".reader-prose")).fontSize,
            };
          }, headerControls);
          results.push({ route, width, ...variant, ...geometry });
          // Capture before assertions so a failing state is available to review.
          if ([1440, 768, 390, 320].includes(width))
            await page.screenshot({ path: `${out}/${label}.png`, animations: "disabled" });
          assert.equal(geometry.skin, variant.skin, `${label}: incorrect skin`);
          assert.equal(geometry.theme, variant.theme, `${label}: incorrect color mode`);
          assert.equal(geometry.footerTargets.length, 3, `${label}: footer links missing`);
          assert.ok(geometry.footerTargets.every((box) => box && box.height >= 44 &&
            box.left >= 0 && box.right <= geometry.viewport + 1),
            `${label}: footer link has a small or clipped touch target`);
          assert.match(geometry.footerCountText || "", /\d+ 条内容/,
            `${label}: mixed content mislabeled as articles`);
          assert.ok(geometry.documentWidth <= geometry.viewport + 1, `${label}: horizontal overflow`);
          assert.equal(geometry.mottoText, "Less, but better.", `${label}: attributed motto missing`);
          assert.ok(geometry.mottoQuote?.width >= 24 && geometry.mottoQuote.height >= 10,
            `${label}: motto clipped away from header`);
          assert.ok(geometry.mottoFont.includes("Waylan Great Vibes"), `${label}: motto lost script typeface`);
          assert.equal(geometry.footerBlogText, "Blog", `${label}: footer signature missing`);
          assert.ok(geometry.footerWordmark?.width > 40 && geometry.footerWordmark.height >= 25 &&
            geometry.footerBlog?.width >= 20 && geometry.footerBlog.height >= 20,
            `${label}: Waylan Blog signature hidden or split`);
          assert.ok(geometry.footerBlogFont.includes("Waylan Great Vibes"), `${label}: footer script typeface changed`);
          assert.ok(await page.evaluate(() => document.fonts.check('20px "Waylan Great Vibes"')),
            `${label}: local handwriting font did not load`);
          assert.deepEqual(geometry.navigation, ["首页", "内容", "归档", "项目", "关于"], `${label}: destination names changed`);
          if (isImmersive) {
            assert.ok(geometry.header && Math.abs(geometry.header.height-56)<=2,
              `${label}: Waylan masthead should remain a slim 56px row`);
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
            } else if (width > 370) {
              assert.ok(geometry.brand.right <= geometry.tools.left + 1, `${label}: brand overlaps header actions`);
            } else {
              assert.ok(geometry.brand.bottom <= geometry.tools.top + 2, `${label}: narrow-phone action row overlaps branding`);
            }
            assert.ok(geometry.brandTagline && geometry.brandWordmark, `${label}: missing wordmark or subtitle`);
            assert.equal(geometry.mobileTagline, null, `${label}: subtitle must not float to a detached mobile row`);
            assert.ok(geometry.brandTagline.left >= geometry.brandWordmark.right - 3 &&
              geometry.brandTagline.top < geometry.brandWordmark.bottom &&
              geometry.brandTagline.bottom > geometry.brandWordmark.top,
              `${label}: site identity must stay beside the wordmark`);
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
                assert.ok(["transparent", "rgba(0, 0, 0, 0)"].includes(chrome.headerBottomColor),
                  `${label}: rounded nav still has a visible full-width bottom border`);
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
                assert.ok(["transparent", "rgba(0, 0, 0, 0)"].includes(chrome.headerBottomColor),
                  `${label}: terminal header bottom line intrudes on page content`);
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
          if (geometry.bookmark) {
            assert.ok(geometry.bookmark.width >= 40 && geometry.bookmark.height >= 40, `${label}: small save target`);
            assert.equal(geometry.bookmarkOpacity, "1", `${label}: save target hidden`);
            assert.ok(geometry.bookmark.left >= geometry.meta.left && geometry.bookmark.right <= geometry.meta.right + 1,
              `${label}: save target escaped its metadata row`);
          }
          if (route === "/feed") {
            if (width < 1120) assert.equal(geometry.sidebar, null, `${label}: redundant feed sidebar should be hidden`);
            else assert.ok(geometry.sidebar, `${label}: desktop discovery rail disappeared`);
            assert.equal(geometry.resetLink, null, `${label}: reset filter appears without active filters`);
            if (width <= 767) {
              assert.equal(geometry.types.length, 0, `${label}: desktop type pills duplicate the phone picker`);
              assert.equal(geometry.mobileTypeOptions, 6, `${label}: phone picker lost content types`);
              assert.ok(geometry.feedControls && geometry.feedControls.height < 150,
                `${label}: phone filters consume too much of the first screen`);
              assert.ok(geometry.mobileType && geometry.mobileType.height >= 44 &&
                geometry.mobileType.left >= 0 && geometry.mobileType.right <= geometry.viewport,
                `${label}: missing/clipped phone type picker`);
            } else {
              assert.equal(geometry.types.length, 6, `${label}: missing tablet/desktop type filters`);
              assert.equal(geometry.mobileType, null, `${label}: duplicated type filter on wider screen`);
              assert.ok(geometry.types.every((tab) => tab && tab.left >= 0 &&
                tab.right <= geometry.viewport && tab.height >= 40), `${label}: clipped/small filter`);
            }
            assert.ok(geometry.densityControls.length === 2 && geometry.densityControls.every((box) => box && box.width >= 40 && box.height >= 40), `${label}: density preference cannot be changed`);
          }
          if (route === "/projects") {
            assert.equal(geometry.projectCount, 2, `${label}: missing project entries`);
            assert.equal(geometry.projectStatusCount, 2, `${label}: missing project status`);
            assert.ok(geometry.projectCodeLabels.every((text) => text.startsWith("项目 · ")),
              `${label}: unpublished slug looks like a public repository`);
            if (width < 1120)
              assert.equal(geometry.sidebar, null, `${label}: projects sidebar should not bury the footer`);
            else {
              assert.ok(geometry.sidebar, `${label}: wide-screen project navigation missing`);
              assert.equal(geometry.projectSidebarBlockCount, 2,
                `${label}: full-length sidebar returned to projects`);
            }
            if (width <= 767) {
              assert.ok(geometry.projectTags.length > 0 &&
                geometry.projectTags.every((box) => box && box.height >= 40 &&
                  box.left >= 0 && box.right <= geometry.viewport),
                `${label}: small or clipped project tags`);
              assert.ok(geometry.projectExternal.every((box) => box && box.height >= 44),
                `${label}: future project links need 44px targets`);
            }
          }
          if (route === "/about") {
            assert.deepEqual(geometry.aboutHeadingLevels, ["写作主题", "技术实现", "隐私与数据"],
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
            if (width < 1120)
              assert.equal(geometry.sidebar, null,
                `${label}: redundant about sidebar extends the narrow-screen page`);
            else {
              assert.ok(geometry.sidebar, `${label}: wide-screen about rail vanished`);
              assert.equal(geometry.aboutSidebarBlockCount, 4,
                `${label}: about rail content changed unexpectedly`);
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
            assert.ok(geometry.archiveYearTargets.every((box) => box?.height >= 44), `${label}: archive year link has a small click target`);
            assert.equal(geometry.archiveTitle, "归档", `${label}: archive label inconsistent`);
            assert.equal(geometry.archiveOverview, false, `${label}: obsolete archive card returned`);
            if (geometry.years === 1) assert.equal(geometry.yearLinks, 0, `${label}: isolated year button returned`);
          }
          if (route === "/") {
            assert.equal(geometry.homeHeadingBars, 0, `${label}: detached update bar returned`);
            assert.ok(geometry.hero && geometry.hero.height <= 380, `${label}: introduction dominates the first screen`);
            assert.ok(geometry.identity && geometry.identity.height > 10, `${label}: blog identity missing`);
            assert.ok(geometry.latestHeading && geometry.latestHeading.height > 20, `${label}: latest section heading hidden`);
            assert.ok(geometry.homeLinks.includes("/about") && geometry.homeLinks.includes("/rss.xml"), `${label}: essential blog entry points buried in sidebar`);
            assert.ok(geometry.sideHeadingLinks.length >= 2 &&
              geometry.sideHeadingLinks.every((link) => link.width > 44 && link.height >= 44),
              `${label}: sidebar heading not fully tappable`);
            if (width < 1120)
              assert.ok(geometry.homeTopicLink && geometry.homeTopicLink.height >= 44 &&
                geometry.homeLinks.includes("/feed"), `${label}: stacked sidebar buried topic discovery`);
            else assert.equal(geometry.homeTopicLink, null, `${label}: redundant topic shortcut beside visible sidebar`);
            assert.ok(geometry.homeDensity?.includes("density-full"), `${label}: library density leaked into home`);
            assert.equal(geometry.homeEntryCount, 6, `${label}: homepage became a full library`);
            assert.ok(geometry.resume && geometry.resume.width <= geometry.viewport, `${label}: resume entry missing or clipped`);
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
            await page.getByRole("button", { name: "展开文章目录", exact: true }).click();
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
                  return { top: r.top, bottom: r.bottom, height: r.height };
                }),
                navScrollable: nav ? getComputedStyle(nav).overflowY === "auto" : false,
              };
            });
            assert.ok(tocLayout.navScrollable && tocLayout.navBottom <= tocLayout.footerTop + 1,
              `${label}: directory list must scroll separately from the footer`);
            assert.equal(tocLayout.buttons.length, 2, `${label}: directory requires two distinct footer actions`);
            assert.ok(tocLayout.buttons.every((b) => b.height >= 44) &&
              tocLayout.buttons[0].bottom <= tocLayout.buttons[1].top + 1 &&
              tocLayout.footerBottom <= 480,
              `${label}: directory actions overlap or escape the viewport`);
            if (width <= 700) assert.ok(bounds.y >= 100,
              `${label}: phone directory should open near the bottom, not over the article heading`);
            assert.equal(await toc.locator("nav a").first().evaluate((el) => el === document.activeElement), true, `${label}: directory focus missing`);
            await page.screenshot({ path: `${out}/${label}-directory.png`, animations: "disabled" });
            await page.keyboard.press("Escape");
            await toc.waitFor({ state: "hidden" });
            assert.equal(await page.locator(".article-action-toc").evaluate((el) => el === document.activeElement), true, `${label}: directory Escape lost focus`);
            await page.getByRole("button", { name: "展开文章目录", exact: true }).click();
            await toc.getByRole("button", { name: "回到页首" }).click();
            await toc.waitFor({ state: "hidden" });
            assert.equal(await page.locator(".article-action-toc").evaluate((el) => el === document.activeElement), true,
              `${label}: back-to-top must close the directory and restore focus`);
            await page.setViewportSize({ width, height: 900 });
          }
          if (route.startsWith("/post/") && [320, 390, 768, 1440].includes(width) &&
              variant.skin === "editorial" && variant.theme === "light") {
            const more = page.getByRole("button", { name: "展开更多操作", exact: true });
            await more.click();
            const panel = page.locator(".article-more-panel:not([hidden])");
            await panel.waitFor();
            const box = await panel.boundingBox();
            assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1,
              `${label}: more actions escape viewport`);
            assert.ok(await panel.locator("button").first().evaluate((el) => el === document.activeElement),
              `${label}: more menu must focus its first action`);
            await page.keyboard.press("Escape");
            await panel.waitFor({ state: "hidden" });
            assert.ok(await more.evaluate((el) => el === document.activeElement),
              `${label}: Escape must restore focus to more trigger`);
            await more.click();
            await panel.getByRole("button", { name: "切换正文为20px" }).click();
            assert.equal(await page.locator(".reader-prose").evaluate((el) => el.style.getPropertyValue("--reader-font")), "20px",
              `${label}: font-size quick control did not update the article`);
            assert.equal(await page.evaluate(() => localStorage.getItem("echo:font-size")), "20",
              `${label}: font-size preference did not persist`);
            await more.click();
            await panel.getByRole("button", { name: "跳到评论" }).click();
            assert.ok(await page.locator("#discussion").evaluate((el) => el === document.activeElement),
              `${label}: comment shortcut did not move keyboard focus`);
            await page.waitForFunction(() => window.scrollY > 300, null, { timeout: 5000 });
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
            await page.screenshot({ path: `${out}/${label}-settings.png`, animations: "disabled" });
            await close.click();
            await settings.waitFor({ state: "hidden" });
          }
          // On the phone, verify the heading text itself and the compact hero
          // topic doorway navigate, not just the small arrow glyph.
          if (route === "/" && width === 390 && variant.skin === "editorial" && variant.theme === "light") {
            await page.locator(".home-sidebar .side-heading-link").first().click({ position: { x: 80, y: 22 } });
            await page.waitForURL("**/feed");
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
          await page.route("**/api/status", (route) => route.fulfill({ json: { notifications: true } }));
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
          await page.route("**/api/status", (route) => route.fulfill({ status: 503, json: { error: "unavailable" } }));
          await page.reload({ waitUntil: "domcontentloaded" });
          const retryBell = page.getByRole("button", { name: "消息通知", exact: true });
          await retryBell.click();
          await page.getByText("暂时无法读取通知，请重试。", { exact: true }).waitFor();
          const errorBounds = await inbox.boundingBox();
          notificationResults.push({ width, ...variant, state: "error", bounds: errorBounds });
          assert.ok(errorBounds && errorBounds.x >= 0 && errorBounds.x + errorBounds.width <= width && errorBounds.y + errorBounds.height <= 900,
            `${label}: error panel escaped viewport`);
          await page.route("**/api/status", (route) => route.fulfill({ json: { notifications: true } }));
          await inbox.getByRole("button", { name: "重试", exact: true }).click();
          await inbox.getByRole("button", { name: "使用 GitHub 登录", exact: true }).waitFor();
          assert.deepEqual(errors, [], `${label}: browser runtime error`);
        }
      } finally { await context.close(); }
    }
  }
  console.log(`Visual geometry checks passed: ${results.length} page/viewport/appearance combinations plus ${notificationResults.length} enabled/error inbox states and retry, including persistent navigation, page-state isolation and theme position parity.`);
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
