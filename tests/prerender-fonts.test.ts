import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { visibleFontText } from "../scripts/visible-font-text";

describe("font preload glyph selection", () => {
  it("excludes nonvisible script, style and SVG glyphs before calculating font ranges", () => {
    const source = [
      '<div>可见正文',
      '<script type="application/ld+json">{"hidden":"虚构Unicode"}<\/script>',
      '<svg viewBox="0 0 4 4"><title>虚拟标题</title><path d="M0 0"></path></svg>',
      '<style>.hidden::after{content:"不应预载"}</style>',
      '<strong>实际内容</strong></div>',
    ].join("");
    assert.equal(visibleFontText(source), "可见正文实际内容");
  });
  it("supports uppercase names, attributes, whitespace and repeated blocks", () => {
    const html = '甲<SCRIPT type="a">不能出现</SCRIPT><span>乙</span><svg><text>忽略</text></svg>丙';
    assert.equal(visibleFontText(html), "甲乙丙");
  });
  it("caps work to the first 1600 visible characters", () => {
    assert.equal(visibleFontText("汉".repeat(2000)).length, 1600);
  });
});
