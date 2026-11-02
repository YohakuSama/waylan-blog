import { useSyncExternalStore } from "react";
import { posts } from "./data";

/**
 * Reading shelf: slugs saved on this device only. The key predates the React
 * port, so lists saved with 1.x keep working after the upgrade.
 */
const KEY = "waylan:reading-list:v1";
const MAX = 300;
const valid = new Set(posts.map((p) => p.slug));
const EMPTY: string[] = [];
let cache: string[] | null = null;
const listeners = new Set<() => void>();

function read(): string[] {
  if (cache) return cache;
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
    cache = Array.isArray(saved)
      ? [...new Set(saved.filter((s): s is string => typeof s === "string" && valid.has(s)))].slice(0, MAX)
      : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: string[]) {
  cache = next;
  let ok = true;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    ok = false;
  }
  listeners.forEach((l) => l());
  return ok;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const sync = (e: StorageEvent) => {
    if (e.key !== KEY && e.key !== null) return;
    cache = null;
    listener();
  };
  window.addEventListener("storage", sync);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", sync);
  };
}

export const shelf = {
  toggle(slug: string) {
    const list = read();
    return write(
      list.includes(slug)
        ? list.filter((s) => s !== slug)
        : [slug, ...list].slice(0, MAX),
    );
  },
  remove: (slug: string) => write(read().filter((s) => s !== slug)),
  clear: () => write([]),
};

/** Server render and first hydration pass see an empty shelf, then the real one. */
export const useShelf = () =>
  useSyncExternalStore(subscribe, read, () => EMPTY);
