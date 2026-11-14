import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArchiveIndex } from "../src/pages/Archive";
import { Heatmap } from "../src/components/Sidebar";
import { posts } from "../src/lib/data";

const entry = (date: string, slug: string, title = "一条测试记录") => ({
  ...posts[0],
  id: `archive-${slug}`,
  slug,
  date,
  title,
});

describe("archive timeline states", () => {
  it("does not render a redundant year jump for one year", () => {
    const html = renderToStaticMarkup(createElement(ArchiveIndex, {
      entries: [entry("2026-10-31", "a"), entry("2026-09-14", "b")],
    }));
    assert.doesNotMatch(html, /class="archive-year-nav"/);
    assert.match(html, /id="year-2026"/);
    assert.match(html, /10(?:<!-- -->)? 月/);
    assert.match(html, /9(?:<!-- -->)? 月/);
    assert.ok(html.indexOf("10") < html.indexOf("9"));
  });

  it("renders distinct ordered anchors and counts for multiple years", () => {
    const html = renderToStaticMarkup(createElement(ArchiveIndex, {
      entries: [
        entry("2026-10-31", "a"),
        entry("2026-09-14", "b"),
        entry("2025-03-01", "c"),
        entry("2024-01-02", "d"),
      ],
    }));
    assert.deepEqual(
      [...html.matchAll(/href="#year-([0-9]{4})"/g)].map((match) => match[1]),
      ["2026", "2025", "2024"],
    );
    for (const year of ["2026", "2025", "2024"]) {
      assert.match(html, new RegExp(`id="year-${year}"`));
    }
    assert.ok(html.includes("2026<span>2 条</span>"));
    assert.ok(html.includes("2025<span>1 条</span>"));
  });

  it("preserves the empty state and never invents a year", () => {
    const html = renderToStaticMarkup(createElement(ArchiveIndex, { entries: [] }));
    assert.match(html, /第一篇记录发布后/);
    assert.doesNotMatch(html, /class="archive-year"/);
  });

  it("keeps long CJK titles separate from type metadata", () => {
    const title = "关于静态内容构建与边缘渲染机制在不同网络环境中保持可靠性的记录".repeat(2);
    const html = renderToStaticMarkup(createElement(ArchiveIndex, {
      entries: [entry("2026-10-31", "long", title)],
    }));
    assert.match(html, /class="archive-entry-copy"/);
    assert.match(html, /class="archive-type"/);
    assert.match(html, /class="archive-entry-title"/);
    assert.ok(html.indexOf('class="archive-entry-title"') < html.indexOf('class="archive-type"'));
    assert.ok(html.includes(title));
    assert.ok(html.includes('href="/post/long"'));
  });

  it("offers keyboard- and touch-accessible heatmap date details only when requested", () => {
    const compact = renderToStaticMarkup(Heatmap());
    const detailed = renderToStaticMarkup(Heatmap({ showDates: true }));
    assert.doesNotMatch(compact, /class="heatmap-details"/);
    assert.match(detailed, /<details class="heatmap-details">/);
    assert.match(detailed, /查看具体更新日期/);
    assert.match(detailed, /每格代表一天/);
    assert.match(detailed, /<time dateTime=|<time dateTime="|<time datetime="/);
    const mostRecent = [...posts].sort((a, b) => b.date.localeCompare(a.date))[0]?.date;
    assert.ok(mostRecent && detailed.includes(mostRecent));
  });
});
