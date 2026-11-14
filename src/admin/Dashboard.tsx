import { useCallback, useEffect, useRef, useState } from "react";
import { str } from "./form";
import { adminApi as api } from "./api";
import { ago, editsLive } from "./helpers";
import { PostEditor } from "./PostEditor";
import { SiteEditor } from "./SiteEditor";
import type { Overview, ReviewState, Session, Status } from "./types";
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

type View = { name: "list" } | { name: "post"; file: string | null; key: number; reviewNumber?: number } |
  { name: "site"; reviewNumber?: number };

export function Dashboard({ session }: { session: Session }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>({ name: "list" });
  const [toast, setToast] = useState("");
  const [reviews, setReviews] = useState<ReviewState[]>([]);
  const [reviewError, setReviewError] = useState("");
  const [reviewTruncated, setReviewTruncated] = useState(false);
  const [loadingReviews, setLoadingReviews] = useState(false);
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

  const refreshReviews = useCallback(async () => {
    setLoadingReviews(true);
    try {
      const result = await api<{ reviews: ReviewState[]; truncated: boolean }>("/api/admin/reviews");
      setReviews(result.reviews);
      setReviewTruncated(result.truncated);
      setReviewError("");
    } catch (e) {
      setReviewError((e as Error).message);
    } finally {
      setLoadingReviews(false);
    }
  }, []);
  // Only review mode uses the extra GitHub PR-list request. Refreshing the queue
  // reflects merged/closed PRs without assuming that merge means deployed.
  useEffect(() => {
    if (overview?.publicationMode !== "review-pr") {
      setReviews([]);
      return;
    }
    if (view.name !== "list") return;
    void refreshReviews();
    const timer = setInterval(() => { void refreshReviews(); }, 60_000);
    return () => clearInterval(timer);
  }, [overview?.publicationMode, view.name, refreshReviews]);

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
        {overview?.publicationMode === "review-pr" && (
          <div className="panel" role="note">
            内容审查模式已启用。文章和站点修改将先生成 GitHub 草稿 PR，
            <strong>不会直接发布到正式网站</strong>；需要通过检查后人工合并到 main。
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
            <p className="error" role="alert">{error}</p>
            <button onClick={refresh}>重试</button>
          </div>
        )}
        {!overview && !error && <p className="muted pad">正在读取仓库…</p>}
        {overview && view.name === "list" && (
          <>
            {overview.publicationMode === "review-pr" && (
              <section className="panel" aria-label="内容审核队列">
                <div className="panel-head">
                  <h2>内容审核队列</h2>
                  <button className="ghost" onClick={() => void refreshReviews()} disabled={loadingReviews}>
                    {loadingReviews ? "读取中…" : "刷新审核状态"}
                  </button>
                </div>
                <p className="muted">
                  显示本后台创建的最近审核 PR。合并到 main 不代表已经完成 Cloudflare 部署。
                </p>
                {reviewError && <p className="error" role="alert">{reviewError}</p>}
                {reviewTruncated && <p className="muted">最近 100 条 PR 已达到查询上限；请到 GitHub 查看更早的审核记录。</p>}
                {!reviews.length && !reviewError && <p className="muted">暂无可显示的内容审核 PR。</p>}
                {!!reviews.length && (
                  <ul className="posts">
                    {reviews.map((review) => (
                      <li key={review.number}>
                        <span>
                          <strong>{review.title}</strong>
                          <span className="muted"> · #{review.number} · {review.state === "open" ? "待审核" :
                            review.state === "merged" ? "已合并 main（待确认部署）" : "已关闭，未合并"}</span>
                        </span>
                        <span className="post-actions">
                          {review.state === "open" && review.draft && review.target?.kind === "post" && review.target.file && (
                            <button className="ghost" onClick={() => setView({ name: "post", file: review.target!.file!, reviewNumber: review.number, key: Date.now() })}>
                              继续编辑
                            </button>
                          )}
                          {review.state === "open" && review.draft && review.target?.kind === "site" && (
                            <button className="ghost" onClick={() => setView({ name: "site", reviewNumber: review.number })}>
                              继续编辑站点资料
                            </button>
                          )}
                          <a href={review.url} className="ghost button" target="_blank" rel="noreferrer">打开 PR</a>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
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
            reviewNumber={view.reviewNumber}
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
            key={view.reviewNumber || 0}
            reviewNumber={view.reviewNumber}
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

