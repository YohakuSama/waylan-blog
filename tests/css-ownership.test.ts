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
});
