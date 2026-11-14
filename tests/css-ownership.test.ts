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
  "./projects.css",
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

  it("removes obsolete base declarations shadowed by the later component owners", () => {
    const base = read("src/styles.css");
    const feed = read("src/styles/feed.css");
    const site = read("src/styles/site.css");
    // Index-page controls are styled once in site.css. The earlier base rule
    // was fully replaced by the later selector with identical specificity.
    assert.doesNotMatch(base, /(?:^|\n)\.feed-controls\s*\{/);
    assert.match(site, /\.feed-controls\s*\{[^}]*border-bottom:\s*1px solid var\(--line\);/s);
    assert.match(site, /\.feed-controls\s*\{[^}]*background:\s*transparent;/s);

    // Feed's later shared empty-state rule owns the final corner radius.
    const empty = base.match(/(?:^|\n)\.empty-state\s*\{([^}]*)\}/)?.[1];
    assert.ok(empty, "keep empty-state spacing, color and dashed border");
    assert.doesNotMatch(empty, /border-radius\s*:/);
    assert.match(feed, /\.empty-state\s*\{[^}]*border-radius:\s*var\(--radius-md\);/s);

    // The article header typography is finalized in site.css, but responsive
    // font sizes/line heights in styles.css must remain intact.
    const headings = [...base.matchAll(/(?:^|\n)\s*\.article-heading h1\s*\{([^}]*)\}/g)];
    assert.ok(headings.length >= 3, "retain base, responsive and print title sizes");
    for (const [, declarations] of headings) {
      assert.doesNotMatch(declarations, /(?:font-weight|letter-spacing)\s*:/);
    }
    assert.match(site, /\.article-heading h1\s*\{[^}]*font-weight:\s*600;[^}]*letter-spacing:\s*0;/s);

    // The later site.css rules also own article eyebrow rhythm, heading
    // typography and toast placement; do not restore shadowed declarations.
    const eyebrows = [...base.matchAll(/(?:^|\n)\s*\.article-eyebrow\s*\{([^}]*)\}/g)];
    assert.ok(eyebrows.length >= 2);
    for (const [, declarations] of eyebrows) assert.doesNotMatch(declarations, /\bgap\s*:/);
    assert.match(site, /\.article-eyebrow\s*\{[^}]*gap:\s*var\(--space-3\);/s);

    for (const selector of ["h2", "h3"]) {
      const body = base.match(new RegExp(`\\.reader-prose ${selector}\\s*\\{([^}]*)\\}`))?.[1];
      assert.ok(body, `retain reader-prose ${selector} size and margins`);
      assert.doesNotMatch(body, /(?:font-family|font-weight|letter-spacing)\s*:/);
    }
    assert.match(site, /\.reader-prose h2,\s*\.reader-prose h3\s*\{[^}]*font-weight:\s*600;[^}]*letter-spacing:\s*0;/s);

    const toasts = [...base.matchAll(/(?:^|\n)\s*\.toast\s*\{([^}]*)\}/g)];
    assert.ok(toasts.length >= 2, "retain standard and phone toast layouts");
    for (const [, declarations] of toasts) assert.doesNotMatch(declarations, /\bleft\s*:/);
    assert.match(site, /\.toast\s*\{\s*left:\s*50%;/);
  });

  it("keeps reading progress geometry in one owner, with only scoped responsive placement", () => {
    const base = read("src/styles.css");
    const pages = read("src/styles/site.css");
    const progress = read("src/styles/reader-progress.css");
    const responsive = read("src/styles/responsive.css");
    assert.doesNotMatch(base, /\.reading-progress\s*\{\s*position:\s*fixed;/);
    assert.doesNotMatch(base, /\.reading-progress\s*>\s*span\s*\{/);
    assert.doesNotMatch(pages, /\.reading-progress\s*\{/);
    assert.match(progress, /\.reading-progress\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*120;/s);
    assert.match(progress, /\.reading-progress\s*>\s*span\s*\{[^}]*width:\s*0;[^}]*transform-origin:\s*left;/s);
    assert.match(responsive, /\.site-header-reader \+ \.site-body \.reading-progress\s*\{/);
    assert.match(base, /@media print\s*\{[\s\S]*?\.reading-progress\s*\{\s*display:\s*none;/);
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
    assert.ok(responsive.includes(".feed-controls .feed-mobile-controls { display: block;"));
    assert.equal(pages.includes("/* ---------- Feed entries ---------- */"), false);
    assert.equal(pages.includes("/* ---------- Sidebar ---------- */"), false);
  });

  it("keeps project-page layout in its single owner while sharing FeedEntry", () => {
    const projects = read("src/styles/projects.css");
    const feed = read("src/styles/feed.css");
    const pages = read("src/styles/site.css");
    const responsive = read("src/styles/responsive.css");
    assert.match(projects, /\.projects-page \.projects-layout \.feed-list \{/);
    assert.match(projects, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    assert.match(projects, /grid-template-areas: "media" "body";/);
    assert.match(projects, /:root\[data-skin="terminal"\] \.projects-page/);
    assert.doesNotMatch(feed, /\.projects-layout \.feed-item\.is-project/);
    assert.doesNotMatch(pages, /\.projects-layout \.feed-list/);
    assert.doesNotMatch(responsive, /\.projects-layout \.project-facts a/);
    assert.doesNotMatch(responsive, /\.projects-layout \.feed-item\.is-project \.feed-tail/);
    // Other routes still use the shared FeedEntry and its mobile fallback.
    assert.match(feed, /\.feed-item \{/);
    assert.match(responsive, /\.feed-item\.is-project\.has-media \.project-media/);
  });

  it("keeps a single mobile page-heading override for all index pages", () => {
    const responsive = read("src/styles/responsive.css");
    assert.equal([...responsive.matchAll(/\.page-heading\s*\{\s*padding:\s*32px 0 20px;\s*\}/g)].length, 1);
  });

  it("uses one stable home headline size without compressing library summaries", () => {
    const responsive = read("src/styles/responsive.css");
    assert.match(responsive, /\.feed-layout \.feed-list \.feed-item\.is-article \.feed-body h2 \{\s*line-height: 1\.34;\s*margin-top: 4px;/);
    assert.match(responsive, /\.feed-layout \.feed-list \.feed-item\.is-article \.feed-body h2 \{\s*font-size: var\(--text-card-title\);/);
    assert.doesNotMatch(responsive, /font-size: clamp\(20px, 5vw, 22px\);/,
      "the obsolete phone title size must not override the shared card token");
    assert.doesNotMatch(responsive, /\.home-list \.feed-item \.feed-body h2 \{[^}]*font-size:/,
      "phone width must not shrink the home-specific headline token");
    assert.doesNotMatch(responsive, /\.home-list \.feed-item:first-child \.feed-body h2/,
      "the first entry must not be oversized solely because it is the newest post");
    assert.match(read("src/styles.css"), /--text-home-title:\s*22px;/);
    assert.match(read("src/styles/shell.css"),
      /\.home-list \.feed-item \.feed-body h2 \{ font-size: var\(--text-home-title\);/);
    assert.match(responsive, /\.home-list \.feed-media-link \{ display: none; \}/,
      "mobile home should not squeeze the featured excerpt beside an image");
    assert.doesNotMatch(responsive, /\.home-list > \.feed-item:first-child\.is-article\.has-media > \.feed-media-link \{\s*display: block;/,
      "a later breakpoint must not restore the cramped featured thumbnail");
    for (const superseded of [
      "clamp(21px, 5.65vw, 24px)",
      "clamp(21px, 5.55vw, 23px)",
      "clamp(20px, 5.15vw, 22px)",
    ]) assert.equal(responsive.includes(superseded), false, `superseded style: ${superseded}`);
  });

  it("scopes compact phone density to the feed without hiding full previews", () => {
    const responsive = read("src/styles/responsive.css");
    const feed = read("src/components/Feed.tsx");
    assert.match(feed, /className="entry-reading-time"/);
    assert.match(feed, /className="entry-comment-count"/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact > \.feed-item \{\s*padding-block: var\(--space-4\) 10px;/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact \.is-article \.feed-body \{ row-gap: var\(--space-1\); \}/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact \.feed-actions \{[\s\S]*?margin-block: -16px -4px;/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact \.feed-tail \.card-bookmark \{[\s\S]*?margin-block: 0;/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact \.entry-reading-time,[\s\S]*?\.project-status \{[^}]*display: none;/);
    // Density affects supporting content, not a heading's font metrics.
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact \.feed-item \.feed-body h2 \{\s*font-size: var\(--text-card-title\);\s*line-height: 1\.45;/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact \.feed-item\.is-article \.feed-body h2 \{\s*font-size: var\(--text-card-title\);\s*line-height: 1\.34;/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-compact \.thought-text \{[\s\S]*?-webkit-line-clamp: 2;[\s\S]*?font-size: var\(--text-lg\);\s*line-height: 1\.75;/);
    assert.match(responsive, /\.feed-layout \.feed-list\.density-full > \.feed-item\.is-article\.has-media \{/);
  });

  it("uses one effective declaration for phone hero copy and root tokens", () => {
    // This repository preserves CRLF in responsive.css; normalize only for
    // finding the end of the outer media block in the source-level contract.
    const responsive = read("src/styles/responsive.css").replaceAll("\r\n", "\n");
    const begin = responsive.indexOf("@media (max-width: 480px) {");
    assert.ok(begin >= 0);
    const phone = responsive.slice(begin, responsive.indexOf("\n}\n", begin) + 2);
    assert.equal([...phone.matchAll(/(?:^|\n)  :root\s*\{/g)].length, 1,
      "one phone token owner avoids a second same-breakpoint :root override");
    assert.match(phone, /--page-gutter:\s*18px;/);
    assert.match(phone, /--masthead-wordmark-height:\s*32px;/);
    const descriptions = [...phone.matchAll(/\.intro-description\s*\{([^}]*)\}/g)];
    assert.equal(descriptions.length, 1, "phone hero description should not have competing line heights");
    assert.match(descriptions[0][1], /margin-top:\s*var\(--space-1\);/);
    assert.match(descriptions[0][1], /font-size:\s*var\(--text-base\);/);
    assert.match(descriptions[0][1], /line-height:\s*1\.65;/);
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
