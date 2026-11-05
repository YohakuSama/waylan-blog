import { useEffect, useState, type RefObject } from "react";
import type { Post } from "../../../shared/types";
import { storage } from "../../lib/storage";

/** Owns the reader scroll observer, TOC tracking and explicit resume position.
 * Gesture selection remains with Reader so Safari's touch dismissal stays intact.
 */
export function useReadingProgress(
  post: Post,
  article: RefObject<HTMLElement | null>,
  prose: RefObject<HTMLDivElement | null>,
  excerptMode: boolean,
  dismissSelection: (value: null) => void,
) {
  const [progress, setProgress] = useState(0);
  const [activeSection, setActiveSection] = useState(post.toc[0]?.id || "");
  useEffect(() => {
    let frame = 0;
    let lastProgress = -1;
    const update = () => {
      frame = 0;
      if (!article.current) return;
      const el = article.current,
        top = el.getBoundingClientRect().top + window.scrollY,
        bottom = top + el.offsetHeight;
      const value = Math.min(
        100,
        Math.max(
          0,
          Math.round(
            ((window.scrollY + window.innerHeight * 0.45 - top) /
              (bottom - top)) *
              100,
          ),
        ),
      );
      if (value !== lastProgress) {
        lastProgress = value;
        setProgress(value);
      }
      let current = post.toc[0]?.id || "";
      for (const heading of post.toc) {
        if (
          (prose.current?.querySelector<HTMLElement>(
            `[data-block-id="${heading.id}"]`,
          )?.getBoundingClientRect().top ?? Infinity) < 170
        )
          current = heading.id;
      }
      setActiveSection(current);
      const visible = [
        ...(prose.current?.querySelectorAll<HTMLElement>("[data-block-id]") ||
          []),
      ].find((b) => b.getBoundingClientRect().bottom > 120);
      if (window.scrollY > 100)
        storage.set("reading", {
          slug: post.slug,
          title: post.title,
          progress: value,
          blockId: visible?.dataset.blockId,
        });
    };
    const scroll = () => {
      // Native drag-selection may be transient; explicit tap-to-excerpt is a
      // deliberate choice and must survive small scrolls while taking action.
      // WebKit may dispatch scroll as the native selection handles and
      // visual viewport settle. Keep the touch action tray until explicit
      // dismissal instead of making it flash and vanish after a long press.
      if (!excerptMode && !window.matchMedia("(any-pointer: coarse)").matches)
        dismissSelection(null);
      if (!frame) frame = requestAnimationFrame(update);
    };
    // Read the saved position before the first update() can overwrite it.
    const saved =
      new URLSearchParams(location.search).get("resume") === "1"
        ? storage.get<{ slug: string; blockId?: string } | null>(
            "reading",
            null,
          )
        : null;
    window.addEventListener("scroll", scroll, { passive: true });
    update();
    const resumeId = saved?.slug === post.slug ? saved.blockId : undefined;
    if (resumeId)
      requestAnimationFrame(() =>
        document.getElementById(resumeId)?.scrollIntoView({ block: "start" }),
      );
    return () => {
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
    };
  }, [post, excerptMode]);
  return { progress, activeSection, setActiveSection };
}
