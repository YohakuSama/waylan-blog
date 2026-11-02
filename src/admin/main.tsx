// The /admin page: edits the site's source through /api/admin/*. Every save is a
// commit to the content repository; Cloudflare rebuilds the site from it. This
// bundle is separate from the public site and never loads its content data.
import {
  StrictMode,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import {
  contentTypes,
  typeLabels,
  type Author,
  type ContentType,
} from "../../shared/types";
import { MAX_IMAGE, toBase64, uploadPath } from "../../shared/uploads";
import { list, str, toData, toForm, type Form } from "./form";
import "./admin.css";

try {
  const theme = JSON.parse(localStorage.getItem("echo:theme") || "null");
  document.documentElement.dataset.theme =
    theme === "light" || theme === "dark"
      ? theme
      : matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}

// ---------------------------------------------------------------- API

type Session = {
  configured: boolean;
  missing: string[];
  user: Author | null;
  admin: boolean;
  csrf?: string;
};
type Status = { head: { oid: string; date: string }; live: string | null };
type Summary = {
  file: string;
  oid: string;
  title: string;
  id?: string;
  slug?: string;
  type?: ContentType;
  date?: string;
  topic?: string;
  draft?: boolean;
  error?: string;
};
type Socials = { label?: string; url: string }[];
type SiteData = Record<string, unknown> & {
  name?: string;
  author?: string;
  tagline?: string;
  description?: string;
  intro?: string;
  avatar?: string;
  profileTags?: string[];
  socials?: Socials;
};
type Overview = Status & {
  repo: { name: string; branch: string };
  site: { oid: string; data: SiteData };
  about: { oid: string | null; text: string };
  topics: { id: string; name: string }[];
  posts: Summary[];
  discussions: { enabled: boolean; pending: { id: string; title: string }[] };
};
/** An image picked in this session; `sent` once committed, kept for previews until the site rebuilds. */
type Upload = { path: string; data: string; url: string; sent?: boolean };

class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
let csrf = "";
async function api<T>(path: string, method = "GET", body?: unknown) {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      signal: AbortSignal.timeout(90_000),
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("网络没有回应，请检查网络后重试。", 0);
  }
  const data = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  if (!response.ok)
    throw new ApiError(
      data?.message || `请求失败（${response.status}），请稍后重试。`,
      response.status,
    );
  return data as T;
}

// ---------------------------------------------------------------- helpers

const today = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
};
const ago = (date: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(date)) / 60000));
  return minutes < 1
    ? "刚刚"
    : minutes < 60
      ? `${minutes} 分钟前`
      : minutes < 1440
        ? `${Math.round(minutes / 60)} 小时前`
        : `${Math.round(minutes / 1440)} 天前`;
};

/** Reads an image chosen by the author into an upload, or explains why not. */
async function readImage(file: File): Promise<Upload> {
  if (file.size > MAX_IMAGE) throw new Error("单张图片不能超过 5 MB。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const path = await uploadPath(bytes);
  if (!path) throw new Error("只支持 PNG、JPG、GIF、WebP、AVIF 图片。");
  const data = toBase64(bytes),
    ext = path.split(".").pop()!;
  return {
    path,
    data,
    url: `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${data}`,
  };
}
function pickImage(onPick: (file: File) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp,image/avif";
  input.onchange = () => input.files?.[0] && onPick(input.files[0]);
  input.click();
}
/** Uploads still referenced by the text being saved. */
function usedUploads(uploads: Upload[], text: string) {
  const used = uploads
    .filter((u) => !u.sent && text.includes(u.path))
    .filter((u, i, all) => all.findIndex((x) => x.path === u.path) === i);
  if (used.length > 8) throw new Error("一次最多保存 8 张新图片，请分几次保存。");
  if (used.reduce((n, u) => n + u.data.length, 0) > 15 * 1024 * 1024)
    throw new Error("新图片总量太大，请分几次保存。");
  return used.map(({ path, data }) => ({ path, data }));
}

/** Warns before leaving a page that has unsaved edits. */
function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const stop = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", stop);
    return () => removeEventListener("beforeunload", stop);
  }, [dirty]);
}
function useSaveKey(save: () => void) {
  const ref = useRef(save);
  ref.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        ref.current();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
}

// ---------------------------------------------------------------- pieces

function Field({
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

function Preview({ text, uploads }: { text: string; uploads: Upload[] }) {
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

function Markdown({
  value,
  onChange,
  uploads,
  onUpload,
  onError,
  rows = 22,
}: {
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
        {onUpload && (
          <button type="button" className="ghost" onClick={insertImage}>
            插入图片
          </button>
        )}
      </div>
      {mode === "write" ? (
        <textarea
          ref={area}
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

function Confirm({
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

// ---------------------------------------------------------------- post editor

function PostEditor({
  file: initialFile,
  overview,
  onSaved,
  onClose,
  notify,
}: {
  file: string | null;
  overview: Overview;
  onSaved: () => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [file, setFile] = useState(initialFile);
  const [oid, setOid] = useState<string | null>(null);
  const [original, setOriginal] = useState<Record<string, unknown>>({});
  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const stem = (file || "").replace(/\.md$/, "");

  const load = useCallback(async () => {
    setLoadError("");
    setForm(null);
    if (!file) {
      const blank = toForm(
        { date: today(), topic: overview.topics[0]?.id || "" },
        "",
        "",
      );
      setOriginal({});
      setForm(blank);
      setSaved(JSON.stringify(blank));
      return;
    }
    try {
      const post = await api<{
        oid: string;
        data: Record<string, unknown>;
        body: string;
      }>(`/api/admin/post?file=${encodeURIComponent(file)}`);
      const next = toForm(post.data, post.body, file.replace(/\.md$/, ""));
      setOid(post.oid);
      setOriginal(post.data);
      setForm(next);
      setSaved(JSON.stringify(next));
    } catch (e) {
      setLoadError((e as Error).message);
    }
    // The editor loads once per file; later saves update state directly.
  }, [initialFile]);
  useEffect(() => {
    load();
  }, [load]);

  const dirty = !!form && JSON.stringify(form) !== saved;
  useLeaveGuard(dirty);

  const save = async () => {
    if (!form || busy || (file && !dirty)) return;
    setError("");
    let body: {
      file?: string;
      oid?: string | null;
      data: Record<string, unknown>;
      body: string;
      uploads: { path: string; data: string }[];
    };
    try {
      body = {
        ...(file ? { file, oid } : {}),
        data: toData(form, original, stem),
        body: form.body,
        uploads: usedUploads(uploads, `${form.body}\n${form.cover}`),
      };
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ file: string; oid: string; commit: string }>(
        "/api/admin/post",
        "PUT",
        body,
      );
      setFile(result.file);
      setOid(result.oid);
      setOriginal(body.data);
      setSaved(JSON.stringify(form));
      const sent = body.uploads.map((u) => u.path);
      setUploads((all) => all.map((u) => (sent.includes(u.path) ? { ...u, sent: true } : u)));
      notify(file ? "已保存，网站会在一两分钟后更新。" : "已发布，网站会在一两分钟后更新。");
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useSaveKey(save);

  if (loadError)
    return (
      <section className="panel">
        <p className="error">{loadError}</p>
        <div className="actions">
          <button className="ghost" onClick={onClose}>
            返回列表
          </button>
          <button onClick={load}>重试</button>
        </div>
      </section>
    );
  if (!form) return <p className="muted pad">正在读取…</p>;

  const update = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));
  const addUpload = (upload: Upload) =>
    setUploads((all) => [...all.filter((u) => u.path !== upload.path), upload]);
  const leave = () => {
    if (!dirty || confirm("有改动还没有保存，确定离开吗？")) onClose();
  };
  const slugChanged = !!file && form.slug !== (str(original.slug) || stem);
  const coverURL =
    uploads.find((u) => u.path === form.cover)?.url || form.cover || "";

  return (
    <section className="editor">
      <div className="editor-head">
        <button className="ghost" onClick={leave} disabled={busy}>
          ← 返回
        </button>
        <h1>{file ? "编辑" : "写新内容"}</h1>
        <span className="spacer" />
        {dirty && <span className="muted">有未保存的改动</span>}
        {file && !form.draft && (
          <a className="ghost button" href={`/post/${str(original.slug) || stem}`} target="_blank" rel="noreferrer">
            查看线上
          </a>
        )}
        <button onClick={save} disabled={busy || (!!file && !dirty)}>
          {busy ? "提交中…" : file ? "保存" : "发布"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="grid">
        <Field label="标题" wide>
          <input value={form.title} onChange={(e) => update("title", e.target.value)} />
        </Field>
        <Field
          label="链接名（slug）"
          hint={
            slugChanged ? (
              <span className="warn">修改后旧链接会失效，已分享出去的地址将打不开。</span>
            ) : (
              <>文章地址是 /post/{form.slug || "…"}，只能用小写英文、数字和连字符。</>
            )
          }
        >
          <input
            value={form.slug}
            placeholder="my-first-post"
            onChange={(e) => update("slug", e.target.value.trim().toLowerCase())}
          />
        </Field>
        <Field label="类型">
          <select
            value={form.type}
            onChange={(e) => update("type", e.target.value as ContentType)}
          >
            {contentTypes.map((t) => (
              <option key={t} value={t}>
                {typeLabels[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="分区">
          <select value={form.topic} onChange={(e) => update("topic", e.target.value)}>
            {!overview.topics.some((t) => t.id === form.topic) && (
              <option value={form.topic}>{form.topic || "请选择"}</option>
            )}
            {overview.topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="发布日期">
          <input type="date" value={form.date} onChange={(e) => update("date", e.target.value)} />
        </Field>
        <Field label="更新日期" hint="有实质修改时填写，可留空。">
          <input
            type="date"
            value={form.updated}
            onChange={(e) => update("updated", e.target.value)}
          />
        </Field>
        <Field label="标签" hint="用逗号分隔。">
          <input value={form.tags} onChange={(e) => update("tags", e.target.value)} />
        </Field>
        <Field label="摘要" wide hint="留空时自动取正文开头。">
          <textarea rows={2} value={form.excerpt} onChange={(e) => update("excerpt", e.target.value)} />
        </Field>
        <Field label="封面" wide>
          <div className="cover">
            {coverURL && <img src={coverURL} alt="" />}
            <div className="cover-actions">
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  pickImage(async (f) => {
                    try {
                      const upload = await readImage(f);
                      addUpload(upload);
                      update("cover", upload.path);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  })
                }
              >
                {form.cover ? "更换封面" : "上传封面"}
              </button>
              {form.cover && (
                <button type="button" className="ghost" onClick={() => update("cover", "")}>
                  移除封面
                </button>
              )}
              {form.cover && (
                <input
                  value={form.coverAlt}
                  placeholder="封面说明（必填，读屏软件会朗读）"
                  onChange={(e) => update("coverAlt", e.target.value)}
                />
              )}
            </div>
          </div>
        </Field>
        {form.type === "project" && (
          <>
            <Field label="项目状态" hint="例如：进行中、已上线。">
              <input value={form.status} onChange={(e) => update("status", e.target.value)} />
            </Field>
            <Field label="技术栈" hint="用逗号分隔，至少一项。">
              <input value={form.stack} onChange={(e) => update("stack", e.target.value)} />
            </Field>
            <Field label="代码仓库" hint="https:// 开头，可留空。">
              <input value={form.repo} onChange={(e) => update("repo", e.target.value)} />
            </Field>
            <Field label="演示地址" hint="https:// 开头，可留空。">
              <input value={form.demo} onChange={(e) => update("demo", e.target.value)} />
            </Field>
          </>
        )}
        <div className="checks wide">
          <label>
            <input
              type="checkbox"
              checked={form.featured}
              onChange={(e) => update("featured", e.target.checked)}
            />
            精选
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.draft}
              onChange={(e) => update("draft", e.target.checked)}
            />
            草稿（不在网站上显示）
          </label>
        </div>
      </div>
      <Markdown
        value={form.body}
        onChange={(v) => update("body", v)}
        uploads={uploads}
        onUpload={addUpload}
        onError={setError}
      />
      <p className="muted small">
        正文是 Markdown。&lt;!-- block:… --&gt; 是段落锚点，用来对应读者的划线与评论，请保留。按 Ctrl+S 保存。
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- site editor

type SiteForm = {
  name: string;
  author: string;
  tagline: string;
  description: string;
  intro: string;
  avatar: string;
  profileTags: string;
  socials: { label: string; url: string }[];
  about: string;
};
const toSiteForm = (o: Overview): SiteForm => ({
  name: str(o.site.data.name),
  author: str(o.site.data.author),
  tagline: str(o.site.data.tagline),
  description: str(o.site.data.description),
  intro: str(o.site.data.intro),
  avatar: str(o.site.data.avatar),
  profileTags: str(o.site.data.profileTags),
  socials: (o.site.data.socials || []).map((s) => ({
    label: s.label || "",
    url: s.url || "",
  })),
  about: o.about.text.replace(/\n$/, ""),
});

function SiteEditor({
  overview,
  onSaved,
  onClose,
  notify,
}: {
  overview: Overview;
  onSaved: () => Promise<void>;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [form, setForm] = useState(() => toSiteForm(overview));
  const [saved, setSaved] = useState(() => JSON.stringify(form));
  const [oids, setOids] = useState({ oid: overview.site.oid, aboutOid: overview.about.oid });
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== saved;
  useLeaveGuard(dirty);
  const update = <K extends keyof SiteForm>(key: K, value: SiteForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setSocial = (i: number, key: "label" | "url", value: string) =>
    update(
      "socials",
      form.socials.map((s, j) => (j === i ? { ...s, [key]: value } : s)),
    );

  const save = async () => {
    if (busy || !dirty) return;
    setError("");
    let body: {
      oid: string;
      aboutOid: string | null;
      site: Record<string, unknown>;
      about: string;
      uploads: { path: string; data: string }[];
    };
    try {
      body = {
        ...oids,
        site: {
          name: form.name,
          author: form.author,
          tagline: form.tagline,
          description: form.description,
          intro: form.intro,
          avatar: form.avatar,
          profileTags: list(form.profileTags),
          socials: form.socials
            .filter((s) => s.url.trim() || s.label.trim())
            .map((s) => ({ label: s.label, url: s.url })),
        },
        about: form.about,
        uploads: usedUploads(uploads, form.avatar),
      };
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ oid: string; aboutOid: string | null; commit: string | null }>(
        "/api/admin/site",
        "PUT",
        body,
      );
      setOids({ oid: result.oid, aboutOid: result.aboutOid });
      setSaved(JSON.stringify(form));
      const sent = body.uploads.map((u) => u.path);
      setUploads((all) => all.map((u) => (sent.includes(u.path) ? { ...u, sent: true } : u)));
      notify(result.commit ? "已保存，网站会在一两分钟后更新。" : "内容没有变化。");
      if (result.commit) await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useSaveKey(save);
  const leave = () => {
    if (!dirty || confirm("有改动还没有保存，确定离开吗？")) onClose();
  };
  const avatarURL = uploads.find((u) => u.path === form.avatar)?.url || form.avatar;

  return (
    <section className="editor">
      <div className="editor-head">
        <button className="ghost" onClick={leave} disabled={busy}>
          ← 返回
        </button>
        <h1>站点资料</h1>
        <span className="spacer" />
        {dirty && <span className="muted">有未保存的改动</span>}
        <button onClick={save} disabled={busy || !dirty}>
          {busy ? "提交中…" : "保存"}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="grid">
        <Field label="头像" wide>
          <div className="cover">
            {avatarURL ? (
              <img className="avatar" src={avatarURL} alt="" />
            ) : (
              <span className="avatar empty">{form.author.slice(0, 1) || "?"}</span>
            )}
            <div className="cover-actions">
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  pickImage(async (f) => {
                    try {
                      const upload = await readImage(f);
                      setUploads((all) => [...all.filter((u) => u.path !== upload.path), upload]);
                      update("avatar", upload.path);
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  })
                }
              >
                上传新头像
              </button>
              {form.avatar && (
                <button type="button" className="ghost" onClick={() => update("avatar", "")}>
                  改用文字头像
                </button>
              )}
              <span className="field-hint">建议使用正方形图片，不超过 5 MB。</span>
            </div>
          </div>
        </Field>
        <Field label="站点名称" hint="显示在导航栏和浏览器标签上。">
          <input value={form.name} onChange={(e) => update("name", e.target.value)} />
        </Field>
        <Field label="作者名">
          <input value={form.author} onChange={(e) => update("author", e.target.value)} />
        </Field>
        <Field label="一句话介绍" wide>
          <input value={form.tagline} onChange={(e) => update("tagline", e.target.value)} />
        </Field>
        <Field label="站点描述" wide hint="用于搜索引擎和分享卡片。">
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
          />
        </Field>
        <Field label="首页介绍" wide>
          <textarea rows={3} value={form.intro} onChange={(e) => update("intro", e.target.value)} />
        </Field>
        <Field label="个人标签" wide hint="用逗号分隔，最多 12 个。">
          <input
            value={form.profileTags}
            onChange={(e) => update("profileTags", e.target.value)}
          />
        </Field>
        <div className="field wide">
          <span className="field-label">联系方式</span>
          {form.socials.map((s, i) => (
            <div className="social-row" key={i}>
              <input
                value={s.url}
                placeholder="https://github.com/… 或邮箱地址"
                onChange={(e) => setSocial(i, "url", e.target.value)}
              />
              <input
                value={s.label}
                placeholder="名称（可留空，自动识别）"
                onChange={(e) => setSocial(i, "label", e.target.value)}
              />
              <button
                type="button"
                className="ghost"
                aria-label="删除这一行"
                onClick={() => update("socials", form.socials.filter((_, j) => j !== i))}
              >
                删除
              </button>
            </div>
          ))}
          {form.socials.length < 12 && (
            <button
              type="button"
              className="ghost add"
              onClick={() => update("socials", [...form.socials, { label: "", url: "" }])}
            >
              添加一行
            </button>
          )}
        </div>
      </div>
      <h2 className="section-title">关于页</h2>
      <Markdown
        value={form.about}
        onChange={(v) => update("about", v)}
        uploads={uploads}
        onError={setError}
        rows={14}
      />
    </section>
  );
}

// ---------------------------------------------------------------- dashboard

function DeployStatus({ status }: { status: Status }) {
  if (!status.live)
    return (
      <span className="status">
        最近一次提交 {ago(status.head.date)}。线上版本未记录提交号，请在 Cloudflare 查看构建进度。
      </span>
    );
  if (status.live === status.head.oid)
    return <span className="status ok">线上已是最新版本</span>;
  const late = Date.now() - Date.parse(status.head.date) > 10 * 60_000;
  return late ? (
    <span className="status bad">
      最近一次提交（{ago(status.head.date)}）还没有上线，请到 Cloudflare 的 Workers Builds 查看构建日志。
    </span>
  ) : (
    <span className="status busy">网站正在重新构建，一两分钟后生效…</span>
  );
}

function Posts({
  overview,
  onEdit,
  onDeleted,
  notify,
}: {
  overview: Overview;
  onEdit: (file: string | null) => void;
  onDeleted: () => void;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const q = query.trim().toLowerCase();
  const shown = overview.posts.filter(
    (p) =>
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.file.toLowerCase().includes(q) ||
      (p.topic || "").toLowerCase().includes(q),
  );
  const topicName = (id?: string) => overview.topics.find((t) => t.id === id)?.name || id;
  const remove = async () => {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/post", "DELETE", { file: target.file, oid: target.oid });
      notify(`已删除「${target.title}」，网站会在一两分钟后更新。`);
      setTarget(null);
      onDeleted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>内容（{overview.posts.length}）</h2>
        <input
          type="search"
          placeholder="搜索标题、文件名或分区"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={() => onEdit(null)}>写新内容</button>
      </div>
      {!shown.length && <p className="muted pad">没有找到。</p>}
      <ul className="posts">
        {shown.map((p) => (
          <li key={p.file}>
            <div className="post-main">
              <button className="link" onClick={() => onEdit(p.file)}>
                {p.title}
              </button>
              <div className="post-meta">
                {p.type && <span className="badge">{typeLabels[p.type]}</span>}
                {p.draft && <span className="badge draft">草稿</span>}
                {p.error && <span className="badge bad">有问题：{p.error}</span>}
                <span>{p.date}</span>
                {p.topic && <span>{topicName(p.topic)}</span>}
                <span className="mono">{p.file}</span>
              </div>
            </div>
            <div className="post-actions">
              {p.slug && !p.draft && !p.error && (
                <a className="ghost button" href={`/post/${p.slug}`} target="_blank" rel="noreferrer">
                  查看
                </a>
              )}
              <button className="ghost" onClick={() => onEdit(p.file)}>
                编辑
              </button>
              <button
                className="ghost danger-text"
                onClick={() => {
                  setError("");
                  setTarget(p);
                }}
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
      <Confirm
        open={!!target}
        title="删除这篇内容？"
        action="删除"
        busy={busy}
        onConfirm={remove}
        onClose={() => !busy && setTarget(null)}
      >
        <p>
          「{target?.title}」将从网站移除。它的评论仍保留在 GitHub Discussions 中；如需恢复，可在仓库的提交历史里找回。
        </p>
        {error && <p className="error">{error}</p>}
      </Confirm>
    </section>
  );
}

function Discussions({
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
      let created = 0;
      for (let round = 0; round < 50; round++) {
        const result = await api<{ created: number; remaining: number }>(
          "/api/admin/discussions",
          "POST",
          {},
        );
        created += result.created;
        if (!result.remaining) break;
      }
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

type View = { name: "list" } | { name: "post"; file: string | null; key: number } | { name: "site" };

function Dashboard({ session }: { session: Session }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>({ name: "list" });
  const [toast, setToast] = useState("");
  const toastTimer = useRef(0);
  const notify = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 5000);
  };
  // Refreshes can overlap (save, then leave); only the latest one may land.
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const run = ++latest.current;
    try {
      const next = await api<Overview>("/api/admin/content");
      if (run !== latest.current) return;
      setOverview(next);
      setStatus({ head: next.head, live: next.live });
      setError("");
    } catch (e) {
      if (run === latest.current) setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // While a commit is waiting to go live, check every 30 seconds.
  const pendingDeploy = !!status?.live && status.live !== status.head.oid;
  useEffect(() => {
    if (!pendingDeploy) return;
    const timer = setInterval(async () => {
      try {
        setStatus(await api<Status>("/api/admin/status"));
      } catch {}
    }, 30_000);
    return () => clearInterval(timer);
  }, [pendingDeploy]);
  // Once the new build is live, reload so lists reflect it (e.g. discussions).
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pendingDeploy && view.name === "list") refresh();
    wasPending.current = pendingDeploy;
  }, [pendingDeploy, refresh, view.name]);

  const logout = async () => {
    try {
      await api("/api/logout", "POST", {});
    } catch {}
    location.reload();
  };
  const siteName = str(overview?.site.data.name) || "网站";

  useEffect(() => {
    document.title = `后台 · ${siteName}`;
  }, [siteName]);

  return (
    <div className="shell">
      <header className="top">
        <strong className="top-title">{siteName} · 后台</strong>
        {overview && (
          <span className="muted small mono">
            {overview.repo.name}@{overview.repo.branch}
          </span>
        )}
        <span className="spacer" />
        <a href="/" target="_blank" rel="noreferrer">
          查看网站
        </a>
        {session.user && (
          <span className="user">
            <img src={session.user.avatarUrl} alt="" />
            <span className="user-name">{session.user.login}</span>
          </span>
        )}
        <button className="ghost" onClick={logout}>
          退出
        </button>
      </header>
      <main>
        {status && (
          <div className="deploy">
            <DeployStatus status={status} />
          </div>
        )}
        {error && (
          <div className="panel">
            <p className="error">{error}</p>
            <button onClick={refresh}>重试</button>
          </div>
        )}
        {!overview && !error && <p className="muted pad">正在读取仓库…</p>}
        {overview && view.name === "list" && (
          <>
            <Discussions overview={overview} onDone={refresh} notify={notify} />
            <section className="panel site-card">
              <div>
                <h2>站点资料</h2>
                <p className="muted">名称、作者、头像、介绍、联系方式和关于页。</p>
              </div>
              <button className="ghost" onClick={() => setView({ name: "site" })}>
                编辑
              </button>
            </section>
            <Posts
              overview={overview}
              onEdit={(file) => setView({ name: "post", file, key: Date.now() })}
              onDeleted={refresh}
              notify={notify}
            />
          </>
        )}
        {overview && view.name === "post" && (
          <PostEditor
            key={view.key}
            file={view.file}
            overview={overview}
            onSaved={refresh}
            onClose={() => {
              setView({ name: "list" });
              refresh();
            }}
            notify={notify}
          />
        )}
        {overview && view.name === "site" && (
          <SiteEditor
            overview={overview}
            onSaved={refresh}
            onClose={() => setView({ name: "list" })}
            notify={notify}
          />
        )}
      </main>
      <div className={toast ? "toast show" : "toast"} role="status">
        {toast}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- gate

function Gate() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const next = await api<Session>("/api/admin/session");
      csrf = next.csrf || "";
      setSession(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (error)
    return (
      <Card title="后台暂时打不开">
        <p className="error">{error}</p>
        <button onClick={load}>重试</button>
      </Card>
    );
  if (!session) return <p className="muted pad center">正在连接…</p>;
  if (!session.configured)
    return (
      <Card title="后台还没有配置完成">
        <p>请在 Cloudflare 中为这个 Worker 设置以下变量或密钥，然后重新部署：</p>
        <ul className="mono">
          {session.missing.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
        <p className="muted">详细步骤见源码中的 README「网页后台」一节。</p>
      </Card>
    );
  if (!session.user)
    return (
      <Card title="登录后台">
        <p>使用有管理权限的 GitHub 账号登录。</p>
        <a className="button" href="/api/auth/github?return=/admin">
          使用 GitHub 登录
        </a>
      </Card>
    );
  if (!session.admin)
    return (
      <Card title="没有管理权限">
        <p>
          当前登录的 GitHub 账号 <strong>@{session.user.login}</strong> 不在管理员名单（ADMIN_GITHUB_LOGINS）中。
        </p>
        <button
          className="ghost"
          onClick={async () => {
            try {
              await api("/api/logout", "POST", {});
            } catch {}
            location.reload();
          }}
        >
          换个账号
        </button>
      </Card>
    );
  return <Dashboard session={session} />;
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gate">
      <section className="panel">
        <h1>{title}</h1>
        {children}
      </section>
    </div>
  );
}

createRoot(document.getElementById("admin")!).render(
  <StrictMode>
    <Gate />
  </StrictMode>,
);
