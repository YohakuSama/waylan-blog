import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { JSDOM, VirtualConsole } from "jsdom";
import { randomUUID } from "node:crypto";
import site from "../src/generated/site.json";
import { posts } from "../src/lib/data";
const html = await readFile("preview/index.html", "utf8");
const parsed = new JSDOM(html).window.document;
assert(parsed.title.includes(site.name));
assert(
  !parsed.querySelector(
    'script[src],script[type="module"],link[rel="stylesheet"][href]',
  ),
  "Offline preview must not load JavaScript or CSS from external files",
);
assert(
  [...parsed.querySelectorAll("img")].every((img) =>
    img.getAttribute("src")?.startsWith("data:"),
  ),
  "Initial preview images must be embedded",
);
assert(
  parsed.querySelector("main")!.textContent!.length > 100,
  "Preview must contain readable HTML before scripts execute",
);
parsed.defaultView?.close();
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => unknown, label: string) {
  for (let i = 0; i < 80; i++) {
    if (predicate()) return;
    await wait(25);
  }
  assert.fail("Preview timeout: " + label);
}
function boot(
  url = "file:///Users/test/Waylan/index.html",
  saved?: Record<string, string>,
  motion = false,
) {
  const errors: Error[] = [];
  let fetches = 0;
  const animations: {
    element: Element;
    frames: Keyframe[];
    options: KeyframeAnimationOptions;
  }[] = [];
  const values = new Map(Object.entries(saved || {}));
  const log = new VirtualConsole();
  log.on("jsdomError", (error) => {
    errors.push(error);
    console.error("Preview runtime error:", error.message.slice(0, 800));
  });
  const dom = new JSDOM(html, {
    url,
    pretendToBeVisual: true,
    runScripts: "dangerously",
    virtualConsole: log,
    beforeParse(window) {
      Object.defineProperty(window.crypto, "randomUUID", { value: randomUUID });
      window.matchMedia = ((query: string) => ({
        matches: !motion && query.includes("reduced-motion"),
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        dispatchEvent() {
          return true;
        },
        addEventListener() {},
        removeEventListener() {},
      })) as typeof window.matchMedia;
      if (motion) {
        Object.defineProperty(window.navigator, "hardwareConcurrency", {
          value: 2,
        });
        Object.defineProperty(window.HTMLElement.prototype, "animate", {
          value: function (
            frames: Keyframe[],
            options: KeyframeAnimationOptions,
          ) {
            animations.push({ element: this, frames, options });
            return { finished: Promise.resolve(), cancel() {} };
          },
        });
        Object.defineProperty(
          window.HTMLElement.prototype,
          "getBoundingClientRect",
          {
            value: function () {
              const element = this as HTMLElement;
              const cover = element.hasAttribute("data-shared-cover");
              const article = element.classList.contains("article-cover-image");
              return {
                left: cover ? 100 : 0,
                top: cover ? 160 : 0,
                width: cover ? (article ? 400 : 160) : 0,
                height: cover ? (article ? 250 : 100) : 0,
                right: cover ? 500 : 0,
                bottom: cover ? 410 : 0,
                x: 100,
                y: 160,
                toJSON() {},
              };
            },
          },
        );
      }
      window.scrollTo = (() => {}) as typeof window.scrollTo;
      window.HTMLElement.prototype.scrollIntoView = function () {};
      window.Range.prototype.getBoundingClientRect = () => ({
        top: 180,
        left: 30,
        right: 330,
        bottom: 204,
        width: 300,
        height: 24,
        x: 30,
        y: 180,
        toJSON() {},
      });
      window.HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute("open", "");
      };
      window.HTMLDialogElement.prototype.close = function () {
        this.removeAttribute("open");
      };
      window.fetch = (async () => {
        fetches++;
        throw new Error("Offline preview tried to use the network");
      }) as typeof window.fetch;
      if (saved) {
        const makeStorage = (map: Map<string, string>) => ({
          get length() {
            return map.size;
          },
          key(index: number) {
            return [...map.keys()][index] || null;
          },
          getItem(key: string) {
            return map.get(key) ?? null;
          },
          setItem(key: string, value: string) {
            map.set(key, String(value));
          },
          removeItem(key: string) {
            map.delete(key);
          },
          clear() {
            map.clear();
          },
        });
        Object.defineProperty(window, "localStorage", {
          value: makeStorage(values),
        });
        Object.defineProperty(window, "sessionStorage", {
          value: makeStorage(new Map()),
        });
      }
    },
  });
  return { dom, errors, values, animations, fetches: () => fetches };
}
async function click(dom: JSDOM, element: Element | null) {
  assert(element, "Missing preview control");
  element.dispatchEvent(
    new dom.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }),
  );
  await wait(50);
}
const first = boot();
try {
  const { dom } = first,
    doc = dom.window.document;
  await until(
    () => doc.querySelector(".site-header"),
    "site header",
  );
  assert(
    doc
      .querySelector(".brand")!
      .textContent!.toLowerCase()
      .includes(site.name.toLowerCase()),
  );
  await click(dom, doc.querySelector(".intro-copy>.primary-button"));
  await until(() => dom.window.location.hash === "#/feed" && doc.querySelector(".page-heading"), "homepage to feed");
  assert.equal(doc.querySelectorAll(".post-card").length, Math.min(8, posts.length));
  await click(
    dom,
    [...doc.querySelectorAll(".filter-tabs button")].find(
      (button) => button.textContent === "随笔",
    )!,
  );
  assert.equal(doc.querySelectorAll(".post-card").length, posts.filter((post) => post.topic === "notes").length);
  assert(dom.window.location.hash.includes("topic=notes"));
  await click(dom, doc.querySelector(".header-search"));
  const input = doc.querySelector<HTMLInputElement>(".search-dialog input")!;
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, "草稿");
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await wait(30);
  await click(dom, doc.querySelector(".search-dialog .search-all"));
  await until(
    () => doc.querySelectorAll(".post-card").length === 1,
    "offline full-text search",
  );
  await click(dom, doc.querySelector(".post-card-link"));
  await until(() => doc.querySelector(".reader-prose"), "article");
  // Let the reader's mount effects (highlight restore re-wraps text nodes) settle
  // before selecting, as a real reader would.
  await until(() => !doc.querySelector("dialog[open]"), "search dialog closed");
  await wait(150);
  assert(dom.window.location.hash.startsWith("#/post/slow-tools"));
  assert(
    doc
      .querySelector(".article-cover img")!
      .getAttribute("src")!
      .startsWith("data:"),
  );
  const paragraph = doc.querySelector(".reader-prose p")!,
    range = doc.createRange();
  range.setStart(paragraph.firstChild!, 0);
  range.setEnd(paragraph.firstChild!, 12);
  dom.window.getSelection()!.removeAllRanges();
  dom.window.getSelection()!.addRange(range);
  doc.dispatchEvent(new dom.window.Event("selectionchange"));
  await until(
    () => doc.querySelector(".selection-toolbar"),
    "native text selection toolbar",
  );
  await click(
    dom,
    [...doc.querySelectorAll(".selection-toolbar button")].find(
      (button) => button.textContent === "划线",
    )!,
  );
  assert(doc.querySelector("mark.private-mark"));
  assert(
    doc.querySelector(".toast")!.textContent!.includes("本次阅读"),
    "Opaque-origin storage must not claim permanent saving",
  );
  await click(dom, doc.querySelector(".reader-topbar>.text-button"));
  await until(
    () => dom.window.location.hash.startsWith("#/feed?"),
    "history back to filtered feed",
  );
  assert.equal(doc.querySelectorAll(".post-card").length, 1);
  const oldTheme = doc.documentElement.dataset.theme;
  await click(dom, doc.querySelector(".settings-button"));
  await click(
    dom,
    doc.querySelector(
      `input[name="theme"][value="${oldTheme === "dark" ? "light" : "dark"}"]`,
    ),
  );
  assert.notEqual(doc.documentElement.dataset.theme, oldTheme);
  await click(dom, doc.querySelector('input[name="skin"][value="terminal"]'));
  assert.equal(doc.documentElement.dataset.skin, "terminal");
  await click(dom, doc.querySelector(".settings-dialog .dialog-header button"));
  await click(dom, doc.querySelector(".header-search"));
  assert(doc.querySelector(".search-dialog[open]"));
  await click(dom, doc.querySelector(".search-dialog .dialog-header button"));
  assert.equal(first.fetches(), 0);
  assert.deepEqual(
    first.errors.map((error) => error.message),
    [],
  );
} finally {
  first.dom.window.close();
}
const persistent = boot(
  "file:///Users/test/Waylan/index.html#/post/a-room-on-the-internet",
  {},
);
let saved: Record<string, string> = {};
try {
  const { dom } = persistent,
    doc = dom.window.document;
  await until(
    () => doc.querySelector(".reader-prose"),
    "direct file article route",
  );
  await wait(60);
  const paragraph = doc.querySelector(".reader-prose p")!,
    range = doc.createRange();
  range.setStart(paragraph.firstChild!, 0);
  range.setEnd(paragraph.firstChild!, 12);
  dom.window.getSelection()!.removeAllRanges();
  dom.window.getSelection()!.addRange(range);
  doc.dispatchEvent(new dom.window.Event("selectionchange"));
  await until(
    () => doc.querySelector(".selection-toolbar"),
    "persistent selection toolbar",
  );
  await click(
    dom,
    [...doc.querySelectorAll(".selection-toolbar button")].find(
      (button) => button.textContent === "划线",
    )!,
  );
  saved = Object.fromEntries(persistent.values);
  assert(Object.keys(saved).some((key) => key.startsWith("echo:marks:")));
  assert.equal(persistent.fetches(), 0);
  assert.deepEqual(
    persistent.errors.map((error) => error.message),
    [],
  );
} finally {
  persistent.dom.window.close();
}
const reload = boot(
  "file:///Users/test/Waylan/index.html#/post/a-room-on-the-internet",
  saved,
);
try {
  await until(
    () => reload.dom.window.document.querySelector("mark.private-mark"),
    "saved highlight after reload",
  );
  assert.equal(reload.fetches(), 0);
  assert.deepEqual(
    reload.errors.map((error) => error.message),
    [],
  );
} finally {
  reload.dom.window.close();
}
const moving = boot("file:///Users/test/Waylan/index.html", {}, true);
try {
  const { dom } = moving,
    doc = dom.window.document;
  // The preview mounts over prerendered markup; wait until React owns the link.
  await until(
    () =>
      Object.keys(
        doc.querySelector(".intro-copy>.primary-button") || {},
      ).some((key) => key.startsWith("__reactProps")),
    "motion app mount",
  );
  await click(dom, doc.querySelector(".intro-copy>.primary-button"));
  await until(() => doc.querySelector(".page-heading .eyebrow"), "motion feed");
  assert(
    moving.animations.some(
      (item) =>
        item.element.tagName === "MAIN" && Number(item.options.duration) > 0,
    ),
    "Two-core offline preview must still dispatch visible motion",
  );
  await click(dom, doc.querySelector(".settings-button"));
  await click(
    dom,
    doc.querySelector('input[name="motion-preference"][value="full"]'),
  );
  assert.equal(doc.documentElement.dataset.motion, "full");
  await click(dom, doc.querySelector(".settings-dialog .dialog-header button"));
  await click(dom, doc.querySelector(".post-card-link"));
  await until(
    () => doc.querySelector(".reader-prose"),
    "shared fallback article",
  );
  assert(
    moving.animations.some((item) =>
      item.element.classList.contains("shared-cover-ghost"),
    ),
    "Bundled preview must dispatch geometry-based shared image motion",
  );
  assert.equal(doc.querySelector(".shared-cover-ghost"), null);
  assert.equal(moving.fetches(), 0);
  assert.deepEqual(
    moving.errors.map((error) => error.message),
    [],
  );
} finally {
  moving.dom.window.close();
}
console.log(
  "Offline HTML checks passed: embedded assets, file:// navigation, filters, search, reading, selection, history, theme, dialog, storage fallback and highlight restoration. No network requests. DOM integration only; browser layout is not measured.",
);
