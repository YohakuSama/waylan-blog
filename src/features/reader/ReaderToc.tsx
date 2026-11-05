import type { RefObject } from "react";
import { ArrowUp, Highlighter, X } from "lucide-react";
import type { Post } from "../../../shared/types";
import { wordCount, wordsLabel } from "../../lib/data";
import { viewsLabel } from "../../lib/views";
import { motionAllowed } from "../../lib/motion";

/** TOC presentation owns its markup; Reader owns scroll and focus state. */
export function ReaderToc({
  post, tocRef, open, activeSection, progress, viewCount, excerptMode,
  onClose, onSelectSection, onToggleExcerpt,
}: {
  post: Post;
  tocRef: RefObject<HTMLElement | null>;
  open: boolean;
  activeSection: string;
  progress: number;
  viewCount?: number;
  excerptMode: boolean;
  onClose: () => void;
  onSelectSection: (id: string) => void;
  onToggleExcerpt: () => void;
}) {
  return (
        <aside id="reader-toc" ref={tocRef} aria-label={post.toc.length ? "本文目录" : "阅读进度"}
          className={`reader-toc ${open ? "toc-visible" : ""}`}>
          <div className="toc-inner">
            <div className="eyebrow">
              {post.toc.length ? "本文目录" : "阅读进度"}
              <button
                className="icon-button"
                onClick={onClose}
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
                    onClick={(event) => {
                      event.preventDefault();
                      onSelectSection(t.id);
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
                onClick={onToggleExcerpt}>
                <Highlighter size={15} aria-hidden="true" />
                {excerptMode ? "退出摘录模式" : "开启摘录段落模式"}
              </button>
              <button
                className="text-button"
                onClick={() => {
                   onClose();
                   window.scrollTo({
                     top: 0,
                     behavior: motionAllowed() ? "smooth" : "instant",
                   });
                 }}
              >
                回到页首
                <ArrowUp size={14} />
              </button>
            </div>
          </div>
        </aside>
  );
}
