/** Admin-only JSON transport: separate CSRF and longer save timeout. */
export class AdminApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
let csrf = "";
export function setAdminCsrf(token: string) { csrf = token; }
export async function adminApi<T>(path: string, method = "GET", body?: unknown) {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      signal: AbortSignal.timeout(90_000),
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new AdminApiError("网络没有回应，请检查网络后重试。", 0);
  }
  const data = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  if (!response.ok)
    throw new AdminApiError(
      data?.message || `请求失败（${response.status}），请稍后重试。`,
      response.status,
    );
  return data as T;
}
