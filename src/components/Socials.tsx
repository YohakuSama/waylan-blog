import { Github, Link2, Mail, MessageCircle, MessagesSquare, Phone, Send } from "lucide-react";
import { site } from "../lib/data";

/** Normalised by scripts/content.ts: `kind` and `label` are always present. */
export type Social = { url: string; kind: string; label: string };
export const socials = site.socials as Social[];

// X has no Lucide glyph; path from Simple Icons (CC0).
function XLogo({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function SocialIcon({
  kind,
  size = 17,
}: {
  kind: string;
  size?: number;
}) {
  if (kind === "x") return <XLogo size={size - 2} />;
  if (kind === "telegram") return <Send size={size} aria-hidden="true" />;
  if (kind === "discord") return <MessagesSquare size={size} aria-hidden="true" />;
  if (kind === "signal") return <MessageCircle size={size} aria-hidden="true" />;
  if (kind === "phone") return <Phone size={size} aria-hidden="true" />;
  if (kind === "github") return <Github size={size} aria-hidden="true" />;
  if (kind === "email") return <Mail size={size} aria-hidden="true" />;
  return <Link2 size={size} aria-hidden="true" />;
}

const external = (s: Social) =>
  s.kind === "email" || s.kind === "phone"
    ? {}
    : { target: "_blank", rel: "me noopener noreferrer" };

/** Icon-only row, used next to RSS in the sidebar profile. */
export function SocialIcons() {
  return socials.map((s) => (
    <a
      key={s.url}
      className="icon-button"
      href={s.url}
      aria-label={s.label}
      data-tip={s.kind === "email" ? s.url.slice(7) : s.kind === "phone" ? s.url.slice(4) : s.label}
      {...external(s)}
    >
      <SocialIcon kind={s.kind} />
    </a>
  ));
}

/** Labelled list for the About page; e-mail shows the address itself. */
export function SocialList() {
  if (!socials.length) return null;
  return (
    <ul className="social-links">
      {socials.map((s) => (
        <li key={s.url} className={s.kind === "email" || s.kind === "phone" ? "contact-address" : undefined}>
          <a href={s.url} {...external(s)}>
            <SocialIcon kind={s.kind} size={16} />
            <span>{s.kind === "email" ? s.url.slice(7) : s.kind === "phone" ? s.url.slice(4) : s.label}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
