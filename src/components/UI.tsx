import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type ImgHTMLAttributes,
} from "react";
import { ArrowUpRight, Check, Copy, MessageSquare, X } from "lucide-react";
import { animateDialog, animateElement } from "../lib/motion";
import { assetURL } from "../lib/runtime";
import { useReveal } from "../lib/reveal";
import { Link, motionOK } from "../lib/router";
import { posts, site, topicName, dateLabel } from "../lib/data";
import type { Comment, Post } from "../../shared/types";
export function EchoMark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 11a7 7 0 0 1 0 10M14 7a13 13 0 0 1 0 18M21 4a17 17 0 0 1 0 24"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
/** Set after the first commit, so prerendered images are never hidden again. */
let hydrated = false;
export const markHydrated = () => void (hydrated = true);
/** Images that arrive after a client navigation fade in once decoded. */
function fadeIn(img: HTMLImageElement | null) {
  if (!img || !hydrated || img.complete) return;
  img.classList.add("art-loading");
  const done = () => img.classList.replace("art-loading", "art-loaded");
  img.addEventListener("load", done, { once: true });
  img.addEventListener("error", done, { once: true });
}
export function ArtImage({
  alt = "",
  onError,
  ...props
}: ImgHTMLAttributes<HTMLImageElement>) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div
      className="art-fallback"
      role="img"
      aria-label={`${alt}（插图暂时未能读取）`}
    >
      <EchoMark />
      <span>插图暂时没有送达</span>
    </div>
  ) : (
    <img
      {...props}
      ref={fadeIn}
      alt={alt}
      src={assetURL(String(props.src || ""))}
      onError={(event) => {
        setFailed(true);
        onError?.(event);
      }}
    />
  );
}
export function TopicBadge({ id }: { id: string }) {
  return (
    <span className="topic-badge">
      <span />
      {topicName(id)}
    </span>
  );
}
export function Avatar({ comment }: { comment: Comment }) {
  return comment.author ? (
    <img
      className="avatar"
      src={comment.author.avatarUrl}
      alt=""
      width="28"
      height="28"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
    />
  ) : (
    <span className="avatar avatar-empty">·</span>
  );
}
export function Dialog({
  open,
  onClose,
  label,
  children,
  className = "",
  initialFocus,
  origin,
  headerActions,
  focusContainer = false,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  headerActions?: ReactNode;
  /** Keep focus on the modal surface initially, rather than its close button. */
  focusContainer?: boolean;
  /** Where the dialog grows from and returns to; defaults to its trigger. */
  origin?: Element | null;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    priorFocus = useRef<HTMLElement | null>(null),
    openedAt = useRef(""),
    pressedBackdrop = useRef(false),
    generation = useRef(0),
    animation = useRef<Animation | null>(null),
    veil = useRef<Animation | null>(null),
    onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const token = ++generation.current;
    animation.current?.cancel();
    veil.current?.cancel();
    // The backdrop fades with the panel; without this it pops in and out abruptly.
    const fadeBackdrop = (from: number, to: number, duration: number) => {
      veil.current = animateElement(
        dialog,
        [{ opacity: from }, { opacity: to }],
        // Hold the faded state on close so the veil cannot flash back before close().
        { duration, easing: "ease-out", pseudoElement: "::backdrop", fill: to ? "none" : "forwards" },
      );
    };
    if (open) {
      if (!dialog.open) {
        priorFocus.current = document.activeElement as HTMLElement;
        openedAt.current = location.href;
        dialog.showModal();
        document.documentElement.classList.add("dialog-open");
        if (focusContainer) dialog.focus({ preventScroll: true });
        else initialFocus?.current?.focus();
      }
      if (motionOK()) {
        fadeBackdrop(0, 1, 240);
        animation.current = animateDialog(
          dialog,
          origin || priorFocus.current,
          true,
        );
      }
    } else if (dialog.open) {
      const close = () => {
        if (token !== generation.current) return;
        veil.current?.cancel();
        dialog.close();
        if (!document.querySelector("dialog[open]"))
          document.documentElement.classList.remove("dialog-open");
        // After a navigation the router moves focus to <main>; do not pull it back.
        if (
          location.href === openedAt.current &&
          priorFocus.current?.isConnected
        )
          priorFocus.current.focus({ preventScroll: true });
      };
      if (motionOK()) {
        fadeBackdrop(1, 0, 200);
        animation.current = animateDialog(
          dialog,
          origin || priorFocus.current,
          false,
        );
        if (animation.current) animation.current.finished.then(close, close);
        else close();
      } else close();
    }
  }, [open]);
  useEffect(
    () => () => {
      generation.current++;
      animation.current?.cancel();
      veil.current?.cancel();
      ref.current?.close();
      if (!document.querySelector("dialog[open]"))
        document.documentElement.classList.remove("dialog-open");
    },
    [],
  );
  return (
    <dialog
      ref={ref}
      tabIndex={focusContainer ? -1 : undefined}
      className={`echo-dialog ${className}`}
      aria-label={label}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClose={() => {
        if (!document.querySelector("dialog[open]"))
          document.documentElement.classList.remove("dialog-open");
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === ref.current;
      }}
      onClick={(e) => {
        // Only a press that starts and ends on the backdrop closes the dialog,
        // so dragging a text selection out of the input never dismisses it.
        if (e.target === ref.current && pressedBackdrop.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onCloseRef.current();
        }
      }}
    >
      <div className="dialog-header">
        <span>{label}</span>
        <div className="dialog-header-actions">
          {headerActions}
          <button className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={19} />
          </button>
        </div>
      </div>
      {children}
    </dialog>
  );
}
export function CopyButton({
  text,
  label = "复制",
  onCopied,
  className = "quiet-button",
}: {
  text: string;
  label?: string;
  onCopied?: () => void;
  className?: string;
}) {
  const [copied, set] = useState(false),
    [error, setError] = useState(""),
    timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            set(true);
            setError("");
            onCopied?.();
            clearTimeout(timer.current);
            timer.current = setTimeout(() => set(false), 2000);
          } catch {
            clearTimeout(timer.current);
            set(false);
            setError("复制未完成，请手动选择文字。");
          }
        }}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
        <span>{copied ? "已复制" : label}</span>
      </button>
      {error && (
        <span role="status" className="small-error">
          {error}
        </span>
      )}
    </>
  );
}
/** Status message promoted to the top layer so open modal dialogs never cover it. */
export function Toast({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el?.showPopover && !el.matches(":popover-open")) el.showPopover();
  }, []);
  return (
    <div ref={ref} className="toast" role="status" popover="manual">
      {children}
    </div>
  );
}
/**
 * Further reading: same topic and shared tags score highest, newer breaks ties.
 * Adjacent posts are excluded because the neighbour links already show them.
 */
export function Related({
  post,
  exclude = [],
}: {
  post: Post;
  exclude?: string[];
}) {
  const score = (p: Post) =>
    (p.topic === post.topic ? 2 : 0) +
    p.tags.filter((t) => post.tags.includes(t)).length;
  const related = posts
    .filter((p) => p.id !== post.id && !exclude.includes(p.id))
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.p.date.localeCompare(a.p.date))
    .slice(0, 2)
    .map((x) => x.p);
  const [listRef] = useReveal<HTMLDivElement>("a", [post.id]);
  return related.length ? (
    <section className="related" aria-labelledby="related-heading">
      <h2 id="related-heading" className="eyebrow">
        延伸阅读
      </h2>
      <div className="related-list" ref={listRef}>
        {related.map((p) => (
          <Link key={p.id} href={`/post/${p.slug}`}>
            <small className="mono">
              {topicName(p.topic)} · {p.date.replaceAll("-", ".")}
            </small>
            <strong>{p.title}</strong>
            <span className="related-excerpt">{p.excerpt}</span>
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  ) : null;
}
