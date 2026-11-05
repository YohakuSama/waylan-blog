import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "./ci-plan.mjs";
import { pruneEligibility } from "./branch-maintenance.mjs";

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

const record = { name: "fix/example", sha: "a".repeat(40),
  kind: "merged", pr: 42, mergedAt: "2026-11-05T10:00:00Z" };
const live = { name: "fix/example", commit: { sha: record.sha }, protected: false };
const prs = [{ number: 42, state: "closed", merged_at: record.mergedAt,
  head: { ref: record.name, sha: record.sha } }];
test("only the archived merged SHA can be removed", () => {
  assert.equal(pruneEligibility(record, live, prs), "eligible");
  assert.equal(pruneEligibility(record, { ...live, commit: { sha: "b".repeat(40) } }, prs), "sha-changed");
  assert.equal(pruneEligibility({ ...record, kind: "closed-unmerged" }, live, prs), "not-approved");
  assert.equal(pruneEligibility({ ...record, name: "main" }, live, prs), "protected");
  assert.equal(pruneEligibility(record, { ...live, protected: true }, prs), "protected");
  assert.equal(pruneEligibility(record, live, [...prs,
    { state: "open", head: { ref: record.name } }]), "open-pr");
  assert.equal(pruneEligibility(record, live, []), "merge-unverified");
});
