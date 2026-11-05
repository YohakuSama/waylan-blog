/** Shared app stylesheet order for the online and offline entrypoints.
 * Font imports remain first so the Vite font-subset/preload pipeline is unchanged.
 */
import "@fontsource-variable/noto-sans-sc/wght.css";
import "@fontsource-variable/noto-serif-sc/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "../styles.css";
import "./site.css";
import "./skins.css";
import "./motion.css";
