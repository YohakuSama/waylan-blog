/**
 * Editorial identity: a geometric W tile paired with a clear wordmark.
 * Inline shapes render at first paint without an external font or logo fetch.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`wordmark ${className}`}
      viewBox="0 0 176 46"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="2" y="4" width="38" height="38" rx="10" fill="var(--ink)" />
      <path
        d="M8.5 15.5h6.3l5.2 16.1 5.1-12.8h4.1l5.1 12.8 4.6-16.1h-2.4l-4.5 19h-4l-5-12.2-4.9 12.2h-4z"
        fill="var(--paper)"
      />
      <rect x="30.5" y="11.5" width="5.5" height="2.8" rx="1" fill="var(--accent)" />
      <text x="49" y="32.5" fontFamily="Georgia, 'Times New Roman', serif"
        fontWeight="700" fontSize="30" letterSpacing="-1.45" fill="currentColor">
        waylan
      </text>
    </svg>
  );
}

/** Didone "W." — thick downstrokes, hairline upstrokes, serifs, a brand full stop. */
export const MONOGRAM_W =
  "M19.57 29 27.24 29 38.27 69.5 30.6 69.5ZM47.65 29 50.18 29 36.88 69.5 34.36 69.5ZM43.62 29 51.33 29 63.16 69.5 55.45 69.5ZM71.64 29 74.15 29 61.82 69.5 59.31 69.5ZM14.5 28h14.5v2H14.5ZM41 28h12v2H41ZM67.5 28h12v2H67.5Z";
/** Terminal variant: prompt, monospace w, block cursor. */
export const MONOGRAM_PROMPT = "M20 37l11 11-11 11";
export const MONOGRAM_MONO_W = "M37.5 37 41.2 61 46 46.5 50.8 61 54.5 37";

/**
 * Author mark. Both variants are drawn and the skin decides which shows, so the
 * prerendered HTML is identical for every visitor. Colours are theme tokens.
 */
export function Monogram({ className = "" }: { className?: string }) {
  return (
    <svg className={`monogram ${className}`} viewBox="0 0 96 96" aria-hidden="true" focusable="false">
      <g className="monogram-editorial">
        <circle cx="48" cy="48" r="48" fill="var(--surface)" />
        <circle cx="48" cy="48" r="44.5" fill="none" stroke="var(--line)" />
        <path d={MONOGRAM_W} fill="var(--ink)" />
        <circle className="monogram-dot" cx="82" cy="66.6" r="3.4" fill="var(--brand)" />
      </g>
      <g className="monogram-terminal">
        <rect width="96" height="96" fill="var(--code-bg)" />
        <path d={MONOGRAM_PROMPT} fill="none" stroke="var(--hl-prompt)" strokeWidth="5" />
        <path d={MONOGRAM_MONO_W} fill="none" stroke="var(--code-ink)" strokeWidth="4.6" strokeLinejoin="miter" />
        <rect className="monogram-cursor" x="62" y="36" width="13" height="26" fill="var(--hl-prompt)" />
      </g>
    </svg>
  );
}
