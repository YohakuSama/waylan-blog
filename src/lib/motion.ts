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
type Transition = { finished: Promise<void>; skipTransition: () => void };
export type Direction = "forward" | "back";
export type RouteMotion = "collection" | "reader" | "resume";
let routeMotionSerial = 0;
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
/**
 * Route navigation changes the document scroll position and can replace large,
 * differently shaped content trees. Native cross-document-style snapshots
 * duplicate those trees during a frame: on mobile WebKit this visibly stacks
 * archived text over feed cards and sends cover images across the viewport.
 *
 * Apply the route first, then animate ONLY the new main's opacity. No old page,
 * title, cover, nav label or Safari chrome is snapshotted. Same-page sort and
 * filter changes still use the separate listTransition() path below.
 */
export function navigateWithMotion(
  change: () => void,
  direction: Direction = "forward",
  kind: RouteMotion = "reader",
): Transition {
  const root = document.documentElement;
  // A filter/sort transition can still be in flight when a reader link is
  // clicked. Cancel its top-layer screenshot before changing routes.
  const list = activeListDocuments.get(document);
  if (list) {
    list.queued?.onFinished?.();
    list.queued = null;
    list.abort?.();
  }
  const serial = ++routeMotionSerial;
  root.dataset.navDir = direction;
  root.dataset.routeMotion = kind;
  const cleanup = () => {
    if (serial !== routeMotionSerial) return;
    delete root.dataset.navDir;
    delete root.dataset.routeMotion;
  };
  // There must be no asynchronously scheduled native View Transition callback:
  // browser Back and a second fast tap must always apply the next route now.
  try {
    change();
  } catch (error) {
    cleanup();
    throw error;
  }
  if (!motionAllowed()) {
    cleanup();
    return { finished: Promise.resolve(), skipTransition() {} };
  }
  const main = document.querySelector("main");
  const fade = animateElement(
    main,
    [{ opacity: 0.25 }, { opacity: 1 }],
    { duration: 170, easing: token("--ease-out", "ease-out") },
  );
  if (!fade) {
    cleanup();
    return { finished: Promise.resolve(), skipTransition() {} };
  }
  let stopped = false;
  const finished = fade.finished.catch(() => {}).then(() => cleanup());
  return {
    finished,
    skipTransition: () => {
      if (stopped) return;
      stopped = true;
      fade.cancel();
      cleanup();
    },
  };
}

/**
 * Same-page re-ordering (filters, sort, density). Cards keep their identity so
 * they glide to their new slots; the active pill slides between tabs.
 * Without View Transitions the change simply applies.
 */
// Only list-changing actions share this gate. Never lock typing, browser
// navigation, dialog dismissal or assistive controls behind a global click timer.
type QueuedListChange = { change: () => void; onFinished?: () => void };
type ListTransaction = { queued: QueuedListChange | null; abort?: () => void };
const activeListDocuments = new WeakMap<Document, ListTransaction>();
export function listTransition(change: () => void, onFinished?: () => void) {
  const doc = document as ViewTransitionDocument;
  const active = activeListDocuments.get(doc);
  if (active) {
    // The browser may still be animating a previous sort. Never silently drop
    // the latest user choice; execute it once the current snapshot settles.
    // Superseded pending route callbacks must still release their locks.
    active.queued?.onFinished?.();
    active.queued = { change, onFinished };
    return;
  }
  if (!motionAllowed()) {
    try { change(); } finally { onFinished?.(); }
    return;
  }

  const root = doc.documentElement;
  const transaction: ListTransaction = { queued: null };
  activeListDocuments.set(doc, transaction);
  root.dataset.listBusy = "true";
  let changed = false;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    activeListDocuments.delete(doc);
    if (root.dataset.vt === "list") delete root.dataset.vt;
    delete root.dataset.listBusy;
    onFinished?.();
    const next = transaction.queued;
    if (next) {
      // Allow the completed View Transition to release its top-layer snapshot
      // before launching the final requested update. The router's serial guard
      // prevents a stale queued destination from overwriting a newer route.
      queueMicrotask(() => listTransition(next.change, next.onFinished));
    }
  };
  // A safety valve, not a debounce: normal release is driven by actual
  // animation completion. A stalled browser API must never freeze interaction.
  const watchdog = setTimeout(finish, 1500);
  transaction.abort = finish;
  const commit = () => {
    if (changed) return;
    changed = true;
    change();
  };
  const afterVisuals = () => {
    if (settled) return;
    // Native page transitions can finish before the category pill's own
    // clip-path animation does. Wait for both before accepting another click.
    try {
      const animations = [...doc.querySelectorAll<HTMLElement>(
        ".type-fill, .feed-list, .feed-item, .view-toggle",
      )].flatMap((element) => element.getAnimations?.() || []).filter(
        (animation) => animation.playState !== "finished" &&
          animation.effect?.getComputedTiming().iterations !== Infinity,
      );
      if (!animations.length) finish();
      else void Promise.allSettled(animations.map((animation) => animation.finished))
        .then(finish);
    } catch {
      finish();
    }
  };
  if (motionLevel() === "shared" && doc.startViewTransition) {
    root.dataset.vt = "list";
    try {
      const transition = doc.startViewTransition(commit);
      transaction.abort = () => {
        try { transition.skipTransition(); } finally { finish(); }
      };
      void transition.finished.then(afterVisuals, () => {
        try {
          // A rejected transition must still apply the requested state once.
          commit();
        } catch {
          // A broken update callback must not leave the interface locked.
        } finally {
          afterVisuals();
        }
      });
      return;
    } catch {
      try {
        commit();
      } finally {
        finish();
      }
      return;
    }
  }
  // In engines without View Transitions, wait for *finite, real* CSS
  // transitions on the affected list/pill, not an arbitrary fixed delay.
  try {
    commit();
    const frame = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : (callback: FrameRequestCallback) => setTimeout(callback, 0);
    frame(afterVisuals);
  } catch (error) {
    finish();
    throw error;
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

/** Shared motion path for resizing a native <dialog> in the top layer.
 * Animate fixed pixel bounds, not the content transform: text remains legible
 * and both directions follow the same layout path and motion tokens.
 * Layout changes must be committed before calling this (useLayoutEffect).
 */
export function animateDialogResize(
  dialog: HTMLElement,
  from: DOMRectReadOnly,
  to: DOMRectReadOnly,
  fromRadius: string,
  toRadius: string,
): Animation | null {
  if (!motionAllowed()) return null;
  if (
    Math.abs(from.left - to.left) < 0.5 &&
    Math.abs(from.top - to.top) < 0.5 &&
    Math.abs(from.width - to.width) < 0.5 &&
    Math.abs(from.height - to.height) < 0.5
  ) return null;
  const frame = (rect: DOMRectReadOnly, radius: string): Keyframe => ({
    position: "fixed",
    inset: "auto",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    right: "auto",
    bottom: "auto",
    margin: "0",
    boxSizing: "border-box",
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    // The resting composer has min-height and max-inline-size constraints.
    // Suspend all of them during FLIP so a desktop resize cannot snap once
    // before the animation starts or when it crosses a responsive threshold.
    minWidth: "0",
    minHeight: "0",
    maxWidth: "none",
    maxHeight: "none",
    maxInlineSize: "none",
    maxBlockSize: "none",
    borderRadius: radius,
  });
  const timing = token("--motion-page", "320ms", dialog);
  const duration = timing.endsWith("ms")
    ? Number.parseFloat(timing)
    : timing.endsWith("s")
      ? Number.parseFloat(timing) * 1000
      : 320;
  return animateElement(dialog, [frame(from, fromRadius), frame(to, toRadius)], {
    duration: Number.isFinite(duration) ? duration : 320,
    easing: token("--ease-out", "cubic-bezier(.22,1,.36,1)", dialog),
    fill: "none",
  });
}
