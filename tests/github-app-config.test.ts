import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("production GitHub authorization configuration", () => {
  it("pins the fine-grained App provider, never the broad OAuth fallback", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    assert.match(config, /"GITHUB_AUTH_PROVIDER"\s*:\s*"github-app"/);
    assert.doesNotMatch(config, /"GITHUB_AUTH_PROVIDER"\s*:\s*"oauth-app"/);
  });
  it("keeps GitHub App credentials out of the tracked Wrangler vars", () => {
    const config = readFileSync("wrangler.jsonc", "utf8");
    assert.doesNotMatch(config, /"GITHUB_APP_CLIENT_ID"\s*:/);
    assert.doesNotMatch(config, /"GITHUB_APP_CLIENT_SECRET"\s*:/);
  });
});
