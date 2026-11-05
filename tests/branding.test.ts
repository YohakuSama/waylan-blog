import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { metadata, site } from "../src/lib/data";

it("首页名称清晰，定位不声称作者是前端工程师", () => {
  assert.doesNotMatch(site.description + site.tagline, /前端工程师|前端开发/);
  assert.equal(metadata("/").title, `首页 · ${site.name}`);
});

it("每个预渲染页面都有与头像同源的 favicon、旧图标回退、触控图标", () => {
  const favicon = readFileSync("public/favicon.svg", "utf8");
  const avatar = readFileSync("public/avatar.svg", "utf8");
  assert.equal(avatar, favicon, "avatar and browser icon should share the same mark");
  assert.match(favicon, /viewBox="0 0 96 96"/);
  const doc = new JSDOM(readFileSync("dist/index.html", "utf8")).window.document;
  assert.equal(doc.querySelector('link[rel="icon"]')?.getAttribute("href"), "/favicon.svg");
  assert.equal(doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"), "/apple-touch-icon.png");
  assert(doc.querySelector('link[rel="alternate icon"]'));
  for (const name of ["favicon.ico", "favicon-32.png", "favicon-64.png", "apple-touch-icon.png"])
    assert(readFileSync("public/" + name).length > 100);
});

it("所有预渲染页面使用统一站点名称与描述", () => {
  for (const page of ["", "about/", "feed/", "archive/", "projects/"]) {
    const doc = new JSDOM(readFileSync(`dist/${page}index.html`, "utf8")).window.document;
    assert(doc.title.includes(site.name));
    assert.equal(doc.querySelector('meta[name="description"]')?.getAttribute("content"), site.description);
  }
});
