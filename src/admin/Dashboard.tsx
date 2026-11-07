import { useCallback, useEffect, useRef, useState } from "react";
import { str } from "./form";
import { adminApi as api } from "./api";
import { ago, editsLive } from "./helpers";
import { PostEditor } from "./PostEditor";
import { SiteEditor } from "./SiteEditor";
import type { Overview, Session, Status } from "./types";
import { Posts } from "./ContentList";
import { Discussions } from "./Discussions";

/** Dashboard coordinates navigation and refresh; editors own their own unsaved state. */
function DeployStatus({ status, branch }: { status: Status; branch: string }) {
  if (!editsLive(branch))
    return (
      <span className="status">
        当前编辑的是内容分支「{branch}」，提交不会直接上线。请先在 GitHub 创建 PR，待通过审核后合并到 main。
      </span>
    );
  if (!status.live)
    return (
      <span className="status">
        最近一次提交 {ago(status.head.date)}。线上版本未记录提交号，请在 Cloudflare 查看构建进度。
      </span>
    );
  if (status.live === status.head.oid)
    return <span className="status ok">线上已是最新版本</span>;
  const late = Date.now() - Date.parse(status.head.date) > 10 * 60_000;
  return late ? (
    <span className="status bad">
      最近一次提交（{ago(status.head.date)}）还没有上线，请到 Cloudflare 的 Workers Builds 查看构建日志。
    </span>
  ) : (
    <span className="status busy">网站正在重新构建，一两分钟后生效…</span>
  );
}

type View = { name: "list" } | { name: "post"; file: string | null; key: number } | { name: "site" };

export function Dashboard({ session }: { session: Session }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>({ name: "list" });
  const [toast, setToast] = useState("");
  const toastTimer = useRef(0);
  const notify = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 5000);
  };
  // Refreshes can overlap (save, then leave); only the latest one may land.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++latest.current;
    try {
      const next = await api<Overview>("/api/admin/content");
      if (run !== latest.current) return;
      setOverview(next);
      setStatus({ head: next.head, live: next.live });
      setError("");
    } catch (e) {
      if (run === latest.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // While a commit is waiting to go live, check every 30 seconds.
  const pendingDeploy = editsLive(overview?.repo.branch || "") &&
    !!status?.live && status.live !== status.head.oid;
  useEffect(() => {
    if (!pendingDeploy) return;
    const timer = setInterval(async () => {
      try {
        setStatus(await api<Status>("/api/admin/status"));
      } catch {}
    }, 30_000);
    return () => clearInterval(timer);
  }, [pendingDeploy]);
  // Once the new build is live, reload so lists reflect it (e.g. discussions).
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pendingDeploy && view.name === "list") refresh();
    wasPending.current = pendingDeploy;
  }, [pendingDeploy, refresh, view.name]);

  const logout = async () => {
    try {
      await api("/api/logout", "POST", {});
    } catch {}
    location.reload();
  };
  const siteName = str(overview?.site.data.name) || "网站";

  useEffect(() => {
    document.title = `后台 · ${siteName}`;
  }, [siteName]);

  return (
    <div className="shell">
      <header className="top">
        <strong className="top-title">{siteName} · 后台</strong>
        {overview && (
          <span className="muted small mono">
            {overview.repo.name}@{overview.repo.branch}
          </span>
        )}
        <span className="spacer" />
        <a href="/" target="_blank" rel="noreferrer">
          查看网站
        </a>
        {session.user && (
          <span className="user">
            <img src={session.user.avatarUrl} alt="" />
            <span className="user-name">{session.user.login}</span>
          </span>
        )}
        <button className="ghost" onClick={logout}>
          退出
        </button>
      </header>
      <main>
        {status && (
          <div className="deploy">
            <DeployStatus status={status} branch={overview?.repo.branch || "main"} />
          </div>
        )}
        {overview && !editsLive(overview.repo.branch) && (
          <div className="panel" role="note">
            当前内容保存在 <strong>{overview.repo.branch}</strong>，不会自动部署到网站。
            <a href={`https://github.com/${overview.repo.name}/compare/main...${encodeURIComponent(overview.repo.branch)}?expand=1`}
              target="_blank" rel="noreferrer">在 GitHub 查看差异并创建 PR</a>。
            合并 PR 后请重新打开后台查看线上版本。
          </div>
        )}
        {error && (
          <div className="panel">
            <p className="error">{error}</p>
            <button onClick={refresh}>重试</button>
          </div>
        )}
        {!overview && !error && <p className="muted pad">正在读取仓库…</p>}
        {overview && view.name === "list" && (
          <>
            <Discussions overview={overview} onDone={refresh} notify={notify} />
            <section className="panel site-card">
              <div>
                <h2>站点资料</h2>
                <p className="muted">名称、作者、头像、介绍、联系方式和关于页。</p>
              </div>
              <button className="ghost" onClick={() => setView({ name: "site" })}>
                编辑
              </button>
            </section>
            <Posts
              overview={overview}
              onEdit={(file) => setView({ name: "post", file, key: Date.now() })}
              onDeleted={refresh}
              notify={notify}
            />
          </>
        )}
        {overview && view.name === "post" && (
          <PostEditor
            key={view.key}
            file={view.file}
            overview={overview}
            onSaved={refresh}
            onClose={() => {
              setView({ name: "list" });
              refresh();
            }}
            notify={notify}
          />
        )}
        {overview && view.name === "site" && (
          <SiteEditor
            overview={overview}
            onSaved={refresh}
            onClose={() => setView({ name: "list" })}
            notify={notify}
          />
        )}
      </main>
      <div className={toast ? "toast show" : "toast"} role="status">
        {toast}
      </div>
    </div>
  );
}

