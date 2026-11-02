import { mkdir, writeFile } from "node:fs/promises";
import manifest from "../worker/generated/manifest.json";
import site from "../src/generated/site.json";
import {
  discussionBody,
  discussionMarker,
  discussionTitle,
} from "../shared/discussions";
try {
  process.loadEnvFile(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
const owner = process.env.GITHUB_REPO_OWNER,
  name = process.env.GITHUB_REPO_NAME,
  token = process.env.GITHUB_SETUP_TOKEN,
  categoryName = process.env.GITHUB_CATEGORY_NAME || "Blog",
  origin = process.env.SITE_URL;
if (
  !owner ||
  !name ||
  !token ||
  !origin ||
  [owner, name, token, origin].some((v) => /YOUR_|REPLACE_|\.example/.test(v))
)
  throw new Error(
    "Set SITE_URL, GITHUB_REPO_OWNER, GITHUB_REPO_NAME and GITHUB_SETUP_TOKEN in your private .env first.",
  );
async function gql<T>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "ECHO-Setup/1.0",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  const body = (await response.json()) as {
    data: T;
    errors?: { message: string }[];
  };
  if (!response.ok || body.errors)
    throw new Error(
      `GitHub setup request failed (${response.status}). Check token permissions, public repository and Discussions settings.`,
    );
  return body.data;
}
type Existing = { id: string; number: number; url: string; body: string };
const data = await gql<{
  repository: {
    id: string;
    isPrivate: boolean;
    discussionCategories: { nodes: { id: string; name: string }[] };
  };
}>(
  `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id isPrivate discussionCategories(first:100){nodes{id name}}}}`,
  { owner, name },
);
if (!data.repository || data.repository.isPrivate)
  throw new Error("Waylan requires a public Discussions repository.");
const category = data.repository.discussionCategories.nodes.find(
  (c) => c.name === categoryName,
);
if (!category)
  throw new Error(
    `Create an open-ended Discussions category named ${categoryName}, or set GITHUB_CATEGORY_NAME.`,
  );
const discussions: Existing[] = [];
let after: string | null = null;
do {
  const result: {
    repository: {
      discussions: {
        nodes: Existing[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    };
  } = await gql<{
    repository: {
      discussions: {
        nodes: Existing[];
        pageInfo: { hasNextPage: boolean; endCursor: string };
      };
    };
  }>(
    `query($owner:String!,$name:String!,$after:String){repository(owner:$owner,name:$name){discussions(first:100,after:$after){nodes{id number url body} pageInfo{hasNextPage endCursor}}}}`,
    { owner, name, after },
  );
  discussions.push(...result.repository.discussions.nodes);
  after = result.repository.discussions.pageInfo.hasNextPage
    ? result.repository.discussions.pageInfo.endCursor
    : null;
  if (discussions.length > 10000)
    throw new Error(
      "More than 10,000 Discussions. Narrow the repository before setup.",
    );
} while (after);
const write = process.argv.includes("--write"),
  sql: string[] = [];
const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
for (const post of manifest) {
  const marker = discussionMarker(post.id);
  let discussion = discussions.find((d) => d.body.includes(marker));
  if (!discussion && !write) {
    console.log(`Would create: ${post.id} / ${post.title}`);
    continue;
  }
  if (!discussion) {
    const result = await gql<{ createDiscussion: { discussion: Existing } }>(
      `mutation($input:CreateDiscussionInput!){createDiscussion(input:$input){discussion{id number url body}}}`,
      {
        input: {
          repositoryId: data.repository.id,
          categoryId: category.id,
          title: discussionTitle(post),
          body: discussionBody(post, origin, site.name),
        },
      },
    );
    discussion = result.createDiscussion.discussion;
  }
  sql.push(
    `INSERT INTO discussions(post_id,discussion_id,discussion_number,url) VALUES(${quote(post.id)},${quote(discussion.id)},${discussion.number},${quote(discussion.url)}) ON CONFLICT(post_id) DO UPDATE SET discussion_id=excluded.discussion_id,discussion_number=excluded.discussion_number,url=excluded.url;`,
  );
  console.log(`Mapped: ${post.id} → Discussion #${discussion.number}`);
}
if (write) {
  await mkdir(".echo", { recursive: true });
  await writeFile(
    ".echo/discussions.sql",
    "-- Public IDs only. Apply after migrations and .echo/posts.sql.\n" +
      sql.join("\n") +
      "\n",
    { mode: 0o600 },
  );
  console.log(
    "Saved .echo/discussions.sql. Apply it with the README commands.",
  );
} else
  console.log(
    "Read-only plan. Run npm run setup:github -- --write to create missing Discussions and generate mappings.",
  );
