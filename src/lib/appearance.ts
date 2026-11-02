import { storage } from "./storage";
export type Skin = "editorial" | "terminal";
export type ThemePreference = "light" | "dark" | "system";
export const themeColors = {
  editorial: { light: "#f7f4ee", dark: "#16151a" },
  terminal: { light: "#eef0e8", dark: "#0b0d0c" },
};
export function skinPreference(): Skin {
  return storage.get<string>("skin", "editorial") === "terminal"
    ? "terminal"
    : "editorial";
}
export function themePreference(): ThemePreference {
  const value = storage.get<string>("theme", "system");
  return value === "light" || value === "dark" ? value : "system";
}
function resolvedTheme(preference: ThemePreference) {
  return preference === "system"
    ? matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : preference;
}
export function applyAppearance(
  skin: Skin = skinPreference(),
  theme: ThemePreference = themePreference(),
) {
  const root = document.documentElement,
    mode = resolvedTheme(theme);
  root.dataset.skin = skin;
  root.dataset.theme = mode;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", themeColors[skin][mode]);
}
export function setSkin(skin: Skin) {
  storage.set("skin", skin);
  applyAppearance(skin);
}
export function setThemePreference(theme: ThemePreference) {
  storage.set("theme", theme);
  applyAppearance(undefined, theme);
}
