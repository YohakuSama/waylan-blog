import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  locateAnchor,
  locateSegment,
  validAnchor,
  partitionIntervals,
} from "../shared/anchors";
import type { Anchor, Segment } from "../shared/types";
const segment = (
  exact: string,
  start = 0,
  prefix = "",
  suffix = "",
  blockId = "p1",
): Segment => ({
  blockId,
  quote: { type: "TextQuoteSelector", exact, prefix, suffix },
  position: { type: "TextPositionSelector", start, end: start + exact.length },
});
const anchor = (s: Segment[]): Anchor => ({
  schema: 1,
  postId: "echo-001",
  version: "v1",
  segments: s,
});
describe("persistent text anchoring", () => {
  it("restores exact offsets after a page refresh", () =>
    assert.deepEqual(
      locateSegment(
        segment("文字", 2),
        [{ id: "p1", text: "一段文字。" }],
        true,
      ),
      { blockId: "p1", start: 2, end: 4 },
    ));
  it("survives inserted words before the quotation", () =>
    assert.deepEqual(
      locateSegment(segment("文字", 2, "一段", "。"), [
        { id: "p1", text: "开头新增。一段文字。" },
      ]),
      { blockId: "p1", start: 7, end: 9 },
    ));
  it("uses context to disambiguate repeated quotations", () =>
    assert.deepEqual(
      locateSegment(segment("你好", 0, "后来", "世界"), [
        { id: "p1", text: "最初你好朋友，后来你好世界" },
      ]),
      { blockId: "p1", start: 9, end: 11 },
    ));
  it("refuses ambiguous repeated quotations", () =>
    assert.equal(
      locateSegment(segment("你好"), [{ id: "p1", text: "你好，你好。" }]),
      null,
    ));
  it("refuses wrong text even when offsets still fit", () =>
    assert.equal(
      locateSegment(
        segment("文字", 2),
        [{ id: "p1", text: "一段代码。" }],
        true,
      ),
      null,
    ));
  it("can relocate a moved block through context", () =>
    assert.deepEqual(
      locateSegment(segment("文字", 2, "一段", "。"), [
        { id: "new-id", text: "一段文字。" },
      ]),
      { blockId: "new-id", start: 2, end: 4 },
    ));
  it("does not move a short generic quote to an unrelated block", () =>
    assert.equal(
      locateSegment(segment("是的"), [
        { id: "new-id", text: "是的，我们继续。" },
      ]),
      null,
    ));
  it("uses UTF-16 offsets consistently with DOM Range", () =>
    assert.deepEqual(
      locateSegment(
        segment("留下", 3),
        [{ id: "p1", text: "🌱，留下回声" }],
        true,
      ),
      { blockId: "p1", start: 3, end: 5 },
    ));
  it("restores all segments of a multi-paragraph annotation", () =>
    assert.equal(
      locateAnchor(
        anchor([segment("第一"), segment("第二", 0, "", "", "p2")]),
        [
          { id: "p1", text: "第一段" },
          { id: "p2", text: "第二段" },
        ],
        "v1",
      )!.length,
      2,
    ));
  it("refuses a partially orphaned annotation", () =>
    assert.equal(
      locateAnchor(
        anchor([segment("第一"), segment("第二", 0, "", "", "p2")]),
        [
          { id: "p1", text: "第一段" },
          { id: "p2", text: "已经改写" },
        ],
        "v2",
      ),
      null,
    ));
  it("preserves all overlapping discussion identities", () =>
    assert.deepEqual(
      partitionIntervals([
        { start: 0, end: 5, id: "a" },
        { start: 3, end: 8, id: "b" },
      ]),
      [
        { start: 0, end: 3, ids: ["a"] },
        { start: 3, end: 5, ids: ["a", "b"] },
        { start: 5, end: 8, ids: ["b"] },
      ],
    ));
  it("validates article identity and rejects unbounded selectors", () => {
    assert.equal(validAnchor(anchor([segment("文字")]), "echo-001"), true);
    assert.equal(validAnchor(anchor([segment("文字")]), "other"), false);
    assert.equal(
      validAnchor(anchor([segment("x".repeat(2001))]), "echo-001"),
      false,
    );
    assert.equal(validAnchor(anchor([]), "echo-001"), false);
    assert.equal(
      validAnchor({ ...anchor([]), segments: [null] }, "echo-001"),
      false,
    );
  });
});
