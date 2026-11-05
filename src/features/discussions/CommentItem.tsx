import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, ExternalLink } from "lucide-react";
import type { Annotation, Comment } from "../../../shared/types";
import { anchorQuote } from "../../../shared/anchors";
import { api } from "../../lib/api";
import { dateLabel } from "../../lib/data";
import { MarkdownTools } from "../../components/MarkdownTools";
import { Avatar } from "../../components/UI";
import { CommentMarkdown } from "./CommentMarkdown";
import { safeDiscussionURL, visibleComment } from "./model";

/** Explicit postId avoids router/global-data coupling in nested replies. */
export function CommentItem({
  postId,
  comment,
  onQuote,
  onReply,
  onChanged,
  currentUser,
  moderator,
  csrf,
  floor,
}: {
  postId: string;
  comment: Comment;
  onQuote: (a: Annotation) => void;
  onReply: (c: Comment) => void;
  onChanged: (id: string, next: Comment | null) => void;
  currentUser?: string;
  moderator?: boolean;
  csrf?: string;
  floor?: string;
}) {
  const [replies, setReplies] = useState(comment.replies?.nodes || []),
    [page, setPage] = useState(comment.replies?.pageInfo),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [editing, setEditing] = useState(false),
    [editBody, setEditBody] = useState(comment.body),
    [busy, setBusy] = useState(false),
    [deleted, setDeleted] = useState(false);
  const editArea = useRef<HTMLTextAreaElement>(null);
  const own = !!currentUser && currentUser.toLowerCase() === comment.author?.login.toLowerCase();
  useEffect(() => {
    if (!editing) setEditBody(comment.body);
  }, [comment.body, editing]);
  async function manage(method: "PUT" | "DELETE") {
    if (busy) return;
    if (method === "DELETE" && !window.confirm("确定删除这条评论吗？此操作不可撤销。")) return;
    if (method === "PUT" && (!editBody.trim() || editBody.trim().length > 6000)) {
      setError("评论需要 1 到 6000 字。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ comment: Comment; ok?: boolean }>(
        `/api/posts/${postId}/comments/${encodeURIComponent(comment.id)}`,
        {
          method,
          headers: { "X-CSRF-Token": csrf || "" },
          ...(method === "PUT" ? { body: JSON.stringify({ body: editBody.trim() }) } : {}),
        },
      );
      if (method === "DELETE") {
        setDeleted(true);
        onChanged(comment.id, null);
      } else {
        setEditing(false);
        onChanged(comment.id, result.comment);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setReplies(comment.replies?.nodes || []);
    setPage(comment.replies?.pageInfo);
  }, [comment]);
  async function more() {
    setLoading(true);
    setError("");
    try {
      const data = await api<{
        nodes: Comment[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      }>(
        `/api/posts/${postId}/comments/${encodeURIComponent(comment.id)}/replies${page?.endCursor ? "?after=" + encodeURIComponent(page.endCursor) : ""}`,
      );
      setReplies((prev) => [
        ...prev,
        ...data.nodes.filter((c) => !prev.some((p) => p.id === c.id)),
      ]);
      setPage(data.pageInfo);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  if (deleted || !visibleComment(comment)) return null;
  return (
    <article className="comment-item" id={`comment-${comment.id}`}>
      <header>
        <Avatar comment={comment} />
        <strong>{comment.author?.login || "已注销的读者"}</strong>
        {floor && <span className="comment-floor">{floor}</span>}
        {comment.stale && <span className="sample-label">缓存</span>}
        <time dateTime={comment.createdAt}>
          {dateLabel(comment.createdAt.slice(0, 10))}
        </time>
      </header>
      {comment.annotation && (
        <button
          className="comment-quote"
          onClick={() => onQuote(comment.annotation!)}
        >
          <span>{anchorQuote(comment.annotation.anchor)}</span>
          <ArrowUpRight size={15} />
        </button>
      )}
      {comment.replyTarget && (
        <p className="comment-reply-target">
          回复 @{comment.replyTarget.login}
        </p>
      )}
      {editing ? (
        <div className="comment-inline-editor">
          <textarea
            ref={editArea}
            aria-label="编辑评论"
            rows={4}
            maxLength={6000}
            value={editBody}
            disabled={busy}
            onChange={(e) => setEditBody(e.target.value)}
          />
          <MarkdownTools area={editArea} value={editBody} onChange={setEditBody} disabled={busy} maxLength={6000} />
          <div className="comment-actions">
            <button className="text-button" onClick={() => manage("PUT")} disabled={busy || !editBody.trim()}>
              {busy ? "保存中…" : "保存修改"}
            </button>
            <button className="text-button" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>
              取消
            </button>
          </div>
        </div>
      ) : (
        <CommentMarkdown body={comment.body} />
      )}
      {error && <p role="alert" className="small-error">{error}</p>}
      {!editing && (
        <div className="comment-actions">
          <button className="text-button" onClick={() => onReply(comment)}>回复</button>
          {own && <button className="text-button" onClick={() => setEditing(true)} disabled={busy}>编辑</button>}
          {(own || moderator) && (
            <button className="text-button comment-delete" onClick={() => manage("DELETE")} disabled={busy}>
              {busy ? "处理中…" : "删除"}
            </button>
          )}
          <a href={safeDiscussionURL(comment.url)} target="_blank" rel="noreferrer">
            在 GitHub 查看
            <ExternalLink size={12} />
          </a>
        </div>
      )}
      {(replies.length > 0 || page?.hasNextPage) && (
        <div className="comment-replies">
          {replies.filter(visibleComment).map((reply, index) => (
            <CommentItem
              postId={postId}
              key={reply.id}
              comment={{ ...reply, parentId: comment.id }}
              floor={floor ? `${floor}-${index + 1}` : undefined}
              currentUser={currentUser}
              moderator={moderator}
              csrf={csrf}
              onChanged={onChanged}
              onQuote={onQuote}
              onReply={onReply}
            />
          ))}
          {page?.hasNextPage && (
            <button className="text-button" onClick={more} disabled={loading}>
              {loading
                ? "正在读取…"
                : `继续阅读回复${comment.replies?.totalCount ? " · " + comment.replies.totalCount : ""}`}
              <ChevronDown size={13} />
            </button>
          )}
          {error && (
            <p className="small-error" role="alert">
              {error}
              <button onClick={more}>重试</button>
            </p>
          )}
        </div>
      )}
    </article>
  );
}
