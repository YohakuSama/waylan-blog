import { useEffect, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { Link } from "../lib/router";
import { api } from "../lib/api";

type Item = {
  id: string;
  actor: string;
  slug: string;
  title: string;
  commentId: string;
  kind: "reply" | "new_comment";
  time: number;
  read: boolean;
};
type Inbox = {
  enabled: boolean;
  subscribed?: boolean;
  unread: number;
  items: Item[];
};
const empty: Inbox = { enabled: false, unread: 0, items: [] };

export function NotificationBell() {
  const [box, setBox] = useState<Inbox>(empty);
  const [csrf, setCsrf] = useState("");
  const [available, setAvailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const session = await api<{ user: { login: string } | null; csrf?: string }>("/api/session");
        if (!active) return;
        if (!session.user || !session.csrf) {
          setBox(empty);
          setCsrf("");
          const status = await api<{ notifications?: boolean }>("/api/status");
          if (active) setAvailable(!!status.notifications);
          return;
        }
        setCsrf(session.csrf);
        const next = await api<Inbox>("/api/notifications");
        if (active) {
          setBox(next);
          setAvailable(next.enabled);
        }
      } catch {
        if (active) {
          setBox(empty);
          setAvailable(false);
        }
      }
    }
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 70000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!available) return null;
  const signedIn = box.enabled && !!csrf;
  const login = () => {
    const returnPath = location.pathname + location.search + location.hash;
    location.assign(`/api/auth/github?return=${encodeURIComponent(returnPath)}`);
  };
  const mark = async (ids: string[]) => {
    if (!ids.length || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/notifications", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({ ids }),
      });
      setBox((prev) => ({
        ...prev,
        unread: Math.max(0, prev.unread - prev.items.filter((item) => ids.includes(item.id) && !item.read).length),
        items: prev.items.map((item) => ids.includes(item.id) ? { ...item, read: true } : item),
      }));
    } catch {
      setError("消息状态保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const subscribe = async () => {
    setBusy(true);
    setError("");
    try {
      await api("/api/notifications", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({ subscribed: !box.subscribed }),
      });
      setBox((prev) => ({ ...prev, subscribed: !prev.subscribed }));
    } catch {
      setError("通知偏好保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="notification-root" ref={root}>
      <button
        type="button"
        className="icon-button notification-trigger"
        aria-label={`消息通知，${box.unread} 条未读`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} />
        {box.unread > 0 && <span className="notification-badge">{box.unread > 99 ? "99+" : box.unread}</span>}
      </button>
      {open && (
        <div className="notification-popover" role="region" aria-label="消息通知">
          <header>
            <strong>消息通知</strong>
            <button type="button" className="icon-button" aria-label="关闭消息" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </header>
          {!signedIn ? (
            <div className="notification-empty">
              <p>登录后可查看别人对你的回复。</p>
              <button type="button" className="quiet-button" onClick={login}>使用 GitHub 登录</button>
            </div>
          ) : <>
          <div className="notification-controls">
            <span>{box.unread} 条未读</span>
            <button type="button" className="text-button" disabled={busy || !box.unread}
              onClick={() => void mark(box.items.filter((item) => !item.read).map((item) => item.id))}>
              <Check size={13} /> 全部已读
            </button>
          </div>
          <div className="notification-items">
            {box.items.length ? box.items.map((item) => (
              <Link
                key={item.id}
                href={`/post/${item.slug}#echo-${encodeURIComponent(item.commentId)}`}
                className={item.read ? "notification-item" : "notification-item unread"}
                onClick={() => { setOpen(false); void mark([item.id]); }}
              >
                <strong>{item.kind === "reply" ? `@${item.actor} 回复了你` : `@${item.actor} 发表了评论`}</strong>
                <span>{item.title}</span>
                <time>{new Date(item.time * 1000).toLocaleDateString("zh-CN")}</time>
              </Link>
            )) : <p className="notification-empty">目前没有新消息。</p>}
          </div>
          {error && <p className="small-error" role="alert">{error}</p>}
          <div className="notification-foot">
            <button type="button" className="text-button" disabled={busy} onClick={() => void subscribe()}>
              {box.subscribed ? "关闭站内提醒" : "开启站内提醒"}
            </button>
          </div>
          </>}
        </div>
      )}
    </div>
  );
}
