import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
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
    assert.doesNotMatch(auth, /scope:\s*["']public_repo["']/);
    assert.doesNotMatch(auth, /authClient(Id|Secret)/);
    // Guard every deployable Worker module, script and checked-in config
    // against accidentally restoring the retired OAuth App credentials.
    const deployablePaths = [
      ".dev.vars.example",
      ".env.example",
      "wrangler.jsonc",
      ...["worker", "scripts"].flatMap((dir) =>
        readdirSync(dir)
          .filter((name) => /\.(?:ts|mjs)$/.test(name))
          .map((name) => `${dir}/${name}`),
      ),
    ];
    for (const path of deployablePaths) {
      const source = readFileSync(path, "utf8");
      assert.doesNotMatch(source, /\bGITHUB_CLIENT_(?:ID|SECRET)\b/, `${path}: retired credentials`);
      assert.doesNotMatch(source, /["']oauth-app["']/, `${path}: retired provider`);
    }
    // GitHub App still uses OAuth callbacks, but does not request broad scopes.
    assert.doesNotMatch(auth, /\bscope\s*:/);
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
