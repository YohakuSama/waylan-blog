import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { Comment } from "../shared/types";
import { CommentMarkdown } from "../src/features/discussions/CommentMarkdown";
import { safeDiscussionURL, visibleComment } from "../src/features/discussions/model";

describe("Reader feature module contracts", () => {
  it("renders published Markdown and preview through one safe renderer", () => {
    const body = "A **bold** [link](https://github.com) ![inline image](https://example.org/a.png)";
    const published = renderToStaticMarkup(createElement(CommentMarkdown, { body }));
    const preview = renderToStaticMarkup(createElement(CommentMarkdown, { body, preview: true }));
    for (const html of [published, preview]) {
      assert.match(html, /<strong>bold<\/strong>/);
      assert.match(html, /rel="nofollow noopener noreferrer"/);
      assert.match(html, /<span>\[图片：inline image\]<\/span>/);
      assert.doesNotMatch(html, /<img/);
    }
    assert.match(preview, /id="echo-preview"/);
    assert.match(preview, /aria-label="评论效果预览"/);
    assert.doesNotMatch(published, /id="echo-preview"/);
  });

  it("never opens arbitrary comment URLs", () => {
    assert.equal(safeDiscussionURL("https://github.com/owner/repo/discussions/1"),
      "https://github.com/owner/repo/discussions/1");
    for (const invalid of [
      "javascript:alert(1)",
      "http://github.com/owner",
      "https://github.com.example.org/owner",
      "https://example.org",
    ]) assert.equal(safeDiscussionURL(invalid), "#");
  });

  it("hides only empty GitHub comment parents, without mutating the comment", () => {
    const comment: Comment = {
      id: "1", body: "  ", url: "https://github.com/a",
      createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z",
      author: null,
    };
    assert.equal(visibleComment(comment), false);
    assert.equal(visibleComment({ ...comment, body: "reply" }), true);
    assert.equal(comment.body, "  ");
  });

  it("discussion view uses explicit post identity, not global route or post catalog", () => {
    const item = readFileSync("src/features/discussions/CommentItem.tsx", "utf8");
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    assert.match(item, /postId: string/);
    assert.match(item, /postId=\{postId\}/);
    assert.equal(item.includes("useRouter"), false);
    assert.equal(item.includes("posts.find("), false);
    assert.equal((reader.match(/postId=\{post.id\}/g) || []).length, 2);
  });

  it("Reader composes stable feature exports rather than redeclaring their internals", () => {
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    const toc = readFileSync("src/features/reader/ReaderToc.tsx", "utf8");
    assert.ok(reader.includes('from "../features/discussions"'));
    assert.ok(reader.includes('from "../features/reader"'));
    assert.equal(reader.includes("function CommentItem("), false);
    assert.equal(reader.includes("function ImageViewer("), false);
    assert.ok(toc.includes('id="reader-toc"'));
    assert.ok(toc.includes("onSelectSection(t.id)"));
  });

  it("scroll tracking, saved reading position and TOC state have one owner", () => {
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    const progress = readFileSync("src/features/reader/useReadingProgress.ts", "utf8");
    assert.ok(reader.includes("useReadingProgress(post, article, prose, excerptMode, setSelection)"));
    assert.equal(reader.includes('window.addEventListener("scroll", scroll)'), false);
    assert.ok(progress.includes('window.addEventListener("scroll", scroll, { passive: true })'));
    assert.ok(progress.includes('new URLSearchParams(location.search).get("resume") === "1"'));
    assert.ok(progress.includes("saved?.slug === post.slug ? saved.blockId : undefined"));
    assert.ok(progress.includes('storage.set("reading"'));
    assert.ok(progress.includes("cancelAnimationFrame(frame)"));
    assert.ok(progress.includes('!window.matchMedia("(any-pointer: coarse)").matches'));
  });
});
