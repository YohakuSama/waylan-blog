import { useEffect, useState } from "react";
import { ArrowUpRight, Highlighter, Monitor, Moon, Rss, Settings2, Sun, Trash2 } from "lucide-react";
import { Dialog } from "./UI";
import { ConfirmButton } from "./Shelf";
import { Link, useRouter } from "../lib/router";
import { posts, site } from "../lib/data";
import { storage } from "../lib/storage";
import { assetURL, offlinePreview } from "../lib/runtime";
import {
  applyAppearance,
  setSkin,
  setThemePreference,
  skinPreference,
  themePreference,
  type Skin,
  type ThemePreference,
} from "../lib/appearance";
import {
  applyMotionPreference,
  motionLevel,
  motionPreference,
  setMotionPreference,
  type MotionPreference,
} from "../lib/motion";
const readerFontSizes = [16, 18, 20];
const defaultReaderFontSize = 18;
const skins: { value: Skin; title: string; description: string }[] = [
  {
    value: "editorial",
    title: "杂志排版",
    description: "衬线标题、纸张底色与宽松留白，适合长文阅读。",
  },
  {
    value: "terminal",
    title: "终端",
    description: "等宽字体、命令行提示符与高对比配色。",
  },
];
const themes: { value: ThemePreference; title: string; icon: typeof Sun }[] = [
  { value: "light", title: "浅色", icon: Sun },
  { value: "dark", title: "深色", icon: Moon },
  { value: "system", title: "跟随系统", icon: Monitor },
];
const motions: {
  value: MotionPreference;
  title: string;
  description: string;
}[] = [
  {
    value: "system",
    title: "跟随系统",
    description: "遵循系统的“减少动态效果”设置。",
  },
  {
    value: "full",
    title: "完整动效",
    description: "页面转场与列表过渡全部开启。",
  },
  {
    value: "reduced",
    title: "减少动效",
    description: "页面直接切换，功能不受影响。",
  },
];
type HighlightSummary = { id: string; slug: string; title: string; count: number };
function savedHighlights(): HighlightSummary[] {
  return posts.flatMap((p) => {
    const marks = storage.get<unknown>(`marks:${p.id}`, []);
    return Array.isArray(marks) && marks.length
      ? [{ id: p.id, slug: p.slug, title: p.title, count: marks.length }]
      : [];
  });
}
export function Settings() {
  const router = useRouter();
  const [open, setOpen] = useState(false),
    [skin, setSkinState] = useState<Skin>("editorial"),
    [theme, setTheme] = useState<ThemePreference>("system"),
    [fontSize, setFontSize] = useState(defaultReaderFontSize),
    [motion, setMotion] = useState<MotionPreference>("system"),
    [level, setLevel] = useState("shared"),
    [highlights, setHighlights] = useState<HighlightSummary[]>([]);
  useEffect(() => {
    const sync = () => {
      const s = skinPreference(),
        t = themePreference(),
        m = motionPreference();
      applyAppearance(s, t);
      applyMotionPreference(m);
      setSkinState(s);
      setTheme(t);
      setMotion(m);
      setLevel(motionLevel());
      const savedSize = storage.get<number>("font-size", defaultReaderFontSize);
      setFontSize(readerFontSizes.includes(savedSize) ? savedSize : defaultReaderFontSize);
    };
    sync();
    const dark = matchMedia("(prefers-color-scheme: dark)"),
      reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const changedInAnotherTab = (event: StorageEvent) => {
      if (event.key === null || ["echo:skin", "echo:theme", "echo:motion"].includes(event.key))
        sync();
    };
    dark.addEventListener?.("change", sync);
    reduce.addEventListener?.("change", sync);
    window.addEventListener("storage", changedInAnotherTab);
    return () => {
      dark.removeEventListener?.("change", sync);
      reduce.removeEventListener?.("change", sync);
      window.removeEventListener("storage", changedInAnotherTab);
    };
  }, []);
  useEffect(() => setOpen(false), [router.path]);
  return (
    <>
      <button
        type="button"
        className="icon-button settings-button"
        aria-label="阅读设置"
        aria-haspopup="dialog"
        data-tip="阅读设置"
        onClick={() => {
          setHighlights(savedHighlights());
          setOpen(true);
        }}
      >
        <Settings2 size={18} />
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        label="阅读设置"
        className="settings-dialog"
      >
        <div className="settings-body">
          <fieldset className="settings-group">
            <legend>界面风格</legend>
            <div className="skin-choices">
              {skins.map((s) => (
                <label
                  key={s.value}
                  className={`skin-choice skin-choice-${s.value}${skin === s.value ? " selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="skin"
                    value={s.value}
                    checked={skin === s.value}
                    onChange={() => {
                      setSkin(s.value);
                      setSkinState(s.value);
                    }}
                  />
                  <span className="skin-preview" aria-hidden="true">
                    {s.value === "editorial" ? (
                      <>
                        <i className="sp-kicker" />
                        <b>Aa</b>
                        <i className="sp-line" />
                        <i className="sp-line short" />
                      </>
                    ) : (
                      <>
                        <i className="sp-bar" />
                        <code>$ ls ~/posts</code>
                        <code>&gt; _</code>
                      </>
                    )}
                  </span>
                  <span className="skin-text">
                    <strong>{s.title}</strong>
                    <small>{s.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="settings-group">
            <legend>颜色模式</legend>
            <div className="segmented">
              {themes.map((t) => (
                <label
                  key={t.value}
                  className={theme === t.value ? "selected" : ""}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={t.value}
                    checked={theme === t.value}
                    onChange={() => {
                      setThemePreference(t.value);
                      setTheme(t.value);
                    }}
                  />
                  <t.icon size={15} aria-hidden="true" />
                  <span>{t.title}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="settings-group settings-reader-font">
            <legend>文章正文字号</legend>
            <div className="segmented reader-font-choices">
              {readerFontSizes.map((size) => (
                <label key={size} className={fontSize === size ? "selected" : ""}>
                  <input type="radio" name="reader-font-size" value={size}
                    checked={fontSize === size}
                    onChange={() => {
                      storage.set("font-size", size);
                      setFontSize(size);
                      window.dispatchEvent(new Event("waylan:font-size-changed"));
                    }} />
                  <span>{size === 16 ? "小" : size === 18 ? "标准" : "大"} · {size}</span>
                </label>
              ))}
            </div>
            <p className="settings-muted">仅调整文章正文，选中的大小会在本设备保存。</p>
          </fieldset>
          <fieldset className="settings-group">
            <legend>动效</legend>
            <div className="motion-choices">
              {motions.map((m) => (
                <label
                  key={m.value}
                  className={
                    motion === m.value
                      ? "motion-choice selected"
                      : "motion-choice"
                  }
                >
                  <input
                    type="radio"
                    name="motion-preference"
                    value={m.value}
                    checked={motion === m.value}
                    onChange={() => {
                      setMotionPreference(m.value);
                      setMotion(m.value);
                      setLevel(motionLevel());
                    }}
                  />
                  <span>
                    <strong>{m.title}</strong>
                    <small>{m.description}</small>
                  </span>
                </label>
              ))}
            </div>
            <p className="settings-status" role="status">
              当前生效：
              {level === "off"
                ? "减少动效"
                : level === "simple"
                  ? "轻量过渡"
                  : "完整过渡"}
            </p>
          </fieldset>
          <section className="settings-group settings-highlights" aria-label="管理私人划线">
            <div className="settings-highlight-head">
              <span className="settings-label">私人划线</span>
              <span className="muted">共 {highlights.reduce((sum, item) => sum + item.count, 0)} 处</span>
            </div>
            {highlights.length > 0 ? (
              <>
                <ul className="saved-highlights">
                  {highlights.map((item) => (
                    <li key={item.id}>
                      <Link href={`/post/${item.slug}`}>
                        <Highlighter size={15} aria-hidden="true" />
                        <span>{item.title}</span>
                        <small>{item.count} 处</small>
                        <ArrowUpRight size={14} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
                <ConfirmButton
                  className="text-button highlights-clear"
                  icon={<Trash2 size={14} aria-hidden="true" />}
                  label="清空所有私人划线"
                  confirmLabel="再按一次，永久清空"
                  onConfirm={() => {
                    let failed = false;
                    for (const item of highlights)
                      if (!storage.remove(`marks:${item.id}`)) failed = true;
                    // Failed removals must remain visible and available to retry.
                    setHighlights(savedHighlights());
                    window.dispatchEvent(new window.Event("waylan:highlights-changed"));
                    if (failed) window.alert("部分私人划线未能删除，请检查浏览器的本地存储权限后重试。");
                  }}
                />
              </>
            ) : <p className="settings-muted">尚未保存私人划线。进入文章选中文字后可以添加。</p>}
            <p className="settings-muted">仅保存在当前浏览器，未同步到服务器；可在文章里点按划线逐条删除。</p>
          </section>
          <div className="settings-group settings-subscribe">
            <span className="settings-label">订阅</span>
            <a
              href={assetURL("/rss.xml")}
              download={offlinePreview() ? `${site.name}-rss.xml` : undefined}
              className="settings-link"
            >
              <Rss size={16} aria-hidden="true" />
              <span>
                <strong>RSS 订阅</strong>
                <small>在阅读器中接收新文章</small>
              </span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>
          <p className="settings-note">设置只保存在当前浏览器中。</p>
        </div>
      </Dialog>
    </>
  );
}
