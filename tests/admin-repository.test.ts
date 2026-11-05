import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { repo, POSTS, files, blobOid } from "../worker/admin-repo";
import type { Env } from "../worker/types";

describe("Admin source repository boundary", () => {
  it("keeps credentialed Git transport out of HTTP endpoint orchestration", () => {
    const handler = readFileSync("worker/admin.ts", "utf8");
    const adapter = readFileSync("worker/admin-repo.ts", "utf8");
    assert.match(handler, /requireAdmin\(request, env\)/);
    assert.doesNotMatch(handler, /api\.github\.com\/repos/);
    assert.doesNotMatch(adapter, /from "\.\/auth"/);
    assert.doesNotMatch(adapter, /from "\.\/security"/);
    assert.match(adapter, /api\.github\.com\/repos/);
  });
  it("selects the configured source repository and preserves its branch", () => {
    const env = {
      CONTENT_REPO: "example/private-contents",
      CONTENT_BRANCH: "release/content",
    } as Env;
    assert.deepEqual(repo(env), {
      owner: "example",
      name: "private-contents",
      branch: "release/content",
    });
    assert.equal(repo({ CONTENT_REPO: "example/project" } as Env).branch, "main");
    assert.equal(POSTS, "content/posts");
  });

  it("returns an empty result without network access when no files were requested", async () => {
    const found = await files({} as Env, "any-commit", []);
    assert.deepEqual(found, {});
  });

  it("uses Git blob byte length and SHA-1 for exact optimistic editor versions", async () => {
    for (const content of ["", "hello world", "中文标题\n", "emoji 🌿\n"]) {
      const bytes = Buffer.from(content, "utf8");
      const expected = createHash("sha1")
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest("hex");
      assert.equal(await blobOid(content), expected);
    }
  });
});
