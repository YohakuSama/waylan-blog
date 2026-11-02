import type { Anchor, Segment } from "./types";
export type Located = { blockId: string; start: number; end: number };
const allIndices = (text: string, quote: string) => {
  const result: number[] = [];
  let offset = 0;
  while (quote && offset <= text.length) {
    const i = text.indexOf(quote, offset);
    if (i < 0) break;
    result.push(i);
    offset = i + 1;
    if (result.length > 1000) break;
  }
  return result;
};
/** Exact quote + context are authoritative. Never guess a different quotation. UTF-16 offsets match DOM Range. */
export function locateSegment(
  segment: Segment,
  blocks: { id: string; text: string }[],
  sameVersion = false,
): Located | null {
  const exact = segment.quote.exact;
  if (!exact) return null;
  const candidates: (Located & { score: number })[] = [];
  for (const block of blocks)
    for (const start of allIndices(block.text, exact)) {
      const end = start + exact.length,
        prefix = segment.quote.prefix,
        suffix = segment.quote.suffix;
      const prefixMatch =
        !!prefix &&
        block.text.slice(Math.max(0, start - prefix.length), start) === prefix;
      const suffixMatch =
        !!suffix && block.text.slice(end, end + suffix.length) === suffix;
      const stable = block.id === segment.blockId;
      const positionMatch =
        sameVersion &&
        stable &&
        segment.position.start === start &&
        segment.position.end === end;
      const score =
        (positionMatch ? 100 : 0) +
        (prefixMatch ? 16 : 0) +
        (suffixMatch ? 16 : 0) +
        (stable ? 4 : 0);
      candidates.push({ blockId: block.id, start, end, score });
    }
  candidates.sort((a, b) => b.score - a.score);
  const first = candidates[0];
  if (!first || candidates[1]?.score === first.score) return null;
  if (first.blockId !== segment.blockId && first.score < 16) return null;
  return { blockId: first.blockId, start: first.start, end: first.end };
}
export function locateAnchor(
  anchor: Anchor,
  blocks: { id: string; text: string }[],
  version: string,
): Located[] | null {
  const result = anchor.segments.map((s) =>
    locateSegment(s, blocks, anchor.version === version),
  );
  return !result.length || result.some((x) => !x)
    ? null
    : (result as Located[]);
}
export function validAnchor(input: unknown, postId: string): input is Anchor {
  if (!input || typeof input !== "object") return false;
  const a = input as Anchor;
  return (
    a.schema === 1 &&
    a.postId === postId &&
    typeof a.version === "string" &&
    a.version.length <= 80 &&
    Array.isArray(a.segments) &&
    a.segments.length > 0 &&
    a.segments.length <= 8 &&
    a.segments.every(
      (s) =>
        !!s &&
        typeof s === "object" &&
        typeof s.blockId === "string" &&
        /^[\w-]{1,120}$/.test(s.blockId) &&
        s.quote?.type === "TextQuoteSelector" &&
        typeof s.quote.exact === "string" &&
        s.quote.exact.length > 0 &&
        s.quote.exact.length <= 2000 &&
        typeof s.quote.prefix === "string" &&
        s.quote.prefix.length <= 64 &&
        typeof s.quote.suffix === "string" &&
        s.quote.suffix.length <= 64 &&
        s.position?.type === "TextPositionSelector" &&
        Number.isInteger(s.position.start) &&
        s.position.start >= 0 &&
        Number.isInteger(s.position.end) &&
        s.position.end > s.position.start &&
        s.position.end - s.position.start === s.quote.exact.length,
    ) &&
    a.segments.reduce((n, s) => n + s.quote.exact.length, 0) <= 4000
  );
}
export function anchorQuote(anchor: Anchor) {
  return anchor.segments.map((s) => s.quote.exact).join("\n");
}
/** Split overlapping annotations into spans retaining every associated discussion. */
export function partitionIntervals(
  intervals: { start: number; end: number; id: string }[],
) {
  const points = [...new Set(intervals.flatMap((i) => [i.start, i.end]))].sort(
    (a, b) => a - b,
  );
  return points.slice(0, -1).flatMap((start, i) => {
    const end = points[i + 1];
    const ids = [
      ...new Set(
        intervals
          .filter((x) => x.start < end && x.end > start)
          .map((x) => x.id),
      ),
    ];
    return ids.length ? [{ start, end, ids }] : [];
  });
}
