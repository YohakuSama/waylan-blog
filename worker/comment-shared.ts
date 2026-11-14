import manifest from "./generated/manifest.json";
import type { CommentPage } from "../shared/types";
import { HttpError, type Env, type DiscussionMap } from "./types";

export const emptyPage: CommentPage = {
  nodes: [],
  totalCount: 0,
  pageInfo: { hasNextPage: false, endCursor: null },
  discussionUrl: null,
  mapped: false,
};
export function requirePost(postId: string) {
  const post = manifest.find((p) => p.id === postId);
  if (!post)
    throw new HttpError(404, "POST_NOT_FOUND", "这篇文字暂时找不到了。");
  return post;
}
export function cursor(value: string | null) {
  if (!value) return null;
  if (value.length > 256 || !/^[a-zA-Z0-9=+/_-]+$/.test(value))
    throw new HttpError(400, "CURSOR", "分页位置无效，请重新读取。");
  return value;
}
export type DiscussionNode = {
  id: string;
  repository: { nameWithOwner: string; isPrivate: boolean };
};
export function checkDiscussion(
  node: DiscussionNode | null,
  env: Env,
  map: DiscussionMap,
) {
  if (!node)
    throw new HttpError(
      404,
      "DISCUSSION_NOT_FOUND",
      "这篇文章的讨论已被移除。",
    );
  if (
    node.id !== map.discussion_id ||
    node.repository.isPrivate ||
    node.repository.nameWithOwner.toLowerCase() !==
      `${env.GITHUB_REPO_OWNER}/${env.GITHUB_REPO_NAME}`.toLowerCase()
  )
    throw new HttpError(403, "REPOSITORY", "讨论来源未通过公开仓库校验。");
}
