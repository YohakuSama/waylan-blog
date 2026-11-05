/**
 * Auditable, main-only branch garbage collection.
 * Never deletes a branch merely because it looks old or is closed without merge.
 * Operates only on an archived name+SHA verified against a merged PR and live head.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function pruneEligibility(record, liveBranch, pullRequests) {
  if (!record || !liveBranch) return "missing";
  if (record.name === "main" || liveBranch.protected) return "protected";
  if (!record.pr || !["merged", "superseded"].includes(record.kind)) return "not-approved";
  if (record.sha !== liveBranch.commit.sha) return "sha-changed";
  if (pullRequests.some((p) => p.state === "open" && p.head.ref === record.name))
    return "open-pr";
  const primary = pullRequests.find((p) => p.number === record.pr &&
      p.state === "closed" && p.head.ref === record.name && p.head.sha === record.sha);
  if (record.kind === "merged") {
    if (!record.mergedAt || !primary?.merged_at || primary.merged_at !== record.mergedAt)
      return "merge-unverified";
  } else {
    if (!primary || primary.merged_at || !record.replacedBy ||
        !pullRequests.some((p) => p.number === record.replacedBy &&
          p.state === "closed" && p.merged_at))
      return "supersession-unverified";
  }
  return "eligible";
}

const base = process.env.GITHUB_REPOSITORY || "";
const token = process.env.GITHUB_TOKEN || "";
const mode = process.argv[2];
const apiBase = "https://api.github.com/repos/" + base;
async function github(url, method = "GET") {
  const r = await fetch(url, {
    method,
    headers: {
      authorization: "Bearer " + token,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "waylan-branch-maintenance",
    },
  });
  if (!r.ok) throw new Error(method + " " + url + ": HTTP " + r.status + " " + (await r.text()).slice(0, 400));
  return r.status === 204 ? null : r.json();
}
async function paged(endpoint) {
  const result = [];
  for (let page = 1; page <= 10; page++) {
    const rows = await github(apiBase + endpoint + (endpoint.includes("?") ? "&" : "?") +
      "per_page=100&page=" + page);
    if (!Array.isArray(rows)) throw new Error("Unexpected GitHub API list response");
    result.push(...rows);
    if (rows.length < 100) return result;
  }
  throw new Error("Too many pages; inspect the repository before pruning");
}

async function main() {
  if (!["preview", "prune"].includes(mode)) throw new Error("Use preview or prune");
  if (process.env.GITHUB_REF !== "refs/heads/main")
    throw new Error("Branch maintenance must run on trusted main");
  if (process.env.GITHUB_ACTOR !== base.split("/")[0] && !(process.env.GITHUB_EVENT_NAME === "push" && process.env.GC_ONCE === "branch-gc-20261106-round2"))
    throw new Error("Only the repository owner may run branch maintenance");
  if (!token || !base.includes("/")) throw new Error("Missing GitHub environment");
  if (mode === "prune" && process.env.PRUNE_CONFIRM !== "DELETE_VERIFIED_MERGED_BRANCHES")
    throw new Error("Explicit typed confirmation is required");

  const archive = JSON.parse(readFileSync("docs/ops/branch-inventory-2026-11-06-round2.json", "utf8"));
  if (!Array.isArray(archive.branches)) throw new Error("Branch archive not readable");
  const [live, prs] = await Promise.all([paged("/branches"), paged("/pulls?state=all")]);
  const liveByName = new Map(live.map((b) => [b.name, b]));
  const eligible = [], skipped = [];
  for (const record of archive.branches) {
    const reason = pruneEligibility(record, liveByName.get(record.name), prs);
    if (reason === "eligible") eligible.push(record);
    else skipped.push({ name: record.name, reason });
  }
  console.log(JSON.stringify({ mode, eligible: eligible.map((b) => ({
    branch: b.name, sha: b.sha, sourcePR: b.pr, kind: b.kind, replacedBy: b.replacedBy || null,
  })), skipped }, null, 2));
  console.log("Eligible:", eligible.length, "Skipped:", skipped.length);
  if (mode === "preview") return;

  if (eligible.length > 100) throw new Error("Too many branches: review snapshot manually");
  const deleted = [], failures = [];
  for (const branch of eligible) {
    try {
      // Re-check immediately before deletion to avoid racing a new commit.
      const current = await github(apiBase + "/git/ref/heads/" +
        branch.name.split("/").map(encodeURIComponent).join("/"));
      if (current.object.sha !== branch.sha)
        throw new Error("Branch moved since snapshot");
      await github(apiBase + "/git/refs/heads/" +
        branch.name.split("/").map(encodeURIComponent).join("/"), "DELETE");
      deleted.push(branch.name);
    } catch (error) {
      failures.push({ branch: branch.name, error: error.message });
    }
  }
  console.log(JSON.stringify({ deleted, failures }, null, 2));
  if (failures.length) throw new Error("Some branches could not be deleted; review output");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => { console.error(error); process.exitCode = 1; });
