import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { transient } from "./storage";

/**
 * Read counts from the Worker. Lists share one request; the reader adds one
 * ping per post per browser session. When the service is absent (offline
 * preview, no database) `enabled` stays false and every count stays hidden.
 */
type State = { enabled: boolean; views: Record<string, number> };
const EMPTY: State = { enabled: false, views: {} };
let state = EMPTY,
  requested = false;
const listeners = new Set<() => void>();
const emit = (next: State) => {
  state = next;
  listeners.forEach((l) => l());
};
function load() {
  if (requested) return;
  requested = true;
  api<State>("/api/views")
    .then((data) =>
      emit({ enabled: !!data?.enabled, views: { ...data?.views, ...state.views } }),
    )
    .catch(() => {});
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  load();
  return () => listeners.delete(listener);
}
export const useViews = () =>
  useSyncExternalStore(subscribe, () => state, () => EMPTY);

/** Counts this read once per session; the server also de-duplicates per day. */
export function useRecordView(postId: string) {
  useEffect(() => {
    const key = `viewed:${postId}`;
    if (transient.get(key, false)) return;
    const timer = window.setTimeout(() => {
      api<{ enabled: boolean; views: number | null }>(
        `/api/posts/${postId}/view`,
        { method: "POST" },
      )
        .then((data) => {
          transient.set(key, true);
          if (data?.enabled && typeof data.views === "number")
            emit({ enabled: true, views: { ...state.views, [postId]: data.views } });
        })
        .catch(() => {});
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [postId]);
}

export const viewsLabel = (n: number) =>
  n >= 10_000
    ? `${(n / 10_000).toFixed(1).replace(/\.0$/, "")} 万`
    : n.toLocaleString("zh-CN");
