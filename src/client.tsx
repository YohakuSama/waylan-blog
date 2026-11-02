import { hydrateRoot, createRoot } from "react-dom/client";
import App from "./App";
import { loadReader } from "./lib/reader-loader";
// Self-hosted web fonts, split by unicode-range so a page only fetches the glyphs it uses.
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./styles.css";
import "./styles/site.css";
import "./styles/skins.css";
import "./styles/motion.css";
if (location.pathname.startsWith("/post/")) await loadReader();
const root = document.getElementById("root")!;
if (root.dataset.prerender === "true")
  hydrateRoot(
    root,
    <App initialPath={location.pathname.replace(/\/$/, "") || "/"} />,
    {
      onRecoverableError(error, info) {
        const diagnostic = window as Window & {
          __WAYLAN_HYDRATION_DIAGNOSTIC__?: boolean;
          __WAYLAN_HYDRATION_TRACE__?: Array<{ route: string; detail: string; stack: string }>;
        };
        if (diagnostic.__WAYLAN_HYDRATION_DIAGNOSTIC__) {
          (diagnostic.__WAYLAN_HYDRATION_TRACE__ ||= []).push({
            route: location.pathname,
            detail: error instanceof Error ? error.message : String(error),
            stack: info.componentStack,
          });
        }
      },
    },
  );
else
  createRoot(root).render(
    <App initialPath={location.pathname.replace(/\/$/, "") || "/"} />,
  );
