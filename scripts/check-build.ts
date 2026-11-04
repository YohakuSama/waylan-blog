import { readFile, readdir } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { metadata, posts, site, structuredData } from "../src/lib/data";
import assert from "node:assert/strict";
for (const path of [
  "index.html",
  "feed/index.html",
  "projects/index.html",
  "about/index.html",
  "archive/index.html",
  "404.html",
  ...posts.map((p) => `post/${p.slug}/index.html`),
]) {
  const source = await readFile(`dist/${path}`, "utf8"),
    doc = new JSDOM(source).window.document;
  assert(
    doc.querySelector("title")?.textContent?.includes(site.name),
    path + " missing title",
  );
  for (const selector of [
    'meta[name="description"]',
    'meta[property="og:title"]',
    'meta[property="og:image"]',
    'link[rel="canonical"]',
    'script[type="application/ld+json"]',
    "main",
    "nav",
    "h1",
  ])
    assert(doc.querySelector(selector), path + " missing " + selector);
  const route = path === "index.html"
    ? "/"
    : path === "404.html"
      ? "/404"
      : "/" + path.replace(/\/index\.html$/, "");
  assert.deepEqual(
    JSON.parse(doc.querySelector('script[type="application/ld+json"]')!.textContent || "{}"),
    structuredData(metadata(route)),
    path + " structured data disagrees with the shared metadata builder",
  );
  assert(
    doc.querySelector("main")!.textContent!.trim().length >
      (path === "404.html" ? 30 : 80),
    path + " empty prerender",
  );
  if (path === "feed/index.html") {
    // The content page owns type filters; homepage stays an editorial doorway.
    const counts = [...doc.querySelectorAll(".type-tab")].map((tab) =>
      Number(tab.querySelector(".tab-count")?.textContent),
    );
    assert.equal(counts[0], posts.length, "feed 全部 count");
    assert.equal(
      counts.slice(1).reduce((a, b) => a + b, 0),
      posts.length,
      "feed type counts must add up",
    );
  }
  if (path === "archive/index.html") {
    assert.equal(doc.querySelectorAll(".archive-row").length, posts.length, "yearbook complete");
    assert.equal(doc.querySelectorAll(".archive-main .type-tabs").length, 0, "yearbook has no duplicate type filters");
  }
  if (path === "index.html") {
    assert(
      doc.querySelector(".home-hero svg.network-wave"),
      "hero network wave",
    );
    assert(doc.querySelector(".home-sidebar .explore-list"), "homepage topic guide");
  }
  if (path.startsWith("post/")) {
    const post = posts.find((p) => path.includes(p.slug))!;
    assert(
      doc.querySelectorAll("main [data-block-id]").length ===
        post.blocks.length,
      "Article must be visible in main HTML",
    );
    assert(
      !doc.querySelector(".reader-prose")?.closest("[hidden]"),
      "Article must not require streaming reveal scripts",
    );
    assert(doc.body.textContent!.includes(post.blocks[0].text.trim()));
  }
  for (const img of doc.querySelectorAll('img[src^="/"]'))
    await readFile("dist" + img.getAttribute("src"));
  for (const link of doc.querySelectorAll('a[href^="/"]')) {
    const href = link.getAttribute("href")!.split(/[?#]/)[0];
    if (href === "/rss.xml") continue;
    assert(
      href === "/" ||
        [
          "/feed",
          "/projects",
          "/about",
          "/archive",
          ...posts.map((p) => `/post/${p.slug}`),
        ].includes(href),
      `Broken link ${href} in ${path}`,
    );
  }
  assert(
    !doc.querySelector('script:not([type="application/ld+json"]):not([src])'),
    "Unexpected inline executable script",
  );
  assert(
    !/GITHUB_CLIENT_SECRET=|ghp_[a-zA-Z0-9]{20}|github_pat_[a-zA-Z0-9_]{20}/.test(
      source,
    ),
    "secret found",
  );
}
// Existence alone cannot detect malformed RSS or Sitemap XML.
for (const [file, expected] of [
  ["sitemap.xml", posts.length + 5],
  ["rss.xml", posts.length],
] as const) {
  const xml = await readFile("dist/" + file, "utf8");
  const doc = new JSDOM(xml, { contentType: "application/xml" }).window.document;
  assert.equal(doc.querySelector("parsererror"), null, file + " malformed XML");
  const selector = file === "sitemap.xml" ? "urlset > url" : "rss > channel > item";
  assert.equal(doc.querySelectorAll(selector).length, expected, file + " entries incomplete");
}
for (const file of [
  "sitemap.xml",
  "rss.xml",
  "robots.txt",
  "404.html",
  "_headers",
  "_redirects",
  "theme.js",
])
  await readFile("dist/" + file);
console.log(
  `Build integrity: ${posts.length + 6} documents, article bodies, metadata, internal links, media and feeds passed`,
);
