import { HttpError, now, type Env } from "./types";
const encoder = new TextEncoder();
export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
export const random = (size = 32) =>
  base64url(crypto.getRandomValues(new Uint8Array(size)));
export const hash = async (value: string) =>
  base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
export function equal(a: string, b: string) {
  let result = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return result === 0;
}
export function cookieValue(request: Request, name: string) {
  return (
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
export const cookieName = (_request: Request, kind = "session") =>
  `__Host-echo_${kind}`;
export function cookie(
  _request: Request,
  name: string,
  value: string,
  age: number,
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}; Secure`;
}
export function safeReturn(path: string | null) {
  if (
    !path ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    /[\r\n\x00]/.test(path) ||
    path.length > 1500
  )
    return "/feed";
  const parsed = new URL(path, "https://echo.invalid");
  if (
    parsed.origin !== "https://echo.invalid" ||
    parsed.pathname.startsWith("/api/")
  )
    return "/feed";
  return parsed.pathname + parsed.search + parsed.hash;
}
async function encryptionKey(secret: string) {
  const bytes = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(plaintext: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode("echo-session-v1"),
      },
      await encryptionKey(secret),
      encoder.encode(plaintext),
    ),
  );
  const bytes = new Uint8Array(iv.length + ciphertext.length);
  bytes.set(iv);
  bytes.set(ciphertext, iv.length);
  return base64url(bytes);
}
export async function unseal(value: string, secret: string) {
  const bytes = Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytes.slice(0, 12),
      additionalData: encoder.encode("echo-session-v1"),
    },
    await encryptionKey(secret),
    bytes.slice(12),
  );
  return new TextDecoder().decode(plaintext);
}
export function requireOrigin(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!env.SITE_ORIGIN || origin !== new URL(env.SITE_ORIGIN).origin)
    throw new HttpError(403, "ORIGIN", "这个操作需要从网站本身发起。");
  if (request.headers.get("Sec-Fetch-Site") === "cross-site")
    throw new HttpError(403, "ORIGIN", "请求来源无法确认。");
}
export async function readBody(request: Request, max = 24000) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new HttpError(415, "CONTENT_TYPE", "请使用 JSON 提交内容。");
  const length = Number(request.headers.get("Content-Length"));
  if (length > max)
    throw new HttpError(413, "TOO_LARGE", "内容太长，请精简后重试。");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "BODY", "内容不能为空。");
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      throw new HttpError(413, "TOO_LARGE", "内容太长，请精简后重试。");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    throw new HttpError(400, "JSON", "内容格式不正确。");
  }
}
/** Atomic fixed-window limiter shared by every isolate, with short-lived opaque bucket keys. */
export async function limit(
  env: Env,
  key: string,
  maximum: number,
  windowSeconds: number,
) {
  if (!env.DB) return;
  const bucket = Math.floor(now() / windowSeconds);
  const opaque = await hash(
    `${env.SESSION_SECRET || "echo-public-read"}:${key}:${bucket}`,
  );
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits(bucket_key,counter,expires_at) VALUES(?,1,?) ON CONFLICT(bucket_key) DO UPDATE SET counter=counter+1 RETURNING counter",
  )
    .bind(opaque, (bucket + 1) * windowSeconds)
    .first<{ counter: number }>();
  if ((row?.counter || 0) > maximum)
    throw new HttpError(429, "RATE_LIMIT", "先歇一会儿，稍后再继续。");
}
export const clientIP = (r: Request) =>
  r.headers.get("CF-Connecting-IP") || "local";
export async function verifyWebhook(
  raw: string,
  signature: string,
  secret: string,
) {
  if (!signature.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(raw)),
  );
  return equal(
    "sha256=" +
      Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""),
    signature,
  );
}
