import { useState } from "react";
import { typeLabels } from "../../shared/types";
import { adminApi as api } from "./api";
import { Confirm } from "./ui";
import type { Overview, Summary } from "./types";

/** Content listing and Discussion bootstrap are one focused dashboard section. */
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

export function Discussions({
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
