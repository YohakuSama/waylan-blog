import { storage } from "./storage";
export type MotionPreference = "system" | "full" | "reduced";
export function motionPreference(): MotionPreference {
  const current =
    typeof document !== "undefined"
      ? document.documentElement.dataset.motionPreference
      : undefined;
  const value = current || storage.get<string>("motion", "system");
  return value === "full" || value === "reduced" || value === "system" ? value : "system";
}
export function motionAllowed() {
  const preference = motionPreference();
  return (
    preference === "full" ||
    (preference === "system" &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}
export function motionLevel() {
  return !motionAllowed()
    ? "off"
    : motionPreference() === "full" || (navigator.hardwareConcurrency || 8) > 2
      ? "shared"
      : "simple";
}
export function applyMotionPreference(preference = motionPreference()) {
  document.documentElement.dataset.motion =
    preference === "reduced" ||
    (preference === "system" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches)
      ? "reduced"
      : "full";
  document.documentElement.dataset.motionPreference = preference;
}
export function setMotionPreference(preference: MotionPreference) {
  storage.set("motion", preference);
  applyMotionPreference(preference);
}
export function animateElement(
  element: Element | null,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (!motionAllowed() || !element || typeof element.animate !== "function")
    return null;
  try {
    return element.animate(keyframes, options);
  } catch {
    return null;
  }
}
type Snapshot = {
  key: string;
  src: string;
  rect: DOMRect;
  radius: string;
  objectPosition: string;
};
type Transition = { finished: Promise<void>; skipTransition: () => void };
export type Direction = "forward" | "back";
type ViewTransitionDocument = Document & {
  startViewTransition?: (change: () => void) => {
    finished: Promise<void>;
    skipTransition: () => void;
  };
};
/** Motion tokens live in CSS (motion.css); scripts read them instead of repeating values. */
export function token(name: string, fallback: string, from?: Element) {
  if (typeof document === "undefined" || !window.getComputedStyle) return fallback;
  return (
    window
      .getComputedStyle(from || document.documentElement)
      .getPropertyValue(name)
      .trim() || fallback
  );
}
function coverSnapshots() {
  const result: Snapshot[] = [];
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-shared-cover]",
  )) {
    const rect = element.getBoundingClientRect(),
      image = element.querySelector("img");
    if (
      !image ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight ||
      rect.right <= 0 ||
      rect.left >= window.innerWidth
    )
      continue;
    const style = window.getComputedStyle(element);
    result.push({
      key: element.dataset.sharedCover!,
      src: image.currentSrc || image.src,
      rect,
      radius: style.borderRadius,
      objectPosition: window.getComputedStyle(image).objectPosition,
    });
  }
  return result;
}
/** Shared image geometry is the fallback when native View Transitions are unavailable. */
function fallback(
  snapshots: Snapshot[],
  shared: boolean,
  direction: Direction,
): Transition {
  const animations: Animation[] = [],
    restorations: (() => void)[] = [];
  const targets = [
    ...document.querySelectorAll<HTMLElement>("[data-shared-cover]"),
  ];
  if (shared) {
    for (const snapshot of snapshots) {
      const target = targets.find(
          (element) => element.dataset.sharedCover === snapshot.key,
        ),
        rect = target?.getBoundingClientRect();
      if (
        !target ||
        !rect ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight
      )
        continue;
      const ghost = document.createElement("img"),
        visibility = target.style.visibility;
      ghost.src = snapshot.src;
      ghost.alt = "";
      ghost.setAttribute("aria-hidden", "true");
      ghost.className = "shared-cover-ghost";
      Object.assign(ghost.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: `${snapshot.rect.width}px`,
        height: `${snapshot.rect.height}px`,
        maxWidth: "none",
        objectFit: "cover",
        objectPosition: snapshot.objectPosition || "50% 50%",
        transformOrigin: "0 0",
        borderRadius: snapshot.radius || "0px",
        margin: "0",
        pointerEvents: "none",
        zIndex: "60",
      });
      document.body.appendChild(ghost);
      const animation = animateElement(
        ghost,
        [
          {
            transform: `translate(${snapshot.rect.left}px,${snapshot.rect.top}px) scale(1,1)`,
          },
          {
            transform: `translate(${rect.left}px,${rect.top}px) scale(${rect.width / snapshot.rect.width},${rect.height / snapshot.rect.height})`,
            borderRadius: window.getComputedStyle(target).borderRadius,
          },
        ],
        { duration: 300, easing: token("--ease-out", "ease-out"), fill: "both" },
      );
      if (animation) {
        target.style.visibility = "hidden";
        animations.push(animation);
        restorations.push(() => {
          target.style.visibility = visibility;
          ghost.remove();
        });
      } else ghost.remove();
    }
  }
  // Same language as the native ::view-transition-new(main) keyframes in motion.css.
  const entry = animateElement(
    document.querySelector("main"),
    [
      { opacity: 0, transform: `translateY(${direction === "back" ? -8 : 10}px)` },
      { opacity: 1, transform: "none" },
    ],
    { duration: shared ? 280 : 200, easing: token("--ease-out", "ease-out") },
  );
  if (entry) animations.push(entry);
  let clean = false;
  const cleanup = () => {
    if (clean) return;
    clean = true;
    restorations.forEach((restore) => restore());
  };
  const finished = Promise.allSettled(
    animations.map((animation) => animation.finished),
  ).then(() => cleanup());
  return {
    finished,
    skipTransition: () => {
      animations.forEach((animation) => animation.cancel());
      cleanup();
    },
  };
}
/**
 * Route change. "forward" goes deeper (list → article), "back" returns;
 * motion.css mirrors the direction so a page leaves the way it came.
 */
export function navigateWithMotion(
  change: () => void,
  direction: Direction = "forward",
): Transition {
  const level = motionLevel();
  if (level === "off") {
    change();
    return { finished: Promise.resolve(), skipTransition() {} };
  }
  const root = document.documentElement;
  root.dataset.navDir = direction;
  const settle = (t: Transition): Transition => {
    t.finished.finally(() => {
      if (root.dataset.navDir === direction) delete root.dataset.navDir;
    });
    return t;
  };
  const snapshots = level === "shared" ? coverSnapshots() : [];
  const doc = document as ViewTransitionDocument;
  if (level === "shared" && doc.startViewTransition) {
    let changed = false,
      cancelled = false,
      later: Transition | null = null;
    const update = () => {
      if (!changed && !cancelled) {
        changed = true;
        change();
      }
    };
    try {
      const native = doc.startViewTransition(update);
      return settle({
        finished: native.finished.catch(() => {
          if (cancelled) return;
          update();
          later = fallback(snapshots, true, direction);
          return later.finished;
        }),
        skipTransition: () => {
          cancelled = true;
          native.skipTransition();
          later?.skipTransition();
        },
      });
    } catch {
      update();
      return settle(fallback(snapshots, true, direction));
    }
  }
  change();
  return settle(fallback(snapshots, level === "shared", direction));
}

/**
 * Same-page re-ordering (filters, sort, density). Cards keep their identity so
 * they glide to their new slots; the active pill slides between tabs.
 * Without View Transitions the change simply applies.
 */
export function listTransition(change: () => void) {
  const doc = document as ViewTransitionDocument,
    root = document.documentElement;
  if (motionLevel() !== "shared" || !doc.startViewTransition) return change();
  root.dataset.vt = "list";
  try {
    doc
      .startViewTransition(change)
      .finished.catch(() => {})
      .finally(() => delete root.dataset.vt);
  } catch {
    delete root.dataset.vt;
    change();
  }
}
function visibleRect(element: Element | null | undefined) {
  // The page itself is not an origin (e.g. a dialog opened by shortcut).
  if (
    !element?.isConnected ||
    element === document.body ||
    element === document.documentElement
  )
    return null;
  const r = element.getBoundingClientRect();
  return r.width > 0 &&
    r.height > 0 &&
    r.bottom > 0 &&
    r.right > 0 &&
    r.top < window.innerHeight &&
    r.left < window.innerWidth
    ? r
    : null;
}
/**
 * A dialog grows out of whatever opened it and returns there on close.
 * The style comes from the dialog's `--dialog-motion` (motion.css), so
 * layout decides: "pop" (from the trigger), "zoom" (an image from its
 * thumbnail), "sheet" (phone bottom sheet) or "panel" (side panel).
 */
export function animateDialog(
  dialog: HTMLElement,
  origin: Element | null | undefined,
  opening: boolean,
): Animation | null {
  if (!motionAllowed()) return null;
  const kind = token("--dialog-motion", "pop", dialog),
    box = dialog.getBoundingClientRect(),
    from = visibleRect(origin);
  let hidden: Keyframe,
    transformOrigin = "50% 40%",
    fade = true;
  if (kind === "sheet") {
    hidden = { transform: "translateY(100%)" };
    fade = false;
  } else if (kind === "panel") {
    hidden = { transform: "translateX(calc(100% + 24px))" };
    fade = false;
  } else if (kind === "zoom" && from) {
    const r = dialog.querySelector("img")?.getBoundingClientRect(),
      img = r && r.width && r.height ? r : box,
      cx = img.left + img.width / 2,
      cy = img.top + img.height / 2;
    transformOrigin = `${cx - box.left}px ${cy - box.top}px`;
    hidden = {
      transform: `translate(${from.left + from.width / 2 - cx}px,${from.top + from.height / 2 - cy}px) scale(${from.width / img.width})`,
    };
  } else {
    if (from) {
      const x = from.left + from.width / 2 - box.left,
        y = from.top + from.height / 2 - box.top;
      transformOrigin = `${Math.min(Math.max(x, 0), box.width)}px ${Math.min(Math.max(y, 0), box.height)}px`;
    }
    hidden = { transform: "scale(.94)" };
  }
  const start = { ...hidden, transformOrigin, ...(fade ? { opacity: 0 } : {}) },
    end = { transform: "none", transformOrigin, ...(fade ? { opacity: 1 } : {}) };
  const sliding = kind === "sheet" || kind === "panel";
  return animateElement(dialog, opening ? [start, end] : [end, start], {
    duration: opening ? (sliding ? 360 : 320) : sliding ? 260 : 200,
    easing: opening
      ? token(sliding ? "--ease-out" : "--ease-spring", "ease-out")
      : token("--ease-in", "ease-in"),
    fill: opening ? "none" : "forwards",
  });
}
