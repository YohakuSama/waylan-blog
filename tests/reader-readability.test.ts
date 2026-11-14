import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("src/styles.css", "utf8");
const reader = readFileSync("src/components/Reader.tsx", "utf8");
const settings = readFileSync("src/components/Settings.tsx", "utf8");
const toc = readFileSync("src/features/reader/ReaderToc.tsx", "utf8");
const browserSmoke = readFileSync("scripts/reader-deep-smoke.mjs", "utf8");

describe("reader readability regression contracts", () => {
  it("maps every 16/18/20px setting to the same body size on phones", () => {
    assert.match(reader, /const FONT_SIZES = \[16, 18, 20\]/);
    assert.match(reader, /"--reader-font": `\$\{fontSize\}px`/);
    assert.match(settings, /name="reader-font-size"/);
    assert.match(css, /\.reader-prose\s*\{[^}]*font-size:\s*var\(--reader-font, 18px\);/s);
    assert.doesNotMatch(css, /calc\(var\(--reader-font[^)]*\)\s*-\s*2px\)/,
      "CSS must not silently reduce the selected size on phones");
    assert.match(browserSmoke, /for \(const size of \[16, 18, 20\]\)/,
      "browser smoke must check each option's computed font-size");
  });

  it("retains the reading measure, code/table scrolling, and both TOC forms", () => {
    assert.match(css, /--reading-width:\s*720px/);
    assert.match(css, /\.reader-prose pre\s*\{[^}]*overflow-x: auto/s);
    assert.match(css, /\.reader-prose pre code\s*\{[^}]*white-space: pre/s);
    assert.match(css, /\.article-block\[data-type="table"\]\s*\{[^}]*overflow-x: auto/s);
    assert.match(css, /\.toc-inner nav a\s*\{[^}]*overflow-wrap: anywhere/s);
    assert.match(css, /@media \(max-width: 1040px\)\s*\{\s*\.reader-toc\s*\{\s*display: none;/s);
    assert.match(toc, /aria-current=\{/);
    assert.match(reader, /destination\.focus\(\{ preventScroll: true \}\)/);
  });

  it("keeps phone discussion content and editors legible", () => {
    const start = css.indexOf("/* Breakpoints:");
    const phone = css.slice(css.indexOf("@media (max-width: 700px) {", start),
      css.indexOf("@media (max-width: 380px) {", start));
    assert.match(phone, /\.comment-markdown\s*\{\s*font-size: 14px;/);
    assert.match(phone, /\.comment-quote\s*\{\s*font-size: 13px;/);
    assert.match(phone, /\.comment-actions \.text-button\s*\{[^}]*min-height: 40px;/s);
    assert.match(phone, /\.discussion-dialog \.comment-composer textarea\s*\{\s*font-size: 16px;/);
    assert.match(browserSmoke, /commentStyles\.editorFont, "16px"/);
  });
});
