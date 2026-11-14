import ts from "typescript";
import { readFile } from "node:fs/promises";
import site from "../src/generated/site.json";
// Wrangler JSONC is deliberately kept to JSON-compatible syntax in the shipped configuration.
const parsed = ts.parseConfigFileTextToJson(
  "wrangler.jsonc",
  await readFile("wrangler.jsonc", "utf8"),
);
if (parsed.error) throw new Error("wrangler.jsonc is not valid JSONC.");
const config = parsed.config;
const valid = (s: string) => !!s && !/YOUR_|REPLACE_|\.example/.test(s);
if (!valid(site.origin) || !site.origin.startsWith("https://"))
  throw new Error(
    "Set SITE_URL to your real HTTPS domain in .env, then rebuild.",
  );
if (config.vars.SITE_ORIGIN !== site.origin)
  throw new Error(
    "wrangler.jsonc SITE_ORIGIN and build-time SITE_URL must be identical.",
  );
if (config.vars.GITHUB_AUTH_PROVIDER !== "github-app")
  throw new Error("GitHub App is the only supported login provider. Set GITHUB_AUTH_PROVIDER=github-app.");
if (!valid(config.d1_databases?.[0]?.database_id))
  throw new Error(
    "Create echo-db and set its real database_id in wrangler.jsonc.",
  );
if (
  !valid(config.vars.GITHUB_REPO_OWNER) ||
  !valid(config.vars.GITHUB_REPO_NAME)
)
  throw new Error(
    "Set your public GitHub Discussions repository in wrangler.jsonc.",
  );
if (
  !valid(config.vars.ADMIN_GITHUB_LOGINS || "") ||
  !valid(config.vars.CONTENT_REPO || "")
)
  console.warn(
    "Note: /admin stays disabled until ADMIN_GITHUB_LOGINS and CONTENT_REPO are set and the GITHUB_CONTENT_TOKEN secret exists.",
  );
console.log(
  "Deployment configuration contains a real domain, repository and D1 binding. Secrets are validated by the API at runtime.",
);
