import { useState } from "react";
import { parseAnnouncements, type Announcement } from "../../shared/announcements";
import { list, str } from "./form";
import { adminApi as api } from "./api";
import { readImage, pickImage, usedUploads, useLeaveGuard, useSaveKey } from "./helpers";
import { Field, Markdown } from "./ui";
import type { Overview, Upload } from "./types";

/** Site identity, public announcements and About are one versioned site.json save. */
type AnnouncementForm = Pick<Announcement, "id" | "title" | "body" | "priority" | "published" | "link">;
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
  announcements: AnnouncementForm[];
};
export const toSiteForm = (o: Overview): SiteForm => ({
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
  announcements: parseAnnouncements(o.site.data.announcements).map(
    ({ id, title, body, priority, published, link }) => ({ id, title, body, priority, published, link }),
  ),
});

export function SiteEditor({
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
  const updateAnnouncement = (i: number, patch: Partial<AnnouncementForm>) =>
    update("announcements", form.announcements.map((item, index) =>
      index === i ? { ...item, ...patch } : item,
    ));
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
          // Revision and update date are assigned by the Worker after comparing
          // with the current repository version, never trusted from the browser.
          announcements: form.announcements,
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
      <section className="admin-announcements" aria-labelledby="site-announcements-title">
        <h2 className="section-title" id="site-announcements-title">站点公告</h2>
        <p className="field-hint">公告随网站部署发布，不需要读者登录。普通公告只进铃铛，重要公告显示横幅，紧急公告在首次访问时弹出。修改已发布内容会自动更新版本，重新提示读者。</p>
        {form.announcements.map((item, i) => (
          <fieldset className="announcement-editor" key={item.id}>
            <legend>公告 {i + 1}</legend>
            <label>标题
              <input maxLength={80} value={item.title}
                onChange={(e) => updateAnnouncement(i, { title: e.target.value })} />
            </label>
            <label>正文（纯文本）
              <textarea maxLength={1800} rows={4} value={item.body}
                onChange={(e) => updateAnnouncement(i, { body: e.target.value })} />
            </label>
            <div className="announcement-editor-row">
              <label>显示级别
                <select value={item.priority}
                  onChange={(e) => updateAnnouncement(i, { priority: e.target.value as AnnouncementForm["priority"] })}>
                  <option value="normal">普通：仅公告列表</option>
                  <option value="important">重要：公告列表 + 横幅</option>
                  <option value="urgent">紧急：公告列表 + 横幅 + 首次弹窗</option>
                </select>
              </label>
              <label>相关链接（可选）
                <input maxLength={300} value={item.link} placeholder="/post/… 或 https://…"
                  onChange={(e) => updateAnnouncement(i, { link: e.target.value })} />
              </label>
            </div>
            <div className="announcement-editor-actions">
              <label className="announcement-published">
                <input type="checkbox" checked={item.published}
                  onChange={(e) => updateAnnouncement(i, { published: e.target.checked })} />
                已发布（取消勾选即撤回）
              </label>
              <button type="button" className="ghost danger-text" onClick={() =>
                update("announcements", form.announcements.filter((_, index) => index !== i))
              }>删除公告</button>
            </div>
          </fieldset>
        ))}
        {form.announcements.length < 12 && (
          <button type="button" className="ghost" onClick={() => update("announcements", [
            ...form.announcements,
            { id: `notice-${crypto.randomUUID()}`, title: "", body: "",
              priority: "normal", published: false, link: "" },
          ])}>新增公告</button>
        )}
      </section>
      <h2 className="section-title">关于页</h2>
      <Markdown
        label="关于页正文（Markdown）"
        value={form.about}
        onChange={(v) => update("about", v)}
        uploads={uploads}
        onError={setError}
        rows={14}
      />
    </section>
  );
}

