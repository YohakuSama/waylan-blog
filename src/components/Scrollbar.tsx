import { useEffect, useRef } from "react";
import { motionAllowed } from "../lib/motion";

const PAD = 3,
  MIN = 40,
  IDLE = 900;

/**
 * Overlay page scrollbar for fine pointers (the native one is hidden in CSS
 * there; touch keeps the system's). It surfaces while the page moves or the
 * pointer nears the edge, follows drags 1:1 and pages on track clicks.
 */
export function PageScrollbar() {
  const track = useRef<HTMLDivElement>(null),
    thumb = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = track.current!,
      knob = thumb.current!,
      root = document.documentElement;
    let frame = 0,
      idle: ReturnType<typeof setTimeout> | undefined,
      drag: { y: number; scroll: number; id: number } | null = null;
    const metrics = () => {
      const view = window.innerHeight,
        full = root.scrollHeight,
        room = view - PAD * 2,
        size = Math.max(MIN, (room * view) / full),
        max = full - view;
      return { view, max, size, ratio: max > 0 ? (room - size) / max : 0 };
    };
    const paint = () => {
      frame = 0;
      const m = metrics();
      bar.hidden = m.max <= 1;
      if (bar.hidden) return;
      knob.style.height = `${m.size}px`;
      knob.style.transform = `translateY(${PAD + window.scrollY * m.ratio}px)`;
    };
    const schedule = () => void (frame ||= requestAnimationFrame(paint));
    const wake = () => {
      schedule();
      bar.dataset.active = "";
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (!drag) delete bar.dataset.active;
      }, IDLE);
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (e.target === knob) {
        drag = { y: e.clientY, scroll: window.scrollY, id: e.pointerId };
        knob.setPointerCapture(e.pointerId);
        bar.dataset.dragging = "";
        return;
      }
      // Track click pages toward the pointer, like the native bar.
      const above = e.clientY < knob.getBoundingClientRect().top;
      window.scrollBy({
        top: (above ? -1 : 1) * window.innerHeight * 0.9,
        behavior: motionAllowed() ? "smooth" : "auto",
      });
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const { ratio } = metrics();
      if (ratio) window.scrollTo(0, drag.scroll + (e.clientY - drag.y) / ratio);
    };
    const up = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      delete bar.dataset.dragging;
      wake();
    };
    const resize =
      typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resize?.observe(document.body);
    window.addEventListener("scroll", wake, { passive: true });
    window.addEventListener("resize", schedule);
    bar.addEventListener("pointerdown", down);
    knob.addEventListener("pointermove", move);
    knob.addEventListener("pointerup", up);
    knob.addEventListener("pointercancel", up);
    paint();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(idle);
      resize?.disconnect();
      window.removeEventListener("scroll", wake);
      window.removeEventListener("resize", schedule);
      bar.removeEventListener("pointerdown", down);
      knob.removeEventListener("pointermove", move);
      knob.removeEventListener("pointerup", up);
      knob.removeEventListener("pointercancel", up);
    };
  }, []);
  return (
    <div ref={track} className="page-scrollbar" aria-hidden="true" hidden>
      <div ref={thumb} className="page-scrollbar-thumb" />
    </div>
  );
}
