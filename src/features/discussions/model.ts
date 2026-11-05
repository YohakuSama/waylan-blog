import type { Comment } from "../../../shared/types";

// GitHub can retain an empty parent after deletion to preserve replies.
// Never erase other users' upstream GitHub content.
export const visibleComment = (comment: Comment) => comment.body.trim().length > 0;

// Untrusted URLs must not become arbitrary external navigation targets.
export const safeDiscussionURL = (value: string) =>
  /^https:\/\/(github\.com|avatars\.githubusercontent\.com)\//.test(value)
    ? value
    : "#";
