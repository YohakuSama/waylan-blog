import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createElement, act } from "react";
import type { Root } from "react-dom/client";
import App from "../src/App";
import Reader from "../src/components/Reader";
import worker from "../worker/index";
import { posts } from "../src/lib/data";
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
    '<!doctype html><html><head><meta name="description"><link rel="canonical"></head><body><div id="root"></div></body></html>',
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
  it("opens the content world and filters real content by topic", async () => {
    await mount();
    await click(
      [...document.querySelectorAll("a")].find((a) =>
        a.textContent?.includes("浏览全部文章"),
      )!,
    );
    assert.equal(location.pathname, "/feed");
    assert.equal(document.querySelectorAll(".post-card").length, 6);
    await click(
      [...document.querySelectorAll(".filter-tabs button")].find(
        (b) => b.textContent === "随笔",
      )!,
    );
    assert.equal(location.search, "?topic=notes");
    assert.equal(document.querySelectorAll(".post-card").length, 1);
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
    await click(document.querySelector(".reader-topbar>.text-button"));
    await settle(50);
    assert.equal(location.pathname, "/feed");
    assert.equal(location.search, "?topic=notes");
    assert.equal(y, 730);
    assert.equal(document.querySelectorAll(".post-card").length, 1);
  });
  it("keeps the native reduced-motion preference usable without View Transitions", async () => {
    let transitions = 0;
    (document as any).startViewTransition = () => {
      transitions++;
    };
    await mount();
    await click(document.querySelector(".intro-copy>.primary-button"));
    assert.equal(location.pathname, "/feed");
    assert.equal(transitions, 0);
  });
  it("has a matching visual source and destination before starting the page transition", async () => {
    Object.defineProperty(globalThis, "matchMedia", {
      value: () => ({ matches: false }),
      configurable: true,
    });
    const common: string[][] = [];
    (document as any).startViewTransition = (change: () => void) => {
      const before = [...document.querySelectorAll<HTMLElement>("[style]")]
        .map((e) => e.style.viewTransitionName)
        .filter(Boolean);
      change();
      const after = [...document.querySelectorAll<HTMLElement>("[style]")]
        .map((e) => e.style.viewTransitionName)
        .filter(Boolean);
      common.push(before.filter((name) => after.includes(name)));
      return { finished: Promise.resolve(), skipTransition() {} };
    };
    await mount();
    await click(document.querySelector(".intro-copy>.primary-button"));
    assert.ok(common[0].includes("visual-echo-001"));
    await click(document.querySelector(".post-card-link"));
    assert.ok(common[1].includes("title-echo-001"));
    assert.ok(document.querySelector(".reader-prose"));
    assert.equal(document.querySelector("main>.empty-state"), null);
  });
  it("opens and closes the mobile navigation through the same accessible control", async () => {
    await mount();
    const button = document.querySelector(".mobile-menu")!;
    await click(button);
    assert.equal(button.getAttribute("aria-expanded"), "true");
    assert.ok(document.querySelector(".nav-open"));
    await click(button);
    assert.equal(button.getAttribute("aria-expanded"), "false");
  });
  it("uses tap-to-excerpt mode without triggering iOS native text selection", async () => {
    await mount("/post/a-room-on-the-internet");
    const toggle = document.querySelector<HTMLButtonElement>(
      '.excerpt-fab[aria-label="开启摘录段落模式"]',
    )!;
    assert.ok(toggle);
    await click(toggle);
    assert.equal(document.querySelector(".excerpt-fab"), null, "floating trigger hides while excerpting");
    assert.ok(document.querySelector(".excerpt-mode-hint"));
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
    assert.equal(document.querySelector(".excerpt-mode-hint"), null);
    await click(document.querySelector<HTMLButtonElement>(
      '.selection-toolbar button[aria-label="关闭摘录工具栏"]',
    ));
    assert.equal(document.querySelector(".selection-toolbar"), null);
    assert.ok(document.querySelector(".excerpt-mode-hint"));
    await click(paragraph);
    const mark = [...document.querySelectorAll(".selection-toolbar-actions button")]
      .find((b) => b.textContent === "划线")!;
    await click(mark);
    assert.ok(document.querySelector("mark.private-mark"), "tap mode retains the usual persisted quote");
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
  it("shows real per-type counts on the home tabs and filters the mixed feed", async () => {
    await mount();
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
      document.querySelector("#site-nav .selected")?.textContent,
      "项目",
    );
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
  it("renders code blocks as terminal windows with a visible copy button", async () => {
    const post = posts.find((p) => p.blocks.some((b) => b.lang === "bash"))!;
    await mount(`/post/${post.slug}`);
    const shell = document.querySelector(".block-code")!;
    assert.ok(shell.querySelector(".code-bar .code-copy"));
    assert.ok(shell.querySelector(".code-bar-lang")?.textContent);
    assert.ok(document.querySelector(".reader-prose .code-prompt"));
    assert.ok(document.querySelector(".reader-prose .hljs"));
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
  it("does not stack duplicate history entries when the current page is clicked again", async () => {
    await mount("/feed");
    const before = history.length;
    const link = document.querySelector<HTMLAnchorElement>('#site-nav a[href="/feed"]')!;
    await click(link);
    await click(link);
    assert.equal(history.length, before);
  });
});
