// /admin entrypoint: themes, session gate and application mount only.
import { StrictMode, useCallback, useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { applyAppearance } from "../lib/appearance";
import { adminApi as api, setAdminCsrf } from "./api";
import { Dashboard } from "./Dashboard";
import type { Session } from "./types";
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

function Gate() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const next = await api<Session>("/api/admin/session");
      setAdminCsrf(next.csrf || "");
      setSession(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (error)
    return (
      <Card title="后台暂时打不开">
        <p className="error">{error}</p>
        <button onClick={load}>重试</button>
      </Card>
    );
  if (!session) return <p className="muted pad center">正在连接…</p>;
  if (!session.configured)
    return (
      <Card title="后台还没有配置完成">
        <p>请在 Cloudflare 中为这个 Worker 设置以下变量或密钥，然后重新部署：</p>
        <ul className="mono">
          {session.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="muted">详细步骤见源码中的 README「网页后台」一节。</p>
      </Card>
    );
  if (!session.user)
    return (
      <Card title="登录后台">
        <p>使用有管理权限的 GitHub 账号登录。</p>
        <a className="button" href="/api/auth/github?return=/admin">
          使用 GitHub 登录
        </a>
      </Card>
    );
  if (!session.admin)
    return (
      <Card title="没有管理权限">
        <p>
          当前登录的 GitHub 账号 <strong>@{session.user.login}</strong> 不在管理员名单（ADMIN_GITHUB_LOGINS）中。
        </p>
        <button
          className="ghost"
          onClick={async () => {
            try {
              await api("/api/logout", "POST", {});
            } catch {}
            location.reload();
          }}
        >
          换个账号
        </button>
      </Card>
    );
  return <Dashboard session={session} />;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gate">
      <section className="panel">
        <h1>{title}</h1>
        {children}
      </section>
    </div>
  );
}

createRoot(document.getElementById("admin")!).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
);
