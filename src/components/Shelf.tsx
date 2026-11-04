import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Bookmark, Shuffle, X } from "lucide-react";
import { posts, topicName, typeLabels } from "../lib/data";
import { Link, useRouter } from "../lib/router";
import { shelf, useShelf } from "../lib/shelf";
import { motionAllowed } from "../lib/motion";
import { Dialog } from "./UI";
import type { Post } from "../../shared/types";

const bySlug = new Map(posts.map((p) => [p.slug, p]));

/** Toggles a post on the device-local reading shelf. */
export function BookmarkButton({
  post,
  className = "",
  showLabel = false,
}: {
  post: Post;
  className?: string;
  showLabel?: boolean;
}) {
  const saved = useShelf().includes(post.slug);
  return (
    <button
      type="button"
      className={`bookmark-button${saved ? " is-saved" : ""} ${className}`}
      aria-pressed={saved}
      aria-label={saved ? `从阅读清单移除：${post.title}` : `加入阅读清单：${post.title}`}
      data-tip={saved ? "已在阅读清单" : "稍后再读"}
      onClick={() => {
        if (!shelf.toggle(post.slug))
          window.alert("当前浏览器不允许保存数据，阅读清单无法保留。");
      }}
    >
      <Bookmark size={17} aria-hidden="true" />
      {showLabel && <span className="bookmark-action-label">{saved ? "已收藏本文" : "收藏本文"}</span>}
    </button>
  );
}

/** Two-step destructive button: the first press arms it, the second confirms. */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = "",
  icon,
}: {
  icon?: ReactNode;
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3200);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={`confirm-button${armed ? " armed" : ""} ${className}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      onBlur={() => setArmed(false)}
    >
      {icon}
      {armed ? confirmLabel : label}
    </button>
  );
}

export function ShelfTrigger() {
  const list = useShelf(),
    router = useRouter(),
    [open, setOpen] = useState(false);
  const items = list.map((s) => bySlug.get(s)).filter((p): p is Post => !!p);
  // Leaving the page through any link closes the shelf.
  const path = useRef(router.path);
  useEffect(() => {
    if (path.current !== router.path) setOpen(false);
    path.current = router.path;
  }, [router.path]);
  return (
    <>
      <button
        type="button"
        className="icon-button shelf-trigger"
        aria-label={`阅读清单${items.length ? `，${items.length} 条` : ""}`}
        data-tip="阅读清单 · 仅保存在此浏览器"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Bookmark size={18} aria-hidden="true" />
        {items.length > 0 && (
          <span className="shelf-count mono" aria-hidden="true">
            {items.length > 99 ? "99+" : items.length}
          </span>
        )}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label="阅读清单"
        className="shelf-dialog"
      >
        <p className="shelf-intro">
          稍后阅读的内容，只保存在这台设备的浏览器里，不会上传。
        </p>
        {items.length ? (
          <ol className="shelf-items">
            {items.map((p) => (
              <li key={p.slug}>
                <Link href={`/post/${p.slug}`}>
                  <small className="mono">
                    {typeLabels[p.type]} · {topicName(p.topic)} · {p.date}
                  </small>
                  <strong>{p.title}</strong>
                </Link>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`移除：${p.title}`}
                  data-tip="移除"
                  onClick={() => {
                    if (!shelf.remove(p.slug))
                      window.alert("无法更新阅读清单：浏览器未能保存更改。");
                  }}
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="shelf-empty">
            <Bookmark size={22} aria-hidden="true" />
            <strong>清单还是空的</strong>
            <p>在文章卡片或正文顶部点一下书签图标，就能把它放进这里。</p>
          </div>
        )}
        <footer className="shelf-footer">
          <button
            type="button"
            className="primary-button"
            disabled={!items.length}
            onClick={() => {
              const pick = items[Math.floor(Math.random() * items.length)];
              if (pick) router.navigate(`/post/${pick.slug}`);
            }}
          >
            <Shuffle size={15} />
            随机阅读一条
          </button>
          {items.length > 0 && (
            <ConfirmButton
              className="text-button"
              label="清空清单"
              confirmLabel="再按一次清空"
              onConfirm={() => {
                if (!shelf.clear())
                  window.alert("无法清空阅读清单：浏览器未能保存更改。");
              }}
            />
          )}
        </footer>
      </Dialog>
    </>
  );
}

/** Quiet return-to-top for long list pages; posts already have one in the TOC. */
export function BackToTop() {
  const router = useRouter(),
    [show, setShow] = useState(false),
    onPost = router.path.startsWith("/post/");
  useEffect(() => {
    if (onPost) return setShow(false);
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setShow(window.scrollY > 720));
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", check);
    };
  }, [onPost]);
  return (
    <button
      type="button"
      className={`back-to-top${show ? " visible" : ""}`}
      aria-label="回到页首"
      data-tip="回到页首"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      onClick={() =>
        window.scrollTo({ top: 0, behavior: motionAllowed() ? "smooth" : "instant" })
      }
    >
      <ArrowUp size={18} />
    </button>
  );
}
