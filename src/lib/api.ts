import { offlinePreview, offlineRead } from "./runtime";
import { useCallback, useEffect, useState } from "react";
export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (offlinePreview()) {
    if (!options.method || options.method === "GET") {
      const result = offlineRead(path);
      if (result !== undefined) return result as T;
    }
    throw new ApiError(
      "本地预览不支持评论，网站上线后即可使用。",
      "OFFLINE_PREVIEW",
      503,
    );
  }
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      signal: options.signal || AbortSignal.timeout(14000),
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError("网络暂时没有回应，请稍后重试。", "NETWORK", 0);
  }
  const body = (await response.json().catch(() => null)) as
    (T & { message?: string; code?: string }) | null;
  if (!response.ok)
    throw new ApiError(
      body?.message || "暂时无法连接讨论服务。",
      body?.code || "UNAVAILABLE",
      response.status,
    );
  return body as T;
}
const memory = new Map<string, { data: unknown; time: number }>();
export function invalidateComments() {
  for (const key of memory.keys())
    if (
      key.includes("comments") ||
      key.includes("annotations") ||
      key === "/api/echo"
    )
      memory.delete(key);
}
export function useApi<T>(path: string | null) {
  const saved = path ? memory.get(path) : null;
  const [state, set] = useState<{
    data: T | null;
    loading: boolean;
    error: ApiError | null;
  }>({
    data: (saved?.data as T) || null,
    loading: !!path && !saved,
    error: null,
  });
  const [revision, refresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(),
      cached = path ? memory.get(path) : null;
    set({
      data: (cached?.data as T) || null,
      loading: !!path && !cached,
      error: null,
    });
    if (!path) return;
    if (cached && Date.now() - cached.time < 60000 && revision === 0) return;
    api<T>(path, {
      signal: offlinePreview()
        ? undefined
        : AbortSignal.any([controller.signal, AbortSignal.timeout(14000)]),
    })
      .then((data) => {
        if (controller.signal.aborted) return;
        memory.set(path, { data, time: Date.now() });
        set({ data, loading: false, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          set({ data: (cached?.data as T) || null, loading: false, error });
      });
    return () => controller.abort();
  }, [path, revision]);
  useEffect(() => {
    const update = () => {
      if (document.visibilityState === "visible") refresh((n) => n + 1);
    };
    const timer = setInterval(update, 60000);
    window.addEventListener("focus", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, [path]);
  return { ...state, reload: useCallback(() => refresh((n) => n + 1), []) };
}
