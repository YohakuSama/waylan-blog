import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement, useState, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import {
  AnnouncementBanner, AnnouncementDetail, AnnouncementList, useSiteAnnouncements,
} from "../src/components/SiteAnnouncements";
import type { Announcement } from "../shared/announcements";
import { NotificationBell } from "../src/components/NotificationBell";

const initial: Announcement = {
  id: "notice-acceptance",
  title: "系统维护",
  body: "网站维护通知。",
  published: true,
  priority: "important",
  link: "",
  updated: "2026-11-06",
  revision: 1,
};
function Fixture({ notice }: { notice: Announcement }) {
  const state = useSiteAnnouncements([notice]);
  return createElement("div", {},
    createElement("output", { "data-unread": state.unread }, String(state.unread)),
    createElement(AnnouncementBanner, {
      item: state.banner, onOpen: state.openDetail, onDismiss: state.dismiss,
    }),
    createElement(AnnouncementList, {
      items: state.items, read: state.read, onOpen: state.openDetail,
    }),
    createElement(AnnouncementDetail, {
      item: state.active, onClose: state.closeDetail,
    }),
  );
}
function BellFixture({ notice }: { notice: Announcement }) {
  const [active, setActive] = useState<Announcement | null>(null);
  return createElement("div", {},
    createElement(NotificationBell, {
      announcements: [notice], readAnnouncements: new Set<string>(),
      onOpenAnnouncement: setActive,
    }),
    createElement(AnnouncementDetail, {
      item: active, onClose: () => setActive(null),
    }),
  );
}
async function setup() {
  const dom = new JSDOM("<!doctype html><html><body><main id='test'></main></body></html>", {
    url: "https://waylan.test/", pretendToBeVisual: true,
  });
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true, value: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
  });
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "showModal", {
    configurable: true, value(this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(dom.window.HTMLDialogElement.prototype, "close", {
    configurable: true, value(this: HTMLDialogElement) { this.removeAttribute("open"); },
  });
  const { createRoot } = await import("react-dom/client");
  const element = dom.window.document.getElementById("test")!;
  let root: Root | null = null;
  const mount = async (node: ReactElement) => {
    if (root) await act(async () => root!.unmount());
    root = createRoot(element);
    await act(async () => { root!.render(node); });
  };
  const render = (item: Announcement) => mount(createElement(Fixture, { notice: item }));
  const renderBell = (item: Announcement) => mount(createElement(BellFixture, { notice: item }));
  const click = async (selector: string) => {
    const button = dom.window.document.querySelector<HTMLButtonElement>(selector);
    assert(button, `missing ${selector}`);
    await act(async () => { button.click(); });
  };
  const clear = async () => {
    if (root) await act(async () => root!.unmount());
    dom.window.close();
  };
  return { dom, render, renderBell, click, clear };
}

describe("Announcement interaction and browser persistence", () => {
  it("dismisses only the banner, records read on detail close, and re-alerts after revision", async () => {
    const app = await setup();
    try {
      await app.render(initial);
      assert(app.dom.window.document.querySelector(".site-announcement-bar"));
      assert.equal(app.dom.window.document.querySelector("output")?.textContent, "1");
      await app.click(".site-announcement-dismiss");
      assert.equal(app.dom.window.document.querySelector(".site-announcement-bar"), null);
      assert.equal(app.dom.window.document.querySelector("output")?.textContent, "1",
        "hiding a banner must not mark its detail as read");
      await app.click(".announcement-item");
      assert(app.dom.window.document.querySelector(".site-announcement-dialog[open]"));
      await app.click(".announcement-detail-actions button");
      assert.equal(app.dom.window.document.querySelector("output")?.textContent, "0");
      assert.equal(app.dom.window.localStorage.getItem("echo:announcement:read:notice-acceptance"), "1");
      assert.equal(app.dom.window.localStorage.getItem("echo:announcement:dismissed:notice-acceptance"), "1");
      await app.render(initial);
      assert.equal(app.dom.window.document.querySelector(".site-announcement-bar"), null);
      assert.equal(app.dom.window.document.querySelector("output")?.textContent, "0");
      await app.render({ ...initial, revision: 2, body: "新版维护说明" });
      assert(app.dom.window.document.querySelector(".site-announcement-bar"));
      assert.equal(app.dom.window.document.querySelector("output")?.textContent, "1");
    } finally {
      await app.clear();
    }
  });

  it("opens public announcements without GitHub login and restores focus to the bell", async () => {
    const app = await setup();
    try {
      await app.renderBell(initial);
      await app.click(".notification-trigger");
      await app.click(".notification-tabs button:last-child");
      assert(app.dom.window.document.querySelector(".notification-popover .announcement-item"),
        "public notices must remain available without a private inbox session");
      await app.click(".notification-popover .announcement-item");
      assert(app.dom.window.document.querySelector(".site-announcement-dialog[open]"));
      await app.click(".site-announcement-dialog .announcement-detail-actions button");
      assert(app.dom.window.document.activeElement?.classList.contains("notification-trigger"),
        "closing the detail must return keyboard focus to the persistent bell");
    } finally {
      await app.clear();
    }
  });

  it("auto-opens an urgent detail only once per published revision", async () => {
    const app = await setup();
    try {
      const urgent = { ...initial, priority: "urgent" as const };
      await app.render(urgent);
      assert(app.dom.window.document.querySelector(".site-announcement-dialog[open]"));
      await app.click(".announcement-detail-actions button");
      await app.render(urgent);
      assert.equal(app.dom.window.document.querySelector(".site-announcement-dialog[open]"), null);
      await app.render({ ...urgent, revision: 2 });
      assert(app.dom.window.document.querySelector(".site-announcement-dialog[open]"));
    } finally {
      await app.clear();
    }
  });
  it("closes the nonmodal inbox when keyboard focus leaves it", async () => {
    const app = await setup();
    const outside = app.dom.window.document.createElement("button");
    outside.textContent = "后续操作";
    app.dom.window.document.body.appendChild(outside);
    try {
      await app.renderBell(initial);
      await app.click(".notification-trigger");
      assert(app.dom.window.document.querySelector(".notification-popover"));
      await act(async () => { outside.focus(); });
      assert.equal(app.dom.window.document.querySelector(".notification-popover"), null,
        "a nonmodal notification panel should not remain above the page after Tab leaves");
    } finally {
      outside.remove();
      await app.clear();
    }
  });

});
