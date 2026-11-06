import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");
const ownerFiles = [
  "../styles.css",
  "./shell.css",
  "./feed.css",
  "./sidebar.css",
  "./site.css",
  "./responsive.css",
  "./skins.css",
  "./motion.css",
  "./reader-progress.css",
  "./image-viewer.css",
  "./announcements.css",
];

describe("Shared CSS ownership and cascade safety", () => {
  it("uses one identical, ordered stylesheet entry for site and offline preview", () => {
    const entry = read("src/styles/index.ts");
    let previous = -1;
    for (const path of ownerFiles) {
      const importLine = `import "${path}";`;
      assert.equal(entry.split(importLine).length - 1, 1, `${path} must be imported exactly once`);
      const at = entry.indexOf(importLine);
      assert.ok(at > previous, `${path} must follow the preceding owner`);
      previous = at;
    }
    assert.ok(entry.indexOf("@fontsource-variable/") < entry.indexOf(ownerFiles[0]),
      "font imports must remain before application CSS");
    for (const file of ["src/client.tsx", "src/offline.tsx"]) {
      assert.ok(read(file).includes('styles/index'),
        `${file} must share the single CSS entrypoint`);
    }
  });

  it("owns image geometry once and preserves Terminal skin differences", () => {
    const base = read("src/styles.css");
    const skin = read("src/styles/skins.css");
    const viewer = read("src/styles/image-viewer.css");
    const progress = read("src/styles/reader-progress.css");
    assert.doesNotMatch(base, /\.image-dialog\s*\{/);
    assert.doesNotMatch(skin, /(?:^|\n)\.image-dialog\s*\{/);
    assert.doesNotMatch(skin, /(?:^|\n)\.echo-dialog\.image-dialog\s*\{/);
    assert.match(skin, /:root\[data-skin="terminal"\] \.image-dialog \{/);
    assert.match(viewer, /\.echo-dialog\.image-dialog\s*\{/);
    assert.match(viewer, /\.image-dialog > img\s*\{/);
    assert.match(viewer, /\.image-dialog:has\(> img\)::after \{ display: none; \}/);
    assert.match(progress, /:root\[data-skin="terminal"\] \.reading-progress/);
    assert.doesNotMatch(skin, /\.reading-progress/);
  });

  it("keeps component ownership explicit at the original top-level section cuts", () => {
    const shell = read("src/styles/shell.css");
    const feed = read("src/styles/feed.css");
    const sidebar = read("src/styles/sidebar.css");
    const pages = read("src/styles/site.css");
    const responsive = read("src/styles/responsive.css");
    assert.ok(shell.includes("/* ---------- Header ---------- */"));
    assert.ok(shell.includes(".hero-visual {"), "hero belongs to the site shell");
    assert.ok(feed.startsWith("/* ---------- Feed entries ---------- */"));
    assert.ok(feed.includes(".feed-item {"));
    assert.ok(sidebar.startsWith("/* ---------- Sidebar ---------- */"));
    assert.ok(pages.startsWith("/* ---------- Index pages ---------- */"));
    assert.ok(responsive.startsWith("/* ---------- Responsive ---------- */"));
    assert.ok(responsive.includes(".feed-controls .mobile-type-select { display: inline-flex; }"));
    assert.equal(pages.includes("/* ---------- Feed entries ---------- */"), false);
    assert.equal(pages.includes("/* ---------- Sidebar ---------- */"), false);
  });

  it("retains the winning phone headline values without superseded mobile rules", () => {
    const responsive = read("src/styles/responsive.css");
    assert.match(responsive, /\.feed-list \.feed-item\.is-article \.feed-body h2,\s*\.home-list \.feed-item:first-child \.feed-body h2 \{\s*font-size: clamp\(20px, 5vw, 22px\);\s*line-height: 1\.34;\s*margin-top: 4px;/);
    for (const superseded of [
      "clamp(21px, 5.65vw, 24px)",
      "clamp(21px, 5.55vw, 23px)",
      "clamp(20px, 5.15vw, 22px)",
    ]) assert.equal(responsive.includes(superseded), false, `superseded style: ${superseded}`);
  });

  it("keeps only the effective phone composer gap and compact reader grid placement", () => {
    const base = read("src/styles.css");
    const responsive = read("src/styles/responsive.css");
    const composer = [...base.matchAll(/\.discussion-dialog\.composer-dialog \.composer-bottom\s*\{([^}]*)\}/g)]
      .map((match) => match[1]);
    const phone = composer.filter((body) => /gap:\s*8px;/.test(body));
    assert.equal(phone.length, 1, "the identical later phone composer gap rule was redundant");
    assert.match(phone[0], /safe-area-inset-bottom/);

    const tools = [...responsive.matchAll(/\.site-header-reader \.header-tools\s*\{([^}]*)\}/g)]
      .map((match) => match[1]);
    assert.equal(tools.filter((body) => /grid-row:\s*1;/.test(body)).length, 1);
    assert.equal(tools.filter((body) => /grid-column:\s*2;/.test(body)).length, 1);
    assert.equal(tools.filter((body) => /gap:\s*0;/.test(body)).length, 1);
    assert.ok(tools.some((body) => /display:\s*flex;/.test(body)),
      "the original compact reader tool layout must remain flex");
  });

  it("keeps loading-indicator geometry in the later motion owner without duplicate skin declarations", () => {
    const skin = read("src/styles/skins.css");
    const motion = read("src/styles/motion.css");
    const selector = ':root[data-navigation="loading"] .site-header::after';
    const block = (source: string) => {
      const start = source.indexOf(selector + " {");
      assert.ok(start >= 0, "missing loading indicator");
      return source.slice(start, source.indexOf("}", start));
    };
    const skinRule = block(skin);
    const motionRule = block(motion);
    for (const property of ["content", "position", "left", "bottom", "height", "pointer-events"]) {
      assert.doesNotMatch(skinRule, new RegExp(`\\b${property}\\s*:`),
        `${property} must be owned by the later motion layer`);
      assert.match(motionRule, new RegExp(`\\b${property}\\s*:`),
        `${property} must retain its original winning value`);
    }
    assert.match(skinRule, /width:\s*32%/);
    assert.match(skinRule, /background:\s*linear-gradient/);
    assert.match(motionRule, /animation:\s*waylan-reader-loading/);
  });
});
