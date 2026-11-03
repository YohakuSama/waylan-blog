import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { database } from "./db";
import { reconcilePostCatalog, type CatalogPost } from "../worker/post-sync";
import worker from "../worker/index";

const row = (id: string, slug: string, title = slug, version = "v2"): CatalogPost =>
  ({ id, slug, title, version });

describe("Deployed article catalog and D1 reconciliation", () => {
  it("synchronizes live slug, title and version without changing stable foreign keys", async () => {
    const { db, sqlite } = database();
    try {
      sqlite.prepare("INSERT INTO discussions VALUES(?,?,?,?)")
        .run("echo-001", "D1", 1, "https://github.com/example/discussions/1");
      const changed = await reconcilePostCatalog(db, [
        row("echo-001", "new-permalink", "修改后的标题"),
        row("echo-002", "quiet-interface", "另一个标题"),
        row("added-article", "new-article"),
      ]);
      assert.equal(changed.changed, 3);
      assert.deepEqual(sqlite.prepare("SELECT slug,title,version FROM posts WHERE id='echo-001'")
        .get(), { slug: "new-permalink", title: "修改后的标题", version: "v2" });
      assert.equal(sqlite.prepare("SELECT discussion_id FROM discussions WHERE post_id='echo-001'")
        .get()!.discussion_id, "D1");
      assert.equal((await reconcilePostCatalog(db, [
        row("echo-001", "new-permalink", "修改后的标题"),
        row("echo-002", "quiet-interface", "另一个标题"),
        row("added-article", "new-article"),
      ])).changed, 0, "repeated deployments must not change rows");
    } finally { sqlite.close(); }
  });
  it("atomically swaps slugs, retaining comment mappings", async () => {
    const { db, sqlite } = database();
    try {
      const original = sqlite.prepare("SELECT slug FROM posts WHERE id='echo-001'")
        .get()!.slug as string;
      const other = sqlite.prepare("SELECT slug FROM posts WHERE id='echo-002'")
        .get()!.slug as string;
      await reconcilePostCatalog(db, [row("echo-001", other), row("echo-002", original)]);
      assert.equal(sqlite.prepare("SELECT slug FROM posts WHERE id='echo-001'").get()!.slug, other);
      assert.equal(sqlite.prepare("SELECT slug FROM posts WHERE id='echo-002'").get()!.slug, original);
    } finally { sqlite.close(); }
  });
  it("refuses to claim historical data belonging to an unpublished post", async () => {
    const { db, sqlite } = database();
    try {
      const before = sqlite.prepare("SELECT slug FROM posts WHERE id='echo-001'").get()!.slug;
      await assert.rejects(
        reconcilePostCatalog(db, [row("echo-001", "slow-tools")]),
        /unpublished historical post/,
      );
      assert.equal(sqlite.prepare("SELECT slug FROM posts WHERE id='echo-001'").get()!.slug, before);
    } finally { sqlite.close(); }
  });
  it("reconciles on the first API request of a newly deployed build", async () => {
    const { db, sqlite } = database();
    try {
      const env = {
        DB: db, SITE_ORIGIN: "https://echo.test",
        GITHUB_READ_TOKEN: "test-token", GITHUB_REPO_OWNER: "test-owner",
        GITHUB_REPO_NAME: "test-blog",
      };
      const response = await worker.fetch(new Request("https://echo.test/api/status"), env);
      assert.equal(response.status, 200);
      const count = (sqlite.prepare("SELECT COUNT(*) AS count FROM posts").get() as any).count;
      assert.ok(count > 6, "new published posts must enter D1 without a manual sync command");
    } finally { sqlite.close(); }
  });
});
