import { beforeEach, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  motionAllowed,
  motionLevel,
  setMotionPreference,
  navigateWithMotion,
  listTransition,
  animateDialogResize,
} from "../src/lib/motion";
let dom: JSDOM,
  reduced = false;
let calls: {
  element: Element;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
}[] = [];
function rect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {},
  };
}
function sharedScene() {
  document.querySelector("main")!.innerHTML =
    '<div data-shared-cover="article" id="source"><img src="https://example.test/cover.svg" alt=""></div>';
  const source = document.getElementById("source")!;
  Object.defineProperty(source, "getBoundingClientRect", {
    value: () => rect(20, 100, 160, 100),
  });
  return () => {
    document.querySelector("main")!.innerHTML =
      '<div data-shared-cover="article" id="target"><img src="https://example.test/cover.svg" alt=""></div>';
    Object.defineProperty(
      document.getElementById("target"),
      "getBoundingClientRect",
      { value: () => rect(100, 160, 400, 250) },
    );
  };
}
beforeEach(() => {
  dom = new JSDOM(
    "<!doctype html><html><body><main>first page</main></body></html>",
    { url: "https://example.test/" },
  );
  reduced = false;
  calls = [];
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
    matchMedia: () => ({ matches: reduced }),
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  Object.defineProperty(dom.window.navigator, "hardwareConcurrency", {
    value: 8,
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, "animate", {
    configurable: true,
    value: function (frames: Keyframe[], options: KeyframeAnimationOptions) {
      calls.push({ element: this, frames, options });
      return {
        finished: Promise.resolve(),
        cancel() {},
      } as unknown as Animation;
    },
  });
});
afterEach(() => dom.window.close());
describe("motion API dispatch, fallback geometry and cancellation (DOM integration)", () => {
  it("uses a visible lightweight transition on two-core devices", async () => {
    Object.defineProperty(navigator, "hardwareConcurrency", {
      value: 2,
      configurable: true,
    });
    assert.equal(motionAllowed(), true);
    assert.equal(motionLevel(), "simple");
    let changes = 0;
    await navigateWithMotion(() => changes++).finished;
    assert.equal(changes, 1);
    assert.ok(
      calls.some(
        (call) =>
          call.element.tagName === "MAIN" && Number(call.options.duration) > 0,
      ),
    );
  });
  it("never captures old/new document snapshots during route changes", async () => {
    let nativeCalls = 0;
    const states: string[] = [];
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: () => {
        nativeCalls++;
        throw new Error("Native route snapshots cause overlapped page text");
      },
    });
    const first = navigateWithMotion(
      () => { states.push(document.documentElement.dataset.routeMotion || ""); },
      "forward", "collection",
    );
    const second = navigateWithMotion(
      () => { states.push(document.documentElement.dataset.routeMotion || ""); },
      "forward", "reader",
    );
    await Promise.all([first.finished, second.finished]);
    assert.deepEqual(states, ["collection", "reader"]);
    assert.equal(nativeCalls, 0, "no cross-route View Transition API calls");
    assert.equal(document.documentElement.dataset.routeMotion, undefined);
    assert.equal(document.querySelector(".shared-cover-ghost"), null);
  });
  it("never creates floating shared-cover ghosts when moving between collection pages in fallback mode", async () => {
    const t = navigateWithMotion(sharedScene(), "back", "collection");
    assert.equal(document.querySelector(".shared-cover-ghost"), null,
      "collection-to-collection transitions should animate the page, not individual covers");
    assert.ok(calls.some((call) => call.element.tagName === "MAIN"),
      "the collection itself still has an entry transition");
    await t.finished;
    assert.equal(document.querySelector(".shared-cover-ghost"), null);
  });
  it("keeps resume transitions free of floating images and title morphs", async () => {
    const stylesheet = readFileSync("src/styles/motion.css", "utf8");
    assert.match(stylesheet, /data-route-motion="resume"/);
    assert.match(stylesheet, /data-route-motion="resume"\] \.article-heading h1/);
    const transition = navigateWithMotion(sharedScene(), "forward", "resume");
    assert.equal(document.querySelector(".shared-cover-ghost"), null);
    assert.ok(calls.some((call) => call.element.tagName === "MAIN"));
    await transition.finished;
    assert.equal(document.querySelector(".shared-cover-ghost"), null);
  });
  it("does not fly article covers or titles between list and reader on any engine", async () => {
    const transition = navigateWithMotion(sharedScene(), "forward", "reader");
    assert.equal(document.getElementById("target")!.style.visibility, "");
    assert.equal(document.querySelector(".shared-cover-ghost"), null);
    assert.ok(calls.some(call =>
      call.element.tagName === "MAIN" &&
      Number(call.options.duration) <= 200 &&
      call.frames.every(frame => frame.transform === undefined)
    ), "only the mounted main should fade; no translation or resizing");
    await transition.finished;
  });
  it("respects reduced motion while keeping navigation fully usable", async () => {
    reduced = true;
    assert.equal(motionAllowed(), false);
    let changes = 0;
    await navigateWithMotion(() => changes++).finished;
    assert.equal(changes, 1);
    assert.equal(calls.length, 0);
  });
  it("lets an explicit full-motion choice work when persistent storage is blocked", async () => {
    reduced = true;
    Object.defineProperty(dom.window.Storage.prototype, "setItem", {
      value() {
        throw new Error("blocked");
      },
      configurable: true,
    });
    setMotionPreference("full");
    assert.equal(document.documentElement.dataset.motion, "full");
    assert.equal(motionAllowed(), true);
    assert.equal(motionLevel(), "shared");
    await navigateWithMotion(() => {}).finished;
    assert.ok(calls.length > 0);
  });
  it("ignores unreliable native route View Transitions and applies navigation once", async () => {
    let nativeCalls = 0, changes = 0;
    Object.defineProperty(document, "startViewTransition", {
      value: () => { nativeCalls++; throw new Error("WebKit native snapshot failed"); },
      configurable: true,
    });
    await navigateWithMotion(() => changes++).finished;
    assert.equal(changes, 1);
    assert.equal(nativeCalls, 0);
    assert.ok(calls.some(call => call.element.tagName === "MAIN"));
  });
  it("applies a new route immediately even if its fade is cancelled by another tap", async () => {
    let changes = 0;
    const transition = navigateWithMotion(() => changes++);
    assert.equal(changes, 1);
    transition.skipTransition();
    await transition.finished;
    assert.equal(changes, 1);
    assert.equal(document.documentElement.dataset.routeMotion, undefined);
  });
  it("restores hidden target images immediately when a fallback is interrupted", async () => {
    const transition = navigateWithMotion(sharedScene());
    transition.skipTransition();
    assert.equal(document.getElementById("target")!.style.visibility, "");
    assert.equal(document.querySelector(".shared-cover-ghost"), null);
    await transition.finished;
  });
});

describe("list animation single-flight and safe recovery", () => {
  it("cancels an in-flight filter screenshot before navigating to another page", async () => {
    let skipped = 0, released = 0, replaced = 0, applied = 0;
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        update();
        return { finished: pending, skipTransition() { skipped++; resolve(); } };
      },
    });
    listTransition(() => applied++);
    listTransition(() => replaced++, () => released++);
    const route = navigateWithMotion(() => {
      assert.equal(document.documentElement.dataset.listBusy, undefined,
        "the old page screenshot must be gone before mounting the new route");
      applied++;
    });
    assert.equal(skipped, 1);
    assert.equal(released, 1, "a queued filter must release its state lock");
    assert.equal(replaced, 0, "queued stale filters may not run on the new route");
    assert.equal(applied, 2);
    await route.finished;
    await pending;
    assert.equal(document.documentElement.dataset.vt, undefined);
  });
  it("coalesces a thousand rapid sort choices into the first and final state", async () => {
    let resolve!: () => void;
    const finished = new Promise<void>((done) => { resolve = done; });
    let transitions = 0;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        transitions++;
        update();
        return { finished, skipTransition() {} };
      },
    });
    const choices: number[] = [];
    for (let i = 0; i < 1000; i++) listTransition(() => choices.push(i));
    assert.deepEqual(choices, [0], "only the first snapshot should run immediately");
    assert.equal(transitions, 1);
    assert.equal(document.documentElement.dataset.listBusy, "true");
    resolve();
    await finished;
    await new Promise<void>((done) => setTimeout(done, 0));
    assert.deepEqual(choices, [0, 999], "the latest requested order must win");
    assert.equal(transitions, 2);
    assert.equal(document.documentElement.dataset.listBusy, undefined);
  });
  it("waits for the category-pill animation after the native transition ends", async () => {
    const pill = document.createElement("div");
    pill.className = "type-fill";
    document.body.appendChild(pill);
    let finishPill!: () => void;
    const pendingPill = new Promise<void>((done) => { finishPill = done; });
    let playing = true;
    Object.defineProperty(pill, "getAnimations", {
      configurable: true,
      value: () => playing ? [{
        playState: "running",
        effect: { getComputedTiming: () => ({ iterations: 1 }) },
        finished: pendingPill,
      }] : [],
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        update();
        return { finished: Promise.resolve(), skipTransition() {} };
      },
    });
    let updates = 0;
    listTransition(() => updates++);
    await Promise.resolve();
    await Promise.resolve();
    listTransition(() => updates++);
    assert.equal(updates, 1, "native completion alone must not unlock the pill");
    playing = false;
    finishPill();
    await pendingPill;
    await new Promise<void>((done) => setTimeout(done, 0));
    assert.equal(updates, 2, "queued order starts after the pill settles");
    listTransition(() => updates++);
    assert.equal(updates, 3);
  });
  it("releases superseded callbacks without applying their stale navigation", async () => {
    let resolve!: () => void;
    const pending = new Promise<void>((done) => { resolve = done; });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        update();
        return { finished: pending, skipTransition() {} };
      },
    });
    const changes: string[] = [];
    const completed: string[] = [];
    listTransition(() => changes.push("newest"));
    listTransition(() => changes.push("oldest"), () => completed.push("oldest"));
    listTransition(() => changes.push("newest-again"), () => completed.push("newest-again"));
    assert.deepEqual(completed, ["oldest"],
      "replaced pending route must release its duplicate-navigation lock");
    resolve();
    await pending;
    await new Promise<void>((done) => setTimeout(done, 0));
    assert.deepEqual(changes, ["newest", "newest-again"]);
    assert.deepEqual(completed, ["oldest", "newest-again"]);
  });
  it("releases the gate after a rejected browser animation", async () => {
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: () => ({
        finished: Promise.reject(new Error("browser unavailable")),
        skipTransition() {},
      }),
    });
    let updates = 0;
    listTransition(() => updates++);
    await new Promise<void>((done) => setTimeout(done, 0));
    assert.equal(updates, 1, "fallback commits exactly once");
    listTransition(() => updates++);
    await new Promise<void>((done) => setTimeout(done, 0));
    assert.equal(updates, 2, "after rejection the control must work again");
  });
  it("still applies changes immediately with reduced motion", () => {
    setMotionPreference("reduced");
    let updates = 0;
    for (let i = 0; i < 4; i++) listTransition(() => updates++);
    assert.equal(updates, 4);
  });
});

describe("immersive composer viewport and motion contract", () => {
  const cssRule = (css: string, selector: string) => {
    const start = css.indexOf(selector + " {");
    assert.ok(start >= 0, `CSS rule not found: ${selector}`);
    return css.slice(start, css.indexOf("}", start) + 1);
  };
  it("anchors fullscreen at the physical viewport origin, without width clamps", () => {
    const css = readFileSync("src/styles.css", "utf8");
    const compact = cssRule(css, ".discussion-dialog.composer-dialog");
    const fullscreen = cssRule(css, ".discussion-dialog.composer-dialog.composer-fullscreen");
    assert.ok(compact.includes("inset: auto 0 0;"));
    for (const fragment of [
      "inset: 0 auto auto 0;",
      "margin: 0;",
      "width: 100dvw;",
      "height: 100dvh;",
      "min-width: 0;",
      "max-inline-size: none;",
    ]) assert.ok(fullscreen.includes(fragment), fragment);
    assert.equal(fullscreen.includes("min-inline-size: 100dvw"), false);
    assert.equal(fullscreen.includes("inline-size: 100dvw"), false);
    assert.equal(compact.includes("width 340ms"), false);
  });
  it("uses the same unclamped viewport sizing on phones and tablets", () => {
    // The stylesheet is checked out with CRLF on some platforms.
    const css = readFileSync("src/styles.css", "utf8").replace(/\r\n/g, "\n");
    const marker = ".discussion-dialog.composer-dialog,\n  .discussion-dialog.composer-dialog.composer-fullscreen {";
    const start = css.indexOf(marker);
    assert.ok(start >= 0);
    const rule = css.slice(start, css.indexOf("}", start) + 1);
    for (const fragment of [
      "width: 100dvw;",
      "min-width: 0;",
      "max-inline-size: none;",
      "--waylan-editor-view-height",
    ]) assert.ok(rule.includes(fragment), fragment);
    assert.equal(rule.includes("min-inline-size: 100dvw"), false);
  });
  it("expands and shrinks on the same geometry path and shared easing", () => {
    const element = document.createElement("dialog");
    document.body.appendChild(element);
    const compact = rect(420, 240, 760, 680);
    const fullscreen = rect(0, 0, 1920, 1000);
    assert.ok(animateDialogResize(element, compact, fullscreen, "18px", "0px"));
    assert.ok(animateDialogResize(element, fullscreen, compact, "0px", "18px"));
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls[0].frames.map((frame) => [frame.left, frame.top, frame.width, frame.height]),
      [
        ["420px", "240px", "760px", "680px"],
        ["0px", "0px", "1920px", "1000px"],
      ],
    );
    assert.deepEqual(
      calls[1].frames.map((frame) => [frame.left, frame.top, frame.width, frame.height]),
      [
        ["0px", "0px", "1920px", "1000px"],
        ["420px", "240px", "760px", "680px"],
      ],
    );
    for (const call of calls) for (const frame of call.frames) {
      assert.equal(frame.minWidth, "0");
      assert.equal(frame.minHeight, "0");
      assert.equal(frame.maxInlineSize, "none");
      assert.equal(frame.maxBlockSize, "none");
    }
    assert.equal(calls[0].options.duration, calls[1].options.duration);
    assert.equal(calls[0].options.easing, calls[1].options.easing);
    assert.equal(calls[0].options.duration, 320);
  });
  it("respects reduced-motion preferences", () => {
    const element = document.createElement("dialog");
    setMotionPreference("reduced");
    assert.equal(
      animateDialogResize(element, rect(400, 200, 760, 700), rect(0, 0, 1920, 1000), "18px", "0px"),
      null,
    );
    assert.equal(calls.length, 0);
    setMotionPreference("system");
  });
});
