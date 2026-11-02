import { useEffect, useRef, type DependencyList, type RefObject } from "react";
import { motionAllowed } from "./motion";

/**
 * One-shot reveal for list items. Items already on screen when the list
 * mounts are left alone (no flashing on load); items further down rise in as
 * they scroll into view. After `grow()` (load more), the newly added items
 * rise in with a short stagger wherever they are.
 */
export function useReveal<T extends HTMLElement>(
  selector: string,
  deps: DependencyList,
): [RefObject<T | null>, () => void] {
  const ref = useRef<T>(null),
    grown = useRef(false);
  useEffect(() => {
    const root = ref.current,
      all = grown.current;
    grown.current = false;
    if (!root || !motionAllowed() || typeof IntersectionObserver === "undefined")
      return;
    const fresh = [...root.querySelectorAll<HTMLElement>(selector)].filter(
      (el) => !("revealed" in el.dataset),
    );
    const pending = fresh.filter((el) => {
      el.dataset.revealed = "";
      return all || el.getBoundingClientRect().top > window.innerHeight;
    });
    if (!pending.length) return;
    for (const el of pending) el.classList.add("reveal-pending");
    const observer = new IntersectionObserver(
      (entries) => {
        entries
          .filter((entry) => entry.isIntersecting)
          .forEach((entry, i) => {
            const el = entry.target as HTMLElement;
            observer.unobserve(el);
            el.style.setProperty("--reveal-delay", `${Math.min(i, 5) * 60}ms`);
            el.classList.add("reveal-in");
            el.classList.remove("reveal-pending");
            const done = (e: TransitionEvent) => {
              if (e.target !== el || e.propertyName !== "transform") return;
              el.removeEventListener("transitionend", done);
              el.classList.remove("reveal-in");
              el.style.removeProperty("--reveal-delay");
            };
            el.addEventListener("transitionend", done);
          });
      },
      { rootMargin: "0px 0px -6% 0px" },
    );
    for (const el of pending) observer.observe(el);
    return () => {
      observer.disconnect();
      // Never leave anything hidden if the list changes mid-reveal.
      for (const el of pending) el.classList.remove("reveal-pending");
    };
  }, deps);
  return [ref, () => (grown.current = true)];
}
