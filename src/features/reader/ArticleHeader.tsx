import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import type { Post } from "../../../shared/types";
import { site, dateLabel, typeLabels } from "../../lib/data";
import { viewsLabel } from "../../lib/views";
import { Avatar as AuthorAvatar } from "../../components/Avatar";
import { TopicBadge } from "../../components/UI";

/** Self-contained article metadata; visual DOM and CSS hooks remain unchanged. */
export function ArticleHeader({
  post,
  viewCount,
  onBack,
  bookmark,
}: {
  post: Post;
  viewCount?: number;
  onBack: () => void;
  bookmark?: ReactNode;
}) {
  return (
            <header className="article-heading">
              <button className="reader-back text-button" type="button"
                aria-label="返回上一页" onClick={onBack}>
                <ArrowLeft size={16} /> 返回上一页
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
              <div className="article-heading-bottom">
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
                {bookmark && <div className="article-heading-save">{bookmark}</div>}
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
  );
}
