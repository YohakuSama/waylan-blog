import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { updatePostRedirects, removePostRedirects, validatePostRedirects } from "../shared/redirects";

describe("Published article permalinks", () => {
  const initial = "# Custom routes stay untouched\n/old-home / 301\n";
  it("keeps unrelated rules and creates permanent redirects", () => {
    const next = updatePostRedirects(initial, "old-slug", "new-slug")!;
    assert.match(next, /^\/old-home \/ 301/m);
    assert.match(next, /^\/post\/old-slug \/post\/new-slug 301$/m);
    validatePostRedirects(next, ["new-slug"]);
  });
  it("flattens repeated renames and permits reverting to an owned alias", () => {
    const second = updatePostRedirects(
      updatePostRedirects(initial, "alpha", "beta")!, "beta", "gamma",
    )!;
    assert.match(second, /\/post\/alpha \/post\/gamma 301/);
    assert.match(second, /\/post\/beta \/post\/gamma 301/);
    const reverted = updatePostRedirects(second, "gamma", "alpha")!;
    assert.doesNotMatch(reverted, /^\/post\/alpha /m);
    assert.match(reverted, /\/post\/beta \/post\/alpha 301/);
    assert.match(reverted, /\/post\/gamma \/post\/alpha 301/);
    validatePostRedirects(reverted, ["alpha"]);
  });
  it("blocks redirects belonging to another post and slug reuse by a new post", () => {
    const history = "/post/legacy /post/article-a 301\n";
    assert.throws(() => updatePostRedirects(history, null, "legacy"), /历史旧地址/);
    assert.throws(() => updatePostRedirects(history, "article-b", "legacy"), /另一篇/);
    assert.throws(() => validatePostRedirects(history, ["article-a", "legacy"]), /冲突/);
    assert.throws(() => validatePostRedirects(history, ["article-b"]), /不存在/);
  });
  it("removes dead aliases when the target article is deleted", () => {
    const source = "/post/old /post/live 301\n/post/older /post/live 301\n/post/other /post/safe 301\n";
    assert.equal(removePostRedirects(source, "live"),
      "/post/other /post/safe 301\n");
    assert.equal(removePostRedirects(source, "missing"), null);
  });
  it("does not touch redirects when saving a post without changing its slug", () => {
    assert.equal(updatePostRedirects(initial, "article-a", "article-a"), null);
    assert.equal(updatePostRedirects(initial, null, "brand-new"), null);
  });
});
