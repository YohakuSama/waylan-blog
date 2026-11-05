import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./ci-plan.mjs";

test("docs-only changes skip code and browsers", () => {
  assert.deepEqual(classify(["README.md", "docs/ops/BRANCH_ARCHIVE.md"]), {
    code: false, browser: false, reader: false, feed: false, motion: false,
  });
});
test("backend PR runs core and relevant browser QA", () => {
  const p = classify(["worker/index.ts"]);
  assert.equal(p.code, true);
  assert.equal(p.browser, true);
  assert.equal(p.reader, false);
  assert.equal(p.motion, false);
});
test("reader UI changes run reader QA only", () => {
  const p = classify(["src/components/Reader.tsx"]);
  assert.equal(p.reader, true);
  assert.equal(p.feed, false);
  assert.equal(p.motion, false);
});
test("shared CSS changes select all relevant browser suites", () => {
  const p = classify(["src/styles/site.css"]);
  assert.ok(p.code && p.browser && p.reader && p.feed && p.motion);
});
test("CI-only and retired maintenance changes do not download browsers", () => {
  const expected = { code: true, browser: false, reader: false, feed: false, motion: false };
  for (const path of [
    ".github/workflows/verify.yml", "scripts/ci-plan.mjs",
    "scripts/ci-plan.test.mjs", "scripts/branch-maintenance.mjs",
    "scripts/maintenance.test.mjs",
  ]) assert.deepEqual(classify([path]), expected, path);
});
test("main pushes keep core gate but avoid duplicate browser installs", () => {
  const p = classify(["src/App.tsx"], "push");
  assert.equal(p.code, true);
  assert.equal(p.browser, false);
});
test("manual full run selects every suite", () => {
  assert.ok(Object.values(classify([], "workflow_dispatch", true)).every(Boolean));
});
test("published Markdown always triggers QA", () => {
  assert.deepEqual(classify(["content/notes/example.md"]), {
    code: true, browser: true, reader: true, feed: true, motion: false,
  });
});
test("public visual assets and route entrypoints trigger browser QA", () => {
  for (const path of ["public/logo.svg", "index.html"]) {
    const p = classify([path]);
    assert.equal(p.code, true);
    assert.equal(p.browser, true);
  }
});
test("retired images placeholder is documentation, not a visual asset", () => {
  assert.equal(classify(["public/images/README.txt"]).code, false);
});
test("reader submodules trigger reader but not feed or motion suites", () => {
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
