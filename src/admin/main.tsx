// /admin bootstrap owns theme initialization and the privileged gate mount.
// Content editing and session authorization are deliberately independent.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyAppearance } from "../lib/appearance";
import { Gate } from "./Gate";
import "./admin.css";

// The admin keeps its own CSS, but shares the public site's theme preference.
// Follow OS changes while "system" is selected and preferences changed in another tab.
const syncAdminAppearance = () => applyAppearance();
syncAdminAppearance();
matchMedia("(prefers-color-scheme: dark)").addEventListener?.(
  "change",
  syncAdminAppearance,
);
window.addEventListener("storage", (event) => {
  if (event.key === "echo:theme" || event.key === "echo:skin" || event.key === null)
    syncAdminAppearance();
});

createRoot(document.getElementById("admin")!).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
);
