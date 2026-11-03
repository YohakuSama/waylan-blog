import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { articleHTML } from "../src/lib/runtime";

describe("Reader HTML keyboard accessibility", () => {
  it("makes plain and classed code blocks focusable for horizontal keyboard scroll", () => {
    assert.equal(articleHTML("<pre><code>print(1)</code></pre>"),
      '<pre tabindex="0"><code>print(1)</code></pre>');
    assert.equal(articleHTML('<pre class="highlight"><code>x</code></pre>'),
      '<pre tabindex="0" class="highlight"><code>x</code></pre>');
  });
  it("preserves existing tabindex and text without duplicate attributes", () => {
    assert.equal(articleHTML('<pre tabindex="0"><code>x</code></pre>'),
      '<pre tabindex="0"><code>x</code></pre>');
    assert.equal(articleHTML("<p>normal text</p>"), "<p>normal text</p>");
  });
});
