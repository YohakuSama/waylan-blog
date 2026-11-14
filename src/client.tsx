import { hydrateRoot, createRoot } from "react-dom/client";
import App from "./App";
import { loadReader } from "./lib/reader-loader";
// Self-hosted web fonts, split by unicode-range so a page only fetches the glyphs it uses.
import "./styles/index";
if (location.pathname.startsWith("/post/")) await loadReader();
const root = document.getElementById("root")!;
if (root.dataset.prerender === "true")
  hydrateRoot(
    root,
    <App initialPath={location.pathname.replace(/\/$/, "") || "/"} />,
  );
else
  createRoot(root).render(
    <App initialPath={location.pathname.replace(/\/$/, "") || "/"} />,
  );
