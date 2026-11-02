import { motionAllowed, animateDialogResize } from "../lib/motion";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import { MarkdownTools } from "./MarkdownTools";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Github,
  Highlighter,
  List,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MessageSquare,
  Plus,
  Send,
  Share2,
  Trash2,
  Type,
  X,
  RotateCw,
} from "lucide-react";
import type {
  Anchor,
  Annotation,
  Comment,
  CommentPage,
  ContentBlock,
  Post,
  Session,
} from "../../shared/types";
import { anchorQuote } from "../../shared/anchors";
import { api, ApiError, useApi, invalidateComments } from "../lib/api";
import { posts, site, topicName, dateLabel, typeLabels, wordCount, wordsLabel } from "../lib/data";
import { Link, useRouter } from "../lib/router";
import { Avatar as AuthorAvatar } from "./Avatar";
import { BookmarkButton } from "./Shelf";
import { useRecordView, useViews, viewsLabel } from "../lib/views";
import { offlinePreview, newId, articleHTML, routeHref } from "../lib/runtime";
import { storage, transient } from "../lib/storage";
import {
  applyHighlights,
  captureSelection,
  captureBlockExcerpt,
  jumpToAnchor,
} from "../lib/selection";
import {
  ArtImage,
  Avatar,
  CopyButton,
  Dialog,
  EchoMark,
  Related,
  Toast,
  TopicBadge,
} from "./UI";
type Draft = {
  body: string;
  anchor: Anchor | null;
  replyTo: Comment | null;
  requestId: string;
  resume?: boolean;
  uncertain?: boolean;
};
const FONT_SIZES = [16, 18, 20];
const DEFAULT_FONT = 18;
const emptyPage: CommentPage = {
  nodes: [],
  totalCount: 0,
  pageInfo: { hasNextPage: false, endCursor: null },
  discussionUrl: null,
  mapped: false,
};
// GitHub can retain an empty parent after deletion to preserve replies.
// Hide that whole conversation on Waylan; do not erase other authors\x27 GitHub content.
const visibleComment = (comment: Comment) => comment.body.trim().length > 0;
const safeURL = (value: string) =>
  /^https:\/\/(github\.com|avatars\.githubusercontent\.com)\//.test(value)
    ? value
    : "#";
// Shell snippets are copied as runnable commands: prompts dropped, output lines skipped.
const copyText = (block: ContentBlock) => {
  const text = block.text.replace(/\n$/, "");
  if (block.lang !== "bash" || !/^\$ /m.test(text)) return text;
  return text
    .split("\n")
    .filter((line) => line.startsWith("$ "))
    .map((line) => line.slice(2))
    .join("\n");
};
function CommentItem({
  comment,
  onQuote,
  onReply,
  onChanged,
  currentUser,
  moderator,
  csrf,
  floor,
}: {
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
        `/api/posts/${parentPost}/comments/${encodeURIComponent(comment.id)}`,
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
  const [parentPost, setParentPost] = useState("");
  const router = useRouter();
  useEffect(() => {
    setParentPost(
      posts.find((p) => router.path.startsWith(`/post/${p.slug}`))?.id || "",
    );
  }, [router.path]);
  async function more() {
    setLoading(true);
    setError("");
    try {
      const data = await api<{
        nodes: Comment[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      }>(
        `/api/posts/${parentPost}/comments/${encodeURIComponent(comment.id)}/replies${page?.endCursor ? "?after=" + encodeURIComponent(page.endCursor) : ""}`,
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
        <div className="comment-markdown">
          <ReactMarkdown
            skipHtml
            components={{
              a: ({ children, href }) => (
                <a href={href} rel="nofollow noopener noreferrer" target="_blank">
                  {children}
                </a>
              ),
              img: ({ alt }) => <span>[图片：{alt || "附件"}]</span>,
            }}
          >
            {comment.body}
          </ReactMarkdown>
        </div>
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
          <a href={safeURL(comment.url)} target="_blank" rel="noreferrer">
            在 GitHub 查看
            <ExternalLink size={12} />
          </a>
        </div>
      )}
      {(replies.length > 0 || page?.hasNextPage) && (
        <div className="comment-replies">
          {replies.filter(visibleComment).map((reply, index) => (
            <CommentItem
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
/** Keep the last selected image mounted while the native dialog animates out.
 * Unmounting it immediately shrinks the modal to a thin bar for one frame. */
type Zoomed = { src: string; alt: string; from?: Element };
function ImageViewer({ image, onClose }: {
  image: Zoomed | null;
  onClose: () => void;
}) {
  const lastImage = useRef<Zoomed | null>(null);
  if (image) lastImage.current = image;
  const visible = image ?? lastImage.current;
  return (
    <Dialog open={!!image} onClose={onClose}
      label={visible?.alt || "放大图片"} className="image-dialog"
      origin={visible?.from}>
      {visible && <ArtImage src={visible.src} alt={visible.alt} />}
    </Dialog>
  );
}

export default function Reader({ post }: { post: Post }) {
  useRecordView(post.id);
  const views = useViews(),
    viewCount = views.enabled ? views.views[post.id] : undefined;
  const router = useRouter(),
    prose = useRef<HTMLDivElement>(null),
    article = useRef<HTMLElement>(null),
    composerArea = useRef<HTMLTextAreaElement>(null),
    composerGeometry = useRef<{ from: DOMRect; radius: string } | null>(null),
    composerResizeAnimation = useRef<Animation | null>(null);
  const [progress, setProgress] = useState(0),
    [activeSection, setActiveSection] = useState(post.toc[0]?.id || ""),
    [fontSize, setFontSize] = useState(DEFAULT_FONT),
    [tocOpen, setTocOpen] = useState(false);
  const [selection, setSelection] = useState<{
      anchor: Anchor;
      rect: DOMRect;
    } | null>(null),
    [excerptMode, setExcerptMode] = useState(false),
    [localMarks, setLocalMarks] = useState<Annotation[]>([]),
    [orphans, setOrphans] = useState<string[]>([]);
  const [panel, setPanel] = useState(false),
    [panelIds, setPanelIds] = useState<string[]>([]),
    [image, setImage] = useState<Zoomed | null>(null),
    [toast, setToast] = useState("");
  const [draft, setDraft] = useState<Draft>({
      body: "",
      anchor: null,
      replyTo: null,
      requestId: "",
    }),
    [sending, setSending] = useState(false),
    [sendError, setSendError] = useState(""),
    [previewDraft, setPreviewDraft] = useState(false),
    [composerFullscreen, setComposerFullscreen] = useState(false),
    [focused, setFocused] = useState<Comment | null>(null);
  const [panelFetched, setPanelFetched] = useState<Comment[]>([]),
    [panelLoading, setPanelLoading] = useState(false),
    [panelError, setPanelError] = useState(""),
    [panelBatch, setPanelBatch] = useState(1),
    [panelRevision, setPanelRevision] = useState(0);
  const [comments, setComments] = useState<CommentPage | null>(null),
    [moreLoading, setMoreLoading] = useState(false),
    [moreError, setMoreError] = useState("");
  const [annotations, setAnnotations] = useState<Annotation[]>([]),
    [annotationError, setAnnotationError] = useState("");
  const session = useApi<Session>("/api/session"),
    commentState = useApi<CommentPage>(`/api/posts/${post.id}/comments`),
    anchorState = useApi<{ nodes: Annotation[]; nextCursor: string | null }>(
      `/api/posts/${post.id}/annotations`,
    );
  useEffect(() => {
    const sync = () => setLocalMarks(storage.get<Annotation[]>(`marks:${post.id}`, []));
    window.addEventListener("waylan:highlights-changed", sync);
    return () => window.removeEventListener("waylan:highlights-changed", sync);
  }, [post.id]);
  // Snapshot before React changes the class; run geometry animation in
  // layout effect after the new bounds exist, before the first painted frame.
  function toggleComposerFullscreen(event: ReactMouseEvent<HTMLButtonElement>) {
    const dialog = event.currentTarget.closest("dialog");
    if (!dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const radius = getComputedStyle(dialog).borderRadius;
    composerResizeAnimation.current?.cancel();
    composerGeometry.current = { from: bounds, radius };
    setComposerFullscreen((value) => !value);
  }
  useLayoutEffect(() => {
    const previous = composerGeometry.current;
    if (!previous) return;
    composerGeometry.current = null;
    const dialog = document.querySelector<HTMLDialogElement>(
      "dialog.discussion-dialog.composer-dialog[open]",
    );
    if (!dialog) return;
    composerResizeAnimation.current = animateDialogResize(
      dialog,
      previous.from,
      dialog.getBoundingClientRect(),
      previous.radius,
      getComputedStyle(dialog).borderRadius,
    );
  }, [composerFullscreen]);
  useEffect(() => () => {
    composerResizeAnimation.current?.cancel();
    composerGeometry.current = null;
  }, []);
  // iOS Safari's keyboard can shrink the visual viewport without changing 100dvh.
  // Keep the full-screen composer and submit button inside the visible area.
  useEffect(() => {
    if (!panel || panelIds.length) return;
    const viewport = window.visualViewport;
    if (!viewport) return;
    const sync = () => {
      document.documentElement.style.setProperty("--waylan-editor-view-height", `${viewport.height}px`);
      document.documentElement.style.setProperty("--waylan-editor-view-top", `${viewport.offsetTop}px`);
    };
    sync();
    viewport.addEventListener("resize", sync);
    viewport.addEventListener("scroll", sync);
    return () => {
      viewport.removeEventListener("resize", sync);
      viewport.removeEventListener("scroll", sync);
      document.documentElement.style.removeProperty("--waylan-editor-view-height");
      document.documentElement.style.removeProperty("--waylan-editor-view-top");
    };
  }, [panel, panelIds.length]);
  useEffect(() => {
    if (!panel || panelIds.length || !window.matchMedia("(pointer: fine)").matches)
      return;
    const id = window.requestAnimationFrame(() => composerArea.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(id);
  }, [panel, panelIds.length]);
  const state = comments || commentState.data || emptyPage;
  const visibleTopComments = state.nodes.filter(visibleComment);
  const visibleCount = Math.max(0, state.totalCount - (state.nodes.length - visibleTopComments.length));
  const allAnnotations = [...annotations, ...localMarks];
  const inVisibleThread = (comment: Comment) =>
    visibleComment(comment) && (!comment.parentId ||
      !state.nodes.some((parent) => parent.id === comment.parentId && !visibleComment(parent)));
  const allComments = [
    ...new Map(
      [
        ...visibleTopComments.flatMap((c) => [
          c,
          ...(c.replies?.nodes || []).filter(visibleComment).map((reply) => ({
            ...reply,
            parentId: c.id,
          })),
        ]),
        ...(focused && inVisibleThread(focused) ? [focused] : []),
        ...panelFetched.filter(inVisibleThread),
      ].map((c) => [c.id, c]),
    ).values(),
  ];
  function notify(text: string) {
    setToast(text);
  }
  function commentChanged(id: string, next: Comment | null) {
    const change = (nodes: Comment[]): Comment[] =>
      nodes.flatMap((c) => {
        if (c.id === id) return next ? [{ ...c, ...next }] : [];
        if (!c.replies) return [c];
        const replies = c.replies.nodes.flatMap((r) =>
          r.id === id ? (next ? [{ ...r, ...next }] : []) : [r],
        );
        return [{ ...c, replies: {
          ...c.replies,
          nodes: replies,
          totalCount: Math.max(0, c.replies.totalCount + (next ? 0 : replies.length - c.replies.nodes.length)),
        } }];
      });
    setComments((prev) => prev ? {
      ...prev,
      nodes: change(prev.nodes),
      totalCount: Math.max(0, prev.totalCount + (!next && prev.nodes.some((c) => c.id === id) ? -1 : 0)),
    } : prev);
    setFocused((prev) => prev?.id === id ? next : prev);
    setPanelFetched((prev) => change(prev));
    invalidateComments();
    commentState.reload();
    anchorState.reload();
    notify(next ? "评论已更新。" : "评论已删除。");
  }
  async function copySection(id: string) {
    const url = new URL(routeHref(`/post/${post.slug}#${id}`), location.href);
    try {
      await navigator.clipboard.writeText(url.href);
      notify("已复制本节链接");
    } catch {
      notify("复制未完成，可从目录进入本节后复制地址");
    }
  }
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    setLocalMarks(storage.get<Annotation[]>(`marks:${post.id}`, []));
    const size = storage.get<number>("font-size", DEFAULT_FONT);
    setFontSize(FONT_SIZES.includes(size) ? size : DEFAULT_FONT);
    const saved = transient.get<Draft | null>(`draft:${post.id}`, null);
    if (saved) {
      const restored = { ...saved, resume: false };
      setDraft(restored);
      if (saved.resume) {
        setPanel(true);
        transient.set(`draft:${post.id}`, restored);
        requestAnimationFrame(() => {
          if (
            saved.anchor &&
            prose.current &&
            !jumpToAnchor(prose.current, post, saved.anchor)
          )
            notify("原文已发生变化。草稿与原始引用仍然保留。");
        });
      }
    } else setDraft((prev) => ({ ...prev, requestId: newId() }));
    if (new URLSearchParams(location.search).has("auth_error"))
      notify("GitHub 登录没有完成。刚才的文字仍然在这里。");
  }, [post.id]);
  useEffect(() => {
    if (draft.requestId) transient.set(`draft:${post.id}`, draft);
  }, [draft, post.id]);
  useEffect(() => {
    if (commentState.data) setComments(commentState.data);
  }, [commentState.data]);
  useEffect(() => {
    let cancelled = false;
    if (!anchorState.data) {
      setAnnotations([]);
      return;
    }
    setAnnotations(anchorState.data.nodes);
    setAnnotationError("");
    async function loadRest() {
      let next = anchorState.data!.nextCursor;
      while (next && !cancelled) {
        try {
          const data = await api<{
            nodes: Annotation[];
            nextCursor: string | null;
          }>(
            `/api/posts/${post.id}/annotations?after=${encodeURIComponent(next)}`,
          );
          if (cancelled) return;
          setAnnotations((prev) => [
            ...prev,
            ...data.nodes.filter((a) => !prev.some((p) => p.id === a.id)),
          ]);
          next = data.nextCursor;
        } catch (e) {
          if (!cancelled) setAnnotationError((e as Error).message);
          break;
        }
      }
    }
    void loadRest();
    return () => {
      cancelled = true;
    };
  }, [anchorState.data, post.id]);
  useEffect(() => {
    if (prose.current)
      setOrphans(applyHighlights(prose.current, post, allAnnotations));
  }, [post, annotations, localMarks]);
  useEffect(() => {
    let frame = 0;
    let lastProgress = -1;
    const update = () => {
      frame = 0;
      if (!article.current) return;
      const el = article.current,
        top = el.getBoundingClientRect().top + window.scrollY,
        bottom = top + el.offsetHeight;
      const value = Math.min(
        100,
        Math.max(
          0,
          Math.round(
            ((window.scrollY + window.innerHeight * 0.45 - top) /
              (bottom - top)) *
              100,
          ),
        ),
      );
      if (value !== lastProgress) {
        lastProgress = value;
        setProgress(value);
      }
      let current = post.toc[0]?.id || "";
      for (const heading of post.toc) {
        if (
          (document.getElementById(heading.id)?.getBoundingClientRect().top ??
            Infinity) < 170
        )
          current = heading.id;
      }
      setActiveSection(current);
      const visible = [
        ...(prose.current?.querySelectorAll<HTMLElement>("[data-block-id]") ||
          []),
      ].find((b) => b.getBoundingClientRect().bottom > 120);
      if (window.scrollY > 100)
        storage.set("reading", {
          slug: post.slug,
          title: post.title,
          progress: value,
          blockId: visible?.dataset.blockId,
        });
    };
    const scroll = () => {
      setSelection(null);
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Read the saved position before the first update() can overwrite it.
    const saved =
      new URLSearchParams(location.search).get("resume") === "1"
        ? storage.get<{ slug: string; blockId?: string } | null>(
            "reading",
            null,
          )
        : null;
    window.addEventListener("scroll", scroll, { passive: true });
    update();
    const resumeId = saved?.slug === post.slug ? saved.blockId : undefined;
    if (resumeId)
      requestAnimationFrame(() =>
        document.getElementById(resumeId)?.scrollIntoView({ block: "start" }),
      );
    return () => {
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
    };
  }, [post]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let pointerDown = false;
    const scan = () => {
      if (panel || !prose.current) return;
      const found = captureSelection(prose.current, post);
      // Native selection may collapse when its system menu is tapped.
      // Keep an explicit touch excerpt until the reader dismisses it.
      if (found) setSelection(found);
      else if (!excerptMode) setSelection(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element)?.closest?.(".selection-toolbar")) return;
      pointerDown = true;
    };
    const onPointerUp = (event: PointerEvent) => {
      pointerDown = false;
      if ((event.target as Element)?.closest?.(".selection-toolbar")) return;
      clearTimeout(timer);
      // Selection handles and the native menu are asynchronous on iOS.
      timer = setTimeout(scan, event.pointerType === "touch" ? 420 : 140);
    };
    const onPointerCancel = () => { pointerDown = false; };
    const onSelectionChange = () => {
      if (pointerDown) return;
      clearTimeout(timer);
      timer = setTimeout(scan, 180);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [post, panel, excerptMode]);
  const handledHash = useRef("");
  useEffect(() => {
    const hash = router.path.split("#")[1];
    if (!hash?.startsWith("echo-") || handledHash.current === hash) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(5));
    } catch {
      return;
    }
    if (!/^[\w=+/-]{1,200}$/.test(id)) return;
    handledHash.current = hash;
    setPanelIds([id]);
    setPanel(true);
    setPanelBatch(1);
  }, [router.path, post]);
  useEffect(() => {
    if (!panel || !panelIds.length) return;
    const ids = panelIds
      .filter((id) => !id.startsWith("local-"))
      .slice(0, panelBatch * 20);
    if (!ids.length) return;
    const controller = new AbortController();
    setPanelLoading(true);
    setPanelError("");
    async function readPanel() {
      let failure = "";
      for (let i = 0; i < ids.length; i += 4) {
        const results = await Promise.allSettled(
          ids.slice(i, i + 4).map((id) =>
            api<{ comment: Comment }>(
              `/api/posts/${post.id}/comments/${encodeURIComponent(id)}`,
              {
                signal: AbortSignal.any([
                  controller.signal,
                  AbortSignal.timeout(14000),
                ]),
              },
            ),
          ),
        );
        if (controller.signal.aborted) return;
        const found: Comment[] = [];
        for (const result of results) {
          if (result.status === "fulfilled") found.push(result.value.comment);
          else failure = (result.reason as Error).message;
        }
        setPanelFetched((previous) => [
          ...new Map(
            [...previous, ...found].map((comment) => [comment.id, comment]),
          ).values(),
        ]);
        const deep = found.find((comment) =>
          router.path.endsWith("#echo-" + encodeURIComponent(comment.id)),
        );
        if (deep?.annotation && prose.current)
          jumpToAnchor(prose.current, post, deep.annotation.anchor);
      }
      if (!controller.signal.aborted) {
        setPanelError(failure);
        setPanelLoading(false);
      }
    }
    void readPanel();
    return () => controller.abort();
  }, [panel, panelIds, panelBatch, panelRevision, post.id]);
  function newComment(
    anchor: Anchor | null = null,
    replyTo: Comment | null = null,
  ) {
    if (draft.uncertain) {
      setPanelIds([]);
      setPanel(true);
      notify("上一条评论仍在提交中，草稿已保留。");
      return;
    }
    setDraft((prev) => ({
      ...prev,
      anchor,
      replyTo,
      requestId: prev.uncertain ? prev.requestId : newId(),
    }));
    setPanelIds([]);
    setSendError("");
    setPreviewDraft(false);
    setComposerFullscreen(false);
    setSelection(null);
    setPanel(true);
  }
  function openHighlights(ids: string[]) {
    setComposerFullscreen(false);
    setPanelIds(ids);
    setSelection(null);
    setPanel(true);
    setPanelBatch(1);
  }
  function quoteJump(annotation: Annotation) {
    setPanel(false);
    setTimeout(() => {
      if (
        prose.current &&
        !jumpToAnchor(prose.current, post, annotation.anchor)
      )
        notify("这段原文已发生变化，暂时无法定位。");
    }, 180);
  }
  async function share(anchor?: Anchor, commentId?: string) {
    if (offlinePreview()) {
      try {
        await navigator.clipboard.writeText(
          anchor ? `“${anchorQuote(anchor)}”\n—— ${post.title}` : post.title,
        );
        notify("文字已复制。分享链接需要网站上线后才能生成。");
      } catch {
        notify("当前环境暂不支持生成分享链接，请在正式域名下使用。");
      }
      return;
    }
    const url = `${site.origin.includes("YOUR_DOMAIN") ? location.origin : site.origin}/post/${post.slug}${commentId ? "#echo-" + encodeURIComponent(commentId) : ""}`;
    const text = anchor
      ? `“${anchorQuote(anchor)}”\n—— ${post.title}`
      : post.title;
    try {
      if (navigator.share)
        await navigator.share({ title: post.title, text, url });
      else {
        await navigator.clipboard.writeText(
          `${anchor ? text + "\n" : ""}${url}`,
        );
        notify("链接已复制。");
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError")
        notify("分享未完成，可以复制地址栏链接。");
    }
  }
  function privateMark() {
    if (!selection) return;
    const item: Annotation = {
      id: "local-" + newId(),
      commentId: "",
      anchor: selection.anchor,
    };
    const next = [...localMarks, item];
    const saved = storage.set(`marks:${post.id}`, next);
    setLocalMarks(next);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    notify(
      saved
        ? "划线已保存在这台设备，仅自己可见。"
        : "划线已保留到本次阅读；浏览器当前不允许保存本地文件的数据。",
    );
  }
  async function loadMore() {
    setMoreLoading(true);
    setMoreError("");
    try {
      const data = await api<CommentPage>(
        `/api/posts/${post.id}/comments?after=${encodeURIComponent(state.pageInfo.endCursor || "")}`,
      );
      setComments((prev) => ({
        ...data,
        nodes: [
          ...(prev?.nodes || []),
          ...data.nodes.filter((c) => !prev?.nodes.some((x) => x.id === c.id)),
        ],
      }));
    } catch (e) {
      setMoreError((e as Error).message);
    } finally {
      setMoreLoading(false);
    }
  }
  function login() {
    const returnUrl = new URL(location.href);
    returnUrl.searchParams.delete("auth_error");
    transient.set(`draft:${post.id}`, { ...draft, resume: true });
    location.assign(
      `/api/auth/github?return=${encodeURIComponent(returnUrl.pathname + returnUrl.search + returnUrl.hash)}`,
    );
  }
  async function submit() {
    if (!session.data?.user) {
      login();
      return;
    }
    if (!draft.body.trim() || sending) return;
    setSending(true);
    setSendError("");
    try {
      const result = await api<{ comment: Comment }>(
        `/api/posts/${post.id}/comments`,
        {
          method: "POST",
          headers: { "X-CSRF-Token": session.data.csrf || "" },
          body: JSON.stringify({
            body: draft.body.trim(),
            anchor: draft.anchor || undefined,
            // Let the server preserve the exact addressee while GitHub keeps one reply level.
            replyToId: draft.replyTo?.id,
            requestId: draft.requestId,
          }),
        },
      );
      invalidateComments();
      setFocused(result.comment);
      setPanelIds([result.comment.id]);
      setDraft({
        body: "",
        anchor: null,
        replyTo: null,
        requestId: newId(),
      });
      transient.remove(`draft:${post.id}`);
      commentState.reload();
      anchorState.reload();
      notify("评论已发布。");
    } catch (e) {
      const err = e as ApiError;
      setSendError(err.message);
      if (err.code === "DELIVERY_UNKNOWN")
        setDraft((prev) => ({ ...prev, uncertain: true }));
      if (err.status === 401) {
        session.reload();
        notify("登录已过期。重新登录后，可以继续刚才的文字。");
      }
    } finally {
      setSending(false);
    }
  }
  const pageComments = panelIds.length
    ? allComments.filter(visibleComment).filter(
        (c) =>
          panelIds.includes(c.id) ||
          (!!c.annotation && panelIds.includes(c.annotation.id)),
      )
    : [];
  const privateSelected = localMarks.filter((a) => panelIds.includes(a.id));
  const chosenAnnotation =
    allAnnotations.find((a) => panelIds.includes(a.id)) ||
    pageComments.find((c) => c.annotation)?.annotation;
  const panelQuote = panelIds.length
    ? chosenAnnotation?.anchor || null
    : draft.anchor;
  const prev = posts[posts.findIndex((p) => p.id === post.id) + 1],
    next = posts[posts.findIndex((p) => p.id === post.id) - 1];
  // Native browser menus usually appear ABOVE the highlighted line.
  // Prefer the space below; on narrow screens CSS docks actions safely at
  // the bottom instead of competing with iOS/Android selection handles.
  const toolbarWidth = 290;
  const toolbarStyle: CSSProperties = selection
    ? {
        left: Math.max(
          12,
          Math.min(
            (typeof window === "undefined" ? 1024 : window.innerWidth) -
              toolbarWidth - 12,
            selection.rect.left + selection.rect.width / 2 - toolbarWidth / 2,
          ),
        ),
        top: selection.rect.bottom + 14 + 52 <=
            (typeof window === "undefined" ? 768 : window.innerHeight)
          ? selection.rect.bottom + 14
          : Math.max(16, Math.min(
              selection.rect.top - 60,
              (typeof window === "undefined" ? 768 : window.innerHeight) - 60,
            )),
      }
    : {};
  return (
    <>
      <div
        className="reading-progress"
        role="progressbar"
        aria-label="阅读进度"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="reader-topbar">
        <button className="text-button" onClick={router.back}>
          <ArrowLeft size={16} />
          返回列表
        </button>
        <div className="reader-controls">
          <button
            className="quiet-button font-button"
            onClick={() => {
              const size =
                FONT_SIZES[
                  (FONT_SIZES.indexOf(fontSize) + 1) % FONT_SIZES.length
                ];
              setFontSize(size);
              storage.set("font-size", size);
            }}
            aria-label={`正文字号 ${fontSize}，点击切换`}
          >
            <Type size={17} />
            <span>{fontSize}</span>
          </button>
          <BookmarkButton post={post} className="icon-button" />
          <button
            className="icon-button"
            onClick={() => share()}
            aria-label="分享文章"
          >
            <Share2 size={17} />
          </button>
          <button
            className="icon-button mobile-toc"
            onClick={() => setTocOpen(!tocOpen)}
            aria-label="展开文章目录"
            aria-expanded={tocOpen}
          >
            <List size={20} />
          </button>
        </div>
      </div>
      <div className="reader-layout">
        <div className="reader-column">
          <article ref={article} className="reading-article">
            <header className="article-heading">
              <div className="article-eyebrow">
                <span className={`type-label type-${post.type}`}>
                  <span className="type-mark" aria-hidden="true" />
                  {typeLabels[post.type]}
                </span>
                <TopicBadge id={post.topic} />
              </div>
              <h1 style={{ viewTransitionName: `title-${post.id}` }}>
                {post.title}
              </h1>
              {!post.autoExcerpt && (
                <p className="article-deck">{post.excerpt}</p>
              )}
              <div className="article-byline">
                <AuthorAvatar size={24} className="author-seal" />
                <strong>{site.author}</strong>
                <time dateTime={post.date}>{dateLabel(post.date)}</time>
                {post.updated && (
                  <span>
                    更新于{" "}
                    <time dateTime={post.updated}>
                      {dateLabel(post.updated)}
                    </time>
                  </span>
                )}
                <span>{post.readingMinutes} 分钟阅读</span>
                {!!viewCount && (
                  <span className="article-views">{viewsLabel(viewCount)} 次阅读</span>
                )}
              </div>
              {post.project && (
                <div className="project-facts">
                  <span className="project-status">{post.project.status}</span>
                  <ul className="stack-list" aria-label="技术栈">
                    {post.project.stack.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                  {post.project.repo && (
                    <a
                      href={post.project.repo}
                      target="_blank"
                      rel="noreferrer"
                    >
                      仓库
                    </a>
                  )}
                  {post.project.demo && (
                    <a
                      href={post.project.demo}
                      target="_blank"
                      rel="noreferrer"
                    >
                      演示
                    </a>
                  )}
                </div>
              )}
            </header>
            {post.cover && (
              <figure className="article-cover">
                <div
                  className="article-cover-image"
                  data-shared-cover={post.id}
                  style={{ viewTransitionName: `visual-${post.id}` }}
                >
                  <ArtImage
                    src={post.cover}
                    alt={post.coverAlt}
                    width="1200"
                    height="750"
                    fetchPriority="high"
                    tabIndex={0}
                    role="button"
                    aria-label="放大文章插图"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setImage({
                          src: post.cover!,
                          alt: post.coverAlt || "",
                          from: e.currentTarget,
                        });
                      }
                    }}
                    onClick={(e) =>
                      setImage({
                        src: post.cover!,
                        alt: post.coverAlt || "",
                        from: e.currentTarget,
                      })
                    }
                  />
                </div>
                <figcaption>
                  {post.type === "article"
                    ? `示意插图 · ${site.name}`
                    : post.coverAlt}
                </figcaption>
              </figure>
            )}
            <div
              ref={prose}
              className={`reader-prose${excerptMode ? " excerpt-mode" : ""}`}
              style={{ "--reader-font": `${fontSize}px` } as CSSProperties}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                const mark = target.closest<HTMLElement>("mark[data-echo-ids]");
                if (mark) {
                  openHighlights(mark.dataset.echoIds!.split(" "));
                  return;
                }
                if (excerptMode && !window.getSelection()?.toString().trim() &&
                  !target.closest("a, button, input, textarea, pre, code, [role='button']")) {
                  const block = target.closest<HTMLElement>("[data-block-id]");
                  const found = block && prose.current
                    ? captureBlockExcerpt(prose.current, post, block) : null;
                  if (found) {
                    setSelection(found);
                    return;
                  }
                }
                if (target.tagName === "IMG")
                  setImage({
                    src: (target as HTMLImageElement).src,
                    alt: (target as HTMLImageElement).alt,
                    from: target,
                  });
              }}
              onKeyDown={(e) => {
                const target = e.target as HTMLElement;
                if (
                  (e.key === "Enter" || e.key === " ") &&
                  target.matches("mark[data-echo-ids]")
                ) {
                  e.preventDefault();
                  openHighlights(target.dataset.echoIds!.split(" "));
                }
              }}
            >
              {post.blocks.map((block) => (
                <div
                  className={`article-block-shell block-${block.type}`}
                  key={block.id}
                >
                  {block.type === "heading" &&
                    post.toc.some((t) => t.id === block.id) && (
                      <button
                        type="button"
                        className="heading-anchor"
                        aria-label={`复制本节链接：${block.text.trim()}`}
                        data-tip="复制本节链接"
                        onClick={() => copySection(block.id)}
                      >
                        #
                      </button>
                    )}
                  {block.type === "code" && (
                    <div className="code-bar">
                      <span className="win-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="code-bar-lang">
                        {block.lang || "code"}
                      </span>
                      <CopyButton
                        className="code-copy"
                        text={copyText(block)}
                        label="复制代码"
                      />
                    </div>
                  )}
                  <div
                    className="article-block"
                    data-block-id={block.id}
                    data-type={block.type}
                    id={block.id}
                    dangerouslySetInnerHTML={{
                      __html: articleHTML(block.html),
                    }}
                  />
                </div>
              ))}
            </div>
          </article>
          {(anchorState.error || annotationError) && (
            <div className="inline-notice">
              部分页边批注暂时没有读取成功。
              <button className="text-button" onClick={anchorState.reload}>
                重试
              </button>
            </div>
          )}
          {orphans.length > 0 && (
            <details className="orphan-notice">
              <summary>
                {orphans.length} 条划线的原文已变化，暂时无法定位。
              </summary>
              <p>保留了原始摘录，避免把批注移到错误的位置。</p>
              {allAnnotations
                .filter((a) => orphans.includes(a.id))
                .map((a) => (
                  <button
                    className="comment-quote"
                    key={a.id}
                    onClick={() => openHighlights([a.id])}
                  >
                    {anchorQuote(a.anchor)}
                  </button>
                ))}
            </details>
          )}
          <div className="reading-end">
            <EchoMark />
            <p>
              读到这里，
              <br />
              感谢你留下这一小段时间。
            </p>
            <div>
              {post.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <button className="quiet-button" onClick={() => share()}>
              <Share2 size={15} />
              把这篇文字带给朋友
            </button>
          </div>
          <section className="discussion-section" id="discussion">
            <div className="discussion-title">
              <h2>
                发表评论
                <span>
                  {commentState.loading
                    ? "…"
                    : commentState.error
                      ? "—"
                      : visibleCount}
                </span>
              </h2>
              {state.mapped && !offlinePreview() ? (
                <button className="quiet-button" onClick={() => newComment()}>
                  <Plus size={16} />写下想法
                </button>
              ) : (
                <span className="discussion-unavailable">公开讨论尚未连接</span>
              )}
            </div>
            <p className="discussion-intro">
              关于整篇文章，也关于让你停下来的那句话。
              {!state.mapped && (
                <>
                  <br />
                  公开评论基于 GitHub Discussions；接入完成后才可发表。
                </>
              )}
            </p>
            {commentState.loading ? (
              <div className="comment-skeleton" role="status">
                <span className="sr-only">正在加载评论…</span>
                {[0, 1].map((i) => (
                  <div key={i} aria-hidden="true">
                    <span className="skeleton-dot" />
                    <span className="skeleton-line" />
                    <span className="skeleton-line" />
                  </div>
                ))}
              </div>
            ) : commentState.error ? (
              <div className="discussion-empty is-error" role="status">
                <p>{commentState.error.message}</p>
                <small>正文与私人划线不受影响，稍后再试即可。</small>
                <button className="quiet-button" onClick={commentState.reload}>
                  <RotateCw size={15} aria-hidden="true" />
                  重新读取
                </button>
              </div>
            ) : (visibleTopComments.length > 0 || state.pageInfo.hasNextPage) ? (
              <>
                {state.stale && (
                  <p className="inline-notice">
                    GitHub 暂时没有回应，当前展示最近缓存的评论。
                  </p>
                )}
                {visibleTopComments.map((c, index) => (
                  <CommentItem
                    key={c.id}
                    comment={c}
                    floor={`${index}F`}
                    currentUser={session.data?.user?.login}
                    moderator={session.data?.moderator}
                    csrf={session.data?.csrf}
                    onChanged={commentChanged}
                    onQuote={quoteJump}
                    onReply={(c) => newComment(c.annotation?.anchor || null, c)}
                  />
                ))}
                {state.pageInfo.hasNextPage && (
                  <button
                    className="quiet-button"
                    disabled={moreLoading}
                    onClick={loadMore}
                  >
                    {moreLoading ? "正在读取…" : "加载更多评论"}
                    <ArrowDown size={15} />
                  </button>
                )}
                {moreError && (
                  <p role="alert" className="small-error">
                    {moreError}
                  </p>
                )}
              </>
            ) : (
              <div className="discussion-empty">
                <span className="empty-echo">
                  <EchoMark />
                </span>
                <p>
                  {state.mapped
                    ? "还没有评论。"
                    : "这篇文章的评论暂时还没有开放。"}
                </p>
                <span>你仍然可以选中文字，把喜欢的句子划下来。</span>
                {state.mapped && !offlinePreview() ? (
                  <button className="text-button" onClick={() => newComment()}>
                    留下一点想法 <ArrowUpRight size={15} />
                  </button>
                ) : (
                  <p className="discussion-setup-note">公开讨论尚未关联到本文，当前仅可使用私人划线；关联 GitHub Discussions 后自动显示真实讨论入口。</p>
                )}
              </div>
            )}
            {state.mapped && state.discussionUrl && (
              <a
                href={safeURL(state.discussionUrl)}
                className="discussion-source"
                rel="noreferrer"
                target="_blank"
              >
                <Github size={14} />
                前往 GitHub 讨论
                <ArrowUpRight size={13} />
              </a>
            )}
          </section>
          <Related post={post} exclude={[prev?.id, next?.id].filter((x): x is string => !!x)} />
          <nav className="article-neighbors" aria-label="相邻文章">
            {prev ? (
              <Link href={`/post/${prev.slug}`}>
                <small>
                  <ArrowLeft size={13} />
                  上一篇
                </small>
                <strong>{prev.title}</strong>
              </Link>
            ) : (
              <div />
            )}
            {next ? (
              <Link href={`/post/${next.slug}`}>
                <small>
                  下一篇
                  <ArrowRight size={13} />
                </small>
                <strong>{next.title}</strong>
              </Link>
            ) : (
              <Link href="/feed">
                <small>
                  继续探索
                  <ArrowRight size={13} />
                </small>
                <strong>回到所有文字</strong>
              </Link>
            )}
          </nav>
        </div>
        <aside className={`reader-toc ${tocOpen ? "toc-visible" : ""}`}>
          <div className="toc-inner">
            <div className="eyebrow">
              {post.toc.length ? "本文目录" : "阅读进度"}
              <button
                className="icon-button"
                onClick={() => setTocOpen(false)}
                aria-label="关闭目录"
              >
                <X size={16} />
              </button>
            </div>
            {post.toc.length > 0 && (
              <nav aria-label="文章目录">
                {post.toc.map((t) => (
                  <a
                    key={t.id}
                    href={`#${t.id}`}
                    className={`${activeSection === t.id ? "active" : ""} level-${t.level}`}
                    aria-current={
                      activeSection === t.id ? "location" : undefined
                    }
                    onClick={(e) => {
                      e.preventDefault();
                      document.getElementById(t.id)?.scrollIntoView({
                        behavior: motionAllowed() ? "smooth" : "instant",
                        block: "start",
                      });
                      setTocOpen(false);
                    }}
                  >
                    {t.title}
                  </a>
                ))}
              </nav>
            )}
            <div className="toc-progress">
              <span>
                已读 {progress}%
                {progress > 2 && progress < 98 && post.readingMinutes > 1 && (
                  <> · 约剩 {Math.max(1, Math.round((post.readingMinutes * (100 - progress)) / 100))} 分钟</>
                )}
              </span>
              <span className="toc-track">
                <span style={{ width: `${progress}%` }} />
              </span>
            </div>
            <dl className="toc-facts">
              <div>
                <dt>字数</dt>
                <dd>{wordsLabel(wordCount(post.text))}</dd>
              </div>
              {!!viewCount && (
                <div>
                  <dt>阅读</dt>
                  <dd>{viewsLabel(viewCount)}</dd>
                </div>
              )}
              <div>
                <dt>{post.updated ? "修订" : "发布"}</dt>
                <dd>{(post.updated || post.date).replaceAll("-", ".")}</dd>
              </div>
            </dl>
            <div className="toc-hint">
              <Highlighter size={17} />
              <p>
                选中一句文字，
                <br />
                可以划线或发表评论。
              </p>
            </div>
            <button
              className="text-button"
              onClick={() =>
                window.scrollTo({
                  top: 0,
                  behavior: motionAllowed() ? "smooth" : "instant",
                })
              }
            >
              回到页首
              <ArrowUp size={14} />
            </button>
          </div>
        </aside>
      </div>
      {!excerptMode && !selection && !panel && (
        <button type="button" className="excerpt-fab" aria-label="开启摘录段落模式"
          title="摘录段落" onClick={() => {
            setExcerptMode(true);
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          }}>
          <Highlighter size={18} />
          <span>摘录</span>
        </button>
      )}
      {excerptMode && !selection && (
        <div className="excerpt-mode-hint" role="status">
          <Highlighter size={16} />
          <span>摘录模式：点选正文段落，可划线或评论。长按仍可精确选择文字。</span>
          <button type="button" onClick={() => { setExcerptMode(false); setSelection(null); }} aria-label="退出摘录模式">
            <X size={17} />
          </button>
        </div>
      )}
      {selection && (
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label="选中文字的操作"
          style={toolbarStyle}
          onPointerDown={(e) => {
            // Keep the selection while clicking toolbar controls on desktop,
            // but do not interfere with touch-generated click events.
            if (e.pointerType === "mouse") e.preventDefault();
          }}
        >
          <div className="selection-toolbar-context">
            <span>已选文字 · {anchorQuote(selection.anchor).length} 字</span>
            <button type="button" aria-label="关闭摘录工具栏" onClick={() => {
              setSelection(null);
              window.getSelection()?.removeAllRanges();
            }}><X size={16} /></button>
          </div>
          <div className="selection-toolbar-actions">
          <button onClick={privateMark}>
            <Highlighter size={17} />
            <span>划线</span>
          </button>
          <button onClick={() => newComment(selection.anchor)} data-tip={!state.mapped ? "公开讨论尚未连接；可查看说明，暂时无法提交" : undefined}>
            <MessageSquare size={17} />
            <span>评论</span>
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  anchorQuote(selection.anchor),
                );
                notify("这段文字已复制。");
              } catch {
                notify("复制未完成，请使用系统复制。");
              }
            }}
          >
            <Copy size={17} />
            <span>复制</span>
          </button>
          <button onClick={() => share(selection.anchor)}>
            <Share2 size={17} />
            <span>分享</span>
          </button>
          </div>
        </div>
      )}
      <Dialog
        open={panel}
        onClose={() => setPanel(false)}
        label={
          panelIds.length
            ? "段落评论"
            : draft.replyTo
              ? "继续这段对话"
              : "发表评论"
        }
        className={`discussion-dialog ${panelIds.length ? "thread-dialog" : "composer-dialog"} ${composerFullscreen && !panelIds.length ? "composer-fullscreen" : ""}`}
        headerActions={!panelIds.length ? (
          <button type="button" className="icon-button composer-expand" title={composerFullscreen ? "退出沉浸模式" : "全屏沉浸编辑"}
            aria-label={composerFullscreen ? "退出全屏编辑" : "进入全屏编辑"}
            aria-pressed={composerFullscreen}
            onClick={toggleComposerFullscreen}>
            {composerFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        ) : undefined}
      >
        <div className="discussion-panel-body">
          {panelQuote && (
            <div className="panel-original">
              <span className="eyebrow">我们停在这句话旁边</span>
              <blockquote>{anchorQuote(panelQuote)}</blockquote>
              {chosenAnnotation && (
                <button
                  className="text-button"
                  onClick={() => quoteJump(chosenAnnotation)}
                >
                  回到原文
                  <ArrowUpRight size={14} />
                </button>
              )}
            </div>
          )}
          {privateSelected.map((a) => (
            <div className="private-highlight-info" key={a.id}>
              <Highlighter size={17} />
              <span>这条私人划线，仅保存在你的设备。</span>
              <button
                className="icon-button"
                aria-label="删除私人划线"
                onClick={() => {
                  const next = localMarks.filter((x) => x.id !== a.id);
                  setLocalMarks(next);
                  storage.set(`marks:${post.id}`, next);
                  setPanelIds((ids) => ids.filter((x) => x !== a.id));
                  notify("私人划线已移除。");
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {panelLoading && <p className="muted">正在加载这段文字的评论…</p>}
          {panelError && (
            <p className="small-error" role="alert">
              {panelError}
              <button
                className="text-button"
                onClick={() => setPanelRevision((n) => n + 1)}
              >
                重试
              </button>
            </p>
          )}
          {pageComments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              floor={(() => {
                const n = visibleTopComments.findIndex((top) => top.id === (c.parentId || c.id));
                if (n < 0) return undefined;
                const sub = c.parentId
                  ? visibleTopComments[n].replies?.nodes.filter(visibleComment).findIndex((reply) => reply.id === c.id) ?? -1
                  : -1;
                return sub >= 0 ? `${n}F-${sub + 1}` : `${n}F`;
              })()}
              currentUser={session.data?.user?.login}
              moderator={session.data?.moderator}
              csrf={session.data?.csrf}
              onChanged={commentChanged}
              onQuote={quoteJump}
              onReply={(c) => newComment(c.annotation?.anchor || null, c)}
            />
          ))}
          {panelIds.length > 0 &&
            !pageComments.length &&
            !panelLoading &&
            !panelError &&
            !privateSelected.length && (
              <p className="muted">
                这条评论可能已被删除，或尚未加载完成。原文仍保留在此。
              </p>
            )}
          {panelIds.filter((id) => !id.startsWith("local-")).length >
            panelBatch * 20 && (
            <button
              className="text-button"
              onClick={() => setPanelBatch((n) => n + 1)}
            >
              加载其他评论
              <ChevronDown size={14} />
            </button>
          )}
          {panelIds.some((id) => !id.startsWith("local-")) && (
            <div className="panel-share">
              <button
                className="text-button"
                onClick={() => share(chosenAnnotation?.anchor, panelIds[0])}
              >
                <Share2 size={14} />
                分享这条评论
              </button>
            </div>
          )}
          {panelIds.length > 0 ? (
            <button
              className="primary-button panel-comment-entry"
              onClick={() => newComment(panelQuote, pageComments[0] || null)}
            >
              <MessageSquare size={16} />
              {panelQuote ? "对这句话写下想法" : "参与这段评论"}
            </button>
          ) : (
            <div className="comment-composer">
              {draft.replyTo && (
                <div className="replying-to">
                  回复 @{draft.replyTo.author?.login || "读者"}
                  <button
                    className="icon-button"
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, replyTo: null }))
                    }
                    aria-label="取消回复"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
              <label htmlFor="echo-comment" className="eyebrow">
                把你的想法，留在这里
              </label>
              <textarea
                ref={composerArea}
                id="echo-comment"
                rows={5}
                maxLength={6000}
                placeholder="读到这里，你想到了什么？"
                value={draft.body}
                disabled={sending || draft.uncertain}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, body: e.target.value }))
                }
              />
              <MarkdownTools area={composerArea} value={draft.body}
                onChange={(body) => setDraft((prev) => ({ ...prev, body }))}
                disabled={sending || draft.uncertain} maxLength={6000} />
              <div className="composer-hint">
                <span>支持代码块与表情 · 评论公开可见</span>
                <button type="button" className="text-button" onClick={() => setPreviewDraft((v) => !v)}>
                  {previewDraft ? "关闭预览" : "预览"}
                </button>
                <span>{draft.body.length} / 6000</span>
              </div>
              {previewDraft && (
                <div className="comment-markdown composer-preview" aria-label="评论预览">
                  <ReactMarkdown skipHtml components={{
                    a: ({ children, href }) => <a href={href} target="_blank" rel="nofollow noopener noreferrer">{children}</a>,
                    img: ({ alt }) => <span>[图片：{alt || "附件"}]</span>,
                  }}>{draft.body || "预览会显示在这里。"}</ReactMarkdown>
                </div>
              )}
              {sendError && (
                <p role="alert" className="composer-error">
                  {sendError}
                </p>
              )}
              {session.loading ? (
                <p className="muted">正在确认你的身份…</p>
              ) : session.error ? (
                <div className="inline-notice">
                  身份服务暂时没有回应。文字会保留。
                  <button className="text-button" onClick={session.reload}>
                    重试
                  </button>
                </div>
              ) : session.data?.user ? (
                <div className="composer-bottom">
                  <div className="signed-user">
                    <img
                      src={session.data.user.avatarUrl}
                      width="24"
                      height="24"
                      alt=""
                    />
                    <span>{session.data.user.login}</span>
                    <button
                      className="text-button"
                      onClick={async () => {
                        try {
                          await api("/api/logout", {
                            method: "POST",
                            headers: {
                              "X-CSRF-Token": session.data?.csrf || "",
                            },
                          });
                          session.reload();
                        } catch (e) {
                          notify((e as Error).message);
                        }
                      }}
                    >
                      退出
                    </button>
                  </div>
                  <button
                    className="primary-button"
                    disabled={sending || !draft.body.trim()}
                    onClick={submit}
                  >
                    {sending ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Send size={15} />
                    )}
                    <span>
                      {draft.uncertain
                        ? "检查是否送达"
                        : sending
                          ? "正在送出"
                          : "发表评论"}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="login-invitation">
                  <p>
                    {session.data?.configured
                      ? "通过 GitHub 留下真实的声音。登录后会回到这一页，保留刚才的文字。"
                      : "评论功能还没有开放。你可以先把喜欢的句子划下来，草稿会保留在本次会话中。"}
                  </p>
                  <button
                    className="primary-button"
                    disabled={!session.data?.configured}
                    onClick={login}
                  >
                    <Github size={17} />
                    使用 GitHub 登录
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </Dialog>
      <ImageViewer image={image} onClose={() => setImage(null)} />
      {toast && (
        <Toast>
          <Check size={16} />
          {toast}
        </Toast>
      )}
    </>
  );
}
