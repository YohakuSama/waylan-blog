import { Monogram } from "./Wordmark";

/**
 * First-load mark, rendered outside #root by the prerender scripts. theme.js
 * shows it only if fonts take a while, then fades it and removes it; the
 * monogram's skin variants decide which mark appears.
 */
export function Boot() {
  return (
    <div id="boot" className="boot" aria-hidden="true">
      <div className="boot-inner">
        <Monogram className="boot-mark" />
        <span className="boot-line" />
      </div>
    </div>
  );
}
