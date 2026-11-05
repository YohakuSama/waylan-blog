import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createElement, act } from "react";
import type { Root } from "react-dom/client";
import App from "../src/App";
import { fragmentId, isAppRoute, routeMotionDirection } from "../src/lib/router";
import Reader from "../src/components/Reader";
import worker from "../worker/index";
import { metadata, posts, structuredData, typeLabels } from "../src/lib/data";
import { invalidateComments } from "../src/lib/api";
let dom: JSDOM,
  root: Root,
  y = 0;
const pause = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
async function settle(ms = 25) {
  await act(async () => {
    await pause(ms);
  });
}
async function click(element: Element | null) {
  assert(element, "missing interactive element");
  await act(async () => {
    element.dispatchEvent(
      new dom.window.MouseEvent("click", {
        bubbles: true,
        button: 0,
        cancelable: true,
      }),
    );
    await pause(30);
  });
}
async function mount(path = "/") {
  dom.window.history.replaceState(null, "", path);
  const { createRoot } = await import("react-dom/client");
  root = createRoot(document.getElementById("root")!);
  await act(async () => {
    root.render(
      createElement(App, { initialPath: path.split("?")[0], reader: Reader }),
    );
    await pause(30);
  });
  await settle();
}
beforeEach(async () => {
  invalidateComments();
  dom = new JSDOM(
    '<!doctype html><html><head><meta name="description"><link rel="canonical"><script id="structured-data" type="application/ld+json"></script></head><body><div id="root"></div></body></html>',
    { url: "https://echo.test/", pretendToBeVisual: true },
  );
  y = 0;
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    history: dom.window.history,
    navigator: dom.window.navigator,
    sessionStorage: dom.window.sessionStorage,
    localStorage: dom.window.localStorage,
    NodeFilter: dom.window.NodeFilter,
    Range: dom.window.Range,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const matches = (query: string) => ({
    matches: true,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  Object.defineProperty(dom.window, "matchMedia", { value: matches });
  Object.defineProperty(globalThis, "matchMedia", {
    value: matches,
    configurable: true,
  });
  Object.defineProperty(dom.window, "scrollY", { get: () => y });
  Object.defineProperty(dom.window, "scrollTo", {
    value: (options: ScrollToOptions) => {
      y = options.top || 0;
    },
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0),
    configurable: true,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: clearTimeout,
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    value() {},
    configurable: true,
  });
  Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", {
    value: () => ({
      top: 180,
      left: 30,
      bottom: 204,
      right: 300,
      width: 270,
      height: 24,
    }),
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "showModal", {
    value: function () {
      this.setAttribute("open", "");
    },
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "close", {
    value: function () {
      this.removeAttribute("open");
    },
    configurable: true,
  });
  mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) =>
      worker.fetch(
        new Request(new URL(String(input), "https://echo.test"), init),
        {},
      ),
  );
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  mock.restoreAll();
  dom.window.close();
});
describe("React navigation and reading interactions (DOM integration, not browser layout)", () => {
  it("keeps comments neutral and the result slot stable until the initial request resolves", async () => {
    const post = posts[0];
    const originalFetch = globalThis.fetch;
    let resolveComments!: (response: Response) => void;
    const deferred = new Promise<Response>((resolve) => { resolveComments = resolve; });
    mock.method(globalThis, "fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === `/api/posts/${post.id}/comments`
        ? deferred
        : originalFetch(input, init),
    );
    await mount("/post/" + post.slug);
    const section = document.querySelector(".discussion-section")!;
    assert.ok(section.querySelector(".comment-skeleton"), "initial request must show a loading placeholder");
    assert.ok(section.querySelector(".discussion-results"), "loading and settled content share a stable slot");
    assert.ok(section.querySelector(".discussion-action-placeholder"));
    assert.doesNotMatch(section.textContent || "", /还没有评论|公开讨论尚未连接|评论暂时还没有开放/);
    await act(async () => {
      resolveComments(Response.json({
        nodes: [], totalCount: 0,
        pageInfo: { hasNextPage: false, endCursor: null },
        mapped: true,
        discussionUrl: "https://github.com/example/repo/discussions/1",
      }));
      await pause(40);
    });
    assert.equal(section.querySelector(".comment-skeleton"), null);
    assert.match(section.querySelector(".discussion-empty")?.textContent || "", /还没有评论/);
    assert.ok(section.querySelector(".discussion-source"), "real discussion link appears after resolution");
    assert.ok(section.querySelector(".discussion-title button"), "comment composer only appears when mapped");
  });
  it("reverses top-navigation motion when going from projects to content or home", () => {
    assert.equal(routeMotionDirection("/", "/projects"), "forward");
    assert.equal(routeMotionDirection("/feed", "/projects"), "forward");
    assert.equal(routeMotionDirection("/projects", "/feed"), "back");
    assert.equal(routeMotionDirection("/feed", "/"), "back");
    assert.equal(routeMotionDirection("/projects", "/"), "back");
    assert.equal(routeMotionDirection("/feed", "/post/a-room-on-the-internet"), "forward");
    assert.equal(routeMotionDirection("/post/a-room-on-the-internet", "/feed"), "back");
    assert.equal(routeMotionDirection("/feed", "/projects", true), "back");
  });
  it("routes pages but leaves static assets and admin URLs to the browser", () => {
    for (const path of ["/", "/feed", "/archive", "/projects",
      "/about", "/privacy", "/404", "/post/a-room-on-the-internet"])
      assert.equal(isAppRoute(path), true, path);
    for (const path of ["/feed/", "/admin", "/admin/", "/api/status",
      "/art/room.svg", "/assets/index.js", "/images/photo.png", "/post/note.md",
      "/post/old-redirected-slug"])
      assert.equal(isAppRoute(path), false, path);
  });
  it("ignores malformed hash escapes instead of throwing during navigation", () => {
    assert.equal(fragmentId("#year-2026"), "year-2026");
    assert.equal(fragmentId("#hello%20world"), "hello world");
    assert.equal(fragmentId("#%E0%A4%A"), null);
    assert.equal(fragmentId("#bad%"), null);
  });
  it("keeps the 404 page usable for malformed percent-encoded URLs", async () => {
    await mount("/post/%E0%A4%A");
    assert.equal(document.querySelector(".not-found h1")?.textContent, "页面不存在");
    assert.ok(document.querySelector('.not-found a[href="/"]'), "return-home link should remain available");
  });
  it("opens the content world and filters real content by topic", async () => {
    await mount();
    await click(
      [...document.querySelectorAll("a")].find((a) =>
        a.textContent?.includes("浏览全部内容"),
      )!,
    );
    assert.equal(location.pathname, "/feed");
    assert.equal(location.search, "", "the content destination must need no query string");
    assert.equal(document.querySelectorAll(".post-card").length, Math.min(8, posts.length));
    await click(
      [...document.querySelectorAll(".filter-tabs button")].find(
        (b) => b.textContent === "随笔",
      )!,
    );
    assert.equal(location.search, "?topic=notes");
    assert.equal(document.querySelectorAll(".post-card").length,
      posts.filter((p) => p.topic === "notes").length);
  });
  it("restores the filtered feed and its saved scroll position after reading", async () => {
    await mount("/feed");
    await click(
      [...document.querySelectorAll(".filter-tabs button")].find(
        (b) => b.textContent === "随笔",
      )!,
    );
    y = 730;
    await click(document.querySelector(".post-card-link"));
    assert.ok(location.pathname.startsWith("/post/"));
    assert.ok(document.querySelector(".reader-prose"));
    assert.equal(y, 0);
    await click(document.querySelector(".reader-back"));
    await settle(50);
    assert.equal(location.pathname, "/feed");
    assert.equal(location.search, "?topic=notes");
    assert.equal(y, 730);
    assert.equal(document.querySelectorAll(".post-card").length,
      posts.filter((p) => p.topic === "notes").length);
  });
  it("restores loaded feed batches and scroll when coming back from a later post", async () => {
    await mount("/feed");
    assert.ok(posts.length > 8, "test requires several feed batches");
    assert.equal(document.querySelectorAll(".feed-list .feed-item").length, 8);
    await click(document.querySelector(".feed-layout .load-more"));
    await settle(80);
    assert.equal(document.querySelectorAll(".feed-list .feed-item").length, posts.length);
    assert.equal(JSON.parse(sessionStorage.getItem("echo:feed-limit:/feed") || "0"), posts.length);
    y = 1250;
    const lastEntry = [...document.querySelectorAll(".feed-list .feed-item .post-card-link")].at(-1);
    assert.ok(lastEntry);
    await click(lastEntry);
    assert.ok(location.pathname.startsWith("/post/"));
    await click(document.querySelector(".reader-back"));
    await settle(140);
    assert.equal(location.pathname, "/feed");
    assert.equal(document.querySelectorAll(".feed-list .feed-item").length, posts.length,
      "returning must restore the expanded list before restoring its scroll");
    assert.equal(y, 1250);
    assert.equal(document.querySelector(".feed-layout button.load-more"), null,
      "the already loaded records must not require a second click");
    assert.match(document.querySelector(".reader-back")?.textContent || "", /^$/, "reader must be unmounted");
  });
  it("returns to the homepage that opened a post instead of the last feed", async () => {
    await mount("/");
    const entry = document.querySelector<HTMLAnchorElement>(".home-list .post-card-link");
    assert.ok(entry, "homepage should include a working article link");
    await click(entry);
    assert.ok(location.pathname.startsWith("/post/"));
    const neighbor = document.querySelector<HTMLAnchorElement>(
      '.article-neighbors a[href^="/post/"]',
    );
    if (neighbor) await click(neighbor);
    await click(document.querySelector(".reader-back"));
    await settle(100);
    assert.equal(location.pathname, "/", "return must honor the actual starting page");
  });
  it("returns to the original filtered list after visiting neighboring articles", async () => {
    await mount("/feed?topic=notes");
    const first = document.querySelector<HTMLAnchorElement>(".post-card-link")!;
    assert.ok(first, "filtered list should contain a post");
    await click(first);
    const firstPath = location.pathname;
    assert.ok(firstPath.startsWith("/post/"));
    const neighbor = document.querySelector<HTMLAnchorElement>(
      '.article-neighbors a[href^="/post/"]',
    )!;
    assert.ok(neighbor, "article has a previous/next article");
    await click(neighbor);
    assert.ok(location.pathname.startsWith("/post/"));
    assert.notEqual(location.pathname, firstPath);
    await click(document.querySelector(".reader-back"));
    await settle(100);
    assert.equal(location.pathname, "/feed",
      "the Return to list control must skip already-read neighboring articles");
    assert.equal(location.search, "?topic=notes",
      "return-to-list should preserve the originating filter");
  });
  it("keeps the native reduced-motion preference usable without View Transitions", async () => {
    let transitions = 0;
    (document as any).startViewTransition = () => {
      transitions++;
    };
    await mount();
    await click(document.querySelector(".hero-browse"));
    assert.equal(location.pathname, "/feed");
    assert.equal(transitions, 0);
  });
  it("changes between collections and articles without overlapping native snapshots", async () => {
    document.documentElement.dataset.motionPreference = "full";
    Object.defineProperty(globalThis, "matchMedia", {
      value: () => ({ matches: false }),
      configurable: true,
    });
    let nativeCalls = 0;
    (document as any).startViewTransition = () => {
      nativeCalls++;
      throw new Error("route navigation must not create an old/new page snapshot");
    };
    await mount();
    await click(document.querySelector(".hero-browse"));
    assert.equal(location.pathname, "/feed");
    await click(document.querySelector(".post-card-link"));
    assert.ok(document.querySelector(".reader-prose"));
    await click(document.querySelector(".reader-back"));
    await settle(45);
    assert.equal(location.pathname, "/feed");
    assert.equal(nativeCalls, 0);
    assert.equal(document.querySelector(".shared-cover-ghost"), null);
  });
  it("keeps primary navigation distinct from content-type filters", async () => {
    await mount();
    const nav = [...document.querySelectorAll<HTMLAnchorElement>("#site-nav .nav-link")];
    assert.deepEqual(nav.map((link) => link.querySelector(".nav-label")?.textContent?.trim()),
      ["首页", "内容", "归档", "项目", "关于"]);
    assert.deepEqual(nav.map((link) => link.getAttribute("href")),
      ["/", "/feed", "/archive", "/projects", "/about"]);
    assert.ok(!document.querySelector(".home-feed .type-tabs"));
    await click(nav[1]);
    assert.equal(document.querySelectorAll(".type-tabs .type-tab").length, 6);
    assert.ok(document.querySelector(".topic-select select"));
    assert.ok(document.querySelectorAll(".filter-tabs button").length > 1);
  });
  it("treats the archive as a chronological index, not a second type-filtered feed", async () => {
    await mount("/archive");
    assert.equal(document.querySelector(".page-heading h1")?.textContent, "归档");
    assert.equal(document.querySelectorAll(".archive-main .type-tabs").length, 0);
    assert.equal(document.querySelectorAll(".archive-main .filter-tabs").length, 0);
    assert.equal(document.querySelectorAll(".archive-row").length, posts.length);
    assert.match(document.querySelector(".archive-summary")?.textContent || "", /共 \d+ 条记录/);
    const expectedYears = [...new Set(posts.map((post) => post.date.slice(0, 4)))];
    const years = [...document.querySelectorAll<HTMLAnchorElement>(".archive-year-nav a")];
    assert.equal(years.length, expectedYears.length > 1 ? expectedYears.length : 0);
    assert.equal(document.querySelector(".timeline-overview"), null);
    for (const year of expectedYears) {
      if (expectedYears.length > 1) assert.ok(years.some((a) => a.getAttribute("href") === "#year-" + year));
      assert.ok(document.getElementById("year-" + year));
    }
    assert.ok(document.querySelector(".archive-month-label"));
    const all = [...document.querySelectorAll<HTMLAnchorElement>(".archive-row")];
    assert.deepEqual(
      all.map((a) => a.getAttribute("href")).sort(),
      posts.map((p) => "/post/" + p.slug).sort(),
    );
    assert.ok(document.querySelector('.archive-summary a[href="/feed"]'));
    for (const row of all) {
      const slug = row.getAttribute("href")!.split("/").at(-1);
      const entry = posts.find((p) => p.slug === slug);
      assert.ok(entry, "archive row must resolve a real post");
      assert.equal(row.querySelector(".archive-type")?.textContent, typeLabels[entry.type]);
    }
  });
  it("navigates synthetic multi-year anchors with correct hash targets", async () => {
    // Production currently contains only 2026. Add a fixture for the duration
    // of this DOM test; never modify published content or generated JSON.
    const fixture = {
      ...posts[0],
      id: "archive-year-test-only",
      slug: "archive-year-test-only",
      date: "2025-12-31",
      title: "跨年度导航测试",
    };
    posts.push(fixture);
    try {
      await mount("/archive");
      const links = [...document.querySelectorAll<HTMLAnchorElement>(".archive-year-nav a")];
      assert.deepEqual(links.map((link) => link.textContent?.trim()), ["2026", "2025"]);
      assert.deepEqual(
        [...document.querySelectorAll(".archive-year > h2 > span")].map((el) => el.textContent?.trim()),
        [`${posts.length - 1} 条`, "1 条"],
        "multi-year counts must describe mixed records, not articles",
      );
      assert.ok(document.querySelector('.archive-row[href="/post/archive-year-test-only"]'));
      const jumps: string[] = [];
      Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
        value: function(this: HTMLElement) { jumps.push(this.id); },
        configurable: true,
      });
      await click(links[1]);
      await settle(90);
      assert.equal(location.pathname + location.hash, "/archive#year-2025");
      assert.ok(jumps.includes("year-2025"), "the 2025 section should receive the scroll action");
      await click(links[0]);
      await settle(90);
      assert.equal(location.hash, "#year-2026");
      assert.ok(jumps.includes("year-2026"), "the 2026 section should receive the scroll action");
    } finally {
      const index = posts.indexOf(fixture);
      if (index !== -1) posts.splice(index, 1);
    }
  });
  it("restores archive scroll when returning from an article", async () => {
    await mount("/archive");
    y = 680;
    const item = document.querySelectorAll<HTMLAnchorElement>(".archive-row")[7];
    assert.ok(item);
    await click(item);
    assert.ok(location.pathname.startsWith("/post/"));
    assert.equal(y, 0, "the reader should start at its own page top");
    await click(document.querySelector(".reader-back"));
    await settle(90);
    assert.equal(location.pathname, "/archive");
    assert.equal(y, 680, "archive should restore the original list position");
    assert.equal(document.querySelectorAll(".archive-row").length, posts.length);
  });
  it("retains old content-type URLs while making /feed the unfiltered destination", async () => {
    await mount("/feed?type=note");
    assert.equal(document.querySelector(".page-heading h1")?.textContent, "笔记");
    assert.ok([...document.querySelectorAll(".feed-item")]
      .every((item) => item.classList.contains("is-note")));
    const all = [...document.querySelectorAll(".type-tabs .type-tab")]
      .find((item) => item.textContent?.startsWith("全部"))!;
    await click(all);
    assert.equal(location.pathname, "/feed");
    assert.equal(location.search, "");
    assert.equal(document.querySelector(".page-heading h1")?.textContent, "全部内容");
  });
  it("keeps destinations and reading tools in separate navigation groups", async () => {
    await mount();
    assert.equal(document.querySelectorAll("#site-nav a").length, 5);
    assert.equal(document.querySelectorAll(".mobile-menu").length, 0);
    assert.ok(document.querySelector('.header-tools[aria-label="全站工具"]'));
    await click(document.querySelector('#site-nav a[href="/projects"]'));
    assert.equal(document.querySelector('#site-nav [aria-current="page"]')?.textContent?.includes("项目"), true);
    assert.equal(document.querySelector('#site-nav a[href="/feed"]')?.getAttribute("aria-current"), null);
  });
  it("separates the reading list from saving the current article", async () => {
    await mount("/post/a-room-on-the-internet");
    const save=document.querySelector<HTMLButtonElement>(".article-actions .article-action-save")!;
    assert.ok(save);
    assert.match(save.textContent || "", /收藏本文|已收藏/);
    assert.equal(document.querySelectorAll(".article-actions .bookmark-button").length,1);
    assert.ok(document.querySelector(".site-header-reader .header-tools > .shelf-trigger"),
      "reading list remains a direct site shortcut separate from the post bookmark");
    assert.ok(document.querySelector(".site-header-reader .header-tools .notification-trigger"));
    assert.ok(document.querySelector(".site-header-reader .header-tools > .settings-button"));
    assert.equal(document.querySelector(".reader-global-menu-trigger"), null,
      "article header must not collapse the site shortcuts into another menu");
  });
  it("keeps the entry to reading light and the save/share actions at the end", async () => {
    await mount("/post/a-room-on-the-internet");
    const actions = document.querySelector<HTMLElement>(".article-actions")!;
    assert.equal(actions.querySelectorAll("button").length, 2,
      "article header should expose only the contents/reading-tools link and a save control");
    assert.ok(!/分享|更多/.test(actions.textContent || ""),
      "sharing and extra font controls must not occupy the article introduction");
    const closing = document.querySelector<HTMLElement>(".reading-end-actions")!;
    assert.ok(closing.querySelector<HTMLButtonElement>(".reading-end-save"));
    assert.ok(closing.querySelector<HTMLButtonElement>(".reading-end-share"));
    assert.match(closing.textContent || "", /收藏本文|已收藏/);
    assert.match(closing.textContent || "", /分享文章/);
    assert.ok(document.querySelector(".site-header-reader .settings-button"),
      "reader font size remains available in the global settings");
  });
  it("uses tap-to-excerpt mode without triggering iOS native text selection", async () => {
    await mount("/post/a-room-on-the-internet");
    const toggle = document.querySelector<HTMLButtonElement>(
      '.toc-excerpt-toggle[aria-label^="开启摘录段落模式"]',
    )!;
    assert.ok(toggle);
    await click(toggle);
    assert.equal(document.querySelector(".toc-excerpt-toggle")?.getAttribute("aria-pressed"), "true",
      "the excerpt toggle must retain an accessible pressed state in the contents panel");
    assert.match(document.querySelector(".reading-article [role=\"status\"]")?.textContent || "", /摘录模式已开启/);
    assert.equal(window.getSelection()?.toString(), "");
    const paragraph = document.querySelector<HTMLElement>(
      '.reader-prose .article-block[data-type="paragraph"]',
    ) || document.querySelector<HTMLElement>(
      '.reader-prose .article-block:not([data-type="code"])',
    );
    assert.ok(paragraph);
    await click(paragraph);
    assert.ok(document.querySelector(".selection-toolbar"));
    assert.ok(document.querySelector(".selection-toolbar-context"));
    assert.ok(document.querySelector(".selection-toolbar-actions"));
    assert.ok(document.querySelector(".toc-excerpt-toggle[aria-pressed=\"true\"]"));
    await click(document.querySelector<HTMLButtonElement>(
      '.selection-toolbar button[aria-label="关闭摘录工具栏"]',
    ));
    assert.equal(document.querySelector(".selection-toolbar"), null);
    assert.match(document.querySelector(".reading-article [role=\"status\"]")?.textContent || "", /摘录模式已开启/);
    await click(paragraph);
    const mark = [...document.querySelectorAll(".selection-toolbar-actions button")]
      .find((b) => b.textContent === "划线")!;
    await click(mark);
    assert.ok(document.querySelector("mark.private-mark"), "tap mode retains the usual persisted quote");
  });
  it("keeps a visible excerpt selected on scroll and allows retapping an already marked passage", async () => {
    await mount("/post/a-room-on-the-internet");
    await click(document.querySelector<HTMLButtonElement>(".toc-excerpt-toggle"));
    const paragraph = document.querySelector<HTMLElement>(
      '.reader-prose .article-block[data-type="paragraph"]',
    )!;
    assert.ok(paragraph);
    await click(paragraph);
    assert.equal(paragraph.dataset.excerptSelected, "true",
      "selected paragraph must have a persistent, visible UI state");
    await act(async () => {
      window.dispatchEvent(new dom.window.Event("scroll"));
      await pause(80);
    });
    assert.ok(document.querySelector(".selection-toolbar"),
      "explicit excerpt selection must remain available after scrolling");
    const mark = [...document.querySelectorAll<HTMLButtonElement>(
      ".selection-toolbar-actions button",
    )].find(button => button.textContent === "划线")!;
    await click(mark);
    assert.equal(paragraph.dataset.excerptSelected, undefined);
    const highlighted = document.querySelector<HTMLElement>(
      ".reader-prose mark.private-mark",
    )!;
    assert.ok(highlighted);
    await click(highlighted);
    assert.equal(document.querySelector(".discussion-dialog[open]"), null,
      "retapping a marked paragraph while excerpt mode is active should not open a separate discussion");
    assert.ok(document.querySelector(".selection-toolbar"),
      "retapping the marked text should select its paragraph again");
    await click(document.querySelector<HTMLButtonElement>(
      '.selection-toolbar button[aria-label="关闭摘录工具栏"]',
    ));
    await act(async () => {
      highlighted.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true,
      }));
      await pause(30);
    });
    assert.ok(document.querySelector(".selection-toolbar"),
      "Enter on a saved mark in excerpt mode must reselect instead of opening a thread");
    assert.equal(document.querySelector(".discussion-dialog[open]"), null);
  });
  it("stores a private highlight and restores it on a fresh React mount", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!,
      range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    const button = [
      ...document.querySelectorAll(".selection-toolbar button"),
    ].find((b) => b.textContent === "划线");
    await click(button!);
    assert.equal(
      document.querySelector("mark.private-mark")?.textContent,
      p.textContent!.slice(0, 12),
    );
    await act(async () => root.unmount());
    document.getElementById("root")!.innerHTML = "";
    window.getSelection()!.removeAllRanges();
    await mount("/post/a-room-on-the-internet");
    assert.equal(document.querySelectorAll("mark.private-mark").length, 1);
  });
  it("moves selection actions with Safari visualViewport and clears offsets on close", async () => {
    const viewport = Object.assign(new dom.window.EventTarget(), {
      offsetTop: 0,
      height: 760,
    });
    Object.defineProperty(dom.window, "innerHeight", { value: 900, configurable: true });
    Object.defineProperty(dom.window, "visualViewport", { value: viewport, configurable: true });
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    assert.ok(document.querySelector(".selection-toolbar"), "selection tray must appear");
    const rootStyle = document.documentElement.style;
    assert.equal(rootStyle.getPropertyValue("--waylan-selection-view-bottom"), "140px");
    assert.equal(rootStyle.getPropertyValue("--waylan-selection-view-height"), "760px");
    viewport.height = 650;
    viewport.offsetTop = 28;
    viewport.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(rootStyle.getPropertyValue("--waylan-selection-view-bottom"), "222px",
      "expanded Safari chrome must update the tray without waiting for another tap");
    assert.equal(rootStyle.getPropertyValue("--waylan-selection-view-height"), "650px");
    viewport.offsetTop = 42;
    viewport.dispatchEvent(new dom.window.Event("scroll"));
    assert.equal(rootStyle.getPropertyValue("--waylan-selection-view-bottom"), "208px",
      "scrolling browser chrome should keep the tray inside the visible viewport");
    await click(document.querySelector(".selection-toolbar button[aria-label='关闭摘录工具栏']"));
    assert.equal(rootStyle.getPropertyValue("--waylan-selection-view-bottom"), "");
    assert.equal(rootStyle.getPropertyValue("--waylan-selection-view-height"), "");
  });
  it("captures a pressed toolbar pointer if Safari shifts its position mid-gesture", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    const button = [...document.querySelectorAll<HTMLButtonElement>(".selection-toolbar-actions button")]
      .find((b) => b.textContent === "复制")!;
    assert.ok(button);
    let captured: number | null = null;
    button.setPointerCapture = (id) => { captured = id; };
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (content: string) => { copied.push(content); },
    } });
    const pointer = (type: string) => {
      const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(e, {
        pointerType: { value: "touch" },
        pointerId: { value: 17 },
      });
      button.dispatchEvent(e);
    };
    await act(async () => {
      pointer("pointerdown");
      await pause(20);
    });
    assert.equal(captured, 17, "the first touch must lock pointerup to the same button");
    assert.equal(copied.length, 0, "copy awaits user activation at pointerup");
    await act(async () => {
      pointer("pointerup");
      await pause(20);
    });
    assert.deepEqual(copied, [p.textContent!.slice(0, 12)],
      "the first gesture must copy once despite simulated button movement");
  });
  it("does not dismiss the touch selection toolbar on transient selectionchange", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    assert.ok(document.querySelector(".selection-toolbar"));
    window.getSelection()!.removeAllRanges();
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(240);
    assert.ok(document.querySelector(".selection-toolbar"),
      "Safari may collapse the native selection while the action tray is being tapped");
  });
  it("preserves a touch selection as a visual highlight without the native edit overlay", async () => {
    const custom = new Map<string, { range: Range }>();
    Object.defineProperty(dom.window, "CSS", {
      configurable: true, value: { highlights: custom },
    });
    Object.defineProperty(dom.window, "Highlight", {
      configurable: true,
      value: class {
        range: Range;
        constructor(range: Range) { this.range = range; }
      },
    });
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    const quote = range.toString();
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    assert.ok(document.querySelector(".selection-toolbar"), "quote actions must remain available");
    assert.equal(window.getSelection()!.rangeCount, 0,
      "WebKit edit handles must be released after retaining the quote");
    assert.equal(custom.get("waylan-selected-quote")?.range.toString(), quote,
      "the exact chosen text must remain visibly highlighted without modifying the DOM");
    await click(document.querySelector(".selection-toolbar button[aria-label='关闭摘录工具栏']"));
    assert.equal(custom.has("waylan-selected-quote"), false,
      "closing the toolbar must not leave a ghost quote highlight");
  });
  it("copies on the first touch gesture even when Safari never dispatches click", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { copied.push(text); },
    } });
    const button = [...document.querySelectorAll(".selection-toolbar-actions button")]
      .find((b) => b.textContent === "复制")!;
    assert.ok(button);
    const down = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
    Object.defineProperty(down, "pointerType", { value: "touch" });
    await act(async () => {
      button.dispatchEvent(down);
      await pause(30);
    });
    assert.equal(copied.length, 0,
      "clipboard must wait for the pointerup that grants transient user activation");
    const up = new dom.window.Event("pointerup", { bubbles: true, cancelable: true });
    Object.defineProperty(up, "pointerType", { value: "touch" });
    await act(async () => {
      button.dispatchEvent(up);
      await pause(30);
    });
    assert.deepEqual(copied, [p.textContent!.slice(0, 12)]);
    assert.equal(down.defaultPrevented, true,
      "prevent the native edit overlay from reclaiming the touch");
    assert.ok(document.querySelector(".selection-toolbar"),
      "copy should not dismiss the selected quote");
    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent("click", {
        bubbles: true, cancelable: true, detail: 1,
      }));
      await pause(20);
    });
    assert.equal(copied.length, 1, "compatibility click must not copy twice");
    await act(async () => {
      button.dispatchEvent(new dom.window.MouseEvent("click", {
        bubbles: true, cancelable: true, detail: 0,
      }));
      await pause(20);
    });
    assert.equal(copied.length, 2, "keyboard click remains independently accessible");
  });
  it("executes first-press highlight and comment actions without waiting for click", async () => {
    const firstPress = async (name: string) => {
      const p = [...document.querySelectorAll(".reader-prose p")].find((node) =>
        node.firstChild?.nodeType === 3 && (node.firstChild.textContent?.length || 0) >= 10,
      )!;
      assert.ok(p, "a still-unmarked text node must be selectable");
      const range = document.createRange();
      range.setStart(p.firstChild!, 0);
      range.setEnd(p.firstChild!, 10);
      window.getSelection()!.removeAllRanges();
      window.getSelection()!.addRange(range);
      document.dispatchEvent(new dom.window.Event("selectionchange"));
      await settle(360);
      const button = [...document.querySelectorAll(".selection-toolbar-actions button")]
        .find((b) => b.textContent === name)!;
      assert.ok(button, name + " must appear on first selection");
      const down = new dom.window.Event("pointerdown", { bubbles: true, cancelable: true });
      Object.defineProperty(down, "pointerType", { value: "touch" });
      await act(async () => {
        button.dispatchEvent(down);
        await pause(30);
      });
    };
    await mount("/post/a-room-on-the-internet");
    await firstPress("划线");
    assert.ok(document.querySelector("mark.private-mark"),
      "mark must persist from the first pointerdown");
    await firstPress("评论");
    assert.ok(document.querySelector("dialog.composer-dialog[open]"),
      "composer must open on the first pointerdown");
  });
  it("shares on touchend when Safari sends touch events without pointer or click", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    const copies: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: async (text: string) => { copies.push(text); },
    } });
    const button = [...document.querySelectorAll(".selection-toolbar-actions button")]
      .find((b) => b.textContent === "分享")!;
    assert.ok(button);
    const start = new dom.window.Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(start, "touches", { value: [{ identifier: 7 }] });
    await act(async () => {
      button.dispatchEvent(start);
      await pause(30);
    });
    assert.equal(copies.length, 0, "share must wait for touchend user activation");
    const end = new dom.window.Event("touchend", { bubbles: true, cancelable: true });
    Object.defineProperty(end, "changedTouches", { value: [{ identifier: 7 }] });
    await act(async () => {
      button.dispatchEvent(end);
      await pause(30);
    });
    assert.equal(copies.length, 1, "share fallback must run on the first touch gesture");
    assert.ok(copies[0].includes("/post/a-room-on-the-internet"));
  });
  it("dismisses the selected-text tray and native range on a deliberate blank tap", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    assert.ok(document.querySelector(".selection-toolbar"));
    // A real short touch tap outside the selection should close both UIs.
    const blank = document.querySelector(".article-heading")!;
    const pointer = (type: string, x: number) => {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerType: { value: "touch" },
        clientX: { value: x },
        clientY: { value: 180 },
      });
      blank.dispatchEvent(event);
    };
    await act(async () => {
      pointer("pointerdown", 15);
      pointer("pointerup", 15);
      blank.dispatchEvent(new dom.window.MouseEvent("click", {
        bubbles: true, cancelable: true, detail: 1,
      }));
      await pause(30);
    });
    assert.equal(document.querySelector(".selection-toolbar"), null);
    assert.equal(window.getSelection()?.toString(), "");
    // A fresh gesture must immediately re-arm selection, not wait for
    // the old native range's suppression window to expire.
    pointer("pointerdown", 18);
    pointer("pointerup", 38);
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    assert.ok(document.querySelector(".selection-toolbar"));
    // Selection-handle movement is not a short tap even if WebKit emits click.
    await act(async () => {
      pointer("pointerdown", 15);
      pointer("pointerup", 38);
      blank.dispatchEvent(new dom.window.MouseEvent("click", {
        bubbles: true, cancelable: true, detail: 1,
      }));
      await pause(30);
    });
    assert.ok(document.querySelector(".selection-toolbar"),
      "dragging text-selection handles must not dismiss the toolbar");
    // Touching the toolbar actions themselves should not dismiss it.
    await click(document.querySelector(".selection-toolbar-context"));
    assert.ok(document.querySelector(".selection-toolbar"));
    // Blank tap inside the article (not just above it) also dismisses.
    await click(document.querySelector(".article-block-shell"));
    assert.equal(document.querySelector(".selection-toolbar"), null);
  });
  it("closes selected text on the first touch pointerup even when Safari suppresses click", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    assert.ok(document.querySelector(".selection-toolbar"));
    const blank = document.querySelector(".article-heading")!;
    const pointer = (type: string, x: number) => {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerType: { value: "touch" },
        clientX: { value: x },
        clientY: { value: 120 },
      });
      blank.dispatchEvent(event);
    };
    await act(async () => {
      pointer("pointerdown", 18);
      // The first touch clears the native range: WebKit may not fire click.
      window.getSelection()!.removeAllRanges();
      pointer("pointerup", 18);
      await pause(30);
    });
    assert.equal(document.querySelector(".selection-toolbar"), null,
      "the first pointerup must dismiss the custom tray without needing click");
    await settle(320);
    assert.equal(document.querySelector(".selection-toolbar"), null,
      "a delayed selectionchange scan must not reopen the dismissed tray");
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    assert.ok(document.querySelector(".selection-toolbar"));
    await act(async () => {
      pointer("pointerdown", 18);
      pointer("pointerup", 35);
      await pause(30);
    });
    assert.ok(document.querySelector(".selection-toolbar"),
      "touch selection-handle dragging must not count as a tap");
  });
  it("does not reselect the tapped paragraph while dismissing an excerpt-mode toolbar", async () => {
    await mount("/post/a-room-on-the-internet");
    await click(document.querySelector(".toc-excerpt-toggle"));
    const paragraph = document.querySelector(".reader-prose .article-block[data-type='paragraph']")!;
    await click(paragraph);
    assert.ok(document.querySelector(".selection-toolbar"));
    const pointer = (type: string) => {
      const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerType: { value: "touch" },
        clientX: { value: 180 },
        clientY: { value: 270 },
      });
      paragraph.dispatchEvent(event);
    };
    await act(async () => {
      pointer("pointerdown");
      pointer("pointerup");
      paragraph.dispatchEvent(new dom.window.MouseEvent("click", {
        bubbles: true, detail: 1, cancelable: true,
      }));
      await pause(30);
    });
    assert.equal(document.querySelector(".selection-toolbar"), null,
      "the same tap must not immediately select the paragraph again");
    await click(paragraph);
    assert.ok(document.querySelector(".selection-toolbar"),
      "a subsequent deliberate tap must still reselect the paragraph");
  });
  it("deleting the final private mark closes its thread instead of opening the composer", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    await click([...document.querySelectorAll(".selection-toolbar button")].find(
      (button) => button.textContent === "划线",
    )!);
    const mark = document.querySelector("mark.private-mark")!;
    await click(mark);
    assert.ok(document.querySelector(".discussion-dialog.thread-dialog[open]"));
    await click(document.querySelector('[aria-label="删除私人划线"]'));
    await settle(220);
    assert.equal(document.querySelector(".discussion-dialog[open]"), null);
    assert.equal(document.querySelector(".discussion-dialog.composer-dialog[open]"), null);
    assert.equal(document.querySelector("mark.private-mark"), null);
  });
  it("keeps mobile thread controls above a shrinking Safari visual viewport and reports failed mark deletion", async () => {
    const viewport = Object.assign(new dom.window.EventTarget(), {
      height: 540,
      offsetTop: 0,
    });
    Object.defineProperty(dom.window, "innerHeight", { value: 900, configurable: true });
    Object.defineProperty(dom.window, "visualViewport", { value: viewport, configurable: true });
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    await click([...document.querySelectorAll(".selection-toolbar button")].find(
      (button) => button.textContent === "划线",
    )!);
    await click(document.querySelector("mark.private-mark"));
    assert.ok(document.querySelector(".discussion-dialog.thread-dialog[open]"));
    assert.equal(document.activeElement, document.querySelector(".discussion-dialog.thread-dialog[open]"),
      "opening a thread must focus the dialog rather than outlining its close button");
    const rootStyle = document.documentElement.style;
    assert.equal(rootStyle.getPropertyValue("--waylan-thread-view-bottom"), "360px");
    assert.equal(rootStyle.getPropertyValue("--waylan-thread-view-height"), "540px");
    viewport.height = 620;
    viewport.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(rootStyle.getPropertyValue("--waylan-thread-view-bottom"), "280px");
    viewport.offsetTop = 25;
    viewport.dispatchEvent(new dom.window.Event("scroll"));
    assert.equal(rootStyle.getPropertyValue("--waylan-thread-view-bottom"), "255px");
    const blocked = mock.method(dom.window.Storage.prototype, "setItem", () => {
      throw new Error("Storage access denied");
    });
    await click(document.querySelector('[aria-label="删除私人划线"]'));
    assert.ok(document.querySelector("mark.private-mark"), "failed deletion must retain the highlight");
    assert.ok(document.querySelector(".discussion-dialog.thread-dialog[open]"),
      "failed deletion must leave retry controls accessible");
    assert.match(document.querySelector(".toast")?.textContent || "", /删除失败/);
    blocked.mock.restore();
    await click(document.querySelector('[aria-label="删除私人划线"]'));
    await settle(280);
    assert.equal(document.querySelector("mark.private-mark"), null);
    assert.equal(document.querySelector(".discussion-dialog[open]"), null);
    assert.equal(rootStyle.getPropertyValue("--waylan-thread-view-bottom"), "");
    assert.equal(rootStyle.getPropertyValue("--waylan-thread-view-height"), "");
  });
  it("copies selected text on desktop without invoking the flashing system share sheet", async () => {
    await mount("/post/a-room-on-the-internet");
    let copied = "";
    let nativeCalls = 0;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => { nativeCalls++; throw new Error("NotAllowedError: share unavailable"); },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value: string) => { copied = value; } },
    });
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    await click([...document.querySelectorAll(".selection-toolbar button")].find(
      (button) => button.textContent === "分享",
    )!);
    assert.ok(copied.includes("/post/a-room-on-the-internet"));
    assert.ok(copied.includes(p.textContent!.slice(0, 12)));
    assert.equal(nativeCalls, 0, "desktop must not open the unreliable native share sheet");
  });
  it("anchors 水合一致性 to its own heading rather than 稳定的标识", async () => {
    await mount("/post/a-room-on-the-internet");
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".reader-toc nav a")];
    const hydration = links.find((a) => a.textContent === "水合一致性")!;
    const stable = links.find((a) => a.textContent === "稳定的标识")!;
    assert.ok(hydration && stable);
    assert.notEqual(hydration.hash, stable.hash, "separate headings need distinct anchors");
    await click(hydration);
    await settle(60);
    assert.equal(document.activeElement?.id, "h-hydration");
    assert.equal(document.querySelector(".reader-toc nav a.active")?.textContent, "水合一致性");
  });
  it("keeps a long-press tray after WebKit's touch pointerup and viewport scroll", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    assert.ok(document.querySelector(".selection-toolbar"));
    window.getSelection()!.removeAllRanges();
    const up = new dom.window.Event("pointerup", { bubbles: true });
    Object.defineProperty(up, "pointerType", { value: "touch" });
    p.dispatchEvent(up);
    window.dispatchEvent(new dom.window.Event("scroll"));
    await settle(520);
    assert.ok(document.querySelector(".selection-toolbar"),
      "long-press selection must survive the native menu's transient collapse and scroll");
  });
  it("opens a genuine selection in the composer and clearly disables unavailable GitHub login", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!,
      range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 12);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    await click(
      [...document.querySelectorAll(".selection-toolbar button")].find(
        (b) => b.textContent === "评论",
      )!,
    );
    assert.ok(document.querySelector(".discussion-dialog[open]"));
    assert.equal(
      document.querySelector(".panel-original blockquote")?.textContent,
      p.textContent!.slice(0, 12),
    );
    const login = [
      ...document.querySelectorAll<HTMLButtonElement>(
        ".login-invitation button",
      ),
    ][0];
    assert.equal(login.disabled, true);
    assert.ok(document.documentElement.classList.contains("dialog-open"));
    await click(
      document.querySelector('.discussion-dialog .dialog-header button[aria-label="关闭"]'),
    );
    await settle(200);
    assert.equal(document.querySelector(".discussion-dialog[open]"), null);
    assert.equal(
      document.documentElement.classList.contains("dialog-open"),
      false,
    );
  });
  it("offers centered immersive writing and a searchable categorized emoji picker", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!,
      range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 8);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    await click([...document.querySelectorAll(".selection-toolbar button")].find(
      (b) => b.textContent === "评论",
    )!);
    const dialog = document.querySelector(".discussion-dialog[open]")!;
    assert.ok(dialog.classList.contains("composer-dialog"));
    await click(dialog.querySelector('button[aria-label="进入全屏编辑"]'));
    assert.ok(dialog.classList.contains("composer-fullscreen"));
    await click(dialog.querySelector('button[aria-label="退出全屏编辑"]'));
    assert.equal(dialog.classList.contains("composer-fullscreen"), false);
    await click(dialog.querySelector('button[aria-label="选择表情"]'));
    const choices = document.querySelectorAll(".markdown-emoji-picker .emoji-grid button");
    assert.ok(choices.length >= 25);
    const input = document.querySelector<HTMLInputElement>('.emoji-search input')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "火箭");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await pause(20);
    });
    assert.ok(document.querySelectorAll(".emoji-grid button").length >= 1);
    await click(document.querySelector(".emoji-grid button"));
    assert.ok(document.querySelector<HTMLTextAreaElement>("#echo-comment")!.value.includes("🚀"));
  });
  it("previews the same safe Markdown formatting as published comments", async () => {
    await mount("/post/a-room-on-the-internet");
    const p = document.querySelector(".reader-prose p")!;
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 8);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new dom.window.Event("selectionchange"));
    await settle(360);
    await click([...document.querySelectorAll(".selection-toolbar button")].find(
      (button) => button.textContent === "评论",
    )!);
    const area = document.querySelector<HTMLTextAreaElement>("#echo-comment")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(area, "**重要**、`代码`与[链接](https://example.com)");
      area.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await pause(30);
    });
    await click([...document.querySelectorAll(".composer-hint button")].find(
      (button) => button.textContent === "效果预览",
    )!);
    const preview = document.querySelector("#echo-preview");
    assert.ok(preview);
    assert.equal(preview.querySelector("strong")?.textContent, "重要");
    assert.equal(preview.querySelector("code")?.textContent, "代码");
    assert.equal(preview.querySelector("a")?.getAttribute("rel"), "nofollow noopener noreferrer");
    assert.equal(preview.closest(".comment-composer")?.getAttribute("data-preview"), "true");
    const composer = preview.closest(".comment-composer")!;
    const dialog = composer.closest(".composer-dialog")!;
    const login = dialog.querySelector(".login-invitation.composer-bottom");
    assert.ok(login && login.parentElement === dialog && !composer.contains(login),
      "unauthenticated publishing must stay in the fixed footer outside scrollable editor content");
  });
  it("opens an annotated reply outside the first comments page by fetching its own deep endpoint", async () => {
    const post = posts[0],
      block = post.blocks[0];
    const annotation = {
      id: "C_late_reply",
      commentId: "C_late_reply",
      anchor: {
        schema: 1,
        postId: post.id,
        version: post.version,
        segments: [
          {
            blockId: block.id,
            quote: {
              type: "TextQuoteSelector",
              exact: block.text.slice(0, 12),
              prefix: "",
              suffix: block.text.slice(12, 44),
            },
            position: { type: "TextPositionSelector", start: 0, end: 12 },
          },
        ],
      },
    };
    const originalFetch = globalThis.fetch;
    mock.method(
      globalThis,
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.endsWith("/annotations"))
          return Response.json({ nodes: [annotation], nextCursor: null });
        if (path.endsWith("/comments/C_late_reply"))
          return Response.json({
            comment: {
              id: "C_late_reply",
              body: "测试夹具：这是第一页之外的一条回复。",
              author: {
                login: "fixture-reader",
                avatarUrl: "https://avatars.githubusercontent.com/u/1",
                url: "https://github.com/fixture-reader",
              },
              url: "https://github.com/example/repo/discussions/1",
              createdAt: "2026-10-31T10:00:00Z",
              updatedAt: "2026-10-31T10:00:00Z",
              parentId: "C_parent",
              annotation,
            },
          });
        if (path.endsWith("/comments"))
          return Response.json({
            nodes: [],
            totalCount: 21,
            pageInfo: { hasNextPage: true, endCursor: "cursor1" },
            mapped: true,
            discussionUrl: "https://github.com/example/repo/discussions/1",
          });
        return originalFetch(input, init);
      },
    );
    await mount("/post/" + post.slug);
    await click(document.querySelector('mark[data-echo-ids="C_late_reply"]'));
    await settle(50);
    assert.ok(
      document
        .querySelector(".discussion-dialog[open] .comment-item")
        ?.textContent?.includes("这是第一页之外的一条回复"),
    );
    assert.equal(
      document.querySelector(".discussion-dialog .panel-original blockquote")
        ?.textContent,
      block.text.slice(0, 12),
    );
    await click(
      document.querySelector(".discussion-dialog .comment-actions button"),
    );
    assert.ok(
      document
        .querySelector(".replying-to")
        ?.textContent?.includes("fixture-reader"),
    );
  });
  it("restores the draft, quotation and original paragraph after an OAuth round trip", async () => {
    const post = posts[0],
      block = post.blocks[0];
    let destination = "";
    Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
      value: function () {
        destination = (this as HTMLElement).dataset.blockId || "";
      },
      configurable: true,
    });
    const anchor = {
      schema: 1,
      postId: post.id,
      version: post.version,
      segments: [
        {
          blockId: block.id,
          quote: {
            type: "TextQuoteSelector",
            exact: block.text.slice(0, 12),
            prefix: "",
            suffix: block.text.slice(12, 44),
          },
          position: { type: "TextPositionSelector", start: 0, end: 12 },
        },
      ],
    };
    sessionStorage.setItem(
      "echo:draft:" + post.id,
      JSON.stringify({
        body: "登录前还没发出的想法。",
        anchor,
        replyTo: null,
        requestId: crypto.randomUUID(),
        resume: true,
      }),
    );
    await mount("/post/" + post.slug);
    await settle(40);
    assert.ok(document.querySelector(".discussion-dialog[open]"));
    assert.equal(
      document.querySelector<HTMLTextAreaElement>("#echo-comment")?.value,
      "登录前还没发出的想法。",
    );
    assert.equal(
      document.querySelector(".panel-original blockquote")?.textContent,
      block.text.slice(0, 12),
    );
    assert.equal(destination, block.id);
  });
  it("keeps home editorial while the dedicated content page owns type filters", async () => {
    await mount();
    assert.equal(document.querySelectorAll(".home-feed .type-tabs").length, 0);
    assert.equal(document.querySelectorAll(".home-feed-heading").length, 0);
    assert.equal(document.querySelector("#latest-heading")?.textContent, "最新内容");
    assert.equal(document.querySelector("#latest-heading")?.classList.contains("sr-only"), false);
    assert.match(document.querySelector(".home-identity")?.textContent || "", /Waylan 的个人博客/);
    assert.ok(document.querySelector('.home-links a[href="/about"]'));
    assert.ok(document.querySelector('.home-links a[href="/rss.xml"]'));
    await click(document.querySelector(".hero-browse"));
    const tabs = [...document.querySelectorAll(".type-tabs .type-tab")];
    const count = (label: string) =>
      Number(
        tabs
          .find((t) => t.textContent?.startsWith(label))
          ?.querySelector(".tab-count")?.textContent,
      );
    assert.equal(count("全部"), posts.length);
    assert.equal(count("笔记"), posts.filter((p) => p.type === "note").length);
    assert.equal(count("项目"), posts.filter((p) => p.type === "project").length);
    // First batch only, then the rest on demand.
    assert.equal(document.querySelectorAll(".feed-item").length, Math.min(8, posts.length));
    await click(document.querySelector(".load-more"));
    assert.equal(document.querySelectorAll(".feed-item").length, posts.length);
    await click(tabs.find((t) => t.textContent?.startsWith("笔记"))!);
    const items = [...document.querySelectorAll(".feed-item")];
    assert.equal(items.length, posts.filter((p) => p.type === "note").length);
    assert.ok(items.every((i) => i.classList.contains("is-note")));
    assert.ok(document.querySelector(".is-note .code-thumb"));
  });
  it("keeps reading tips available without an always-expanded home sidebar panel", async () => {
    await mount("/");
    const tip = document.querySelector<HTMLDetailsElement>(".home-reading-note")!;
    assert.ok(tip && !tip.open, "help should be collapsed until requested");
    assert.match(tip.textContent || "", /书签/);
    assert.ok(document.querySelector('.home-links a[href="/about"]'),
      "about remains visible in the primary introduction");
    await click(tip.querySelector("summary"));
    assert.ok(tip.open, "the explanation remains accessible on demand");
  });
  it("keeps an active search as a single removable result chip, not a third filter-row control", async () => {
    await mount("/feed?q=D1");
    assert.equal(document.querySelectorAll(".query-chip").length, 1);
    const chip = document.querySelector<HTMLAnchorElement>(".feed-result-line .query-chip")!;
    assert.ok(chip, "search status must stay next to the result count");
    assert.match(chip.textContent || "", /D1/);
    assert.equal(document.querySelectorAll(".feed-search-row .query-chip").length, 0);
    await click(chip);
    assert.equal(new URLSearchParams(location.search).has("q"), false);
  });
  it("supports the same content types through the compact phone selector and desktop tabs", async () => {
    await mount("/feed");
    const select = document.querySelector(".mobile-type-select select") as unknown as HTMLSelectElement;
    assert.equal(select.options.length, 6);
    assert.equal(select.value, "all");
    await act(async () => {
      select.value = "note";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await pause(30);
    });
    assert.equal(new URLSearchParams(location.search).get("type"), "note");
    assert.equal(select.value, "note");
    assert.ok([...document.querySelectorAll(".feed-item")].every((x) => x.classList.contains("is-note")));
    await act(async () => {
      select.value = "all";
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await pause(30);
    });
    assert.equal(location.pathname, "/feed");
    assert.equal(new URLSearchParams(location.search).has("type"), false);
    assert.equal(select.value, "all");
    assert.equal(document.querySelectorAll(".type-tabs .type-tab").length, 6);
  });
  it("keeps home newest-first and editorial after changing library sort and density", async () => {
    await mount("/feed");
    const newest = document.querySelector(".feed-item time")?.getAttribute("datetime");
    await click(document.querySelector('button[aria-label="紧凑列表"]'));
    const select = document.querySelector('.sort-control select') as unknown as HTMLSelectElement;
    await act(async () => { select.value = "oldest"; select.dispatchEvent(new dom.window.Event("change", { bubbles: true })); await pause(30); });
    assert.ok(location.search.includes("sort=oldest"));
    assert.notEqual(document.querySelector(".feed-item time")?.getAttribute("datetime"), newest);
    await click(document.querySelector('#site-nav a[href="/"]'));
    assert.ok(document.querySelector(".home-list.density-full"));
    assert.equal(document.querySelector(".home-list time")?.getAttribute("datetime"), newest);
    assert.equal(document.querySelectorAll(".home-feed .feed-item").length, Math.min(6, posts.length));
    assert.equal(document.querySelectorAll(".home-feed button.load-more").length, 0);
    await click(document.querySelector('#site-nav a[href="/feed"]'));
    assert.ok(document.querySelector(".feed-list.density-compact"));
  });
  it("lets readers restore the full list after a saved compact preference", async () => {
    localStorage.setItem("echo:density", JSON.stringify("compact"));
    await mount("/feed");
    assert.ok(document.querySelector(".feed-list.density-compact"));
    await click(document.querySelector('button[aria-label="图文 · 详细列表"]'));
    assert.ok(document.querySelector(".feed-list.density-full"));
    assert.equal(JSON.parse(localStorage.getItem("echo:density") || "null"), "full");
  });
  it("focuses the touch reading directory and restores its trigger on dismissal", async () => {
    await mount("/post/a-room-on-the-internet");
    const trigger = document.querySelector<HTMLButtonElement>('.article-action-toc')!;
    await click(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement, document.querySelector('.reader-toc nav a'));
    await act(async () => {
      document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);
    await click(trigger);
    await click(document.querySelector('button[aria-label="关闭目录"]'));
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);
    await click(trigger);
    const sectionLink = document.querySelector<HTMLAnchorElement>('.reader-toc nav a')!;
    const section = document.getElementById(sectionLink.hash.slice(1));
    await click(sectionLink);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, section);
  });
  it("adds a tag to the current content filters without losing type, topic or sort", async () => {
    const post = posts.find((p) => p.type === "article" && p.tags.length)!;
    assert.ok(post, "test data needs a tagged article");
    await mount(`/feed?type=article&topic=${post.topic}&sort=oldest`);
    const link = document.querySelector<HTMLAnchorElement>(
      `#card-${post.id} .tag-list a`,
    )!;
    assert.ok(link, "scoped post must be reachable");
    const expectedTag = post.tags[0];
    const target = new URL(link.href);
    assert.equal(target.pathname, "/feed");
    assert.equal(target.searchParams.get("type"), "article");
    assert.equal(target.searchParams.get("topic"), post.topic);
    assert.equal(target.searchParams.get("sort"), "oldest");
    assert.equal(target.searchParams.get("tag"), expectedTag);
    await click(link);
    await settle();
    const selected = new URLSearchParams(location.search);
    assert.equal(selected.get("tag"), expectedTag);
    assert.equal(selected.get("type"), "article");
    assert.equal(selected.get("topic"), post.topic);
    assert.equal(selected.get("sort"), "oldest");
    await click(document.querySelector(".feed-clear-filters"));
    assert.equal(location.pathname, "/feed");
    assert.equal(location.search, "");
  });
  it("shows no reset link by default and keeps feed sidebar section headings honest", async () => {
    await mount("/feed");
    assert.equal(document.querySelector(".feed-clear-filters"), null);
    const headings = [...document.querySelectorAll(".feed-layout .side-head")];
    assert.ok(headings.length >= 3);
    for (const name of ["写作主题", "站内导航"]) {
      const heading = headings.find((el) => el.textContent?.includes(name))!;
      assert.ok(heading?.querySelector(".side-heading-static"), `${name} must not link to itself`);
      assert.equal(heading.querySelector("a"), null);
    }
    assert.equal(document.querySelector('.feed-layout .side-heading-link[href="/feed"]'), null);
    assert.equal(document.querySelector('.feed-layout .popular-block a[href="/archive"]'), null);
    assert.ok(document.querySelector('.feed-layout .recent-list a[href^="/post/"]'));
  });
  it("leaves homepage article tags as independent whole-site tag links", async () => {
    await mount("/");
    const tag = document.querySelector<HTMLAnchorElement>(".home-list .tag-list a")!;
    assert.ok(tag);
    assert.match(tag.getAttribute("href") || "", /^\/feed\?tag=/);
  });
  it("filters by tag across content types and keeps permalinks stable", async () => {
    const tag = posts.find((p) => p.type !== "article" && p.tags.length)!.tags[0];
    await mount("/feed?tag=" + encodeURIComponent(tag));
    const expected = posts.filter((p) => p.tags.includes(tag));
    const links = [...document.querySelectorAll<HTMLAnchorElement>(".feed-item .post-card-link")];
    assert.equal(links.length, expected.length);
    assert.deepEqual(
      links.map((a) => a.getAttribute("href")).sort(),
      expected.map((p) => `/post/${p.slug}`).sort(),
    );
  });
  it("lists projects on their own page with status and stack, without invented links", async () => {
    await mount("/projects");
    const projects = posts.filter((p) => p.type === "project");
    assert.equal(document.querySelectorAll(".feed-item.is-project").length, projects.length);
    assert.ok(document.querySelector(".is-project .stack-list li"));
    const external = [...document.querySelectorAll<HTMLAnchorElement>(".is-project .project-facts a")];
    assert.equal(
      external.length,
      projects.reduce((n, p) => n + Number(!!p.project?.repo) + Number(!!p.project?.demo), 0),
    );
    assert.equal(
      document.querySelector("#site-nav .selected .nav-label")?.textContent,
      "项目",
    );
  });
  it("keeps project details, bookmarks and return position across both project readers", async () => {
    await mount("/projects");
    const projects = posts.filter((p) => p.type === "project").sort((a, b) => b.date.localeCompare(a.date));
    assert.equal(document.querySelectorAll(".projects-layout .feed-item.is-project").length, projects.length);
    assert.equal(document.querySelectorAll(".projects-sidebar .profile-block").length, 0);
    assert.equal(document.querySelectorAll(".projects-sidebar .side-block").length, 2);
    for (const project of projects) {
      const card = document.getElementById(`card-${project.id}`)!;
      assert.ok(card);
      assert.match(card.querySelector(".project-code")?.textContent || "", /^项目 · /);
      assert.ok(card.querySelector(".project-status"));
      assert.equal(card.querySelectorAll(".stack-list li").length, project.project!.stack.length);
      const bookmark = card.querySelector<HTMLButtonElement>(".card-bookmark")!;
      await click(bookmark);
      assert.equal(bookmark.getAttribute("aria-pressed"), "true");
      y = 640;
      await click(card.querySelector(".post-card-link"));
      assert.equal(location.pathname, `/post/${project.slug}`);
      assert.equal(y, 0);
      await click(document.querySelector(".reader-back"));
      await settle(90);
      assert.equal(location.pathname, "/projects");
      assert.equal(y, 640, "return to projects must restore the original scroll");
      assert.equal(document.getElementById(`card-${project.id}`)?.querySelector(".card-bookmark")?.getAttribute("aria-pressed"), "true");
    }
    const tag = document.querySelector<HTMLAnchorElement>(".projects-layout .tag-list a")!;
    assert.ok(tag);
    const destination = tag.getAttribute("href")!;
    assert.match(destination, /^\/feed\?tag=/);
    await click(tag);
    assert.equal(location.pathname, "/feed");
    assert.ok(new URLSearchParams(location.search).has("tag"));
    // The reading shelf keeps in-process state beyond individual JSDOM
    // instances; clear the test bookmarks through the real UI so later
    // tests still start with an empty shelf.
    await click(document.querySelector(".shelf-trigger"));
    const clear = document.querySelector(".shelf-footer .confirm-button");
    await click(clear);
    await click(clear);
    assert.equal(document.querySelectorAll(".shelf-items li").length, 0);
  });
  it("only renders project repo/demo actions when real URLs exist, with safe new-tab links", async () => {
    const source = posts.find((p) => p.type === "project")!;
    const fixture = {
      ...source,
      id: "project-external-fixture",
      slug: "project-external-fixture",
      title: "项目外链测试",
      project: { ...source.project!, repo: "https://github.com/example/project", demo: "https://demo.example.com/" },
    };
    posts.push(fixture);
    try {
      await mount("/projects");
      const card = document.getElementById("card-project-external-fixture")!;
      assert.ok(card, "temporary project must be visible without modifying production data");
      const links = [...card.querySelectorAll<HTMLAnchorElement>(".project-facts a")];
      assert.deepEqual(links.map((a) => a.href), [fixture.project.repo, fixture.project.demo]);
      for (const link of links) {
        assert.equal(link.target, "_blank");
        assert.ok(link.rel.split(/\s+/).includes("noreferrer"));
      }
      assert.match(card.querySelector(".project-code")?.textContent || "", /^仓库 · /);
    } finally {
      const at = posts.indexOf(fixture);
      if (at !== -1) posts.splice(at, 1);
    }
  });
  it("keeps about sections, stats, navigation and social destinations semantically accurate", async () => {
    await mount("/about");
    assert.equal(document.querySelector(".page-heading h1")?.textContent, "关于");
    assert.ok(document.querySelector(".about-layout .about-prose h2"));
    assert.deepEqual(
      [...document.querySelectorAll(".about-details > div > h2")].map((h) => h.textContent?.trim()),
      ["写作主题", "技术实现"],
    );
    assert.equal(document.querySelectorAll(".about-details > div > h3").length, 0);
    assert.ok(document.querySelectorAll(".about-details > div > ul > li").length > 0);
    const stats = document.querySelector(".about-layout .site-stats");
    assert.ok(stats);
    assert.match(stats.querySelector("div:first-child dd")?.textContent || "", /^\d+条$/);
    const heading = [...document.querySelectorAll(".about-layout .side-block .side-title")]
      .find((el) => el.textContent?.trim() === "站点数据");
    assert.ok(heading);
    assert.equal(heading.querySelector("a"), null, "stats should not imply that archive is a data dashboard");
    assert.ok(heading.querySelector(".side-heading-static"));
    const github = document.querySelector<HTMLAnchorElement>('.about-text .social-links a');
    assert.ok(github);
    assert.equal(github.getAttribute("href"), "https://github.com/YohakuSama");
    assert.equal(github.textContent?.trim(), "GitHub");
    assert.equal(github.target, "_blank");
    for (const flag of ["noopener", "noreferrer"])
      assert.ok(github.rel.split(/\s+/).includes(flag), "missing external-link protection: " + flag);
    assert.equal(document.querySelector(".about-text > .primary-button")?.textContent?.trim(), "浏览全部内容");
    assert.equal(document.querySelector(".about-text > .primary-button")?.getAttribute("href"), "/feed");
    assert.equal(document.querySelector("#site-nav .selected .nav-label")?.textContent, "关于");
  });
  it("keeps the privacy notice on its own route and leaves About uncluttered", async () => {
    await mount("/about");
    assert.equal(document.querySelector(".about-details > div")?.textContent?.includes("隐私与数据"), false);
    assert.equal(document.querySelector(".about-prose")?.textContent?.includes("保存期限"), false);
    const footerLink = document.querySelector<HTMLAnchorElement>('.site-footer a[href="/privacy"]');
    assert.ok(footerLink, "privacy is available from the footer without a new header tab");
    await click(footerLink);
    assert.equal(location.pathname, "/privacy");
    assert.equal(document.querySelector(".page-heading h1")?.textContent, "隐私说明");
    assert.equal(document.querySelectorAll(".privacy-page section h2").length, 6);
    assert.match(document.querySelector(".privacy-page")?.textContent || "", /Cloudflare Web Analytics/);
    assert.match(document.querySelector(".privacy-page")?.textContent || "", /GitHub Discussions/);
    assert.equal(document.querySelector(".about-details"), null);
  });
  it("returns to the about reading position after opening the complete feed", async () => {
    await mount("/about");
    y = 960;
    await click(document.querySelector(".about-text > .primary-button"));
    assert.equal(location.pathname, "/feed");
    assert.equal(y, 0);
    await act(async () => {
      dom.window.history.back();
      await pause(85);
    });
    await settle(90);
    assert.equal(location.pathname, "/about");
    assert.ok(document.querySelector(".about-prose"));
    assert.equal(y, 960, "browser back should restore about reading position");
  });
  it("allows full motion to be selected when the system preference reduces it", async () => {
    await mount();
    await click(document.querySelector(".settings-button"));
    assert.ok(document.querySelector(".settings-dialog[open]"));
    await click(document.querySelector('.motion-choice input[value="full"]'));
    assert.equal(document.documentElement.dataset.motion, "full");
    assert.equal(localStorage.getItem("echo:motion"), JSON.stringify("full"));
    await click(document.querySelector(".settings-dialog .dialog-header button"));
    await settle(30);
    assert.equal(document.querySelector(".settings-dialog[open]"), null);
  });
  it("bookmarks a post into the reading shelf and clears it with a two-step confirm", async () => {
    await mount();
    const save = document.querySelector(".card-bookmark") as HTMLButtonElement;
    assert.ok(save);
    await click(save);
    assert.equal(save.getAttribute("aria-pressed"), "true");
    assert.equal(JSON.parse(localStorage.getItem("waylan:reading-list:v1") || "[]").length, 1);
    assert.equal(document.querySelector(".shelf-count")?.textContent, "1");
    await click(document.querySelector(".shelf-trigger"));
    assert.equal(document.querySelectorAll(".shelf-items li").length, 1);
    const clear = document.querySelector(".shelf-footer .confirm-button") as HTMLButtonElement;
    await click(clear);
    assert.equal(document.querySelectorAll(".shelf-items li").length, 1, "first press only arms");
    await click(clear);
    assert.equal(document.querySelectorAll(".shelf-items li").length, 0);
    assert.equal(document.querySelector(".shelf-count"), null);
  });
  it("does not display unsaved bookmarks or silently discard saved items when storage writes fail", async () => {
    await mount();
    const bookmark = document.querySelector<HTMLButtonElement>(".card-bookmark")!;
    const warning = mock.method(dom.window, "alert", () => {});
    const failWrite = () => { throw new Error("Storage quota exceeded"); };
    const blocked = mock.method(dom.window.Storage.prototype, "setItem", failWrite);
    await click(bookmark);
    assert.equal(bookmark.getAttribute("aria-pressed"), "false");
    assert.equal(localStorage.getItem("waylan:reading-list:v1"), null);
    assert.equal(document.querySelector(".shelf-count"), null);
    assert.equal(warning.mock.callCount(), 1);
    blocked.mock.restore();
    await click(bookmark);
    assert.equal(bookmark.getAttribute("aria-pressed"), "true");

    mock.method(dom.window.Storage.prototype, "setItem", failWrite);
    await click(document.querySelector(".shelf-trigger"));
    await click(document.querySelector(".shelf-items li button"));
    assert.equal(document.querySelectorAll(".shelf-items li").length, 1);
    const clear = document.querySelector(".shelf-footer .confirm-button");
    await click(clear);
    await click(clear);
    assert.equal(document.querySelectorAll(".shelf-items li").length, 1);
    assert.equal(warning.mock.callCount(), 3, "failed add, remove and clear must all report the failure");
  });
  it("keeps private highlights visible when browser storage rejects clearing them", async () => {
    const post = posts[0];
    localStorage.setItem("echo:marks:" + post.id, JSON.stringify([{ id: "saved-test-mark" }]));
    await mount();
    await click(document.querySelector(".settings-button"));
    assert.match(document.querySelector(".settings-highlights")?.textContent || "", /共 1 处/);
    const warning = mock.method(dom.window, "alert", () => {});
    const blocked = mock.method(dom.window.Storage.prototype, "removeItem", () => {
      throw new Error("Storage access denied");
    });
    const clear = document.querySelector(".settings-highlights .confirm-button");
    await click(clear);
    await click(clear);
    assert.match(document.querySelector(".settings-highlights")?.textContent || "", /共 1 处/);
    assert.ok(localStorage.getItem("echo:marks:" + post.id));
    assert.equal(warning.mock.callCount(), 1);
    blocked.mock.restore();
    await click(clear);
    await click(clear);
    assert.equal(localStorage.getItem("echo:marks:" + post.id), null);
    assert.match(document.querySelector(".settings-highlights")?.textContent || "", /尚未保存私人划线/);
  });
  it("keeps the notification entry in its familiar slot when the service is disabled", async () => {
    await mount();
    const controls = [...document.querySelectorAll(".header-tools .shelf-trigger, .header-tools .notification-trigger, .header-tools .settings-button")];
    assert.ok(controls[0]?.classList.contains("shelf-trigger"));
    assert.ok(controls[1]?.classList.contains("notification-trigger"));
    assert.ok(controls[2]?.classList.contains("settings-button"));
    await click(controls[1]);
    assert.match(document.querySelector(".notification-popover")?.textContent || "", /本站暂未开启消息通知/);
    assert.equal(document.querySelector(".notification-badge"), null);
    assert.equal([...document.querySelectorAll(".notification-popover button")].some((button) => button.textContent?.includes("GitHub 登录")), false);
  });
  it("keeps notifications visible after a failed request and recovers through retry", async () => {
    const fallback = globalThis.fetch;
    let unavailable = true;
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) return Response.json({ user: null });
      if (url.endsWith("/api/status")) {
        if (unavailable) throw new Error("temporary network failure");
        return Response.json({ notifications: true });
      }
      return fallback(input, init);
    });
    await mount();
    const trigger = document.querySelector(".notification-trigger");
    await click(trigger);
    assert.match(document.querySelector(".notification-popover")?.textContent || "", /暂时无法读取通知/);
    unavailable = false;
    await click(document.querySelector(".notification-popover .quiet-button"));
    await settle(40);
    assert.equal(document.querySelector(".notification-trigger"), trigger);
    assert.match(document.querySelector(".notification-popover")?.textContent || "", /使用 GitHub 登录/);
  });
  it("displays unread replies when notifications are enabled", async () => {
    const fallback = globalThis.fetch;
    mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/session")) return Response.json({ user: { login: "reader" }, csrf: "test-session-csrf" });
      if (url.endsWith("/api/notifications")) return Response.json({ enabled: true, unread: 1, subscribed: true, items: [
        { id: "reply-1", actor: "friend", slug: posts[0].slug, title: posts[0].title, commentId: "comment-1", kind: "reply", time: 1762000000, read: false },
      ] });
      return fallback(input, init);
    });
    await mount();
    assert.equal(document.querySelector(".notification-badge")?.textContent, "1");
    await click(document.querySelector(".notification-trigger"));
    assert.match(document.querySelector(".notification-item")?.textContent || "", /friend 回复了你/);
  });
  it("keeps article and website JSON-LD complete after client route changes", async () => {
    await mount("/post/" + posts[0].slug);
    const readData = () => JSON.parse(document.getElementById("structured-data")?.textContent || "{}");
    assert.deepEqual(readData(), structuredData(metadata("/post/" + posts[0].slug)));
    assert.equal(readData().dateModified, posts[0].updated || posts[0].date);
    assert.equal(readData().inLanguage, "zh-CN");
    assert.equal(readData().isAccessibleForFree, true);
    await click(document.querySelector('#site-nav a[href="/feed"]'));
    await settle(70);
    assert.deepEqual(readData(), structuredData(metadata("/feed")));
  });
  it("switches skin and colour mode from one settings panel and persists both", async () => {
    await mount();
    // Reading shelf + settings; everything else lives inside the settings panel.
    assert.equal(document.querySelectorAll(".header-tools > .icon-button:not(.mobile-menu)").length, 2);
    assert.ok(document.querySelector(".header-tools > .shelf-trigger"));
    await click(document.querySelector(".settings-button"));
    await click(document.querySelector('input[name="skin"][value="terminal"]'));
    assert.equal(document.documentElement.dataset.skin, "terminal");
    assert.equal(localStorage.getItem("echo:skin"), JSON.stringify("terminal"));
    await click(document.querySelector('input[name="theme"][value="light"]'));
    assert.equal(document.documentElement.dataset.theme, "light");
    await click(document.querySelector('input[name="theme"][value="dark"]'));
    assert.equal(document.documentElement.dataset.theme, "dark");
    assert.equal(localStorage.getItem("echo:theme"), JSON.stringify("dark"));
    // "System" follows prefers-color-scheme, which this environment reports as dark.
    await click(document.querySelector('input[name="theme"][value="system"]'));
    assert.equal(document.documentElement.dataset.theme, "dark");
    // A preference changed in another tab should refresh both the palette and settings controls.
    await act(async () => {
      localStorage.setItem("echo:theme", JSON.stringify("light"));
      dom.window.dispatchEvent(new dom.window.StorageEvent("storage", { key: "echo:theme" }));
      await pause(20);
    });
    assert.equal(document.documentElement.dataset.theme, "light");
    assert.ok(document.querySelector<HTMLInputElement>('input[name="theme"][value="light"]')?.checked);
  });
  it("uses accurate shared counts and only exposes listbox semantics for actual search options", async () => {
    await mount("/");
    assert.match(document.querySelector(".footer-stats")?.textContent || "", new RegExp(`${posts.length} 条内容`));
    assert.match(metadata("/feed").title, /^全部内容/);
    await click(document.querySelector(".header-search"));
    const input = document.querySelector<HTMLInputElement>(".search-dialog input")!;
    const change = async (value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await pause(25);
    });
    assert.equal(document.querySelector(".search-dialog [role=listbox]"), null);
    assert.equal(input.getAttribute("aria-controls"), null);
    assert.ok(document.querySelector(".search-suggestions button"), "suggestions remain clickable outside listbox");
    assert.match(document.querySelector(".search-footer")?.textContent || "", new RegExp(`共 ${posts.length} 条内容`));
    await change("not-a-real-site-keyword-qwerty");
    assert.ok(document.querySelector(".search-empty-state"));
    assert.equal(document.querySelector(".search-dialog [role=listbox]"), null);
    assert.equal(input.getAttribute("aria-controls"), null);
    await change("D1");
    const listbox = document.querySelector(".search-dialog [role=listbox]");
    assert.ok(listbox);
    assert.equal(listbox.id, "search-results");
    assert.equal(input.getAttribute("aria-controls"), "search-results");
    assert.ok(listbox.querySelector('[role="option"]'));
    assert.equal(listbox.querySelector(".search-all"), null, "navigation links must not be inside a listbox");
    assert.ok(document.querySelector(".search-dialog .search-all"));
  });
  it("focuses the search field, navigates results by keyboard and opens the full result list", async () => {
    await mount();
    await click(document.querySelector(".header-search"));
    const input = document.querySelector<HTMLInputElement>(".search-dialog input")!;
    assert.equal(document.activeElement, input);
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "D1");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const options = document.querySelectorAll(".search-dialog [role=option]");
    assert.ok(options.length > 0);
    const key = async (k: string) =>
      act(async () => {
        input.dispatchEvent(
          new dom.window.KeyboardEvent("keydown", { key: k, bubbles: true }),
        );
        await pause(20);
      });
    await key("ArrowDown");
    assert.equal(input.getAttribute("aria-activedescendant"), "search-option-0");
    assert.equal(options[0].getAttribute("aria-selected"), "true");
    await key("ArrowUp");
    assert.equal(input.getAttribute("aria-activedescendant"), null);
    await key("Enter");
    await settle(60);
    assert.equal(location.pathname, "/feed");
    assert.equal(new URLSearchParams(location.search).get("q"), "D1");
    assert.equal(document.querySelector(".search-dialog[open]"), null);
    assert.equal(document.querySelector(".feed-search-row input"), null, "one search entry point only");
  });
  it("completes search dialog closing before navigating to an article result", async () => {
    await mount("/feed");
    await click(document.querySelector(".header-search"));
    const input = document.querySelector<HTMLInputElement>(".search-dialog input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!
        .call(input, "D1");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    const result = document.querySelector(".search-option") as HTMLAnchorElement;
    assert.ok(result);
    const destination = new URL(result.href).pathname;
    await click(result);
    await settle(100);
    assert.equal(location.pathname, destination);
    assert.equal(document.querySelector(".search-dialog[open]"), null);
    assert.ok(document.querySelector(".reader-main"), "search navigates to a reader route");
  });
  it("closes a nonempty native search input on the first Escape and resets its next opening", async () => {
    await mount();
    await click(document.querySelector(".header-search"));
    const input = document.querySelector<HTMLInputElement>(".search-dialog input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!
        .call(input, "静态");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    assert.equal(input.value, "静态");
    assert.ok(document.querySelector(".search-dialog[open]"));
    await act(async () => {
      input.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "Escape", bubbles: true, cancelable: true,
      }));
      await pause(30);
    });
    assert.equal(document.querySelector(".search-dialog[open]"), null,
      "one Escape must close the modal, not just empty the native search field");
    await click(document.querySelector(".header-search"));
    assert.equal(document.querySelector<HTMLInputElement>(".search-dialog input")!.value, "");
  });
  it("renders code blocks as terminal windows with a visible copy button", async () => {
    const post = posts.find((p) => p.blocks.some((b) => b.lang === "bash"))!;
    await mount(`/post/${post.slug}`);
    const shell = document.querySelector(".block-code")!;
    assert.ok(shell.querySelector(".code-bar .code-copy"));
    assert.ok(shell.querySelector(".code-bar-lang")?.textContent);
    assert.ok(document.querySelector(".reader-prose .code-prompt"));
    assert.ok(document.querySelector(".reader-prose .hljs"));
  });
  it("resets a copied code button if a subsequent clipboard write fails", async () => {
    const post = posts.find((p) => p.blocks.some((b) => b.lang === "bash"))!;
    const clipboard = { writeText: async (_value: string) => {} };
    Object.defineProperty(dom.window.navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
    await mount("/post/" + post.slug);
    const button = document.querySelector<HTMLButtonElement>(".code-copy")!;
    await click(button);
    assert.match(button.textContent || "", /已复制/);
    clipboard.writeText = async () => { throw new Error("Clipboard access revoked"); };
    await click(button);
    assert.match(button.textContent || "", /复制代码/);
    assert.doesNotMatch(button.textContent || "", /已复制/);
    assert.match(document.querySelector(".small-error")?.textContent || "", /复制未完成/);
  });
  it("does not execute repeated same-target route clicks while a transition is in flight", async () => {
    await mount("/");
    const link = document.querySelector<HTMLAnchorElement>('#site-nav a[href="/feed"]');
    assert.ok(link);
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    let pushes = 0;
    let replaces = 0;
    Object.defineProperty(history, "pushState", {
      configurable: true,
      value: (...args: Parameters<History["pushState"]>) => {
        pushes++;
        return push(...args);
      },
    });
    Object.defineProperty(history, "replaceState", {
      configurable: true,
      value: (...args: Parameters<History["replaceState"]>) => {
        replaces++;
        return replace(...args);
      },
    });
    await act(async () => {
      for (let i = 0; i < 1000; i++) {
        link.dispatchEvent(new dom.window.MouseEvent("click", {
          bubbles: true, cancelable: true, button: 0,
        }));
      }
      await pause(70);
    });
    assert.equal(location.pathname, "/feed");
    assert.equal(pushes, 1, "only one history navigation for one target");
    assert.equal(replaces, 0, "repeated clicks must not replace history repeatedly");
  });
  it("renders helpful 404 destinations and does not invent a match for unrelated slugs", async () => {
    await mount("/post/this-really-does-not-exist");
    assert.equal(document.querySelector(".not-found h1")?.textContent, "页面不存在");
    assert.ok(document.querySelector('.not-found a[href="/"]'));
    assert.ok(document.querySelector('.not-found a[href="/archive"]'));
    assert.equal(document.querySelector(".not-found .lost-guess"), null);
    assert.equal(document.querySelectorAll(".not-found .lost-latest a").length, 3);
    await click(document.querySelector(".not-found .lost-page"));
    assert.ok(document.querySelector(".echo-trail"), "the 404 interaction should remain keyboard-clickable");
    await click(document.querySelector('.not-found a[href="/archive"]'));
    assert.equal(location.pathname, "/archive");
  });
  it("does not stack duplicate history entries when the current page is clicked again", async () => {
    await mount("/feed");
    const before = history.length;
    const link = document.querySelector<HTMLAnchorElement>('#site-nav a[href="/feed"]')!;
    await click(link);
    await click(link);
    assert.equal(history.length, before);
  });
});
