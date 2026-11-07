import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authClientId, authClientSecret, authProvider, authReady, type Env } from "../worker/types";

describe("production GitHub authorization configuration", () => {
  it("pins the fine-grained App provider, never the broad OAuth fallback", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    assert.match(config, /"GITHUB_AUTH_PROVIDER"\s*:\s*"github-app"/);
    assert.doesNotMatch(config, /"GITHUB_AUTH_PROVIDER"\s*:\s*"oauth-app"/);
  });

  const legacyEnv = {
    DB: {} as D1Database,
    SITE_ORIGIN: "https://waylan.example",
    GITHUB_CLIENT_ID: "legacy-client",
    GITHUB_CLIENT_SECRET: "legacy-secret",
    SESSION_SECRET: "s".repeat(32),
  } satisfies Env;

  it("fails closed when provider is missing, even with valid legacy OAuth credentials", () => {
    assert.equal(authProvider(legacyEnv), undefined);
    assert.equal(authReady(legacyEnv), false);
    assert.equal(authReady({ ...legacyEnv, GITHUB_AUTH_PROVIDER: "github-app" }), false,
      "GitHub App mode must not quietly use the legacy OAuth secret");
  });

  it("uses only GitHub App credentials with the explicit fine-grained provider", () => {
    const appEnv = {
      ...legacyEnv,
      GITHUB_AUTH_PROVIDER: "github-app" as const,
      GITHUB_APP_CLIENT_ID: "app-client",
      GITHUB_APP_CLIENT_SECRET: "app-secret",
    };
    assert.equal(authProvider(appEnv), "github-app");
    assert.equal(authClientId(appEnv), "app-client");
    assert.equal(authClientSecret(appEnv), "app-secret");
    assert.equal(authReady(appEnv), true);
    assert.equal(authReady({ ...appEnv, GITHUB_APP_CLIENT_SECRET: undefined }), false,
      "GitHub App mode must not fall back when its own secret is missing");
  });

  it("keeps the broad legacy OAuth mode behind an explicit opt-in", () => {
    const oauthEnv = { ...legacyEnv, GITHUB_AUTH_PROVIDER: "oauth-app" as const };
    assert.equal(authReady(oauthEnv), true);
    assert.equal(authClientId(oauthEnv), "legacy-client");
    assert.equal(authClientSecret(oauthEnv), "legacy-secret");
  });

  it("keeps GitHub App credentials out of the tracked Wrangler vars", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    assert.doesNotMatch(config, /"GITHUB_APP_CLIENT_ID"\s*:/);
    assert.doesNotMatch(config, /"GITHUB_APP_CLIENT_SECRET"\s*:/);
  });
});
