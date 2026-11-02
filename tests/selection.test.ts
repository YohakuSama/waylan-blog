import { JSDOM } from "jsdom";
const dom = new JSDOM("<!doctype html><body></body>");
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Range: dom.window.Range,
  NodeFilter: dom.window.NodeFilter,
});
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { captureSelection, captureBlockExcerpt, applyHighlights } from "../src/lib/selection";
import type { Anchor, Post } from "../shared/types";
const html =
  '<div data-block-id="p1">一段<strong>认真读过</strong>的文字。</div><div data-block-id="p2">第二段也留下了回声。</div>';
const post = { id: "echo-001", version: "v1" } as Post;
const makeAnchor = (start: number, end: number): Anchor => ({
  schema: 1,
  postId: "echo-001",
  version: "v1",
  segments: [
    {
      blockId: "p1",
      quote: {
        type: "TextQuoteSelector",
        exact: "一段认真读过的文字。".slice(start, end),
        prefix: "",
        suffix: "",
      },
      position: { type: "TextPositionSelector", start, end },
    },
  ],
});
afterEach(() => mock.restoreAll());
describe("real DOM selection and overlapping marks", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="prose">${html}</div>`;
    window.getSelection()?.removeAllRanges();
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      value: () => ({}),
      configurable: true,
      writable: true,
    });
    mock.method(Range.prototype, "getBoundingClientRect", () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width: 100,
      height: 20,
      bottom: 20,
      right: 100,
      toJSON() {},
    }));
  });
  it("captures a paragraph by tap without any native Selection or Range", () => {
    const root = document.getElementById("prose")!,
      paragraph = root.querySelector<HTMLElement>('[data-block-id="p1"]')!;
    assert.equal(window.getSelection()?.rangeCount, 0);
    const result = captureBlockExcerpt(root, post, paragraph)!;
    assert.ok(result);
    assert.equal(result.anchor.segments[0].quote.exact, "一段认真读过的文字。");
    assert.deepEqual(result.anchor.segments[0].position, {
      type: "TextPositionSelector", start: 0, end: "一段认真读过的文字。".length,
    });
    applyHighlights(root, post, [{ id: "local-sample", commentId: "", anchor: result.anchor }]);
    // Each text node is marked separately so inline <strong> formatting survives.
    assert.equal([...root.querySelectorAll("mark.private-mark")]
      .map((mark) => mark.textContent).join(""), "一段认真读过的文字。");
  });
  it("rejects code and blocks outside the reader, and bounds large excerpts", () => {
    const root = document.getElementById("prose")!,
      paragraph = root.querySelector<HTMLElement>('[data-block-id="p1"]')!;
    paragraph.dataset.type = "code";
    assert.equal(captureBlockExcerpt(root, post, paragraph), null);
    paragraph.dataset.type = "paragraph";
    document.body.insertAdjacentHTML("beforeend", '<p data-block-id="alien">外部段落</p>');
    assert.equal(captureBlockExcerpt(root, post, document.querySelector<HTMLElement>("#prose + p")!), null);
    paragraph.textContent = "  " + "甲".repeat(700);
    const result = captureBlockExcerpt(root, post, paragraph)!;
    assert.equal(result.anchor.segments[0].position.start, 2);
    assert.equal(result.anchor.segments[0].quote.exact.length, 400);
    assert.equal(result.anchor.segments[0].quote.suffix.length, 32);
  });
  it("captures a selection spanning inline emphasis", () => {
    const root = document.getElementById("prose")!,
      p = root.firstChild!,
      range = document.createRange();
    range.setStart(p.firstChild!, 1);
    range.setEnd(p.childNodes[2], 3);
    window.getSelection()!.addRange(range);
    const result = captureSelection(root, post)!;
    assert.equal(result.anchor.segments[0].quote.exact, "段认真读过的文字");
    assert.partialDeepStrictEqual(result.anchor.segments[0].position, {
      start: 1,
      end: 9,
    });
  });
  it("captures selections across two paragraphs", () => {
    const root = document.getElementById("prose")!,
      range = document.createRange();
    range.setStart(root.firstChild!.firstChild!, 1);
    range.setEnd(root.lastChild!.firstChild!, 3);
    window.getSelection()!.addRange(range);
    assert.equal(captureSelection(root, post)!.anchor.segments.length, 2);
  });
  it("rejects selection outside the article", () => {
    const root = document.getElementById("prose")!;
    document.body.appendChild(document.createTextNode("外部文字"));
    const range = document.createRange();
    range.selectNodeContents(document.body);
    window.getSelection()!.addRange(range);
    assert.equal(captureSelection(root, post), null);
  });
  it("restores persisted marks on a fresh DOM without retaining Range objects", () => {
    const root = document.getElementById("prose")!,
      data = JSON.parse(
        JSON.stringify({ id: "a", commentId: "a", anchor: makeAnchor(2, 6) }),
      );
    applyHighlights(root, post, [data]);
    assert.equal(root.querySelector("mark")?.textContent, "认真读过");
    root.innerHTML = html;
    applyHighlights(root, post, [data]);
    assert.equal(root.querySelector("mark")?.textContent, "认真读过");
  });
  it("keeps text and semantic emphasis intact with overlapping marks", () => {
    const root = document.getElementById("prose")!,
      original = root.textContent;
    applyHighlights(root, post, [
      { id: "a", commentId: "a", anchor: makeAnchor(1, 7) },
      { id: "b", commentId: "b", anchor: makeAnchor(4, 9) },
    ]);
    assert.equal(root.textContent, original);
    assert.notEqual(root.querySelector("strong"), null);
    assert.notEqual(root.querySelector('[data-echo-ids="a b"]'), null);
    applyHighlights(root, post, []);
    assert.equal(root.textContent, original);
    assert.equal(root.querySelector("mark"), null);
  });
  it("reports orphaned annotations instead of highlighting a wrong passage", () => {
    const root = document.getElementById("prose")!;
    root.innerHTML = '<div data-block-id="p1">原文已经重写。</div>';
    assert.deepEqual(
      applyHighlights(root, post, [
        { id: "a", commentId: "a", anchor: makeAnchor(2, 6) },
      ]),
      ["a"],
    );
    assert.equal(root.querySelector("mark"), null);
  });
});
