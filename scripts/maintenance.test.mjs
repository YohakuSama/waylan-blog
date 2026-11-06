import { test } from "node:test";
import { readFileSync } from "node:fs";
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
test("CI-only maintenance changes keep core verification without browser installation", () => {
  const expected = { code: true, browser: false, reader: false, feed: false, motion: false };
  for (const path of [
    ".github/workflows/verify.yml", "scripts/ci-plan.mjs",
    "scripts/maintenance.test.mjs", "scripts/branch-maintenance.mjs",
    "scripts/mobile-layout-audit.mjs",
  ]) assert.deepEqual(classify([path]), expected, path);
});
test("removed images placeholder does not invoke build or browser QA", () => {
  assert.equal(classify(["public/images/README.txt"]).code, false);
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

test("browser QA installs are bounded, cached immediately and never skipped by a cache hit", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.match(workflow, /uses: actions\/cache\/restore@v4/);
  assert.match(workflow, /uses: actions\/cache\/save@v4/);
  assert.match(workflow, /id: browsers\s+if:.*\n\s+timeout-minutes: 5/);
  assert.match(workflow, /npx playwright install-deps chromium firefox webkit/);
  assert.match(workflow, /npx playwright install chromium firefox webkit/);
  assert.ok(workflow.indexOf("Save browser binaries immediately on cache miss") <
    workflow.indexOf("Phone, tablet and desktop layout"),
    "an unsuccessful visual test must not discard the installed browser cache");
  assert.ok(workflow.includes("steps.browsers.outcome == 'success'"),
    "a missing browser binary must fail closed, never silently skip QA");
});

test("PR visual smoke checks all skins and representative device widths, full keeps breakpoint boundaries", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const visual = readFileSync("scripts/visual-smoke.mjs", "utf8");
  const parse = (name) => {
    const match = visual.match(new RegExp(`const ${name} = \\[([^\\]]+)\\];`));
    assert.ok(match, `missing ${name}`);
    return match[1].split(",").map(x => Number(x.trim()));
  };
  const focused = parse("smokeWidths");
  const full = parse("fullWidths");
  assert.deepEqual(focused, [1440, 1024, 860, 768, 767, 390, 320]);
  assert.equal(full.length, 16);
  for (const width of focused) assert.ok(full.includes(width));
  assert.match(workflow, /WAYLAN_VISUAL_MATRIX:/);
  assert.ok(workflow.includes("github.event_name == 'workflow_dispatch' && 'full' || 'smoke'"));
  assert.match(visual, /matrix === "smoke" \? smokeWidths : fullWidths/);
});
