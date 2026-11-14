import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authProvider, authReady, type Env } from "../worker/types";
import { adminMissing } from "../worker/admin";

const appEnv = {
  DB: {} as D1Database,
  SITE_ORIGIN: "https://waylan.test",
  CONTENT_REPO: "site-owner/blog-source",
  ADMIN_GITHUB_LOGINS: "site-owner",
  GITHUB_CONTENT_TOKEN: "content-token",
  SESSION_SECRET: "s".repeat(32),
  GITHUB_AUTH_PROVIDER: "github-app" as const,
  GITHUB_APP_CLIENT_ID: "app-id",
  GITHUB_APP_CLIENT_SECRET: "app-secret",
} satisfies Env;

describe("GitHub App-only authorization", () => {
  it("requires an explicit, fully configured GitHub App", () => {
    assert.equal(authProvider(appEnv), "github-app");
    assert.equal(authReady(appEnv), true);
    assert.equal(authReady({ ...appEnv, GITHUB_AUTH_PROVIDER: undefined }), false);
    assert.equal(authReady({ ...appEnv, GITHUB_APP_CLIENT_ID: undefined }), false);
    assert.equal(authReady({ ...appEnv, GITHUB_APP_CLIENT_SECRET: undefined }), false);
    assert.equal(authReady({ ...appEnv, GITHUB_AUTH_PROVIDER: "oauth-app" } as unknown as Env), false,
      "an old provider name must never enable login");
  });

  it("lists only GitHub App settings in the admin configuration screen", () => {
    assert.deepEqual(adminMissing(appEnv), []);
    assert.deepEqual(adminMissing({ ...appEnv, GITHUB_APP_CLIENT_SECRET: undefined }),
      ["GITHUB_APP_CLIENT_SECRET"]);
    assert.deepEqual(adminMissing({ ...appEnv, GITHUB_AUTH_PROVIDER: undefined }),
      ["GITHUB_AUTH_PROVIDER"]);
    assert.deepEqual(adminMissing({ ...appEnv, GITHUB_AUTH_PROVIDER: "oauth-app" } as unknown as Env),
      ["GITHUB_AUTH_PROVIDER"]);
  });

  it("contains no old OAuth App execution or broad-scope branch", () => {
    const auth = readFileSync("worker/auth.ts", "utf8");
    const types = readFileSync("worker/types.ts", "utf8");
    const admin = readFileSync("worker/admin.ts", "utf8");
    assert.doesNotMatch(auth, /scope:\s*["']public_repo["']/);
    assert.doesNotMatch(auth, /authClient(Id|Secret)/);
    for (const source of [auth, types, admin]) {
      assert.doesNotMatch(source, /GITHUB_CLIENT_ID|GITHUB_CLIENT_SECRET/);
      assert.doesNotMatch(source, /["']oauth-app["']/);
    }
  });

  it("pins the GitHub App provider and keeps real credentials outside tracked vars", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    const local = readFileSync(".dev.vars.example", "utf8");
    const readme = readFileSync("README.md", "utf8");
    assert.match(config, /"GITHUB_AUTH_PROVIDER"\s*:\s*"github-app"/);
    assert.doesNotMatch(config, /"GITHUB_APP_CLIENT_(ID|SECRET)"\s*:/);
    assert.match(local, /^GITHUB_AUTH_PROVIDER=github-app$/m);
    assert.match(local, /^GITHUB_APP_CLIENT_ID=/m);
    assert.match(local, /^GITHUB_APP_CLIENT_SECRET=/m);
    assert.doesNotMatch(local, /^GITHUB_CLIENT_(ID|SECRET)=/m);
    assert.doesNotMatch(readme, /### 4\. 创建 GitHub OAuth App/);
  });
});
