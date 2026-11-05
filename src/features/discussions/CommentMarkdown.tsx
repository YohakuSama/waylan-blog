import ReactMarkdown from "react-markdown";

/** Composer preview and published comments share exactly the same safe renderer. */
export function CommentMarkdown({ body, preview = false }: { body: string; preview?: boolean }) {
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
