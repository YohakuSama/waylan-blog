import assert from "node:assert/strict";
import { test } from "node:test";
import { social } from "../shared/content-rules";

test("future contact destinations use stable labels without inventing profiles", () => {
  const cases: Array<[string, string, string]> = [
    ["contact@example.org", "email", "邮箱"],
    ["tel:+1 213 555 0100", "phone", "电话"],
    ["https://discord.gg/example", "discord", "Discord"],
    ["https://discord.com/users/123456", "discord", "Discord"],
    ["https://signal.me/#eu/example", "signal", "Signal"],
    ["https://t.me/example", "telegram", "Telegram"],
    ["https://x.com/example", "x", "X"],
    ["https://github.com/example", "github", "GitHub"],
  ];
  for (const [url, kind, label] of cases) {
    const result = social({ url }, 0);
    assert.equal(result.kind, kind);
    assert.equal(result.label, label);
    assert.ok(result.url.startsWith("mailto:") || result.url === url);
  }
  assert.equal(social({ url: "tel:+1 213 555 0100", label: "联系作者" }, 0).label, "联系作者");
});

test("contact destinations fail closed for unsafe or malformed schemes", () => {
  for (const url of ["javascript:alert(1)", "data:text/html,x", "tel:123", "http://example.org"]) {
    assert.throws(() => social({ url }, 0), /url 必须/);
  }
});
