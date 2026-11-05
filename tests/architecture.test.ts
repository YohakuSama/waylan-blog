import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const file = (path: string) => readFileSync(path, "utf8");

describe("maintainable module boundaries", () => {
  it("keeps each public route in an independent module without changing exports", () => {
    const barrel = file("src/pages.tsx");
    const names = ["Home", "Feed", "Projects", "Archive", "About", "NotFound"];
    for (const name of names) {
      assert.ok(barrel.includes(`export { ${name} } from "./pages/${name}";`));
      assert.ok(file(`src/pages/${name}.tsx`).includes(`export function ${name}()`));
    }
    assert.equal(barrel.includes("className="), false,
      "the route export file must not grow back into a mixed page component");
  });

  it("uses a single ordered CSS/font entry for online and offline builds", () => {
    const entry = file("src/styles/index.ts");
    for (const path of ["src/client.tsx", "src/offline.tsx"]) {
      const source = file(path);
      assert.ok(source.includes('import "./styles/index";'));
      assert.equal(source.includes('import "./styles/motion.css";'), false);
    }
    for (const stylesheet of ["../styles.css", "./site.css", "./skins.css", "./motion.css"])
      assert.ok(entry.includes(`import "${stylesheet}";`));
    assert.ok(entry.indexOf('"./motion.css"') > entry.indexOf('"./skins.css"'),
      "motion overrides must load last for both entrypoints");
  });

  it("keeps motion decisions in the motion module, not the route module", () => {
    const ui = file("src/components/UI.tsx");
    const router = file("src/lib/router.tsx");
    assert.match(ui, /import \{[^}]*motionAllowed[^}]*\} from "\.\.\/lib\/motion"/);
    assert.equal(ui.includes("motionOK"), false);
    assert.equal(router.includes("motionOK"), false);
    assert.ok(file("src/lib/motion.ts").includes("export function motionAllowed()"));
  });

  it("separates privileged admin transport from public API caching", () => {
    const admin = file("src/admin/main.tsx");
    const transport = file("src/admin/api.ts");
    const gate = file("src/admin/Gate.tsx");
    assert.ok(admin.includes('import { Gate } from "./Gate";'));
    assert.ok(gate.includes('import { adminApi as api, setAdminCsrf } from "./api";'));
    assert.equal(admin.includes("await fetch("), false);
    assert.ok(transport.includes('credentials: "same-origin"'));
    assert.ok(transport.includes('"X-CSRF-Token"'));
    assert.ok(transport.includes("AbortSignal.timeout(90_000)"));
    assert.ok(file("src/lib/api.ts").includes("export function useApi"));
  });

  it("keeps the existing build and regression suites as release gates", () => {
    const pkg = JSON.parse(file("package.json"));
    assert.match(pkg.scripts.test, /tests\/\*\.test\.ts/);
    assert.match(pkg.scripts.check, /typecheck/);
    assert.match(pkg.scripts.check, /build/);
    assert.match(pkg.scripts.check, /test/);
  });

  it("keeps comment reads and shared repository validation independent of the write state machine", () => {
    const entry = file("worker/index.ts");
    const writes = file("worker/comments.ts");
    const reads = file("worker/comment-reads.ts");
    const shared = file("worker/comment-shared.ts");
    assert.ok(entry.includes('from "./comments"'), "HTTP router keeps the stable module contract");
    for (const name of ["readComments", "readReplies", "feedPreviews", "readAnnotations", "getSingle", "recentEcho"])
      assert.ok(writes.includes(name), `route-facing export must retain ${name}`);
    assert.ok(reads.includes('from "./comment-shared"'));
    assert.ok(writes.includes('from "./comment-shared"'));
    assert.equal(reads.includes('from "./comments"'), false);
    assert.equal(shared.includes('from "./comments"'), false);
    assert.equal(shared.includes('from "./comment-reads"'), false);
    assert.ok(reads.includes("checkDiscussion(node, env, map)"));
    assert.ok(writes.includes("checkDiscussion(check.node, env, map)"));
    assert.ok(writes.includes('intent?.status === "sending"'));
    assert.ok(writes.includes('"DELIVERY_UNKNOWN"'));
  });
});
