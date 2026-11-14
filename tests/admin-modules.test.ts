import { usedUploads, editsLive, saveMessage } from "../src/admin/helpers";
import { createDiscussionBatches } from "../src/admin/Discussions";
import { toSiteForm } from "../src/admin/SiteEditor";
import type { Overview, Upload } from "../src/admin/types";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("Admin feature boundaries", () => {
  it("keeps /admin entry focused on appearance, authentication and root mount", () => {
    const entry = read("src/admin/main.tsx");
    const gate = read("src/admin/Gate.tsx");
    assert.match(entry, /import \{ Gate \} from "\.\/Gate"/);
    assert.match(gate, /export function Gate\(/);
    assert.match(gate, /setAdminCsrf\(next\.csrf \|\| ""\)/);
    assert.match(gate, /<Dashboard session=\{session\}/);
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
    const list = read("src/admin/ContentList.tsx");
    assert.match(list, /export function Posts\(/);
    const discussion = read("src/admin/Discussions.tsx");
    assert.match(discussion, /export function Discussions\(/);
    assert.doesNotMatch(list, /export function Discussions\(/);
    assert.ok(dashboard.includes('from "./ContentList"'));
    assert.ok(dashboard.includes('from "./Discussions"'));
    assert.match(dashboard, /function DeployStatus\(/);
    assert.match(dashboard, /const latest = useRef\(0\)/);
    assert.match(dashboard, /run !== latest\.current/);
    assert.ok(dashboard.includes('"/api/admin/content"'));
    assert.ok(dashboard.includes('"/api/admin/status"'));
    assert.ok(discussion.includes('"/api/admin/discussions"'));
    assert.ok(list.includes('"/api/admin/post", "DELETE"'));
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
    assert.equal(read("src/admin/main.tsx").includes("/api/admin/"), false);
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

describe("admin data contracts after extraction", () => {
  it("deduplicates referenced unsent media without mutating uploaded records", () => {
    const uploads: Upload[] = [
      { path: "images/a.jpg", data: "a", url: "" },
      { path: "images/a.jpg", data: "duplicate", url: "" },
      { path: "images/b.jpg", data: "b", url: "", sent: true },
      { path: "images/c.jpg", data: "c", url: "" },
    ];
    assert.deepEqual(usedUploads(uploads, "images/a.jpg images/b.jpg images/c.jpg"), [
      { path: "images/a.jpg", data: "a" },
      { path: "images/c.jpg", data: "c" },
    ]);
    assert.equal(uploads[2].sent, true);
    const many: Upload[] = Array.from({ length: 9 }, (_, i) => ({
      path: `images/${i}.jpg`, data: "x", url: "",
    }));
    assert.throws(() => usedUploads(many, many.map(u => u.path).join(" ")), /8 张/);
  });

  it("preserves site metadata, social links and about text conversion", () => {
    const overview: Overview = {
      head: { oid: "head", date: "2026-11-05" },
      live: "head",
      repo: { name: "owner/repo", branch: "main" },
      site: { oid: "site", data: {
        name: "Waylan", author: "Waylan", profileTags: ["React", "Cloudflare"],
        socials: [{ url: "https://github.com/example" }],
      } },
      about: { oid: "about", text: "About the site.\n" },
      topics: [], posts: [], discussions: { enabled: false, pending: [] },
    };
    const form = toSiteForm(overview);
    assert.equal(form.name, "Waylan");
    assert.equal(form.profileTags, "React, Cloudflare");
    assert.deepEqual(form.socials, [{ label: "", url: "https://github.com/example" }]);
    assert.equal(form.about, "About the site.");
    assert.deepEqual(form.announcements, [], "older site profiles remain editable without notices");
  });
});

describe("admin publication branch semantics", () => {
  it("retains immediate-live feedback on the existing main branch", () => {
    assert.equal(editsLive("main"), true);
    assert.match(saveMessage("main", "new-post"), /已发布.*一两分钟/);
    assert.match(saveMessage("main", "post"), /已保存.*一两分钟/);
    assert.match(saveMessage("main", "site"), /已保存.*一两分钟/);
    assert.match(saveMessage("main", "delete", "例文"), /已删除「例文」.*一两分钟/);
  });

  it("never tells authors a staging-branch commit was published", () => {
    const branch = "content/editorial-review";
    assert.equal(editsLive(branch), false);
    for (const operation of ["new-post", "post", "site", "delete"] as const) {
      const message = saveMessage(branch, operation, "例文");
      assert.match(message, /PR 合并到 main/);
      assert.match(message, /content\/editorial-review/);
      assert.doesNotMatch(message, /一两分钟后更新|已发布/);
    }
    const dashboard = read("src/admin/Dashboard.tsx");
    assert.match(dashboard, /editsLive\(overview\?\.repo\.branch/);
    assert.match(dashboard, /<DeployStatus status=\{status\} branch=/);
    assert.match(read("src/admin/PostEditor.tsx"), /!form\.draft && editsLive\(overview\.repo\.branch\)/);
    assert.match(read("src/admin/ContentList.tsx"), /!p\.error && editsLive\(overview\.repo\.branch\)/);
  });
});

describe("admin review PR interface contract", () => {
  it("makes review mode explicit and never confuses PR creation with going live", () => {
    const dashboard = read("src/admin/Dashboard.tsx");
    const post = read("src/admin/PostEditor.tsx");
    const site = read("src/admin/SiteEditor.tsx");
    const list = read("src/admin/ContentList.tsx");
    const repo = read("worker/admin-repo.ts");
    const handler = read("worker/admin.ts");
    assert.match(dashboard, /publicationMode === "review-pr"/);
    assert.match(dashboard, /刷新审核状态/);
    assert.match(dashboard, /继续编辑/);
    assert.match(dashboard, /reviewNumber: review.number/);
    assert.match(post, /reviewInput/);
    assert.match(site, /reviewInput/);
    assert.match(repo, /reviewBase\(env, editing.number\)/);
    assert.match(dashboard, /已合并 main（待确认部署）/);
    assert.match(post, /result\.review/);
    assert.match(site, /result\.review/);
    assert.match(list, /result\.review/);
    assert.match(post, /等待 PR 合并/);
    assert.match(site, /等待 PR 合并/);
    assert.match(repo, /draft: true/);
    assert.match(repo, /base: "main"/);
    assert.match(repo, /publicationMode\(env\) === "direct"/);
    assert.match(handler, /publicationMode: publicationMode\(env\)/);
    assert.doesNotMatch(read("wrangler.jsonc"), /"CONTENT_PUBLISH_MODE"\s*:\s*"review-pr"/,
      "the production worker must not opt in until a supervised rollout");
  });
});

describe("admin discussion provisioning", () => {
  it("returns success only after all pending Discussions have been created", async () => {
    let rounds = 0;
    const count = await createDiscussionBatches(async () => {
      rounds++;
      return rounds === 1
        ? { created: 2, remaining: 1 }
        : { created: 1, remaining: 0 };
    });
    assert.equal(count, 3);
    assert.equal(rounds, 2);
  });

  it("accepts an already complete batch without retrying", async () => {
    let calls = 0;
    const count = await createDiscussionBatches(async () => {
      calls++;
      return { created: 0, remaining: 0 };
    });
    assert.equal(count, 0);
    assert.equal(calls, 1);
  });

  it("stops immediately on no progress, instead of issuing 50 wasted requests", async () => {
    let calls = 0;
    await assert.rejects(createDiscussionBatches(async () => {
      calls++;
      return { created: 0, remaining: 8 };
    }), /没有取得进展/);
    assert.equal(calls, 1);
  });

  it("reports incomplete work after the bounded maximum", async () => {
    let calls = 0;
    await assert.rejects(createDiscussionBatches(async () => {
      calls++;
      return { created: 1, remaining: 10 };
    }), /未完成项/);
    assert.equal(calls, 50);
  });

  it("rejects invalid API responses and preserves upstream failures", async () => {
    await assert.rejects(
      createDiscussionBatches(async () => ({ created: -1, remaining: 2 })),
      /异常数据/,
    );
    await assert.rejects(
      createDiscussionBatches(async () => { throw new Error("GitHub rate limit"); }),
      /GitHub rate limit/,
    );
  });
});
