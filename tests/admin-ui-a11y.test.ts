import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("admin responsive and accessibility contracts", () => {
  const content = read("src/admin/ContentList.tsx");
  const post = read("src/admin/PostEditor.tsx");
  const site = read("src/admin/SiteEditor.tsx");
  const ui = read("src/admin/ui.tsx");
  const css = read("src/admin/admin.css");

  it("associates search with a visible label and explains no results", () => {
    assert.match(content, /<label className="search-field">/);
    assert.match(content, /<span className="field-label">搜索内容<\/span>/);
    assert.match(content, /没有匹配的内容，请调整搜索关键词/);
  });

  it("names each contact address, label and destructive control", () => {
    assert.match(site, /aria-labelledby="site-socials-title"/);
    assert.match(site, /第 \{i \+ 1\} 项 · 地址或邮箱/);
    assert.match(site, /第 \{i \+ 1\} 项 · 显示名称/);
    assert.match(site, /删除第 \$\{i \+ 1\} 条联系方式/);
  });

  it("gives cover alternative text a persistent label, not only a placeholder", () => {
    assert.match(post, /<label className="cover-alt">/);
    assert.match(post, /封面说明（图片替代文字）/);
    assert.match(post, /<Field label="封面" wide asGroup>/);
    assert.match(site, /<Field label="头像" wide asGroup>/);
    assert.match(ui, /if \(asGroup\)/);
  });

  it("preserves editing and PR operations while splitting responsive editor controls", () => {
    for (const editor of [post, site]) {
      assert.match(editor, /className="editor-head-main"/);
      assert.match(editor, /className="editor-head-actions"/);
      assert.match(editor, /className="editor-save"/);
      assert.match(editor, /useLeaveGuard\(dirty\)/);
      assert.match(editor, /等待 PR 合并/);
      assert.match(editor, /没有保存，确定离开吗/);
    }
    assert.match(css, /@media \(max-width: 900px\)/);
    assert.match(css, /@media \(max-width: 520px\)/);
    assert.match(css, /@media \(max-height: 540px\) and \(max-width: 900px\)/);
    assert.match(css, /\.editor-head \{ position: static; \}/);
  });

  it("supports touch formatting, wrap and accessible preview", () => {
    assert.match(css, /@media \(pointer: coarse\)/);
    assert.match(css, /\.markdown-tools \.emoji-grid button \{ min-height: 44px; height: 44px; \}/);
    assert.match(css, /\.post-meta \.mono \{ overflow-wrap: anywhere; \}/);
    assert.match(css, /\.social-row \+ \.social-row \{ margin-top: 12px; \}/);
    assert.match(ui, /aria-pressed=\{mode === "preview"\}/);
    assert.match(ui, /role="region" aria-label=\{\x60\$\{label\}预览\x60\}/);
  });

  it("retains a meaningful failure message in delete confirmation", () => {
    assert.match(content, /role="alert">\{error\}/);
    assert.match(content, /<Confirm/);
    assert.match(content, /result\.review/);
  });
});
