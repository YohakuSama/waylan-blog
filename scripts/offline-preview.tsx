import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { build } from "vite";
import { renderToString } from "react-dom/server";
import { JSDOM } from "jsdom";
import App from "../src/App";
import Reader from "../src/components/Reader";
import { Boot } from "../src/components/Boot";
import { metadata, site } from "../src/lib/data";

const escape = (value: string) =>
  value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const built = await build({
  configFile: false,
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  publicDir: false,
  build: {
    write: false,
    emptyOutDir: false,
    target: "es2020",
    minify: "esbuild",
    cssCodeSplit: false,
    lib: { entry: "src/offline.tsx", name: "WaylanOffline", formats: ["iife"] },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
const output = Array.isArray(built)
  ? built[0].output
  : "output" in built
    ? built.output
    : null;
if (!output) throw new Error("Offline preview build did not produce output");
const script = output
  .filter((item) => item.type === "chunk")
  .map((item) => item.code)
  .join("\n");
const rawCss = output
  .flatMap((item) =>
    item.type === "asset" && item.fileName.endsWith(".css")
      ? [
          typeof item.source === "string"
            ? item.source
            : Buffer.from(item.source).toString("utf8"),
        ]
      : [],
  )
  .join("\n");
// A file:// page cannot fetch Vite's root-relative /assets/ font URLs.
// Embed every emitted font once so every Chinese glyph and both skins render
// in the same font without a network connection.
const fonts = new Map<string, string>(
  output.flatMap((item) =>
    item.type === "asset" && /\.woff2?$/.test(item.fileName)
      ? [[item.fileName.split("/").at(-1)!, Buffer.from(item.source).toString("base64")] as [string, string]]
      : [],
  ),
);
const css = rawCss.replace(
  /url\((['"]?)([^)'"\s]+\.woff2?)\1\)/g,
  (whole, _quote, url: string) => {
    const encoded = fonts.get(url.split("/").at(-1)!);
    if (!encoded) throw new Error(`Offline preview missing embedded font: ${url}`);
    return `url("data:font/woff2;base64,${encoded}")`;
  },
);
const assets: Record<string, string> = {};
const mime: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};
// Covers live in public/art, images inside posts in public/images.
for (const dir of ["art", "images"]) {
  const names = await readdir(`public/${dir}`, { recursive: true }).catch(
    () => [] as string[],
  );
  for (const name of names) {
    const type = mime[name.split(".").at(-1)!.toLowerCase()];
    if (!type) continue;
    assets[`/${dir}/` + name.replaceAll("\\", "/")] =
      `data:${type};base64,` +
      (await readFile(`public/${dir}/` + name)).toString("base64");
  }
}
const avatar = (
  JSON.parse(await readFile("src/generated/site.json", "utf8")) as {
    avatar?: string;
  }
).avatar;
if (avatar?.startsWith("/")) {
  const type = mime[avatar.split(".").at(-1)!.toLowerCase()];
  if (!type)
    throw new Error(`site.json avatar has unsupported type: ${avatar}`);
  assets[avatar] =
    `data:${type};base64,` +
    (await readFile("public" + avatar)).toString("base64");
}
assets["/rss.xml"] =
  "data:application/rss+xml;base64," +
  (await readFile("dist/rss.xml")).toString("base64");
const favicon =
  "data:image/svg+xml;base64," +
  (await readFile("public/favicon.svg")).toString("base64");
const doc = new JSDOM(
  "<!doctype html><body>" +
    renderToString(<App initialPath="/" reader={Reader} />),
).window.document;
for (const image of doc.querySelectorAll("img[src]")) {
  const src = image.getAttribute("src")!;
  if (assets[src]) image.setAttribute("src", assets[src]);
}
for (const link of doc.querySelectorAll("a[href]")) {
  const href = link.getAttribute("href")!;
  if (assets[href]) {
    link.setAttribute("href", assets[href]);
    link.setAttribute("download", `${site.name}-rss.xml`);
  } else if (href.startsWith("/")) link.setAttribute("href", "#" + href);
}
doc.querySelectorAll('link[rel="preload"]').forEach((link) => link.remove());
const theme = await readFile("public/theme.js", "utf8");
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f7f4ee"><title>${escape(metadata("/").title)}</title><link rel="icon" href="${favicon}"><script>${theme.replace(/<\/script/gi, "<\\/script")}</script><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body>${renderToString(<Boot />)}<div id="root">${doc.body.innerHTML}</div><script>window.__WAYLAN_OFFLINE_PREVIEW__=true;window.__WAYLAN_PREVIEW_ASSETS__=${JSON.stringify(assets).replace(/</g, "\\u003c")};\n${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
await mkdir("preview", { recursive: true });
await writeFile("preview/index.html", html);
console.log(
  `Waylan offline preview: ${Math.round(Buffer.byteLength(html) / 1024)} KiB, self-contained classic script + embedded images. Open preview/index.html directly.`,
);
