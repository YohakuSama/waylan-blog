import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type AnchorHTMLAttributes,
} from "react";
import { flushSync } from "react-dom";
import { currentRoute, offlinePreview, routeHref, newId } from "./runtime";
import { metadata, posts, structuredData } from "./data";
import { loadReader } from "./reader-loader";
import { transient } from "./storage";
import { listTransition, motionAllowed, navigateWithMotion } from "./motion";
type NavigationOptions = { replace?: boolean; pop?: boolean; key?: string };
type Router = {
  path: string;
  navigate: (url: string, options?: NavigationOptions) => void;
  back: () => void;
  backToList: () => void;
};
type VisitedRoute = { route: string; fromKey: string | null };
/** Return to the page that actually opened the reader, not an arbitrary feed. */
const isReturnOrigin = (route: string) => {
  const pathname = route.split(/[?#]/)[0];
  return pathname !== "/404" && !pathname.startsWith("/post/") && isAppRoute(pathname);
};
/** Top-level navigation follows the visual header order in both directions. */
export function routeMotionDirection(from: string, to: string, pop = false): "forward" | "back" {
  if (pop || (from.startsWith("/post/") && !to.startsWith("/post/"))) return "back";
  const sections = ["/", "/feed", "/archive", "/projects", "/about"];
  const previous = sections.indexOf(from);
  const next = sections.indexOf(to);
  return previous !== -1 && next !== -1 && next < previous ? "back" : "forward";
}
const Context = createContext<Router>(null!);
export const useRouter = () => useContext(Context);
export const motionOK = motionAllowed;
// Only public application pages belong to the client router. Static files,
// /admin and API links must use native browser navigation.
export function isAppRoute(pathname: string) {
  return ["/", "/feed", "/archive", "/projects", "/about", "/404"].includes(pathname)
    || posts.some((post) => pathname === `/post/${post.slug}`);
}
export function fragmentId(fragment: string): string | null {
  if (!fragment.startsWith("#")) return null;
  try {
    return decodeURIComponent(fragment.slice(1));
  } catch {
    return null;
  }
}
export function RouterProvider({
  initialPath,
  children,
}: {
  initialPath: string;
  children: ReactNode;
}) {
  const [path, setPath] = useState(initialPath),
    key = useRef(""),
    operation = useRef(0),
    transition = useRef<{ skipTransition?: () => void } | null>(null),
    pendingTarget = useRef<{ route: string; serial: number } | null>(null),
    pathRef = useRef(path);
  const positions = useRef(new Map<string, number>()),
    lastOrigin = useRef(transient.get("last-origin", transient.get("last-list", "/feed"))),
    visitedRoutes = useRef(new Map<string, VisitedRoute>());
  const fileHistory = useRef({
    entries: [{ route: initialPath, key: "" }],
    index: 0,
  });
  pathRef.current = path;
  function save() {
    if (key.current) {
      positions.current.set(key.current, window.scrollY);
      transient.set(`scroll:${key.current}`, window.scrollY);
    }
  }
  async function navigate(url: string, options: NavigationOptions = {}) {
    const offline = offlinePreview(),
      target = new URL(
        offline && url.startsWith("#/") ? url.slice(1) : url,
        offline ? "https://preview.invalid/" : location.href,
      );
    if (
      target.origin !== (offline ? "https://preview.invalid" : location.origin)
    ) {
      location.assign(url);
      return;
    }
    const next = target.pathname + target.search + target.hash;
    // Repeated taps on the same link must share one in-flight load and
    // transition. A different destination can still supersede a slow one.
    if (!options.pop && pendingTarget.current?.route === next) return;
    if (!options.pop && next === pathRef.current && !pendingTarget.current) {
      const id = fragmentId(target.hash);
      if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
      return;
    }
    const serial = ++operation.current;
    pendingTarget.current = { route: next, serial };
    const release = () => {
      if (pendingTarget.current?.serial === serial) pendingTarget.current = null;
    };
    if (target.pathname.startsWith("/post/")) {
      // Only indicate work when the reader chunk really needs loading.
      // Delay avoids a distracting flash on cached navigation.
      const loading = window.setTimeout(() => {
        if (serial === operation.current)
          document.documentElement.dataset.navigation = "loading";
      }, 140);
      try {
        await loadReader();
      } catch {
        if (serial === operation.current) {
          release();
          location.assign(
            offline
              ? routeHref(target.pathname + target.search + target.hash)
              : target.href,
          );
        }
        return;
      } finally {
        window.clearTimeout(loading);
        if (serial === operation.current)
          delete document.documentElement.dataset.navigation;
      }
    }
    if (serial !== operation.current) return;
    transition.current?.skipTransition?.();
    save();
    const prevPath = pathRef.current;
    if (isReturnOrigin(prevPath)) {
      lastOrigin.current = prevPath;
      transient.set("last-origin", prevPath);
    }
    const nextKey = options.key || newId();
    // Re-clicking the current page must not stack duplicate history entries.
    if (next === prevPath && !options.pop)
      options = { ...options, replace: true };
    const change = () => {
      const priorKey = key.current;
      if (!options.pop) {
        if (offline) {
          const trail = fileHistory.current,
            entry = { route: next, key: nextKey };
          if (options.replace) trail.entries[trail.index] = entry;
          else if (next !== prevPath) {
            trail.entries.splice(trail.index + 1);
            trail.entries.push(entry);
            trail.index++;
          } else trail.entries[trail.index] = entry;
          // Local file origins cannot safely use pushState. Fragment navigation works without a server.
          if (options.replace) location.replace(routeHref(next));
          else location.hash = next;
        } else
          history[options.replace ? "replaceState" : "pushState"](
            {
              echoKey: nextKey,
              echoFrom: options.replace ? history.state?.echoFrom : key.current,
            },
            "",
            next,
          );
      }
      key.current = nextKey;
      visitedRoutes.current.set(nextKey, {
        route: next,
        fromKey: options.pop ? (history.state?.echoFrom || null) : priorKey,
      });
      flushSync(() => setPath(next));
      const y = options.pop
        ? (positions.current.get(nextKey) ??
          transient.get(`scroll:${nextKey}`, 0))
        : 0;
      if (target.pathname !== prevPath.split(/[?#]/)[0] || options.pop)
        window.scrollTo({ top: y, behavior: "instant" });
      const id = target.hash.startsWith("#echo-") ? null : fragmentId(target.hash);
      if (id)
        requestAnimationFrame(() =>
          document.getElementById(id)?.scrollIntoView({ block: "start" }),
        );
    };
    const prevPathname = prevPath.split(/[?#]/)[0];
    if (target.pathname !== prevPathname) {
      // Collection sections follow the header order, while leaving an
      // article and browser Back reverse the journey.
      const direction = routeMotionDirection(prevPathname, target.pathname, !!options.pop);
      const collectionToCollection =
        !prevPathname.startsWith("/post/") &&
        !target.pathname.startsWith("/post/");
      const active = navigateWithMotion(
        change, direction,
        collectionToCollection ? "collection"
          : (target.searchParams.get("resume") === "1" ||
             new URL(prevPath, "https://preview.invalid").searchParams.get("resume") === "1")
            ? "resume" : "reader",
      );
      transition.current = active;
      active.finished
        .catch(() => {})
        .finally(() => {
          if (operation.current === serial) transition.current = null;
          release();
        });
    } else if (target.search !== new URL(prevPath, "https://x.invalid").search) {
      // A fresh sort/filter is a new ordering, not a continuation of the
      // expanded list. When initiated from the footer, preserving its old
      // scroll position lands the reader below the new eight-item page.
      // Save the previous history position above, then align the *old* page
      // before taking View Transition snapshots to avoid a giant vertical
      // crossfade. Browser Back/Forward keeps its own restored position.
      if (!options.pop && target.pathname === "/feed" &&
          prevPathname === "/feed" && window.scrollY > 0) {
        window.scrollTo({ top: 0, behavior: "instant" });
      }
      // Preserve the shared list animation. A user-clicked query is ignored
      // during an active list animation, while browser Back/Forward always
      // completes to remain in sync with its already-updated history URL.
      if (options.pop) {
        change();
        release();
      } else {
        // Hold same-target deduplication until the native and CSS animations
        // have settled. A newer route supersedes this callback safely.
        listTransition(() => {
          if (serial === operation.current) change();
        }, release);
      }
    } else {
      change();
      release();
    }
    if (target.pathname !== prevPathname)
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>("main")
          ?.focus({ preventScroll: true }),
      );
  }
  useEffect(() => {
    history.scrollRestoration = "manual";
    key.current = offlinePreview()
      ? newId()
      : history.state?.echoKey || newId();
    if (offlinePreview())
      fileHistory.current = {
        entries: [{ route: currentRoute(), key: key.current }],
        index: 0,
      };
    else
      history.replaceState(
        { ...history.state, echoKey: key.current },
        "",
        location.href,
      );
    visitedRoutes.current.set(key.current, {
      route: currentRoute(),
      fromKey: offlinePreview() ? null : (history.state?.echoFrom || null),
    });
    if (currentRoute() !== initialPath) setPath(currentRoute());
    if (!location.hash) {
      const y = transient.get(`scroll:${key.current}`, 0);
      if (y)
        requestAnimationFrame(() =>
          window.scrollTo({ top: y, behavior: "instant" }),
        );
    }
    const pop = (event: PopStateEvent) => {
      if (!offlinePreview())
        void navigate(currentRoute(), {
          pop: true,
          key: event.state?.echoKey || newId(),
        });
    };
    const hashChange = () => {
      if (!offlinePreview() || currentRoute() === pathRef.current) return;
      const route = currentRoute(),
        trail = fileHistory.current;
      let index = trail.entries.findIndex(
        (entry, i) => i === trail.index - 1 && entry.route === route,
      );
      if (index < 0)
        index = trail.entries.findIndex(
          (entry, i) => i === trail.index + 1 && entry.route === route,
        );
      if (index < 0) {
        trail.entries.splice(trail.index + 1);
        trail.entries.push({ route, key: newId() });
        index = trail.entries.length - 1;
      }
      trail.index = index;
      void navigate(route, { pop: true, key: trail.entries[index].key });
    };
    const pagehide = () => save();
    const click = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        "a[href]",
      );
      if (!link || link.target || link.hasAttribute("download")) return;
      if (offlinePreview()) {
        const href = link.getAttribute("href") || "";
        if (href.startsWith("#/") || href.startsWith("/post/")) {
          event.preventDefault();
          void navigate(href.startsWith("#/") ? href.slice(1) : href);
        }
        return;
      }
      const target = new URL(link.href, location.href);
      if (target.origin !== location.origin || !isAppRoute(target.pathname))
        return;
      event.preventDefault();
      void navigate(target.pathname + target.search + target.hash);
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("hashchange", hashChange);
    window.addEventListener("pagehide", pagehide);
    document.addEventListener("click", click);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("hashchange", hashChange);
      window.removeEventListener("pagehide", pagehide);
      document.removeEventListener("click", click);
    };
  }, []);
  useEffect(() => {
    const m = metadata(path);
    document.title = m.title;
    const values: [string, string, string][] = [
      ['meta[name="description"]', "content", m.description],
      ['link[rel="canonical"]', "href", m.canonical],
      ['meta[property="og:title"]', "content", m.title],
      ['meta[property="og:description"]', "content", m.description],
      ['meta[property="og:url"]', "content", m.canonical],
      ['meta[property="og:image"]', "content", m.image.replace(".svg", ".png")],
      ['meta[property="og:type"]', "content", m.post ? "article" : "website"],
    ];
    for (const [selector, attribute, value] of values)
      document.querySelector(selector)?.setAttribute(attribute, value);
    const structured = document.getElementById("structured-data");
    if (structured)
      structured.textContent = JSON.stringify(structuredData(m));
  }, [path]);
  return (
    <Context
      value={{
        path,
        navigate,
        back: () => {
          if (offlinePreview()) {
            if (fileHistory.current.index > 0) history.back();
            else void navigate(lastOrigin.current);
          } else if (history.state?.echoFrom) history.back();
          else void navigate(lastOrigin.current);
        },
        backToList: () => {
          // Return to the real origin, skipping neighboring articles when necessary.
          // Browser history restores the origin's filters and saved scroll position.
          if (offlinePreview()) {
            const trail = fileHistory.current;
            for (let i = trail.index - 1; i >= 0; i--) {
              if (isReturnOrigin(trail.entries[i].route)) {
                history.go(i - trail.index);
                return;
              }
            }
          } else {
            let fromKey: string | null = history.state?.echoFrom || null;
            let steps = 1;
            const seen = new Set<string>();
            while (fromKey && !seen.has(fromKey) && steps < 100) {
              seen.add(fromKey);
              const entry = visitedRoutes.current.get(fromKey);
              if (!entry) break;
              if (isReturnOrigin(entry.route)) {
                history.go(-steps);
                return;
              }
              fromKey = entry.fromKey;
              steps++;
            }
          }
          // Deep links have no in-session origin; use the last known destination.
          void navigate(lastOrigin.current);
        },
      }}
    >
      {children}
    </Context>
  );
}
export function Link({
  href = "",
  onClick,
  onPointerEnter,
  onFocus,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const router = useRouter(),
    preload = () => {
      if (href.startsWith("/post/")) void loadReader().catch(() => {});
    };
  return (
    <a
      {...props}
      href={routeHref(href)}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        preload();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        preload();
      }}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target ||
          props.download
        )
          return;
        const target = new URL(
          href,
          offlinePreview() ? "https://preview.invalid/" : location.href,
        );
        if (
          target.origin !==
          (offlinePreview() ? "https://preview.invalid" : location.origin) ||
          !isAppRoute(target.pathname)
        )
          return;
        event.preventDefault();
        router.navigate(href);
      }}
    />
  );
}
