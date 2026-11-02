import { readFile, writeFile, mkdir } from "node:fs/promises";
import { renderToString } from "react-dom/server";
import StaticReader from "../src/components/Reader";
import App from "../src/App";
import { Boot } from "../src/components/Boot";
import { posts, site, metadata } from "../src/lib/data";

const boot = renderToString(<Boot />);
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const xml = escape;
const manifest = JSON.parse(await readFile("dist/.vite/manifest.json", "utf8"));
const entry = manifest["index.html"];
const modulePreloads = (entry?.imports || [])
  .map(
    (key: string) => `<link rel="modulepreload" href="/${manifest[key].file}">`,
  )
  .join("");
if (!entry) throw new Error("Missing Vite entry");
// Fonts are only discovered after the large stylesheet parses, so each page
// preloads the few unicode-range subsets its first screen actually uses.
type Face = { family: string; url: string; ranges: [number, number][] };
const faces: Face[] = [];
for (const c of entry.css || []) {
  const css = await readFile(`dist/${c}`, "utf8");
  for (const [, block] of css.matchAll(/@font-face\{([^}]*)\}/g)) {
    const family = /font-family:"?([^";]+)/.exec(block)?.[1],
      url = /url\(([^)]+\.woff2)\)/.exec(block)?.[1],
      range = /unicode-range:([^;}]+)/.exec(block)?.[1];
    if (!family || !url || !range) continue;
    faces.push({
      family,
      url,
      ranges: range.split(",").map((r) => {
        const [a, b = a] = r.trim().slice(2).split("-");
        return [parseInt(a, 16), parseInt(b, 16)];
      }),
    });
  }
}
const fontPreloads = (html: string) => {
  const text = html
    .replace(/<(script|svg|style)[\s\S]*?<\/>/g, "")
    .replace(/<[^>]+>/g, "")
    .slice(0, 1600);
  const pick = (family: string, n: number) =>
    faces
      .filter((f) => f.family === family)
      .map((f) => ({
        url: f.url,
        hits: [...text].filter((ch) => {
          const cp = ch.codePointAt(0)!;
          return f.ranges.some(([a, b]) => cp >= a && cp <= b);
        }).length,
      }))
      .filter((f) => f.hits > 2)
      .sort((a, b) => b.hits - a.hits)
      .slice(0, n)
      .map((f) => f.url);
  return [
    ...pick("Noto Sans SC Variable", 8),
    ...pick("Noto Serif SC Variable", 4),
    ...pick("JetBrains Mono Variable", 1),
  ]
    .map(
      (url) =>
        `<link rel="preload" href="${url}" as="font" type="font/woff2" crossorigin>`,
    )
    .join("");
};
const paths = [
  "/",
  "/feed",
  "/projects",
  "/about",
  "/archive",
  ...posts.map((p) => `/post/${p.slug}`),
  "/404",
];
const placeholder = site.origin.includes("YOUR_DOMAIN");
for (const path of paths) {
  const m = metadata(path),
    body = renderToString(<App initialPath={path} reader={StaticReader} />);
  const structured = m.post
    ? {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: m.post.title,
        description: m.post.excerpt,
        datePublished: m.post.date,
        dateModified: m.post.updated || m.post.date,
        author: { "@type": "Person", name: site.author },
        mainEntityOfPage: m.canonical,
        image: m.image,
        inLanguage: "zh-CN",
        isAccessibleForFree: true,
      }
    : {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: site.name,
        url: site.origin,
        description: site.description,
        inLanguage: "zh-CN",
      };
  const image = m.image.replace(".svg", ".png");
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f7f4ee"><title>${escape(m.title)}</title><meta name="description" content="${escape(m.description)}"><link rel="canonical" href="${escape(m.canonical)}"><meta property="og:type" content="${m.post ? "article" : "website"}"><meta property="og:locale" content="zh_CN"><meta property="og:site_name" content="${escape(site.name)}"><meta property="og:title" content="${escape(m.title)}"><meta property="og:description" content="${escape(m.description)}"><meta property="og:url" content="${escape(m.canonical)}"><meta property="og:image" content="${escape(image)}"><meta name="twitter:card" content="summary_large_image">${m.post ? `<meta property="article:published_time" content="${m.post.date}T12:00:00+08:00">` : ""}${placeholder || path === "/404" ? '<meta name="robots" content="noindex,nofollow">' : ""}<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate icon" href="/favicon.ico" sizes="any"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="alternate" type="application/rss+xml" title="${escape(site.name)}" href="/rss.xml"><script src="/theme.js"></script>${fontPreloads(body)}${modulePreloads}${(entry.css || []).map((c: string) => `<link rel="stylesheet" href="/${c}">`).join("")}<script id="structured-data" type="application/ld+json">${JSON.stringify({ ...structured, image }).replace(/</g, "\\u003c")}</script></head><body>${boot}<div id="root" data-prerender="true">${body}</div><script type="module" src="/${entry.file}"></script></body></html>`;
  const file =
    path === "/404"
      ? "dist/404.html"
      : path === "/"
        ? "dist/index.html"
        : `dist${path}/index.html`;
  await mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
  await writeFile(file, html);
}
await writeFile(
  "dist/sitemap.xml",
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths
    .filter((p) => p !== "/404")
    .map(
      (path) =>
        `<url><loc>${xml(site.origin + (path === "/" ? "" : path))}</loc>${metadata(path).post ? `<lastmod>${metadata(path).post!.updated || metadata(path).post!.date}</lastmod>` : ""}</url>`,
    )
    .join("")}</urlset>`,
);
await writeFile(
  "dist/rss.xml",
  `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xml(site.name)}</title><link>${xml(site.origin)}</link><description>${xml(site.description)}</description><language>zh-CN</language><atom:link href="${xml(site.origin)}/rss.xml" rel="self" type="application/rss+xml"/>${posts.map((p) => `<item><title>${xml(p.title)}</title><link>${xml(site.origin)}/post/${p.slug}</link><guid isPermaLink="false">echo:${p.id}</guid><pubDate>${new Date(p.date + "T12:00:00+08:00").toUTCString()}</pubDate><description>${xml(p.excerpt)}</description></item>`).join("")}</channel></rss>`,
);
await writeFile(
  "dist/robots.txt",
  `User-agent: *\n${placeholder ? "Disallow: /" : "Allow: /\nDisallow: /api/\nDisallow: /admin"}\nSitemap: ${site.origin}/sitemap.xml\n`,
);
console.log(
  `Pre-rendered ${paths.length} full HTML documents${placeholder ? " (preview domain: noindex enabled)" : ""}`,
);
