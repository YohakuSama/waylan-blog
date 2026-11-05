import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { MarkdownTools } from "../components/MarkdownTools";
import { readImage, pickImage } from "./helpers";
import type { Upload } from "./types";

/** Shared admin controls preserve their existing DOM/CSS and Markdown behavior. */
export function Field({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Preview({ text, uploads }: { text: string; uploads: Upload[] }) {
  return (
    <div className="preview prose">
      <ReactMarkdown
        skipHtml
        components={{
          img: ({ src, alt }) => (
            <img
              src={
                uploads.find((u) => u.path === src)?.url ??
                (typeof src === "string" ? src : undefined)
              }
              alt={alt || ""}
            />
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export function Markdown({
  label,
  value,
  onChange,
  uploads,
  onUpload,
  onError,
  rows = 22,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  uploads: Upload[];
  /** Without it the editor offers no image button. */
  onUpload?: (upload: Upload) => void;
  onError: (message: string) => void;
  rows?: number;
}) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const area = useRef<HTMLTextAreaElement>(null);
  const insertImage = () =>
    pickImage(async (file) => {
      try {
        const upload = await readImage(file);
        onUpload!(upload);
        const el = area.current,
          at = el ? el.selectionStart : value.length,
          alt = file.name.replace(/\.[^.]+$/, "").replace(/[[\]]/g, ""),
          snippet = `\n![${alt}](${upload.path})\n`;
        onChange(value.slice(0, at) + snippet + value.slice(at));
        setMode("write");
      } catch (error) {
        onError((error as Error).message);
      }
    });
  return (
    <div className="markdown">
      <div className="markdown-bar">
        <div className="segmented">
          <button
            type="button"
            className={mode === "write" ? "on" : ""}
            onClick={() => setMode("write")}
          >
            编辑
          </button>
          <button
            type="button"
            className={mode === "preview" ? "on" : ""}
            onClick={() => setMode("preview")}
          >
            预览
          </button>
        </div>
        {mode === "write" && <MarkdownTools area={area} value={value} onChange={onChange} />}
        {onUpload && (
          <button type="button" className="ghost" onClick={insertImage}>
            插入图片
          </button>
        )}
      </div>
      {mode === "write" ? (
        <textarea
          ref={area}
          aria-label={label}
          className="mono"
          rows={rows}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Preview text={value} uploads={uploads} />
      )}
    </div>
  );
}

export function Confirm({
  open,
  title,
  children,
  action,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  action: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm"
      onCancel={(e) => busy && e.preventDefault()}
      onClose={onClose}
    >
      <h2>{title}</h2>
      <div className="confirm-body">{children}</div>
      <div className="actions">
        <button type="button" className="ghost" onClick={onClose} disabled={busy}>
          取消
        </button>
        <button type="button" className="danger" onClick={onConfirm} disabled={busy}>
          {busy ? "处理中…" : action}
        </button>
      </div>
    </dialog>
  );
}

