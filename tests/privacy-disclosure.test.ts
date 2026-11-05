import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const about = readFileSync("content/about.md", "utf8");
const page = readFileSync("src/pages.tsx", "utf8");

describe("privacy disclosure stays aligned with deployed features", () => {
  it("does not claim that the site has no third-party analytics", () => {
    assert.ok(about.includes("Cloudflare Web Analytics"));
    assert.ok(page.includes("包含 Cloudflare 网站分析脚本"));
    assert.equal(page.includes("无第三方统计与追踪脚本"), false);
  });
  it("describes GitHub App as active and legacy OAuth as conditional", () => {
    assert.ok(about.includes("生产配置已显式选择 GitHub App"));
    assert.ok(about.includes("若站长切回旧版 OAuth"));
    assert.ok(page.includes("GitHub App 登录"));
    assert.ok(page.includes("若启用旧版 OAuth"));
    assert.ok(!page.includes("目前旧版 OAuth 仍申请"));
  });
  it("discloses login scope, local and server data, retention and a contact route", () => {
    for (const fact of [
      "public_repo", "GitHub Discussions", "AES-GCM", "PKCE",
      "90 天", "180 天", "两日", "GitHub 主页",
    ]) {
      assert.ok(about.includes(fact), `Missing privacy disclosure: ${fact}`);
    }
    assert.ok(about.includes("https://github.com/YohakuSama"));
    assert.ok(about.includes("非公开权利请求联系渠道"));
  });
});
