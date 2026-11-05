import { useCallback, useEffect, useState } from "react";
import { contentTypes, typeLabels, type ContentType } from "../../shared/types";
import { str, toData, toForm, type Form } from "./form";
import { adminApi as api } from "./api";
import { readImage, pickImage, today, usedUploads, useLeaveGuard, useSaveKey } from "./helpers";
import { Field, Markdown } from "./ui";
import type { Overview, Upload } from "./types";

/** Post editing owns only the post draft, image staging and save transaction. */
export function PostEditor({
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
              <span className="warn">保存后旧地址会自动通过 301 跳转到新链接。</span>
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
        label="文章正文（Markdown）"
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

