import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const about = readFileSync("content/about.md", "utf8");
const aboutPage = readFileSync("src/pages.tsx", "utf8");
const privacy = readFileSync("src/pages/Privacy.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const layout = readFileSync("src/styles/site.css", "utf8");

describe("layered, accurate privacy disclosure", () => {
  it("keeps the personal About page free of long-form privacy text", () => {
    assert.ok(!about.includes("### 隐私与数据说明"));
    assert.ok(!aboutPage.includes('<h2 className="side-title">隐私与数据</h2>'));
    assert.ok(!about.includes("防重复提交记录"));
  });
  it("provides a discoverable notice without changing primary navigation", () => {
    assert.ok(app.includes('pathname === "/privacy"'));
    assert.ok(app.includes('<Link href="/privacy">隐私</Link>'));
    assert.ok(!app.includes('{ url: "/privacy", label:'));
    assert.ok(layout.includes(".privacy-page {"));
  });
  it("states data uses, retention, third parties and available choices", () => {
    for (const fact of [
      "Cloudflare Web Analytics", "GitHub App", "GitHub Discussions",
      "哈希", "会话", "私人划线", "90 天", "180 天",
      "www.cloudflare.com/privacypolicy", "github-general-privacy-statement",
      "站长 GitHub 主页",
    ]) {
      assert.ok(privacy.includes(fact), `Missing privacy disclosure: ${fact}`);
    }
    assert.ok(!privacy.includes("无第三方统计"));
    assert.ok(!privacy.includes("目前旧版 OAuth 仍申请"));
    assert.ok(!privacy.includes("已完全符合"));
  });
});
