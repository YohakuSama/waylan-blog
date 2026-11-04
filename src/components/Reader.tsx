import { motionAllowed, animateDialogResize } from "../lib/motion";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from "react";
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
  MoreHorizontal,
  MessageSquare,
  Plus,
  Send,
  Share2,
  Trash2,
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
/** The composer preview and published comments must use identical rendering. */
function CommentMarkdown({ body, preview = false }: { body: string; preview?: boolean }) {
  return (
    <div
      id={preview ? "echo-preview" : undefined}
      className={preview ? "comment-markdown composer-preview" : "comment-markdown"}
      aria-label={preview ? "评论效果预览" : undefined}
      role={preview ? "region" : undefined}
    >
      <ReactMarkdown
        skipHtml
        components={{
          a: ({ children, href }) => (
            <a href={href} rel="nofollow noopener noreferrer" target="_blank">{children}</a>
          ),
          img: ({ alt }) => <span>[图片：{alt || "附件"}]</span>,
        }}
      >
        {body || (preview ? "预览会显示在这里。" : "")}
      </ReactMarkdown>
    </div>
  );
}

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
    toc = useRef<HTMLElement>(null),
    tocButton = useRef<HTMLButtonElement>(null),
    moreButton = useRef<HTMLButtonElement>(null),
    moreMenu = useRef<HTMLDivElement>(null),
    composerArea = useRef<HTMLTextAreaElement>(null),
    composerGeometry = useRef<{ from: DOMRect; radius: string } | null>(null),
    composerResizeAnimation = useRef<Animation | null>(null);
  const [progress, setProgress] = useState(0),
    [activeSection, setActiveSection] = useState(post.toc[0]?.id || ""),
    [fontSize, setFontSize] = useState(DEFAULT_FONT),
    [tocOpen, setTocOpen] = useState(false),
    [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return;
    moreMenu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!moreMenu.current?.contains(event.target as Node) &&
          !moreButton.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMoreOpen(false);
      moreButton.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
    };
  }, [moreOpen]);
  useEffect(() => {
    if (!tocOpen) return;
    (toc.current?.querySelector<HTMLElement>("nav a") ||
      toc.current?.querySelector<HTMLElement>("button"))?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setTocOpen(false);
      tocButton.current?.focus({ preventScroll: true });
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!toc.current?.contains(target) && !tocButton.current?.contains(target)) setTocOpen(false);
    };
    const desktop = window.matchMedia("(min-width: 1041px)");
    const resize = (event: MediaQueryListEvent) => {
      if (event.matches) setTocOpen(false);
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", outside);
    desktop.addEventListener("change", resize);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", outside);
      desktop.removeEventListener("change", resize);
    };
  }, [tocOpen]);
  const [selection, setSelection] = useState<{
      anchor: Anchor;
      rect: DOMRect;
    } | null>(null),
    [excerptMode, setExcerptMode] = useState(false),
    [localMarks, setLocalMarks] = useState<Annotation[]>([]),
    [orphans, setOrphans] = useState<string[]>([]);
  // Document-level tap listeners need the latest selection without resetting
  // the pointer gesture each time WebKit emits selectionchange.
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const lastToolbarTouch = useRef<{ target: EventTarget; at: number; handled: boolean } | null>(null);
  // When supported, transfer the *visual* selection to a CSS custom highlight.
  // iOS Safari otherwise treats the first tap as "dismiss the native selection"
  // instead of delivering the button's click. The captured Anchor remains
  // authoritative; this does not modify the article DOM or its text offsets.
  function clearToolbarHighlight() {
    const host = window as Window & { CSS?: { highlights?: {
      delete(name: string): boolean;
    } } };
    host.CSS?.highlights?.delete("waylan-selected-quote");
  }
  function stabilizeTouchSelection() {
    if (!window.matchMedia("(any-pointer: coarse)").matches) return;
    const host = window as Window & {
      CSS?: { highlights?: { set(name: string, value: unknown): unknown } };
      Highlight?: new (...ranges: Range[]) => unknown;
    };
    const native = window.getSelection();
    if (!host.CSS?.highlights || !host.Highlight || !native?.rangeCount || native.isCollapsed) return;
    // Cloned Range stays rendered even after Safari releases its edit handles.
    // Keep the native range if a browser exposes an incomplete Highlight API.
    try {
      host.CSS.highlights.set("waylan-selected-quote",
        new host.Highlight(native.getRangeAt(0).cloneRange()));
      native.removeAllRanges();
    } catch {
      clearToolbarHighlight();
    }
  }
  useEffect(() => {
    if (!selection) clearToolbarHighlight();
  }, [selection]);
  useEffect(() => () => clearToolbarHighlight(), []);
  // Ignore the article click generated by the very tap that dismissed a tray.
  // Otherwise excerpt mode immediately reselects the tapped paragraph.
  const dismissedTap = useRef<{ target: Element | null; until: number } | null>(null);
  const [panel, setPanel] = useState(false),
    [panelIds, setPanelIds] = useState<string[]>([]),
    [quoteExpanded, setQuoteExpanded] = useState(false),
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
  // Reader settings own text-size controls. Keep the current article in sync
  // without remounting it or changing the saved reading position.
  useEffect(() => {
    const syncFont = () => {
      const size = storage.get<number>("font-size", DEFAULT_FONT);
      setFontSize(FONT_SIZES.includes(size) ? size : DEFAULT_FONT);
    };
    window.addEventListener("waylan:font-size-changed", syncFont);
    window.addEventListener("storage", syncFont);
    return () => {
      window.removeEventListener("waylan:font-size-changed", syncFont);
      window.removeEventListener("storage", syncFont);
    };
  }, []);
  function toggleReaderExcerpt() {
    setExcerptMode((active) => !active);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }
  // Snapshot before React changes the class; run geometry animation in
  // layout effect after the new bounds exist, before the first painted frame.
  function toggleComposerFullscreen(event: ReactMouseEvent<HTMLButtonElement>) {
    const dialog = event.currentTarget.closest("dialog");
    if (!dialog) return;
    const bounds = dialog.getBoundingClientRect();
    const radius = window.getComputedStyle(dialog).borderRadius;
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
      window.getComputedStyle(dialog).borderRadius,
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
  // Safari's bottom browser bar can expand on the first tap and shrink the
  // visual viewport. Keep the excerpt tray above the *visible* bottom instead
  // of trusting CSS safe-area (which does not include Safari browser chrome).
  // This is also needed on iPads where the browser toolbar can change size.
  useEffect(() => {
    if (!selection) return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const sync = () => {
      const obscured = viewport
        ? Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height)
        : 0;
      root.style.setProperty("--waylan-selection-view-bottom", `${Math.ceil(obscured)}px`);
      root.style.setProperty("--waylan-selection-view-height",
        `${Math.floor(viewport?.height ?? window.innerHeight)}px`);
    };
    sync();
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      root.style.removeProperty("--waylan-selection-view-bottom");
      root.style.removeProperty("--waylan-selection-view-height");
    };
  }, [!!selection]);
  // All paragraph threads rise from the bottom, like the comment composer.
  // Safari's visible viewport can end well above the layout viewport when
  // browser chrome or the keyboard is present; measure that covered area.
  useEffect(() => {
    if (!panel || !panelIds.length) return;
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let trackedDialog: HTMLDialogElement | null = null;
    const sync = () => {
      const obscured = viewport ? Math.max(
        0, window.innerHeight - viewport.offsetTop - viewport.height,
      ) : 0;
      const viewHeight = viewport?.height ?? window.innerHeight;
      root.style.setProperty("--waylan-thread-view-bottom", `${Math.ceil(obscured)}px`);
      root.style.setProperty("--waylan-thread-view-height", `${Math.floor(viewHeight)}px`);
      const dialog = document.querySelector<HTMLDialogElement>(
        "dialog.discussion-dialog.thread-dialog[open]",
      );
      if (!dialog) return;
      trackedDialog = dialog;
      dialog.style.top = "auto";
      dialog.style.bottom = `${Math.ceil(obscured) + 8}px`;
      dialog.style.marginBlock = "0";
    };
    sync();
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      if (trackedDialog) {
        trackedDialog.style.removeProperty("top");
        trackedDialog.style.removeProperty("bottom");
        trackedDialog.style.removeProperty("margin-block");
      }
      root.style.removeProperty("--waylan-thread-view-bottom");
      root.style.removeProperty("--waylan-thread-view-height");
    };
  }, [panel, panelIds.length]);
  useEffect(() => {
    if (!panel || panelIds.length || !window.matchMedia("(pointer: fine)").matches)
      return;
    const id = window.requestAnimationFrame(() => composerArea.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(id);
  }, [panel, panelIds.length]);
  // Unknown comment data must not be mistaken for an empty discussion.
  const commentsUnresolved = !comments && !commentState.data;
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
          (prose.current?.querySelector<HTMLElement>(
            `[data-block-id="${heading.id}"]`,
          )?.getBoundingClientRect().top ?? Infinity) < 170
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
      // Native drag-selection may be transient; explicit tap-to-excerpt is a
      // deliberate choice and must survive small scrolls while taking action.
      // WebKit may dispatch scroll as the native selection handles and
      // visual viewport settle. Keep the touch action tray until explicit
      // dismissal instead of making it flash and vanish after a long press.
      if (!excerptMode && !window.matchMedia("(any-pointer: coarse)").matches)
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
  }, [post, excerptMode]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let pointerDown = false;
    let gesture: { x: number; y: number; start: number; selection: string } | null = null;
    let completedTap = false;
    let dismissSelectionUntil = 0;
    const dismissSelection = (target: EventTarget | null) => {
      dismissSelectionUntil = performance.now() + 250;
      dismissedTap.current = {
        target: target as Element | null,
        until: performance.now() + 250,
      };
      clearTimeout(timer);
      selectionRef.current = null;
      setSelection(null);
      clearToolbarHighlight();
      window.getSelection()?.removeAllRanges();
    };
    const scan = (dismissMissing: boolean) => {
      if (panel || !prose.current || performance.now() < dismissSelectionUntil) return;
      const found = captureSelection(prose.current, post);
      // iOS and iPadOS may collapse the native selection when a user taps
      // the action tray or opens the system share sheet. Only a new pointer
      // gesture away from the tray should dismiss a missing selection.
      if (found) {
        selectionRef.current = found;
        setSelection(found);
        stabilizeTouchSelection();
      } else if (dismissMissing && !excerptMode) setSelection(null);
    };
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element)?.closest?.(".selection-toolbar")) return;
      // A new deliberate gesture can make a fresh text selection immediately,
      // even while old native selectionchange events are being suppressed.
      dismissSelectionUntil = 0;
      dismissedTap.current = null;
      gesture = {
        x: event.clientX, y: event.clientY, start: performance.now(),
        selection: window.getSelection()?.toString() || "",
      };
      completedTap = false;
      pointerDown = true;
    };
    const onPointerUp = (event: PointerEvent) => {
      pointerDown = false;
      if ((event.target as Element)?.closest?.(".selection-toolbar")) return;
      const elapsed = gesture ? performance.now() - gesture.start : Infinity;
      const moved = gesture ? Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) : Infinity;
      // Long press/dragging selection handles must not count as a blank tap.
      completedTap = elapsed < 450 && moved < 12;
      const selectedNow = window.getSelection()?.toString() || "";
      if (gesture && selectedNow && selectedNow !== gesture.selection) completedTap = false;
      gesture = null;
      clearTimeout(timer);
      const touch = event.pointerType === "touch";
      // iOS may swallow the first click to collapse native text selection.
      // A genuine short pointer gesture is sufficient to dismiss BOTH the
      // native range and the site's toolbar on that very first tap.
      if (touch && completedTap && selectionRef.current) {
        dismissSelection(event.target);
        return;
      }
      // Long press and selection handles can collapse a range temporarily.
      // Never dismiss them from pointerup alone.
      timer = setTimeout(() => scan(!touch), touch ? 420 : 140);
    };
    const onPointerCancel = () => {
      pointerDown = false;
      gesture = null;
      completedTap = false;
    };
    const onClick = (event: MouseEvent) => {
      if (!selectionRef.current || panel) return;
      if ((event.target as Element)?.closest?.(".selection-toolbar")) return;
      // The native edit menu and selection handles do not generate a regular
      // short tap. Preserve their selection; dismiss on an intentional tap
      // anywhere else, including a blank area within the article.
      if (event.detail > 0 && !completedTap) return;
      dismissSelection(event.target);
    };
    const onSelectionChange = () => {
      if (pointerDown) return;
      clearTimeout(timer);
      timer = setTimeout(() => scan(false), 180);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
    document.addEventListener("click", onClick, true);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("click", onClick, true);
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
    setQuoteExpanded(false);
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
    setQuoteExpanded(false);
    setSendError("");
    setPreviewDraft(false);
    setComposerFullscreen(false);
    setSelection(null);
    setPanel(true);
  }
  function openHighlights(ids: string[]) {
    setComposerFullscreen(false);
    setPanelIds(ids);
    setQuoteExpanded(false);
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
  async function copyArticleLink() {
    if (offlinePreview()) {
      notify("离线预览暂不提供在线文章链接。");
      return;
    }
    const url = `${site.origin.includes("YOUR_DOMAIN") ? location.origin : site.origin}/post/${post.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      notify("文章链接已复制。");
    } catch {
      notify("复制未完成，请从地址栏复制文章链接。");
    }
  }
  function changeFontSize(size: number) {
    if (!FONT_SIZES.includes(size)) return;
    setFontSize(size);
    const saved = storage.set("font-size", size);
    if (saved) window.dispatchEvent(new Event("waylan:font-size-changed"));
    else notify("字号已调整，但当前浏览器无法保存偏好。");
    setMoreOpen(false);
  }
  function jumpToDiscussion() {
    setMoreOpen(false);
    const discussion = document.getElementById("discussion");
    discussion?.focus({ preventScroll: true });
    discussion?.scrollIntoView({
      block: "start",
      behavior: motionAllowed() ? "smooth" : "instant",
    });
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
    const payload = { title: post.title, text, url };
    const fallback = async () => {
      try {
        await navigator.clipboard.writeText(
          `${anchor ? text + "\n" : ""}${url}`,
        );
        notify("分享内容和链接已复制，可以粘贴发送。");
      } catch {
        notify("系统分享未完成，请复制文章地址栏链接。");
      }
    };
    try {
      // Desktop OS share sheets can appear and immediately close without
      // delivering anything, sometimes resolving the Promise. On fine-pointer
      // desktops, provide a reliable copy action rather than a false success.
      // Keep the native share sheet on touch devices that support it.
      const desktop = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      if (!desktop && navigator.share &&
          (!navigator.canShare || navigator.canShare(payload))) {
        await navigator.share(payload);
      } else await fallback();
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        notify("系统分享已取消；可使用复制功能。");
      } else await fallback();
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
  // Marking, commenting and closing can run on the first pointerdown.
  // Clipboard and Web Share require transient user activation: stage them on
  // pointerdown, then perform once at that same touch's pointerup/touchend.
  // This avoids relying on WebKit's often-swallowed compatibility click.
  function onToolbarPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>, action: () => void,
    needsActivation = false,
  ) {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") {
      lastToolbarTouch.current = null;
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    lastToolbarTouch.current = {
      target: event.currentTarget, at: performance.now(), handled: !needsActivation,
    };
    if (!needsActivation) action();
  }
  function onToolbarTouchStart(
    event: ReactTouchEvent<HTMLButtonElement>, action: () => void,
    needsActivation = false,
  ) {
    if (event.touches.length !== 1) return;
    event.stopPropagation();
    const last = lastToolbarTouch.current;
    if (last?.target === event.currentTarget && performance.now() - last.at < 300) return;
    lastToolbarTouch.current = {
      target: event.currentTarget, at: performance.now(), handled: !needsActivation,
    };
    if (!needsActivation) action();
  }
  function completeToolbarTouch(target: EventTarget, action: () => void) {
    const last = lastToolbarTouch.current;
    if (!last || last.target !== target || last.handled) return;
    last.handled = true;
    action();
  }
  function onToolbarPointerUp(event: ReactPointerEvent<HTMLButtonElement>, action: () => void) {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    event.stopPropagation();
    completeToolbarTouch(event.currentTarget, action);
  }
  function onToolbarTouchEnd(event: ReactTouchEvent<HTMLButtonElement>, action: () => void) {
    if (event.changedTouches.length !== 1) return;
    event.stopPropagation();
    completeToolbarTouch(event.currentTarget, action);
  }
  function onToolbarClick(event: ReactMouseEvent<HTMLButtonElement>, action: () => void) {
    const last = lastToolbarTouch.current;
    lastToolbarTouch.current = null;
    // A compatibility click is never a second command. If pointerup/touchend
    // did not arrive, click still completes a pending clipboard/share command.
    // detail === 0 is a keyboard activation and always runs independently.
    if (event.detail !== 0 && last?.target === event.currentTarget &&
        performance.now() - last.at < 1500) {
      event.preventDefault();
      if (!last.handled) action();
      return;
    }
    action();
  }
  function dismissToolbar() {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }
  async function copySelected() {
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(anchorQuote(selection.anchor));
      notify("这段文字已复制。");
    } catch {
      notify("复制未完成，请使用系统复制。");
    }
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
  const panelQuoteText = panelQuote ? anchorQuote(panelQuote) : "";
  const canExpandPanelQuote = panelIds.length > 0 && panelQuoteText.length > 90;
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
        top: selection.rect.bottom + 14 + 82 <=
            (typeof window === "undefined" ? 768 : window.innerHeight)
          ? selection.rect.bottom + 14
          : Math.max(16, Math.min(
              selection.rect.top - 90,
              (typeof window === "undefined" ? 768 : window.innerHeight) - 84,
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
      <div className="reader-layout">
        <div className="reader-column">
          <article ref={article} className="reading-article">
            <header className="article-heading">
              <button className="reader-back text-button" type="button"
                aria-label="返回列表" onClick={router.backToList}>
                <ArrowLeft size={16} /> 返回列表
              </button>
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
                <div className="article-author">
                  <AuthorAvatar size={24} className="author-seal" />
                  <strong>{site.author}</strong>
                </div>
                <div className="article-meta">
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
            <div className="article-actions"
              role="group" aria-label="本文操作">
              <BookmarkButton post={post} className="article-action-save" showLabel />
              <button className="article-action" type="button" aria-label="分享文章" onClick={() => share()}>
                <Share2 size={17} /><span>分享</span>
              </button>
              <button className="article-action article-action-toc" type="button" ref={tocButton}
                aria-label={tocOpen ? "收起文章目录" : post.toc.length ? "展开文章目录" : "查看阅读进度"}
                aria-expanded={tocOpen} aria-controls="reader-toc" onClick={() => { setMoreOpen(false); setTocOpen((value) => !value); }}>
                <List size={17} /><span>目录</span>
              </button>
              <div className="article-more">
                <button className="article-action article-action-more" type="button" ref={moreButton}
                  aria-label={moreOpen ? "收起更多操作" : "展开更多操作"}
                  aria-expanded={moreOpen} aria-controls="reader-more-actions"
                  onClick={() => { setTocOpen(false); setMoreOpen((value) => !value); }}>
                  <MoreHorizontal size={17} /><span>更多</span>
                </button>
                <div className="article-more-panel" id="reader-more-actions" ref={moreMenu}
                  role="group" aria-label="更多阅读操作" hidden={!moreOpen}>
                  <button type="button" onClick={() => { setMoreOpen(false); void copyArticleLink(); }}>
                    <Copy size={16} aria-hidden="true" />复制链接
                  </button>
                  <button type="button" onClick={jumpToDiscussion}>
                    <MessageSquare size={16} aria-hidden="true" />跳到评论
                  </button>
                  <span className="article-font-label" id="reader-font-label">正文字号</span>
                  <div className="article-font-options" role="group" aria-labelledby="reader-font-label">
                    {FONT_SIZES.map((size) => (
                      <button key={size} type="button" aria-pressed={fontSize === size}
                        aria-label={`切换正文为${size}px（${size === 16 ? "小" : size === 18 ? "标准" : "大"}）`}
                        onClick={() => changeFontSize(size)}>
                        {size === 16 ? "小" : size === 18 ? "标准" : "大"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {excerptMode && (
              <div className="excerpt-mode-hint" role="status">
                <Highlighter size={17} aria-hidden="true" />
                <span>
                  <strong>段落摘录已开启</strong>
                  <small>点击正文段落选择，无时间限制</small>
                </span>
                <button type="button" onClick={toggleReaderExcerpt}>
                  退出摘录
                </button>
              </div>
            )}
            <section className="reader-content" aria-label="文章正文">
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
                const justDismissed = dismissedTap.current;
                if (justDismissed && performance.now() < justDismissed.until) {
                  const firstBlock = justDismissed.target?.closest?.("[data-block-id]");
                  const currentBlock = target.closest("[data-block-id]");
                  const sameTap = target === justDismissed.target ||
                    (!!firstBlock && firstBlock === currentBlock);
                  dismissedTap.current = null;
                  // Ignore only the browser's click from the dismissing touch,
                  // never the user's next tap in another paragraph.
                  if (sameTap) return;
                }
                const mark = target.closest<HTMLElement>("mark[data-echo-ids]");
                // A saved mark opens its thread in normal reading. In excerpt
                // mode the reader's explicit tap should select the paragraph,
                // not unexpectedly open a different discussion dialog.
                if (mark && !excerptMode) {
                  openHighlights(mark.dataset.echoIds!.split(" "));
                  return;
                }
                const interactive = target.closest<HTMLElement>(
                  "a, button, input, textarea, pre, code, [role='button']",
                );
                if (excerptMode && !window.getSelection()?.toString().trim() &&
                    (!interactive || interactive === mark)) {
                  const block = target.closest<HTMLElement>("[data-block-id]");
                  const found = block && prose.current
                    ? captureBlockExcerpt(prose.current, post, block, {
                        x: e.clientX, y: e.clientY,
                      }) : null;
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
                  if (excerptMode) {
                    // Keyboard activation must match tapping highlighted text
                    // while choosing a new excerpt (no stray thread dialog).
                    const block = target.closest<HTMLElement>("[data-block-id]");
                    const found = block && prose.current
                      ? captureBlockExcerpt(prose.current, post, block) : null;
                    if (found) setSelection(found);
                  } else openHighlights(target.dataset.echoIds!.split(" "));
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
                    data-excerpt-selected={excerptMode && selection?.anchor.segments.some((s) => s.blockId === block.id) ? "true" : undefined}
                    id={block.id}
                    tabIndex={block.type === "heading" ? -1 : undefined}
                    dangerouslySetInnerHTML={{
                      __html: articleHTML(block.html),
                    }}
                  />
                </div>
              ))}
            </div>
            </section>
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
          <section className="discussion-section" id="discussion" tabIndex={-1}>
            <div className="discussion-title">
              <h2>
                发表评论
                <span>
                  {commentsUnresolved && !commentState.error
                    ? "…"
                    : commentState.error
                      ? "—"
                      : visibleCount}
                </span>
              </h2>
              {commentsUnresolved ? (
                <span className="discussion-action-placeholder" aria-hidden="true" />
              ) : state.mapped && !offlinePreview() ? (
                <button className="quiet-button" onClick={() => newComment()}>
                  <Plus size={16} />写下想法
                </button>
              ) : (
                <span className="discussion-unavailable">公开讨论尚未连接</span>
              )}
            </div>
            <p className="discussion-intro">
              关于整篇文章，也关于让你停下来的那句话。
              {!commentsUnresolved && !state.mapped && (
                <>
                  <br />
                  公开评论基于 GitHub Discussions；接入完成后才可发表。
                </>
              )}
            </p>
            <div className="discussion-results">
              {commentsUnresolved && !commentState.error ? (
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
            </div>
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
        <aside id="reader-toc" ref={toc} aria-label={post.toc.length ? "本文目录" : "阅读进度"}
          className={`reader-toc ${tocOpen ? "toc-visible" : ""}`}>
          <div className="toc-inner">
            <div className="eyebrow">
              {post.toc.length ? "本文目录" : "阅读进度"}
              <button
                className="icon-button"
                onClick={() => { setTocOpen(false); tocButton.current?.focus({ preventScroll: true }); }}
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
                      const targetId = t.id;
                      setTocOpen(false);
                      // Resolve the exact rendered block *after* closing the
                      // mobile TOC. Use its physical position, avoiding a
                      // browser smooth-scroll that can land in the next section.
                      window.requestAnimationFrame(() => {
                        const destination = prose.current?.querySelector<HTMLElement>(
                          `[data-block-id="${targetId}"]`,
                        );
                        if (!destination) return;
                        const margin = Number.parseFloat(
                          window.getComputedStyle(destination).scrollMarginTop,
                        ) || 0;
                        window.scrollTo({
                          top: Math.max(
                            0,
                            window.scrollY + destination.getBoundingClientRect().top - margin,
                          ),
                          behavior: "instant",
                        });
                        destination.focus({ preventScroll: true });
                        setActiveSection(targetId);
                        // WebKit may deliver a stale scroll event while the
                        // instant jump settles. Restore the clicked section
                        // on the next frame, after scroll/layout events.
                        window.requestAnimationFrame(() => setActiveSection(targetId));
                      });
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
                选中文字后可划线、评论、复制或分享。
              </p>
            </div>
            <div className="toc-footer" role="group" aria-label="目录操作">
              <button type="button" className="toc-excerpt-toggle"
                aria-pressed={excerptMode}
                aria-label={excerptMode ? "退出摘录模式" : "开启摘录段落模式"}
                onClick={() => {
                  toggleReaderExcerpt();
                  setTocOpen(false);
                  tocButton.current?.focus({ preventScroll: true });
                }}>
                <Highlighter size={15} aria-hidden="true" />
                {excerptMode ? "退出摘录模式" : "开启摘录段落模式"}
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setTocOpen(false);
                  window.scrollTo({
                    top: 0,
                    behavior: motionAllowed() ? "smooth" : "instant",
                  });
                  tocButton.current?.focus({ preventScroll: true });
                }}
              >
                回到页首
                <ArrowUp size={14} />
              </button>
            </div>
          </div>
        </aside>
      </div>
      {selection && (
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label="选中文字的操作"
          style={toolbarStyle}
          onPointerDown={(e) => {
            // Prevent desktop selection blur; touch buttons handle their own
            // pointerdown before a compatibility click can be swallowed.
            if (e.pointerType === "mouse") e.preventDefault();
          }}
        >
          <div className="selection-toolbar-context">
            <span title={anchorQuote(selection.anchor)}>
              已选 {anchorQuote(selection.anchor).length} 字 · “{anchorQuote(selection.anchor).slice(0, 28)}{anchorQuote(selection.anchor).length > 28 ? "…" : ""}”
            </span>
            {excerptMode && (
              <button type="button" className="selection-toolbar-mode-exit"
                onPointerDown={(e) => onToolbarPointerDown(e, toggleReaderExcerpt)}
                onTouchStart={(e) => onToolbarTouchStart(e, toggleReaderExcerpt)}
                onClick={(e) => onToolbarClick(e, toggleReaderExcerpt)}
              >退出摘录</button>
            )}
            <button type="button" aria-label="关闭摘录工具栏"
              onPointerDown={(e) => onToolbarPointerDown(e, dismissToolbar)}
                onTouchStart={(e) => onToolbarTouchStart(e, dismissToolbar)}
              onClick={(e) => onToolbarClick(e, dismissToolbar)}
            ><X size={16} /></button>
          </div>
          <div className="selection-toolbar-actions">
          <button onPointerDown={(e) => onToolbarPointerDown(e, privateMark)}
                onTouchStart={(e) => onToolbarTouchStart(e, privateMark)}
            onClick={(e) => onToolbarClick(e, privateMark)}>
            <Highlighter size={17} />
            <span>划线</span>
          </button>
          <button onPointerDown={(e) => onToolbarPointerDown(e, () => newComment(selection.anchor))}
                onTouchStart={(e) => onToolbarTouchStart(e, () => newComment(selection.anchor))}
            onClick={(e) => onToolbarClick(e, () => newComment(selection.anchor))} data-tip={!state.mapped ? "公开讨论尚未连接；可查看说明，暂时无法提交" : undefined}>
            <MessageSquare size={17} />
            <span>评论</span>
          </button>
          <button
            onPointerDown={(e) => onToolbarPointerDown(e, () => { void copySelected(); }, true)}
                onTouchStart={(e) => onToolbarTouchStart(e, () => { void copySelected(); }, true)}
            onPointerUp={(e) => onToolbarPointerUp(e, () => { void copySelected(); })}
            onTouchEnd={(e) => onToolbarTouchEnd(e, () => { void copySelected(); })}
            onClick={(e) => onToolbarClick(e, () => { void copySelected(); })}
          >
            <Copy size={17} />
            <span>复制</span>
          </button>
          <button onPointerDown={(e) => onToolbarPointerDown(e, () => { void share(selection.anchor); }, true)}
                onTouchStart={(e) => onToolbarTouchStart(e, () => { void share(selection.anchor); }, true)}
            onPointerUp={(e) => onToolbarPointerUp(e, () => { void share(selection.anchor); })}
            onTouchEnd={(e) => onToolbarTouchEnd(e, () => { void share(selection.anchor); })}
            onClick={(e) => onToolbarClick(e, () => { void share(selection.anchor); })}>
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
        focusContainer={panelIds.length > 0}
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
              <blockquote
                id="thread-original-quote"
                className={canExpandPanelQuote ? (quoteExpanded ? "quote-expanded" : "quote-collapsed") : undefined}
              >{panelQuoteText}</blockquote>
              {canExpandPanelQuote && (
                <button
                  type="button"
                  className="text-button quote-toggle"
                  aria-controls="thread-original-quote"
                  aria-expanded={quoteExpanded}
                  onClick={() => setQuoteExpanded((value) => !value)}
                >
                  {quoteExpanded ? "收起引用" : "展开完整引用"}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              )}
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
                  if (!storage.set(`marks:${post.id}`, next)) {
                    notify("私人划线删除失败，原记录仍然保留；请检查浏览器存储权限。");
                    return;
                  }
                  setLocalMarks(next);
                  // Keep the thread type during its closing animation.
                  // Empty panelIds with panel=true would open the composer.
                  const remaining = panelIds.filter((id) => id !== a.id);
                  if (remaining.length) setPanelIds(remaining);
                  else setPanel(false);
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
          {!panelIds.length && (
            <div className="comment-composer" data-preview={previewDraft ? "true" : undefined}>
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
                <button type="button" className="text-button" aria-pressed={previewDraft}
                  aria-controls="echo-preview" onClick={() => setPreviewDraft((v) => !v)}>
                  {previewDraft ? "继续编辑" : "效果预览"}
                </button>
                <span>{draft.body.length} / 6000</span>
              </div>
              {previewDraft && <CommentMarkdown body={draft.body} preview />}
              {sendError && (
                <p role="alert" className="composer-error">
                  {sendError}
                </p>
              )}
            </div>
          )}
        </div>
        {!panelIds.length && (session.loading ? (
                <div className="composer-bottom composer-status" role="status">正在确认你的身份…</div>
              ) : session.error ? (
                <div className="composer-bottom composer-status inline-notice">
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
                <div className="composer-bottom login-invitation">
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
              ))}
        {panelIds.length > 0 && (
          <div className="thread-dialog-footer">
            <button
              className="primary-button panel-comment-entry"
              onClick={() => newComment(panelQuote, pageComments[0] || null)}
            >
              <MessageSquare size={16} />
              {panelQuote ? "对这句话写下想法" : "参与这段评论"}
            </button>
          </div>
        )}
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
