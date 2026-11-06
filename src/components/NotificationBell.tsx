import { useEffect, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { Link } from "../lib/router";
import { api } from "../lib/api";
import { AnnouncementList } from "./SiteAnnouncements";
import type { Announcement } from "../../shared/announcements";

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

export function NotificationBell({
  announcements = [],
  readAnnouncements = new Set<string>(),
  onOpenAnnouncement = () => {},
}: {
  announcements?: Announcement[];
  readAnnouncements?: Set<string>;
  onOpenAnnouncement?: (item: Announcement) => void;
}) {
  const [box, setBox] = useState<Inbox>(empty);
  const [csrf, setCsrf] = useState("");
  const [moderator, setModerator] = useState(false);
  const [success, setSuccess] = useState("");
  const [availability, setAvailability] = useState<"checking" | "enabled" | "disabled" | "error">("checking");
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"messages" | "announcements">("messages");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dismiss = useRef<HTMLButtonElement>(null);
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => trigger.current?.focus());
  };
  const refreshInbox = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    let requestSerial = 0;
    async function refresh() {
      const serial = ++requestSerial;
      try {
        const session = await api<{ user: { login: string } | null; csrf?: string; moderator?: boolean }>("/api/session");
        if (!active || serial !== requestSerial) return;
        if (!session.user || !session.csrf) {
          setBox(empty);
          setCsrf("");
          setModerator(false);
          const status = await api<{ notifications?: boolean }>("/api/status");
          if (active && serial === requestSerial)
            setAvailability(status.notifications ? "enabled" : "disabled");
          return;
        }
        setCsrf(session.csrf);
        setModerator(!!session.moderator);
        const next = await api<Inbox>("/api/notifications");
        if (active && serial === requestSerial) {
          setBox(next);
          setAvailability(next.enabled ? "enabled" : "disabled");
        }
      } catch {
        if (active && serial === requestSerial) {
          setBox(empty);
          setCsrf("");
          setModerator(false);
          setAvailability("error");
        }
      }
    }
    refreshInbox.current = refresh;
    void refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 70000);
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      ++requestSerial;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  useEffect(() => {
    // Open is an intentional request to see the latest unread notifications,
    // rather than waiting for the 70-second background refresh.
    if (open) void refreshInbox.current();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    // Non-modal dialog: move keyboard focus into the panel when opening.
    dismiss.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const signedIn = availability === "enabled" && box.enabled && !!csrf;
  const retry = () => {
    setAvailability("checking");
    void refreshInbox.current();
  };
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
  const markAll = async () => {
    if (!box.unread || busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/notifications", {
        method: "POST",
        headers: { "X-CSRF-Token": csrf },
        body: JSON.stringify({ all: true }),
      });
      setBox((prev) => ({
        ...prev,
        unread: 0,
        items: prev.items.map((item) => ({ ...item, read: true })),
      }));
    } catch {
      setError("消息状态保存失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  const testNotification = async (method: "POST" | "DELETE") => {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api("/api/notifications/test", {
        method,
        headers: { "X-CSRF-Token": csrf },
      });
      const updated = await api<Inbox>("/api/notifications");
      setBox(updated);
      setSuccess(method === "POST" ? "测试消息已发送到你的收件箱。" : "测试消息已清除。");
    } catch (e) {
      setError((e as Error).message || "操作失败，请重试。");
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
  const announcementUnread = announcements.filter((a) =>
    !readAnnouncements.has(`${a.id}:${a.revision}`)).length;
  return (
    <div className="notification-root" ref={root}>
      <button
        type="button"
        className="icon-button notification-trigger"
        ref={trigger}
        aria-label={`${availability === "enabled" ? `消息通知，${box.unread} 条未读` : "消息通知"}${announcementUnread ? "，有新公告" : ""}`}
        data-tip="站内通知"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={18} />
        {availability === "enabled" && box.unread > 0 && <span className="notification-badge">{box.unread > 99 ? "99+" : box.unread}</span>}
        {announcementUnread > 0 && !(availability === "enabled" && box.unread > 0) &&
          <span className="announcement-indicator" aria-hidden="true" />}
      </button>
      {open && (
        <div id="notification-panel" className="notification-popover"
          role="dialog" aria-modal="false" aria-labelledby="notification-heading">
          <header>
            <strong id="notification-heading">{tab === "announcements" ? "站点公告" : "消息通知"}</strong>
            <button type="button" className="icon-button" ref={dismiss}
              aria-label="关闭消息" onClick={() => close(true)}>
              <X size={16} />
            </button>
          </header>
          <div className="notification-tabs" role="group" aria-label="消息类型">
            <button type="button" aria-pressed={tab === "messages"}
              className={tab === "messages" ? "selected" : ""}
              onClick={() => setTab("messages")}>我的消息</button>
            <button type="button" aria-pressed={tab === "announcements"}
              className={tab === "announcements" ? "selected" : ""}
              onClick={() => setTab("announcements")}>公告{announcementUnread ? ` · ${announcementUnread}` : ""}</button>
          </div>
          {tab === "announcements" ? (
            <AnnouncementList items={announcements} read={readAnnouncements}
              onOpen={(item) => {
                // Preserve a connected trigger as the native dialog's
                // return-focus target after removing this non-modal popover.
                trigger.current?.focus({ preventScroll: true });
                setOpen(false);
                onOpenAnnouncement(item);
              }} />
          ) : availability !== "enabled" ? (
            // Distinct keys prevent React reusing a Retry DOM button as OAuth login during recovery.
            <div key="notification-retry" className="notification-empty">
              <p role="status">{availability === "checking" ? "正在读取通知…" : availability === "disabled" ? "本站暂未开启消息通知。" : "暂时无法读取通知，请重试。"}</p>
              {availability !== "checking" && <button type="button" className="quiet-button" onClick={retry}>
                {availability === "error" ? "重试" : "重新检查"}
              </button>}
            </div>
          ) : !signedIn ? (
            <div key="notification-login" className="notification-empty">
              <p>登录后可查看别人对你的回复。</p>
              <button type="button" className="quiet-button" onClick={login}>使用 GitHub 登录</button>
            </div>
          ) : <>
          <div className="notification-controls">
            <span>{box.unread} 条未读</span>
            <button type="button" className="text-button" disabled={busy || !box.unread}
              onClick={() => void markAll()}>
              <Check size={13} /> 全部已读
            </button>
          </div>
          <div className="notification-items">
            {box.items.length ? box.items.map((item) => (
              <Link
                key={item.id}
                href={item.id.startsWith("test:") ? `/post/${item.slug}` : `/post/${item.slug}#echo-${encodeURIComponent(item.commentId)}`}
                className={item.read ? "notification-item" : "notification-item unread"}
                onClick={() => { setOpen(false); void mark([item.id]); }}
              >
                <strong>{item.id.startsWith("test:") ? "站长测试通知" : item.kind === "reply" ? `@${item.actor} 回复了你` : `@${item.actor} 发表了评论`}</strong>
                <span>{item.title}</span>
                <time>{new Date(item.time * 1000).toLocaleDateString("zh-CN")}</time>
              </Link>
            )) : <p className="notification-empty">目前没有新消息。</p>}
          </div>
          {error && <p className="small-error" role="alert">{error}</p>}
          {success && <p className="notification-success" role="status">{success}</p>}
          {moderator && <div className="notification-test-tools">
            <span>仅站长可见 · 不会向 GitHub 发评论</span>
            <button type="button" className="text-button" disabled={busy || !box.subscribed}
              onClick={() => void testNotification("POST")}>发送测试通知</button>
            <button type="button" className="text-button" disabled={busy}
              onClick={() => void testNotification("DELETE")}>清空测试消息</button>
          </div>}
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
