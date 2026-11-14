import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import site from "../content/site.json";
import {
  parseFrontmatter,
  postMeta,
  stringifyFrontmatter,
} from "../shared/content-rules";
import { list, toData, toForm } from "../src/admin/form";

const topics = site.topics.map((t) => t.id);
// The admin API sends dates as YYYY-MM-DD strings.
const plain = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).map(([k, v]) => [
      k,
      v instanceof Date ? v.toISOString().slice(0, 10) : v,
    ]),
  );
const posts = readdirSync("content/posts")
  .filter((f) => f.endsWith(".md"))
  .map((file) => {
    const raw = readFileSync(`content/posts/${file}`, "utf8").replace(/\r\n/g, "\n");
    const { data, content } = parseFrontmatter(raw);
    return { file, raw, stem: file.replace(/\.md$/, ""), data: plain(data), content };
  });

describe("Admin editor form", () => {
  it("saving any existing post untouched writes the same front matter", () => {
    for (const p of posts) {
      const form = toForm(p.data, p.content, p.stem);
      const data = toData(form, p.data, p.stem);
      // Byte for byte what the author wrote: same keys, order, quoting, dates.
      assert.equal(stringifyFrontmatter(data, p.content), p.raw, p.file);
    }
  });
  it("a blank form filled in by hand yields a post the build accepts", () => {
    const form = {
      ...toForm({ date: "2026-11-02", topic: topics[0] }, "正文", ""),
      title: "新文章",
      slug: "new-post",
      tags: "甲，乙, 丙",
    };
    const data = toData(form, {}, "");
    assert.deepEqual(data.tags, ["甲", "乙", "丙"]);
    assert.equal("type" in data, false);
    const meta = postMeta(data, "new-post.md", topics);
    assert.equal(meta.slug, "new-post");
    assert.equal(meta.type, "article");
  });
  it("switching away from project drops project fields; clearing fields removes them", () => {
    const project = posts.find((p) => p.data.type === "project")!;
    const form = toForm(project.data, project.content, project.stem);
    const data = toData({ ...form, type: "note", tags: "", cover: "" }, project.data, project.stem);
    for (const key of ["status", "stack", "repo", "demo"]) assert.equal(key in data, false);
    const text = stringifyFrontmatter(data, project.content);
    assert.doesNotMatch(text, /^(tags|cover|coverAlt):/m);
    assert.match(text, /^type: note$/m);
  });
  it("splits lists on ASCII and full-width commas and lines", () => {
    assert.deepEqual(list(" a, b，c\nd ,, "), ["a", "b", "c", "d"]);
  });
});
