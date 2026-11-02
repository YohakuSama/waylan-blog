import { useEffect, useRef } from "react";

const DELAY = 480,
  WARM = 360,
  GAP = 8,
  EDGE = 8;

/**
 * One tooltip for every `[data-tip]`. The first waits a beat; while it (or one
 * that just closed) is up, neighbours answer at once, so a toolbar can be read
 * by sweeping across it. It grows out of the side facing its trigger and lives
 * in the top layer so it also works inside open dialogs. Purely visual: every
 * trigger already has an accessible name.
 */
export function Tooltips() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = ref.current!,
      layer = typeof tip.showPopover === "function";
    let target: HTMLElement | null = null,
      timer: ReturnType<typeof setTimeout> | undefined,
      warmUntil = 0;
    const shown = () => "show" in tip.dataset;
    const place = (el: HTMLElement) => {
      if (!el.isConnected || !el.dataset.tip) return;
      if (layer) {
        // Re-enter the top layer so a dialog opened since sits underneath.
        if (tip.matches(":popover-open")) tip.hidePopover();
        tip.showPopover();
      }
      tip.textContent = el.dataset.tip;
      const r = el.getBoundingClientRect(),
        t = tip.getBoundingClientRect(),
        below = r.bottom + GAP + t.height <= window.innerHeight - EDGE,
        x = Math.min(
          Math.max(r.left + r.width / 2 - t.width / 2, EDGE),
          window.innerWidth - t.width - EDGE,
        ),
        y = below ? r.bottom + GAP : r.top - GAP - t.height;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      tip.style.transformOrigin = `${r.left + r.width / 2 - x}px ${below ? 0 : t.height}px`;
      tip.dataset.side = below ? "below" : "above";
      void tip.offsetWidth;
      tip.dataset.show = "";
    };
    const hide = () => {
      clearTimeout(timer);
      if (shown()) warmUntil = performance.now() + WARM;
      target = null;
      delete tip.dataset.show;
    };
    const show = (el: HTMLElement) => {
      if (el === target) return;
      const warm = shown() || performance.now() < warmUntil;
      hide();
      target = el;
      if (warm) place(el);
      else timer = setTimeout(() => target === el && place(el), DELAY);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const el = (e.target as Element).closest?.<HTMLElement>("[data-tip]");
      if (el?.dataset.tip) show(el);
      else if (target) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.dataset?.tip && el.matches(":focus-visible")) {
        warmUntil = performance.now() + WARM;
        show(el);
      }
    };
    const blur = (e: FocusEvent) => e.target === target && hide();
    const out = (e: PointerEvent) => !e.relatedTarget && hide();
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
      window.removeEventListener("scroll", hide, { capture: true });
    };
  }, []);
  return <div ref={ref} className="tooltip" popover="manual" aria-hidden="true" />;
}
