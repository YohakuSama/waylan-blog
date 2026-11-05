import { useState } from "react";
import { adminApi as api } from "./api";
import type { Overview } from "./types";

/**
 * Initialize missing Discussions in bounded batches.
 * The caller is only notified of success when the server reports none remain.
 * Do not keep hitting GitHub if an operation makes no progress.
 */
export async function createDiscussionBatches(
  request: () => Promise<{ created: number; remaining: number }>,
): Promise<number> {
  let created = 0;
  for (let round = 0; round < 50; round++) {
    const result = await request();
    if (!result || !Number.isSafeInteger(result.created) || result.created < 0 ||
        !Number.isSafeInteger(result.remaining) || result.remaining < 0)
      throw new Error("评论区初始化返回了异常数据，请稍后重试。");
    created += result.created;
    if (result.remaining === 0) return created;
    if (result.created === 0)
      throw new Error("评论区初始化没有取得进展，请检查 GitHub 权限后重试。");
  }
  throw new Error("评论区仍有未完成项，请刷新后台状态后重试。");
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
      const created = await createDiscussionBatches(() =>
        api<{ created: number; remaining: number }>("/api/admin/discussions", "POST", {}),
      );
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
