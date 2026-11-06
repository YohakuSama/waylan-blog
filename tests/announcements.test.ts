import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  announcementToken,
  parseAnnouncements,
  publishedAnnouncements,
  saveAnnouncements,
  type Announcement,
} from "../shared/announcements";
import { AnnouncementBanner, AnnouncementList, AnnouncementDetail } from "../src/components/SiteAnnouncements";

const sample: Announcement = {
  id: "notice-test",
  title: "例行维护",
  body: "部分页面正在维护，完成后会撤下通知。",
  link: "/about",
  priority: "important",
  published: true,
  revision: 1,
  updated: "2026-11-06",
};

describe("Public site announcements", () => {
  it("has no public notices when the site does not publish any", () => {
    assert.deepEqual(parseAnnouncements(undefined), []);
    assert.deepEqual(publishedAnnouncements([
      { ...sample, published: false },
    ]), []);
    assert.equal(renderToStaticMarkup(createElement(AnnouncementBanner, {
      item: null, onOpen: () => {}, onDismiss: () => {},
    })), "");
  });

  it("ships only published notices in the generated public bundle", () => {
    const source = JSON.parse(readFileSync("content/site.json", "utf8"));
    const generated = JSON.parse(readFileSync("src/generated/site.json", "utf8"));
    assert.deepEqual(generated.announcements, publishedAnnouncements(source.announcements));
    assert.equal(generated.announcements.every((item: Announcement) => item.published), true);
  });

  it("rejects malformed, duplicate, unsafe and oversized source content", () => {
    const invalid = [
      [{ ...sample, link: "javascript:alert(1)" }],
      [{ ...sample, link: "//evil.example/x" }],
      [{ ...sample, link: "http://insecure.example" }],
      [{ ...sample, link: "https://name:password@host.example" }],
      [{ ...sample, id: "../admin" }],
      [sample, { ...sample }],
      [{ ...sample, title: "" }],
      [{ ...sample, body: "x".repeat(1801) }],
      [{ ...sample, priority: "everything" }],
      [{ ...sample, revision: 0 }],
      [{ ...sample, published: "yes" }],
      Array.from({ length: 13 }, (_, i) => ({ ...sample, id: `notice-${i}` })),
    ];
    for (const list of invalid)
      assert.throws(() => parseAnnouncements(list), Error, JSON.stringify(list).slice(0, 80));
  });

  it("allows a blank unpublished draft but rejects publishing it before completion", () => {
    const draft = { ...sample, title: "", body: "", published: false };
    assert.equal(parseAnnouncements([draft])[0].title, "");
    assert.throws(() => parseAnnouncements([{ ...draft, published: true }]), /标题与正文/);
  });

  it("preserves stable ids and increments revisions only on material edits", () => {
    const initial = saveAnnouncements([{ ...sample, revision: 999 }], [], "2026-11-06");
    assert.deepEqual(initial, [sample]);
    const unchanged = saveAnnouncements(initial, initial, "2026-11-07");
    assert.deepEqual(unchanged, initial, "a profile-only save must not re-alert visitors");
    const updated = saveAnnouncements([{ ...sample, body: "维护时间调整", revision: 1 }], initial, "2026-11-07");
    assert.equal(updated[0].id, sample.id);
    assert.equal(updated[0].revision, 2);
    assert.equal(updated[0].updated, "2026-11-07");
    assert.notEqual(announcementToken(updated[0]), announcementToken(initial[0]));
    const unpublished = saveAnnouncements([{ ...updated[0], published: false }], updated, "2026-11-08");
    assert.equal(unpublished[0].revision, 3);
    assert.deepEqual(publishedAnnouncements(unpublished), []);
    const revived = saveAnnouncements([{ ...unpublished[0], published: true }], unpublished, "2026-11-09");
    assert.equal(revived[0].revision, 4);
  });

  it("renders the important banner in prerendered HTML without JavaScript", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementBanner, {
      item: sample, onOpen: () => {}, onDismiss: () => {},
    }));
    assert.match(html, /站点公告/);
    assert.match(html, /例行维护/);
    assert.match(html, /查看详情/);
    assert.match(html, /site-announcement-noscript/);
    assert.match(html, /部分页面正在维护/);
    assert.match(html, /不再显示公告/);
    assert.equal((html.match(/<button/g) || []).length, 2);
  });

  it("renders a public announcement list without a login or private inbox", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementList, {
      items: [sample], read: new Set<string>(), onOpen: () => {},
    }));
    assert.match(html, /例行维护/);
    assert.match(html, /未读/);
    assert.doesNotMatch(html, /GitHub 登录/);
    assert.equal((html.match(/<button/g) || []).length, 1);
    const seen = renderToStaticMarkup(createElement(AnnouncementList, {
      items: [sample], read: new Set([announcementToken(sample)]), onOpen: () => {},
    }));
    assert.doesNotMatch(seen, /aria-label="未读"/);
  });

  it("escapes announcement text instead of accepting raw HTML", () => {
    const html = renderToStaticMarkup(createElement(AnnouncementDetail, {
      item: { ...sample, title: '<script>alert(1)</script>', body: '<img src=x onerror=alert(1)>', link: '' },
      onClose: () => {},
    }));
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;img/);
    assert.doesNotMatch(html, /<script>|<img src=x/);
    assert.match(html, /role="dialog"|<dialog/);
  });
});
