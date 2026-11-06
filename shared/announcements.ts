/** Public site announcements are build-time content, not private GitHub inbox items.
 * The same validation applies to hand-edited site.json and privileged admin saves.
 */
export type AnnouncementPriority = "normal" | "important" | "urgent";
export type Announcement = {
  id: string;
  title: string;
  body: string;
  priority: AnnouncementPriority;
  published: boolean;
  link: string;
  revision: number;
  updated?: string;
};
const priorities = new Set<AnnouncementPriority>(["normal", "important", "urgent"]);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const stringField = (value: unknown, name: string, max: number) => {
  if (typeof value !== "string" || value.trim().length > max)
    throw new Error(`公告的${name}格式不正确（最多 ${max} 字）。`);
  return value.trim();
};
const safeLink = (link: string) => {
  if (!link) return true;
  if (/^\/(?!\/)[^\s\\<>]*$/.test(link)) return true;
  try {
    const url = new URL(link);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
};

export function parseAnnouncements(input: unknown): Announcement[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 12)
    throw new Error("公告必须为数组，最多 12 条。");
  const ids = new Set<string>();
  return input.map((value, index) => {
    if (!record(value)) throw new Error(`第 ${index + 1} 条公告格式不正确。`);
    const id = stringField(value.id, "ID", 64);
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id) || ids.has(id))
      throw new Error("公告 ID 必须唯一，仅可使用小写字母、数字和连字符。");
    ids.add(id);
    const title = stringField(value.title, "标题", 80);
    const body = stringField(value.body, "正文", 1800);
    if (typeof value.published !== "boolean")
      throw new Error("公告发布状态必须为布尔值。");
    if (value.published && (!title || !body))
      throw new Error("已发布公告必须填写标题与正文。");
    if (!priorities.has(value.priority as AnnouncementPriority))
      throw new Error("公告级别不正确。");
    const link = stringField(value.link ?? "", "链接", 300);
    if (!safeLink(link))
      throw new Error("公告链接仅允许站内 / 路径或不含账号密码的 HTTPS 地址。");
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1)
      throw new Error("公告版本号必须为正整数。");
    const updated = value.updated === undefined ? undefined : stringField(value.updated, "日期", 10);
    if (updated && (!/^\d{4}-\d{2}-\d{2}$/.test(updated) ||
      Number.isNaN(Date.parse(`${updated}T00:00:00Z`))))
      throw new Error("公告日期必须为有效的 YYYY-MM-DD。");
    return { id, title, body, priority: value.priority as AnnouncementPriority,
      published: value.published, link, revision: Number(value.revision),
      ...(updated ? { updated } : {}) };
  });
}

/** A new revision invalidates only this announcement's read/dismiss markers. */
export const announcementToken = (item: Pick<Announcement, "id" | "revision">) =>
  `${item.id}:${item.revision}`;

export const publishedAnnouncements = (source: unknown) =>
  parseAnnouncements(source).filter((item) => item.published);

/** Admin clients cannot forge revisions. Changes to an existing notice
 * increment its revision once per successful save; unchanged notices retain it.
 */
export function saveAnnouncements(input: unknown, previous: unknown, today: string): Announcement[] {
  if (!Array.isArray(input)) throw new Error("公告必须为数组。");
  const prior = new Map(parseAnnouncements(previous).map((item) => [item.id, item]));
  const normalized = parseAnnouncements(input.map((value) =>
    record(value) ? { ...value, revision: 1 } : value,
  ));
  return normalized.map((item) => {
    const old = prior.get(item.id);
    const fields: (keyof Announcement)[] = ["title", "body", "priority", "link", "published"];
    const changed = !old || fields.some((field) => item[field] !== old[field]);
    if (old && changed && old.revision >= Number.MAX_SAFE_INTEGER)
      throw new Error("公告版本号已超出支持范围。");
    return { ...item,
      revision: old ? old.revision + (changed ? 1 : 0) : 1,
      updated: changed ? today : old?.updated };
  });
}
