import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { Comment, CommentPage } from "../shared/types";
import { CommentMarkdown } from "../src/features/discussions/CommentMarkdown";
import { safeDiscussionURL, visibleComment, discussionView, updateCommentNodes, updateCommentPage } from "../src/features/discussions/model";

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

  it("keeps reader progress semantics and both visual skins independently owned", () => {
    const reader = readFileSync("src/components/Reader.tsx", "utf8");
    const styles = readFileSync("src/styles/reader-progress.css", "utf8");
    const skins = readFileSync("src/styles/skins.css", "utf8");
    const responsive = readFileSync("src/styles/responsive.css", "utf8");
    const imports = readFileSync("src/styles/index.ts", "utf8");
    assert.match(reader, /role="progressbar"/);
    assert.match(reader, /aria-valuenow=\{progress\}/);
    assert.ok(imports.includes('import "./reader-progress.css";'));
    assert.doesNotMatch(skins, /\.reading-progress/,
      "theme decoration must have one visual owner instead of accumulating in skins.css");
    assert.doesNotMatch(responsive, /\.reading-progress > span/,
      "responsive.css must own only the reader bar's position");
    assert.ok(styles.includes('.reading-progress > span::after {'),
      "Editorial retains its amber endpoint");
    assert.ok(styles.includes(':root[data-skin="terminal"] .reading-progress > span::after {'),
      "Terminal uses a separate square cursor");
    assert.ok(styles.includes('border-radius: 0;') && styles.includes('animation: none;'));
    assert.ok(styles.includes(':root[data-skin="terminal"] .reading-progress[aria-valuenow="0"]'),
      "terminal cursor must not falsely show progress at 0%");
  });

  it("builds visible comment trees without changing dedupe precedence or source objects", () => {
    const root = { id: "root", body: "Root", author: null, createdAt: "", updatedAt: "", url: "" } as Comment;
    const emptyParent = { ...root, id: "empty", body: "   " };
    const reply = { ...root, id: "reply", body: "Reply" };
    const hiddenReply = { ...root, id: "hidden", body: "  " };
    const original: CommentPage = {
      nodes: [{ ...root, replies: { nodes: [reply, hiddenReply], totalCount: 2,
        pageInfo: { hasNextPage: false, endCursor: null } } }, emptyParent],
      totalCount: 2, mapped: true, discussionUrl: null,
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    const focused = { ...root, id: "focus", body: "Focused" };
    const fetched = [{ ...root, id: "reply", body: "Updated reply" }, { ...root, id: "focus", body: "Latest focus" },
      { ...root, id: "child", parentId: "empty", body: "Orphaned reply" }];
    const { visibleTopComments, visibleCount, allComments } = discussionView(original, focused, fetched);
    assert.deepEqual(visibleTopComments.map((c) => c.id), ["root"]);
    assert.equal(visibleCount, 1);
    assert.deepEqual(allComments.map((c) => c.id), ["root", "reply", "focus"]);
    assert.equal(allComments.find((c) => c.id === "reply")?.body, "Updated reply");
    assert.equal(allComments.find((c) => c.id === "focus")?.body, "Latest focus");
    assert.equal(original.nodes[0].replies?.nodes[0].parentId, undefined, "flattening must not mutate reply source");
    assert.equal(fetched[0].parentId, undefined);
  });

  it("reconciles comment edits and deletion with the original count and metadata semantics", () => {
    const root = { id: "root", body: "Root", author: null, createdAt: "", updatedAt: "", url: "" } as Comment;
    const reply = { ...root, id: "reply", body: "Old" };
    const page: CommentPage = {
      nodes: [{ ...root, replies: { nodes: [reply], totalCount: 1,
        pageInfo: { hasNextPage: false, endCursor: null } } }],
      totalCount: 5, mapped: true, discussionUrl: null,
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    const edited = updateCommentPage(page, "reply", { ...reply, body: "New" });
    assert.equal(edited.nodes[0].replies?.nodes[0].body, "New");
    assert.equal(edited.nodes[0].replies?.totalCount, 1);
    assert.equal(edited.totalCount, 5);
    assert.equal(page.nodes[0].replies?.nodes[0].body, "Old");
    const noReply = updateCommentPage(page, "reply", null);
    assert.equal(noReply.nodes[0].replies?.nodes.length, 0);
    assert.equal(noReply.nodes[0].replies?.totalCount, 0);
    assert.equal(noReply.totalCount, 5, "deleting a reply must not decrement top-level total");
    assert.deepEqual(updateCommentNodes([reply], "reply", null), []);
    const noRoot = updateCommentPage(page, "root", null);
    assert.deepEqual(noRoot.nodes, []);
    assert.equal(noRoot.totalCount, 4);
    assert.equal(page.nodes.length, 1);
  });
});
