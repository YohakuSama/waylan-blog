import type { Author, ContentType } from "../../shared/types";

/** Data exchanged with the existing privileged /api/admin/* endpoints. */
export type Session = {
  configured: boolean;
  missing: string[];
  user: Author | null;
  admin: boolean;
  csrf?: string;
};
export type Status = { head: { oid: string; date: string }; live: string | null };
export type Summary = {
  file: string;
  oid: string;
  title: string;
  id?: string;
  slug?: string;
  type?: ContentType;
  date?: string;
  topic?: string;
  draft?: boolean;
  error?: string;
};
export type Socials = { label?: string; url: string }[];
export type SiteData = Record<string, unknown> & {
  name?: string;
  author?: string;
  tagline?: string;
  description?: string;
  intro?: string;
  avatar?: string;
  profileTags?: string[];
  socials?: Socials;
};
export type Overview = Status & {
  repo: { name: string; branch: string };
  site: { oid: string; data: SiteData };
  about: { oid: string | null; text: string };
  topics: { id: string; name: string }[];
  posts: Summary[];
  discussions: { enabled: boolean; pending: { id: string; title: string }[] };
};
/** An image picked in this session; `sent` once committed, kept for previews until the site rebuilds. */
export type Upload = { path: string; data: string; url: string; sent?: boolean };

