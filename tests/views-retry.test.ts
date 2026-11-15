import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useViews } from "../src/lib/views";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Shared view counts", () => {
  it("retries a failed request when the window receives focus", async () => {
    const dom = new JSDOM('<!doctype html><body><div id="root"></div></body>',
      { url: "https://echo.test/", pretendToBeVisual: true });
    for (const [key, value] of Object.entries({
      window: dom.window, document: dom.window.document,
      IS_REACT_ACT_ENVIRONMENT: true,
    })) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    let calls = 0;
    mock.method(globalThis, "fetch", async () => {
      calls++;
      if (calls === 1) throw new Error("network unavailable");
      return Response.json({ enabled: true, views: { "echo-001": 5 } });
    });
    function Count() {
      const { enabled, views } = useViews();
      return createElement("span", null, enabled ? String(views["echo-001"]) : "unavailable");
    }
    const root = createRoot(dom.window.document.getElementById("root")!);
    try {
      await act(async () => { root.render(createElement(Count)); await delay(20); });
      assert.equal(calls, 1);
      assert.equal(dom.window.document.querySelector("span")?.textContent, "unavailable");
      await act(async () => {
        dom.window.dispatchEvent(new dom.window.Event("focus"));
        await delay(20);
      });
      assert.equal(calls, 2);
      assert.equal(dom.window.document.querySelector("span")?.textContent, "5");
    } finally {
      await act(async () => root.unmount());
      mock.restoreAll();
      dom.window.close();
    }
  });
});
