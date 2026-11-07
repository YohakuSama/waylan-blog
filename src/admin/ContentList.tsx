import { useState } from "react";
import { typeLabels } from "../../shared/types";
import { adminApi as api } from "./api";
import { Confirm } from "./ui";
import { editsLive, saveMessage } from "./helpers";
import type { Overview, Review, Summary } from "./types";

/** Content search, editing entrypoints, and deletion; Discussions are isolated. */
export function Posts({
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
  const [review, setReview] = useState<Review | null>(null);
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
      const result = await api<{ commit: string; review?: Review }>(
        "/api/admin/post", "DELETE", { file: target.file, oid: target.oid },
      );
      if (result.review) {
        setReview(result.review);
        notify(`已提交删除审核 PR #${result.review.number}；正式文章仍保留。`);
      } else {
        notify(saveMessage(overview.repo.branch, "delete", target.title));
        onDeleted();
      }
      setTarget(null);
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
      {review && (
        <p className="status" role="status">
          删除修改尚未发布；请先
          <a href={review.url} target="_blank" rel="noreferrer">审核草稿 PR #{review.number}</a>。
          文章会在 PR 合并后从正式站点移除。
        </p>
      )}
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
              {p.slug && !p.draft && !p.error && editsLive(overview.repo.branch) && (
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
        action={overview.publicationMode === "review-pr" ? "提交删除审核" : "删除"}
        busy={busy}
        onConfirm={remove}
        onClose={() => !busy && setTarget(null)}
      >
        <p>
          「{target?.title}」将从{editsLive(overview.repo.branch) ? "网站" : "当前内容分支"}移除。
          {overview.publicationMode === "review-pr" || !editsLive(overview.repo.branch) ?
            "正式网站在 PR 合并前不会变化。" : ""}
          它的评论仍保留在 GitHub Discussions 中；如需恢复，可在仓库的提交历史里找回。
        </p>
        {error && <p className="error">{error}</p>}
      </Confirm>
    </section>
  );
}
