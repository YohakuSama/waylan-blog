import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./ci-plan.mjs";

test("docs-only changes keep a successful, low-cost status", () => {
  assert.deepEqual(classify(["README.md", "docs/ops/BRANCH_ARCHIVE.md"]),
    { code: false, browser: false, reader: false, feed: false, motion: false });
});
test("server-only PR runs core plus relevant browser QA, not reader or motion", () => {
  const p = classify(["worker/index.ts"]);
  assert.equal(p.code, true);
  assert.equal(p.browser, true);
  assert.equal(p.reader, false);
  assert.equal(p.motion, false);
});
test("reader changes run targeted reader QA, without feed or motion duplication", () => {
  const p = classify(["src/components/Reader.tsx"]);
  assert.equal(p.reader, true);
  assert.equal(p.feed, false);
  assert.equal(p.motion, false);
});
test("shared design changes run all affected groups", () => {
  const p = classify(["src/styles/site.css"]);
  assert.ok(p.code && p.browser && p.reader && p.feed && p.motion);
});
test("workflow changes verify all contracts once", () => {
  const p = classify([".github/workflows/verify.yml"]);
  assert.ok(p.code && p.browser && p.reader && p.feed && p.motion);
});
test("main pushes retain the core gate without duplicate browser installation", () => {
  const p = classify(["src/App.tsx"], "push");
  assert.equal(p.code, true);
  assert.equal(p.browser, false);
});
test("owner-requested full suite bypasses file filtering", () => {
  const p = classify([], "workflow_dispatch", true);
  assert.ok(Object.values(p).every(Boolean));
});

test("published Markdown never counts as documentation-only", () => {
  assert.deepEqual(classify(["content/notes/example.md"]), {
    code: true, browser: true, reader: true, feed: true, motion: false,
  });
});
test("public assets and routes still trigger visual QA", () => {
  for (const path of ["public/logo.svg", "index.html"]) {
    const p = classify([path]);
    assert.equal(p.code, true);
    assert.equal(p.browser, true);
  }
});

test("reader feature submodules select reader QA without unrelated feed/motion groups", () => {
  for (const path of [
    "src/features/reader/ReaderToc.tsx",
    "src/features/reader/ArticleHeader.tsx",
    "src/features/discussions/CommentItem.tsx",
    "src/features/discussions/model.ts",
    "src/features/annotations/FutureFeature.tsx",
  ]) {
    const p = classify([path]);
    assert.equal(p.code, true, path);
    assert.equal(p.browser, true, path);
    assert.equal(p.reader, true, path);
    assert.equal(p.feed, false, path);
    assert.equal(p.motion, false, path);
  }
});
