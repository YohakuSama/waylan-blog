import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Admin feature boundaries", () => {
  it("keeps /admin entry focused on appearance, authentication and root mount", () => {
    const entry = read("src/admin/main.tsx");
    assert.match(entry, /function Gate\(/);
    assert.match(entry, /setAdminCsrf\(next\.csrf \|\| ""\)/);
    assert.match(entry, /<Dashboard session=\{session\}/);
    assert.match(entry, /createRoot\(document\.getElementById\("admin"\)!\)/);
    assert.doesNotMatch(entry, /function (PostEditor|SiteEditor|Posts|Discussions)\(/);
    assert.doesNotMatch(entry, /await fetch\(/);
  });

  it("isolates post editing from site editing without changing privileged API routes", () => {
    const post = read("src/admin/PostEditor.tsx");
    const site = read("src/admin/SiteEditor.tsx");
    assert.match(post, /export function PostEditor\(/);
    assert.match(site, /export function SiteEditor\(/);
    assert.ok(post.includes('"/api/admin/post"') && post.includes('"PUT"'));
    assert.ok(site.includes('"/api/admin/site"') && site.includes('"PUT"'));
    assert.ok(post.includes("usedUploads(") && site.includes("usedUploads("));
    assert.ok(post.includes("useLeaveGuard(dirty)") && site.includes("useLeaveGuard(dirty)"));
    assert.ok(post.includes("useSaveKey(save)") && site.includes("useSaveKey(save)"));
  });

  it("places list refresh, discussion setup and deployment status in the dashboard", () => {
    const dashboard = read("src/admin/Dashboard.tsx");
    assert.match(dashboard, /export function Dashboard\(/);
    assert.match(dashboard, /function Posts\(/);
    assert.match(dashboard, /function Discussions\(/);
    assert.match(dashboard, /function DeployStatus\(/);
    assert.match(dashboard, /const latest = useRef\(0\)/);
    assert.match(dashboard, /run !== latest\.current/);
    assert.ok(dashboard.includes('"/api/admin/content"'));
    assert.ok(dashboard.includes('"/api/admin/status"'));
    assert.ok(dashboard.includes('"/api/admin/discussions"'));
    assert.ok(dashboard.includes('"/api/admin/post", "DELETE"'));
  });

  it("shares one editor Markdown renderer, file validation and confirmation dialog", () => {
    const ui = read("src/admin/ui.tsx");
    const helpers = read("src/admin/helpers.ts");
    assert.match(ui, /export function Field\(/);
    assert.match(ui, /export function Markdown\(/);
    assert.match(ui, /export function Confirm\(/);
    assert.match(ui, /skipHtml/);
    assert.match(ui, /<MarkdownTools/);
    assert.match(helpers, /MAX_IMAGE/);
    assert.match(helpers, /uploadPath\(bytes\)/);
    assert.match(helpers, /usedUploads/);
    assert.match(helpers, /const stop = \(event: BeforeUnloadEvent\)/);
    assert.match(helpers, /event\.key\.toLowerCase\(\) === "s"/);
    assert.equal(read("src/admin/main.tsx").includes("<ReactMarkdown"), false);
  });

  it("keeps admin transport isolated from public cached GET API", () => {
    const transport = read("src/admin/api.ts");
    const post = read("src/admin/PostEditor.tsx");
    const site = read("src/admin/SiteEditor.tsx");
    assert.match(transport, /credentials: "same-origin"/);
    assert.match(transport, /"X-CSRF-Token"/);
    assert.match(transport, /AbortSignal\.timeout\(90_000\)/);
    assert.ok(post.includes('from "./api"') && site.includes('from "./api"'));
    assert.equal(post.includes('from "../lib/api"'), false);
    assert.equal(site.includes('from "../lib/api"'), false);
  });
});
