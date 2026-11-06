import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Megaphone, X } from "lucide-react";
import { Dialog } from "./UI";
import { Link } from "../lib/router";
import { storage } from "../lib/storage";
import { site } from "../lib/data";
import {
  announcementToken,
  publishedAnnouncements,
  type Announcement,
} from "../../shared/announcements";

// The public list is generated from site.json at build time: no login, D1,
// polling, or private notification endpoint is involved.
const notices = publishedAnnouncements((site as { announcements?: unknown }).announcements);
const key = (name: string, item: Announcement) => `announcement:${name}:${item.id}`;

export function useSiteAnnouncements() {
  const [ready, setReady] = useState(false);
  const [read, setRead] = useState<Set<string>>(() => new Set());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [active, setActive] = useState<Announcement | null>(null);
  const autoOpened = useRef(false);
  useEffect(() => {
    // Never read browser storage during SSR or the first hydration render.
    setRead(new Set(notices.filter((item) =>
      storage.get(key("read", item), 0) === item.revision,
    ).map(announcementToken)));
    setHidden(new Set(notices.filter((item) =>
      storage.get(key("dismissed", item), 0) === item.revision,
    ).map(announcementToken)));
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready || active || autoOpened.current) return;
    const urgent = notices.find((item) =>
      item.priority === "urgent" && !read.has(announcementToken(item)));
    if (urgent) {
      autoOpened.current = true;
      setActive(urgent);
    }
  }, [ready, active, read]);
  const markRead = (item: Announcement) => {
    storage.set(key("read", item), item.revision);
    setRead((prev) => new Set(prev).add(announcementToken(item)));
  };
  const dismiss = (item: Announcement) => {
    storage.set(key("dismissed", item), item.revision);
    setHidden((prev) => new Set(prev).add(announcementToken(item)));
  };
  const closeDetail = () => {
    if (active) markRead(active);
    setActive(null);
  };
  const banner = notices.find((item) =>
    item.priority !== "normal" && !hidden.has(announcementToken(item))) || null;
  return {
    items: notices,
    ready,
    unread: ready ? notices.filter((item) => !read.has(announcementToken(item))).length : 0,
    read,
    banner,
    active,
    openDetail: (item: Announcement) => setActive(item),
    closeDetail,
    dismiss,
  };
}

const priorityLabel = { normal: "公告", important: "重要公告", urgent: "紧急公告" };

export function AnnouncementBanner({
  item, onOpen, onDismiss,
}: {
  item: Announcement | null;
  onOpen: (item: Announcement) => void;
  onDismiss: (item: Announcement) => void;
}) {
  if (!item) return null;
  return (
    <aside className={`site-announcement-bar priority-${item.priority}`}
      aria-label="站点公告">
      <div className="site-announcement-inner">
        <Megaphone size={16} aria-hidden="true" />
        <span className="site-announcement-priority">{priorityLabel[item.priority]}</span>
        <strong className="site-announcement-title">{item.title}</strong>
        <button type="button" className="site-announcement-open" onClick={() => onOpen(item)}>
          查看详情
        </button>
        <button type="button" className="site-announcement-dismiss"
          onClick={() => onDismiss(item)} aria-label={`不再显示公告：${item.title}`}>
          <X size={16} />
        </button>
      </div>
    </aside>
  );
}

export function AnnouncementList({
  items, read, onOpen,
}: {
  items: Announcement[];
  read: Set<string>;
  onOpen: (item: Announcement) => void;
}) {
  if (!items.length) return <p className="notification-empty">暂无公告。</p>;
  return (
    <div className="notification-items site-announcement-list">
      {items.map((item) => {
        const unseen = !read.has(announcementToken(item));
        return (
          <button type="button" className={unseen ? "announcement-item unread" : "announcement-item"}
            key={item.id} onClick={() => onOpen(item)}>
            <span className="announcement-item-heading">
              <strong>{item.title}</strong>
              {unseen && <span className="announcement-item-unread" aria-label="未读" />}
            </span>
            <span className="announcement-item-meta">
              {priorityLabel[item.priority]}{item.updated && <> · <time dateTime={item.updated}>{item.updated}</time></>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function AnnouncementDetail({
  item, onClose,
}: {
  item: Announcement | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!item} onClose={onClose} label="站点公告"
      className="site-announcement-dialog" focusContainer>
      {item && (
        <div className="site-announcement-detail">
          <p className="announcement-detail-meta">
            {priorityLabel[item.priority]}
            {item.updated && <> · <time dateTime={item.updated}>{item.updated}</time></>}
          </p>
          <h2>{item.title}</h2>
          <p className="announcement-detail-body">{item.body}</p>
          <div className="announcement-detail-actions">
            {item.link && (item.link.startsWith("https://") ? (
              <a href={item.link} target="_blank" rel="noopener noreferrer" onClick={onClose}>
                相关链接 <ArrowUpRight size={14} />
              </a>
            ) : (
              <Link href={item.link} onClick={onClose}>
                相关链接 <ArrowUpRight size={14} />
              </Link>
            ))}
            <button type="button" className="primary-button" onClick={onClose}>已了解</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
