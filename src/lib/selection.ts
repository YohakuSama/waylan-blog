import { motionAllowed } from "./motion";
import type { Anchor, Annotation, Post, Segment } from "../../shared/types";
import { locateAnchor, partitionIntervals } from "../../shared/anchors";
export function captureSelection(
  root: HTMLElement,
  post: Post,
): { anchor: Anchor; rect: DOMRect } | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return null;
  if (
    range.startContainer.parentElement?.closest("pre,button,textarea,input") ||
    range.endContainer.parentElement?.closest("pre,button,textarea,input")
  )
    return null;
  const segments: Segment[] = [];
  for (const block of root.querySelectorAll<HTMLElement>("[data-block-id]")) {
    if (!range.intersectsNode(block)) continue;
    const text = block.textContent || "";
    if (!text) continue;
    let start = 0,
      end = text.length;
    if (block.contains(range.startContainer)) {
      const before = document.createRange();
      before.selectNodeContents(block);
      before.setEnd(range.startContainer, range.startOffset);
      start = before.toString().length;
    }
    if (block.contains(range.endContainer)) {
      const before = document.createRange();
      before.selectNodeContents(block);
      before.setEnd(range.endContainer, range.endOffset);
      end = before.toString().length;
    }
    if (start >= end) continue;
    segments.push({
      blockId: block.dataset.blockId!,
      quote: {
        type: "TextQuoteSelector",
        exact: text.slice(start, end),
        prefix: text.slice(Math.max(0, start - 32), start),
        suffix: text.slice(end, end + 32),
      },
      position: { type: "TextPositionSelector", start, end },
    });
  }
  const len = segments.reduce((n, s) => n + s.quote.exact.length, 0);
  if (
    !segments.length ||
    segments.length > 8 ||
    len < 2 ||
    len > 4000 ||
    segments.some((s) => s.quote.exact.length > 2000)
  )
    return null;
  return {
    anchor: { schema: 1, postId: post.id, version: post.version, segments },
    rect: range.getBoundingClientRect(),
  };
}
export function applyHighlights(
  root: HTMLElement,
  post: Post,
  annotations: Annotation[],
) {
  root
    .querySelectorAll("mark[data-echo-ids]")
    .forEach((mark) => mark.replaceWith(...mark.childNodes));
  root.querySelectorAll("[data-echo-count]").forEach((el) => {
    el.removeAttribute("data-echo-count");
    el.classList.remove("has-echo");
  });
  root.normalize();
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-block-id]")].map(
    (el) => ({ id: el.dataset.blockId!, text: el.textContent || "", el }),
  );
  const ranges = new Map<
    string,
    { start: number; end: number; id: string }[]
  >();
  const orphaned: string[] = [];
  for (const annotation of annotations) {
    const located = locateAnchor(annotation.anchor, blocks, post.version);
    if (!located) {
      orphaned.push(annotation.id);
      continue;
    }
    for (const part of located) {
      const arr = ranges.get(part.blockId) || [];
      arr.push({ ...part, id: annotation.id });
      ranges.set(part.blockId, arr);
    }
  }
  for (const block of blocks) {
    const intervals = ranges.get(block.id);
    if (!intervals) continue;
    const parts = partitionIntervals(intervals);
    block.el.classList.add("has-echo");
    block.el.dataset.echoCount = String(
      new Set(intervals.map((i) => i.id)).size,
    );
    const walker = document.createTreeWalker(block.el, NodeFilter.SHOW_TEXT);
    const nodes: { node: Text; start: number; end: number }[] = [];
    let position = 0;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const start = position;
      position += node.textContent?.length || 0;
      nodes.push({ node: node as Text, start, end: position });
    }
    for (const item of nodes) {
      const hits = parts.filter(
        (p) => p.start < item.end && p.end > item.start,
      );
      if (!hits.length) continue;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      const text = item.node.data;
      for (const hit of hits) {
        const start = Math.max(0, hit.start - item.start),
          end = Math.min(text.length, hit.end - item.start);
        if (start > offset) fragment.append(text.slice(offset, start));
        const mark = document.createElement("mark");
        mark.dataset.echoIds = hit.ids.join(" ");
        mark.textContent = text.slice(start, end);
        mark.tabIndex = 0;
        mark.role = "button";
        mark.setAttribute(
          "aria-label",
          `查看这段文字的 ${hit.ids.length} 条讨论或私人划线`,
        );
        if (hit.ids.every((id) => id.startsWith("local-")))
          mark.className = "private-mark";
        fragment.append(mark);
        offset = end;
      }
      if (offset < text.length) fragment.append(text.slice(offset));
      item.node.replaceWith(fragment);
    }
  }
  return orphaned;
}
export function jumpToAnchor(root: HTMLElement, post: Post, anchor: Anchor) {
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-block-id]")].map(
    (el) => ({ id: el.dataset.blockId!, text: el.textContent || "" }),
  );
  const located = locateAnchor(anchor, blocks, post.version);
  if (!located) return false;
  const block = [...root.querySelectorAll<HTMLElement>("[data-block-id]")].find(
    (element) => element.dataset.blockId === located[0].blockId,
  );
  if (!block) return false;
  block.scrollIntoView({
    block: "center",
    behavior: motionAllowed() ? "smooth" : "instant",
  });
  block.classList.add("anchor-focus");
  setTimeout(() => block.classList.remove("anchor-focus"), 1800);
  return true;
}
