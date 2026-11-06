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
  assert.ok(workflow.indexOf("Probe native browser startup before apt") <
    workflow.indexOf("Install missing Linux browser libraries only if needed"),
    "do not apt-install packages before testing whether browsers already launch");
  assert.match(workflow, /steps\.browser-probe\.outputs\.needs_linux_deps == 'true'/,
    "native package installation must be strictly conditional on a real failed probe");
  assert.ok(workflow.includes("node scripts/ci-browser-runtime.mjs verify"),
    "all three engines must start successfully before browser test gates can pass");
  const probe = readFileSync("scripts/ci-browser-runtime.mjs", "utf8");
  for (const name of ["chromium", "firefox", "webkit"]) assert.ok(probe.includes(name));
  assert.ok(probe.includes("engine.launch") && probe.includes("browser.newPage") &&
    probe.includes("needs_linux_deps=") &&
    probe.includes("Browser runtime verification failed after dependency repair"),
    "probe must launch every browser, report repair need and fail on unsuccessful verification");
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
  assert.deepEqual(focused, [1440, 1025, 1024, 860, 768, 767, 601, 390, 320]);
  assert.equal(full.length, 18);
  assert.ok(full.includes(600) && full.includes(601), "retain both sides of the former phone-cover boundary");
  assert.ok(full.includes(1024) && full.includes(1025), "retain both sides of the tablet filter boundary");
  for (const width of focused) assert.ok(full.includes(width));
  assert.match(workflow, /WAYLAN_VISUAL_MATRIX:/);
  assert.ok(workflow.includes("github.event_name == 'workflow_dispatch' && 'full' || 'smoke'"));
  assert.match(visual, /matrix === "smoke" \? smokeWidths : fullWidths/);
});

test("draft PRs avoid runner compute, but ready-for-review and subsequent changes are gated", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft\]/);
  assert.ok(workflow.includes("if: ${{ github.event_name != 'pull_request' || !github.event.pull_request.draft }}"));
  assert.ok(workflow.includes("cancel-in-progress: ${{ github.event_name == 'pull_request' }}"),
    "new ready-PR revisions must supersede stale checks");
  assert.ok(workflow.includes("steps.plan.outputs.browser == 'true'"),
    "ready PRs must retain impacted browser checks");
  assert.ok(workflow.includes("timeout-minutes: 30"), "keep bounded runners");
  assert.doesNotMatch(workflow, /runs-on:.*self-hosted/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
});

test("clean installs and isolated browser states are not replaced by persisted site data", () => {
  const workflow = readFileSync(".github/workflows/verify.yml", "utf8");
  const visual = readFileSync("scripts/visual-smoke.mjs", "utf8");
  assert.match(workflow, /run: npm ci/);
  assert.match(visual, /browser\.newContext\(\{/);
  assert.doesNotMatch(workflow, /node_modules\/|\.localStorage|cache:.*localStorage|\.cache\/vite/);
});
