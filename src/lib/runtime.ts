declare global {
  interface Window {
    __WAYLAN_OFFLINE_PREVIEW__?: boolean;
    __WAYLAN_PREVIEW_ASSETS__?: Record<string, string>;
  }
}
/** A separate, visibly labelled offline build; deployed pages use the real HTTP API. */
export function offlinePreview() {
  return (
    typeof window !== "undefined" &&
    (window.__WAYLAN_OFFLINE_PREVIEW__ === true ||
      window.location.protocol === "file:")
  );
}
export function currentRoute() {
  if (offlinePreview()) {
    const hash = location.hash.slice(1);
    return hash.startsWith("/") ? hash : "/";
  }
  return (
    (location.pathname.replace(/\/$/, "") || "/") +
    location.search +
    location.hash
  );
}
export function routeHref(href: string) {
  return offlinePreview() && href.startsWith("/") ? "#" + href : href;
}
export function assetURL(src: string) {
  return typeof window !== "undefined"
    ? window.__WAYLAN_PREVIEW_ASSETS__?.[src] || src
    : src;
}
export function offlineRead(path: string) {
  const url = new URL(path, "https://preview.invalid");
  const empty = {
    nodes: [],
    totalCount: 0,
    pageInfo: { hasNextPage: false, endCursor: null },
    discussionUrl: null,
    mapped: false,
  };
  if (url.pathname === "/api/session") return { user: null, configured: false };
  if (url.pathname === "/api/status") return { comments: false, login: false };
  if (url.pathname === "/api/echo") return { comment: null };
  if (url.pathname === "/api/views") return { enabled: false, views: {} };
  if (url.pathname === "/api/feed/comments")
    return {
      posts: Object.fromEntries(
        (url.searchParams.get("ids") || "")
          .split(",")
          .filter(Boolean)
          .map((id) => [id, empty]),
      ),
    };
  if (/^\/api\/posts\/[^/]+\/annotations$/.test(url.pathname))
    return { nodes: [], nextCursor: null };
  if (/^\/api\/posts\/[^/]+\/comments$/.test(url.pathname)) return empty;
  return undefined;
}

export function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function articleHTML(html: string) {
  if (!offlinePreview()) return html;
  return html.replace(
    /\bsrc=(["'])(\/[^"']+)\1/g,
    (attribute, quote: string, src: string) =>
      `src=${quote}${assetURL(src)}${quote}`,
  );
}
