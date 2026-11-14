import {
  authProvider,
  authReady,
  HttpError,
  json,
  now,
  type Env,
  type SessionRow,
  type UserSession,
} from "./types";
import {
  base64url,
  cookie,
  cookieName,
  cookieValue,
  equal,
  hash,
  limit,
  random,
  safeReturn,
  seal,
  unseal,
  clientIP,
} from "./security";
export async function getSession(
  request: Request,
  env: Env,
): Promise<UserSession | null> {
  if (!authReady(env)) return null;
  const raw = cookieValue(request, cookieName(request));
  if (!raw) return null;
  const row = await env
    .DB!.prepare("SELECT * FROM sessions WHERE id_hash=? AND expires_at>?")
    .bind(await hash(raw), now())
    .first<SessionRow>();
  if (!row) return null;
  try {
    const user = JSON.parse(row.user_json) as UserSession["user"] & {
      authProvider?: string;
    };
    // Only sessions established by GitHub App are trusted.
    if (user.authProvider !== "github-app") return null;
    return {
      row,
      user,
      token: await unseal(row.token_encrypted, env.SESSION_SECRET!),
    };
  } catch {
    return null;
  }
}
export async function requireSession(request: Request, env: Env) {
  const session = await getSession(request, env);
  if (!session)
    throw new HttpError(
      401,
      "LOGIN_REQUIRED",
      "请先通过 GitHub 登录，刚才的文字会保留。",
    );
  if (!equal(request.headers.get("X-CSRF-Token") || "", session.row.csrf))
    throw new HttpError(403, "CSRF", "会话校验没有通过，请刷新身份后重试。");
  return session;
}
export async function startAuth(request: Request, env: Env) {
  if (!authReady(env))
    throw new HttpError(503, "NOT_CONFIGURED", "评论功能尚未开放。");
  await limit(env, `oauth:${clientIP(request)}`, 12, 600);
  const state = random(),
    verifier = random(48);
  const challenge = await hash(verifier),
    returnPath = safeReturn(new URL(request.url).searchParams.get("return"));
  await env
    .DB!.prepare(
      "INSERT INTO oauth_states(state_hash,verifier_encrypted,return_path,expires_at) VALUES(?,?,?,?)",
    )
    .bind(
      await hash(state),
      await seal(verifier, env.SESSION_SECRET!),
      returnPath,
      now() + 600,
    )
    .run();
  const url = new URL("https://github.com/login/oauth/authorize");
  Object.entries({
    client_id: env.GITHUB_APP_CLIENT_ID!,
    redirect_uri: `${env.SITE_ORIGIN}/api/auth/callback`,
    // GitHub Apps use registered fine-grained permissions, not broad OAuth scopes.
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).forEach(([k, v]) => url.searchParams.set(k, v));
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Cache-Control": "no-store",
      "Set-Cookie": cookie(request, cookieName(request, "oauth"), state, 600),
    },
  });
}
export async function callback(request: Request, env: Env) {
  if (!authReady(env))
    throw new HttpError(503, "NOT_CONFIGURED", "评论功能尚未开放。");
  const url = new URL(request.url),
    state = url.searchParams.get("state") || "",
    browserState = cookieValue(request, cookieName(request, "oauth"));
  if (!state || !browserState || !equal(state, browserState))
    throw new HttpError(
      400,
      "OAUTH_STATE",
      "登录状态无法验证。请回到文章重新登录。",
    );
  const flow = await env
    .DB!.prepare(
      "DELETE FROM oauth_states WHERE state_hash=? AND expires_at>? RETURNING *",
    )
    .bind(await hash(state), now())
    .first<{ verifier_encrypted: string; return_path: string }>();
  if (!flow)
    throw new HttpError(
      400,
      "OAUTH_EXPIRED",
      "这次登录已过期或已使用，请重新开始。",
    );
  const redirect = (path: string, sessionCookie?: string) => {
    const headers = new Headers({
      Location: new URL(path, env.SITE_ORIGIN).toString(),
      "Cache-Control": "no-store",
    });
    headers.append(
      "Set-Cookie",
      cookie(request, cookieName(request, "oauth"), "", 0),
    );
    if (sessionCookie) headers.append("Set-Cookie", sessionCookie);
    return new Response(null, { status: 302, headers });
  };
  if (url.searchParams.has("error") || !url.searchParams.get("code")) {
    const target = new URL(flow.return_path, env.SITE_ORIGIN);
    target.searchParams.set("auth_error", "cancelled");
    return redirect(target.pathname + target.search + target.hash);
  }
  try {
    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "ECHO-Blog/1.0",
        },
        body: JSON.stringify({
          client_id: env.GITHUB_APP_CLIENT_ID,
          client_secret: env.GITHUB_APP_CLIENT_SECRET,
          code: url.searchParams.get("code"),
          redirect_uri: `${env.SITE_ORIGIN}/api/auth/callback`,
          code_verifier: await unseal(
            flow.verifier_encrypted,
            env.SESSION_SECRET!,
          ),
        }),
        signal: AbortSignal.timeout(10000),
      },
    );
    const token = (await response.json()) as {
      access_token?: string;
      error?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!response.ok || !token.access_token || token.error)
      throw new Error("exchange");
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ECHO-Blog/1.0",
      },
      signal: AbortSignal.timeout(10000),
    });
    const user = (await userResponse.json()) as {
      id: number;
      login: string;
      avatar_url: string;
      html_url: string;
    };
    if (!userResponse.ok || !user.id) throw new Error("user");
    const age = Math.min(
        7 * 86400,
        token.expires_in ? Math.max(60, token.expires_in - 60) : 7 * 86400,
      ),
      sessionId = random(),
      csrf = random();
    await env
      .DB!.prepare(
        "INSERT INTO sessions(id_hash,user_id,user_json,token_encrypted,csrf,expires_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        await hash(sessionId),
        String(user.id),
        JSON.stringify({
          login: user.login,
          avatarUrl: user.avatar_url,
          url: user.html_url,
          authProvider: authProvider(env),
        }),
        await seal(token.access_token, env.SESSION_SECRET!),
        csrf,
        now() + age,
      )
      .run();
    return redirect(
      safeReturn(flow.return_path),
      cookie(request, cookieName(request), sessionId, age),
    );
  } catch {
    const target = new URL(flow.return_path, env.SITE_ORIGIN);
    target.searchParams.set("auth_error", "unavailable");
    return redirect(target.pathname + target.search + target.hash);
  }
}
export async function logout(request: Request, env: Env) {
  const session = await requireSession(request, env);
  await env
    .DB!.prepare("DELETE FROM sessions WHERE id_hash=?")
    .bind(session.row.id_hash)
    .run();
  return json({ ok: true }, 200, {
    "Set-Cookie": cookie(request, cookieName(request), "", 0),
  });
}
