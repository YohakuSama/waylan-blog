import { beforeEach, afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  motionAllowed,
  motionLevel,
  setMotionPreference,
  navigateWithMotion,
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
  it("moves the shared image from its original geometry when native transitions are unavailable", async () => {
    const transition = navigateWithMotion(sharedScene());
    assert.equal(document.getElementById("target")!.style.visibility, "hidden");
    const ghost = calls.find((call) =>
      call.element.classList.contains("shared-cover-ghost"),
    );
    assert.ok(ghost);
    assert.equal(
      ghost.frames[1].transform,
      "translate(100px,160px) scale(2.5,2.5)",
    );
    await transition.finished;
    assert.equal(document.getElementById("target")!.style.visibility, "");
    assert.equal(document.querySelector(".shared-cover-ghost"), null);
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
  it("falls back after a rejected native transition and applies the target only once", async () => {
    Object.defineProperty(document, "startViewTransition", {
      value: () => ({
        finished: Promise.reject(new Error("not supported")),
        skipTransition() {},
      }),
      configurable: true,
    });
    let changes = 0;
    await navigateWithMotion(() => changes++).finished;
    assert.equal(changes, 1);
    assert.ok(calls.length > 0);
  });
  it("does not apply an obsolete target after a transition was cancelled", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, fail) => (reject = fail));
    Object.defineProperty(document, "startViewTransition", {
      value: () => ({
        finished: pending,
        skipTransition() {
          reject(new Error("cancelled"));
        },
      }),
      configurable: true,
    });
    let changes = 0;
    const transition = navigateWithMotion(() => changes++);
    transition.skipTransition();
    await transition.finished;
    assert.equal(changes, 0);
    assert.equal(calls.length, 0);
  });
  it("restores hidden target images immediately when a fallback is interrupted", async () => {
    const transition = navigateWithMotion(sharedScene());
    transition.skipTransition();
    assert.equal(document.getElementById("target")!.style.visibility, "");
    assert.equal(document.querySelector(".shared-cover-ghost"), null);
    await transition.finished;
  });
});
