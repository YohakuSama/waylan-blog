import type { Comment, CommentPage } from "../../../shared/types";

// GitHub can retain an empty parent after deletion to preserve replies.
// Never erase other users' upstream GitHub content.
export const visibleComment = (comment: Comment) => comment.body.trim().length > 0;

// Untrusted URLs must not become arbitrary external navigation targets.
export const safeDiscussionURL = (value: string) =>
  /^https:\/\/(github\.com|avatars\.githubusercontent\.com)\//.test(value)
    ? value
    : "#";

/** Merge visible root replies, direct-link results and focused comments without changing precedence. */
export function discussionView(state: CommentPage, focused: Comment | null, panelFetched: Comment[]) {
  const visibleTopComments = state.nodes.filter(visibleComment);
  const visibleCount = Math.max(0, state.totalCount - (state.nodes.length - visibleTopComments.length));
  const inVisibleThread = (comment: Comment) =>
    visibleComment(comment) && (!comment.parentId ||
      !state.nodes.some((parent) => parent.id === comment.parentId && !visibleComment(parent)));
  const allComments = [
    ...new Map(
      [
        ...visibleTopComments.flatMap((c) => [
          c,
          ...(c.replies?.nodes || []).filter(visibleComment).map((reply) => ({
            ...reply,
            parentId: c.id,
          })),
        ]),
        ...(focused && inVisibleThread(focused) ? [focused] : []),
        ...panelFetched.filter(inVisibleThread),
      ].map((c) => [c.id, c]),
    ).values(),
  ];
  return { visibleTopComments, visibleCount, allComments };
}

/** Pure reconciliation keeps optimistic edits/deletes consistent across cached pages and opened threads. */
export const updateCommentNodes = (nodes: Comment[], id: string, next: Comment | null): Comment[] =>
  nodes.flatMap((c) => {
    if (c.id === id) return next ? [{ ...c, ...next }] : [];
    if (!c.replies) return [c];
    const replies = c.replies.nodes.flatMap((r) =>
      r.id === id ? (next ? [{ ...r, ...next }] : []) : [r],
    );
    return [{ ...c, replies: {
      ...c.replies,
      nodes: replies,
      totalCount: Math.max(0, c.replies.totalCount + (next ? 0 : replies.length - c.replies.nodes.length)),
    } }];
  });

export function updateCommentPage(prev: CommentPage, id: string, next: Comment | null): CommentPage {
  return {
    ...prev,
    nodes: updateCommentNodes(prev.nodes, id, next),
    totalCount: Math.max(0, prev.totalCount + (!next && prev.nodes.some((c) => c.id === id) ? -1 : 0)),
  };
}
