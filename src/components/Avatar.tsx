import { site } from "../lib/data";
import { assetURL } from "../lib/runtime";
import { Monogram } from "./Wordmark";

/**
 * Author avatar. Uses `avatar` from content/site.json (a path under public/, e.g.
 * "/avatar.jpg") when set; otherwise falls back to the script monogram.
 */
export function Avatar({
  size,
  className = "",
}: {
  size: number;
  className?: string;
}) {
  const src = (site as { avatar?: string }).avatar;
  return (
    <span
      className={`avatar ${src ? "has-photo" : ""} ${className}`}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img
          src={assetURL(src)}
          alt={`${site.author} 的头像`}
          width={size}
          height={size}
          decoding="async"
        />
      ) : (
        <Monogram />
      )}
    </span>
  );
}
