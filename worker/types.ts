import type { Author } from "../shared/types";
export type Env = {
  DB?: D1Database;
  ASSETS?: Fetcher;
  SITE_ORIGIN?: string;
  GITHUB_REPO_OWNER?: string;
  GITHUB_REPO_NAME?: string;
  /** Legacy OAuth App or fine-grained GitHub App user authorization. */
  GITHUB_AUTH_PROVIDER?: "oauth-app" | "github-app";
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Staged GitHub App credentials; keep old OAuth secrets untouched until cutover. */
  GITHUB_APP_CLIENT_ID?: string;
  GITHUB_APP_CLIENT_SECRET?: string;
  GITHUB_READ_TOKEN?: string;
  SESSION_SECRET?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  /** Safe opt-in: enable only after 0004 migration + verified webhook setup. */
  NOTIFICATIONS_ENABLED?: "true" | "false";
  /** Admin: GitHub logins allowed into /admin, comma separated. */
  ADMIN_GITHUB_LOGINS?: string;
  /** Admin: repository holding this site's source, "owner/name". */
  CONTENT_REPO?: string;
  CONTENT_BRANCH?: string;
  /** Admin: fine-grained token, Contents read/write on CONTENT_REPO only. */
  GITHUB_CONTENT_TOKEN?: string;
  GITHUB_CATEGORY_NAME?: string;
};
export type DiscussionMap = {
  post_id: string;
  discussion_id: string;
  discussion_number: number;
  url: string;
};
export type SessionRow = {
  id_hash: string;
  user_id: string;
  user_json: string;
  token_encrypted: string;
  csrf: string;
  expires_at: number;
};
export type UserSession = { row: SessionRow; user: Author; token: string };
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const now = () => Math.floor(Date.now() / 1000);
export const present = (value?: string) =>
  !!value && !/YOUR_|REPLACE_|\.example/.test(value);
export const readReady = (env: Env) =>
  !!env.DB &&
  present(env.GITHUB_READ_TOKEN) &&
  present(env.GITHUB_REPO_OWNER) &&
  present(env.GITHUB_REPO_NAME);
export const authProvider = (env: Env) => env.GITHUB_AUTH_PROVIDER || "oauth-app";
export const authClientId = (env: Env) =>
  authProvider(env) === "github-app" ? env.GITHUB_APP_CLIENT_ID : env.GITHUB_CLIENT_ID;
export const authClientSecret = (env: Env) =>
  authProvider(env) === "github-app" ? env.GITHUB_APP_CLIENT_SECRET : env.GITHUB_CLIENT_SECRET;
export const authReady = (env: Env) =>
  (env.GITHUB_AUTH_PROVIDER === undefined ||
    env.GITHUB_AUTH_PROVIDER === "oauth-app" ||
    env.GITHUB_AUTH_PROVIDER === "github-app") &&
  !!env.DB &&
  present(authClientId(env)) &&
  present(authClientSecret(env)) &&
  present(env.SESSION_SECRET) &&
  !!env.SESSION_SECRET &&
  env.SESSION_SECRET.length >= 32 &&
  present(env.SITE_ORIGIN);
export const json = (value: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
