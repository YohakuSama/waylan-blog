import { useCallback, useEffect, useRef, useState } from "react";
import { typeLabels } from "../../shared/types";
import { str } from "./form";
import { adminApi as api } from "./api";
import { ago } from "./helpers";
import { Confirm } from "./ui";
import { PostEditor } from "./PostEditor";
import { SiteEditor } from "./SiteEditor";
import type { Overview, Session, Status, Summary } from "./types";

/** Dashboard coordinates navigation and refresh; editors own their own unsaved state. */
function DeployStatus({ status }: { status: Status }) {
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

function Posts({
  overview,
  onEdit,
  onDeleted,
  notify,
}: {
  overview: Overview;
  onEdit: (file: string | null) => void;
  onDeleted: () => void;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const q = query.trim().toLowerCase();
  const shown = overview.posts.filter(
    (p) =>
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.file.toLowerCase().includes(q) ||
      (p.topic || "").toLowerCase().includes(q),
  );
  const topicName = (id?: string) => overview.topics.find((t) => t.id === id)?.name || id;
  const remove = async () => {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/post", "DELETE", { file: target.file, oid: target.oid });
      notify(`已删除「${target.title}」，网站会在一两分钟后更新。`);
      setTarget(null);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>内容（{overview.posts.length}）</h2>
        <input
          type="search"
          placeholder="搜索标题、文件名或分区"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={() => onEdit(null)}>写新内容</button>
      </div>
      {!shown.length && <p className="muted pad">没有找到。</p>}
      <ul className="posts">
        {shown.map((p) => (
          <li key={p.file}>
            <div className="post-main">
              <button className="link" onClick={() => onEdit(p.file)}>
                {p.title}
              </button>
              <div className="post-meta">
                {p.type && <span className="badge">{typeLabels[p.type]}</span>}
                {p.draft && <span className="badge draft">草稿</span>}
                {p.error && <span className="badge bad">有问题：{p.error}</span>}
                <span>{p.date}</span>
                {p.topic && <span>{topicName(p.topic)}</span>}
                <span className="mono">{p.file}</span>
              </div>
            </div>
            <div className="post-actions">
              {p.slug && !p.draft && !p.error && (
                <a className="ghost button" href={`/post/${p.slug}`} target="_blank" rel="noreferrer">
                  查看
                </a>
              )}
              <button className="ghost" onClick={() => onEdit(p.file)}>
                编辑
              </button>
              <button
                className="ghost danger-text"
                onClick={() => {
                  setError("");
                  setTarget(p);
                }}
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Confirm
        open={!!target}
        title="删除这篇内容？"
        action="删除"
        busy={busy}
        onConfirm={remove}
        onClose={() => !busy && setTarget(null)}
      >
        <p>
          「{target?.title}」将从网站移除。它的评论仍保留在 GitHub Discussions 中；如需恢复，可在仓库的提交历史里找回。
        </p>
        {error && <p className="error">{error}</p>}
      </Confirm>
    </section>
  );
}

function Discussions({
  overview,
  onDone,
  notify,
}: {
  overview: Overview;
  onDone: () => void;
  notify: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { enabled, pending } = overview.discussions;
  if (!enabled || !pending.length) return null;
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      let created = 0;
      for (let round = 0; round < 50; round++) {
        const result = await api<{ created: number; remaining: number }>(
          "/api/admin/discussions",
          "POST",
          {},
        );
        created += result.created;
        if (!result.remaining) break;
      }
      notify(created ? `已为 ${created} 篇内容开启评论区。` : "评论区已全部就绪。");
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="banner">
      <span>
        {pending.length} 篇已上线的内容还没有评论区：
        {pending
          .slice(0, 3)
          .map((p) => `「${p.title}」`)
          .join("")}
        {pending.length > 3 ? " 等" : ""}
      </span>
      <button onClick={run} disabled={busy}>
        {busy ? "正在开启…" : "开启评论区"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
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
  const pendingDeploy = !!status?.live && status.live !== status.head.oid;
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
            <DeployStatus status={status} />
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

