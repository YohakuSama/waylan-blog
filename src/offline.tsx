import { createRoot } from "react-dom/client";
import App from "./App";
import Reader from "./components/Reader";
import { currentRoute } from "./lib/runtime";
// Keep the stand-alone preview's typography identical to the deployed site.
// The preview packager converts emitted WOFF2 files to embedded data URIs.
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles.css";
import "./styles/site.css";
import "./styles/skins.css";
import "./styles/motion.css";
// This is bundled as one classic IIFE. It needs no imports, server, fetch, or CDN.
createRoot(document.getElementById("root")!).render(
  <App initialPath={currentRoute()} reader={Reader} />,
);
// Every font is already embedded, so decode the rest a few at a time while idle;
// later pages then render in their final face instead of swapping glyphs.
// Waits for theme.js to reveal the page so it doesn't extend the first-load wait.
const idle = (fn: () => void) =>
  "requestIdleCallback" in window ? requestIdleCallback(fn) : setTimeout(fn, 50);
const warmFonts = () => {
  const pending = [...document.fonts].filter((f) => f.status === "unloaded");
  const next = () => {
    const batch = pending.splice(0, 4);
    if (!batch.length) return;
    Promise.all(batch.map((f) => f.load().catch(() => {}))).then(() => idle(next));
  };
  idle(next);
};
const html = document.documentElement;
if (document.fonts && !html.classList.contains("font-wait")) warmFonts();
else if (document.fonts) {
  const revealed = new MutationObserver(() => {
    if (html.classList.contains("font-wait")) return;
    revealed.disconnect();
    warmFonts();
  });
  revealed.observe(html, { attributes: true, attributeFilter: ["class"] });
}
