import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { metadata, site } from "../src/lib/data";

it("首页名称清晰，定位不声称作者是前端工程师", () => {
  assert.doesNotMatch(site.description + site.tagline, /前端工程师|前端开发/);
  assert.equal(metadata("/").title, `首页 · ${site.name}`);
});

it("公开介绍描述内容范围与使用说明，不使用职业标签或否定式定位", () => {
  const about = readFileSync("content/about.md", "utf8");
  const source = JSON.parse(readFileSync("content/site.json", "utf8"));
  const copy = about + source.description + source.intro + source.hero.lines.join("");
  assert.doesNotMatch(copy, /前端开发教程站|职业身份|真实的技术折腾|值得研究的我都会/);
  assert.match(about, /操作系统、软件配置、网络服务/);
  assert.match(about, /运行环境不同/);
  assert.equal(site.description, source.description, "site metadata must match the authored description");
});

it("每个预渲染页面都有与头像同源的 favicon、旧图标回退、触控图标", () => {
  const favicon = readFileSync("public/favicon.svg", "utf8");
  const avatar = readFileSync("public/avatar.svg", "utf8");
  assert.equal(avatar, favicon, "avatar and browser icon should share the same mark");
  assert.match(favicon, /viewBox="0 0 96 96"/);
  assert.match(favicon, /class="letter"/, "browser icon must use a solid legible W at small sizes");
  assert.match(favicon, /prefers-color-scheme:dark/, "primary vector icon adapts to device appearance");
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

it("保留 Editorial 原有手写体路径，终端标识不会显示为 waylanl", () => {
  const wordmark = readFileSync("src/components/Wordmark.tsx", "utf8");
  const app = readFileSync("src/App.tsx", "utf8");
  const skins = readFileSync("src/styles/skins.css", "utf8");
  assert.match(wordmark, /const WORD\s*=/, "restore the original outlined script wordmark");
  assert.ok(wordmark.includes('viewBox="-3.7 -83.3 313.4 117.2"'));
  assert.ok(wordmark.includes('<path d={WORD} fill="currentColor" />'));
  assert.doesNotMatch(wordmark, /<text[\s>]|viewBox="0 0 170 46"/,
    "do not replace the handwritten identity with an SVG text label");
  assert.ok(app.includes('className="brand-term-prompt"'));
  assert.ok(app.includes('{site.name.toLowerCase()}'));
  assert.doesNotMatch(app, /brand-term-caret/, "trailing cursor looks like an extra l on iOS");
  assert.doesNotMatch(skins, /\.brand-term-caret\s*\{/);
  assert.match(skins, /\.brand-term\s*\{[^}]*gap:\s*\.3em;/);
});
