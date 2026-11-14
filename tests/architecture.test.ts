import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import * as ts from "typescript";

const file = (path: string) => readFileSync(path, "utf8");

describe("maintainable module boundaries", () => {
  it("keeps each public route in an independent module without changing exports", () => {
    const barrel = file("src/pages.tsx");
    const names = ["Home", "Feed", "Projects", "Archive", "About", "NotFound"];
    for (const name of names) {
      assert.ok(barrel.includes(`export { ${name} } from "./pages/${name}";`));
      const source = file(`src/pages/${name}.tsx`);
      if (name === "Feed") {
        // The library delegates to the existing global search dialog via a typed callback.
        assert.ok(source.includes("export function Feed({ onOpenSearch }"));
        assert.ok(file("src/App.tsx").includes("<Feed onOpenSearch={() => setSearch(true)} />"));
      } else {
        assert.ok(source.includes(`export function ${name}()`));
      }
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
    assert.ok(reads.includes("checkDiscussion(data.node, env, map)"));
    assert.ok(writes.includes("checkDiscussion(check.node, env, map)"));
    assert.ok(writes.includes('intent?.status === "sending"'));
    assert.ok(writes.includes('"DELIVERY_UNKNOWN"'));
  });

  it("keeps runtime module imports acyclic and inside client/Worker/shared boundaries", () => {
    // Analyze the real TypeScript AST instead of matching text or counting type-only imports.
    // Lazy import("../components/Reader") is intentionally not a static dependency:
    // it preserves reader chunk loading rather than creating a router/Reader cycle.
    const files: string[] = [];
    const collect = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name !== "generated") collect(join(dir, entry.name));
        } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
          files.push(resolve(dir, entry.name));
        }
      }
    };
    for (const dir of ["src", "worker", "shared", "scripts"]) collect(dir);
    assert.ok(files.length > 70, "the audit must scan the actual application and build sources");

    const known = new Set(files);
    const edges = new Map<string, string[]>();
    // Lazy imports are part of entrypoint reachability, but do not turn an
    // intentionally split browser chunk into a static import/cycle.
    const lazyEdges = new Map<string, string[]>();
    const label = (p: string) => relative(process.cwd(), p).replaceAll("\\", "/");
    for (const path of files) {
      const source = ts.createSourceFile(path, file(path), ts.ScriptTarget.Latest, false);
      const dependencies: string[] = [];
      for (const stmt of source.statements) {
        if (!ts.isImportDeclaration(stmt) && !ts.isExportDeclaration(stmt)) continue;
        if (ts.isImportDeclaration(stmt)) {
          const clause = stmt.importClause;
          if (clause?.isTypeOnly || (clause && !clause.name &&
              clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
              clause.namedBindings.elements.every((element) => element.isTypeOnly))) continue;
        } else if (stmt.isTypeOnly || (stmt.exportClause &&
            ts.isNamedExports(stmt.exportClause) &&
            stmt.exportClause.elements.every((element) => element.isTypeOnly))) continue;
        const specifier = stmt.moduleSpecifier;
        if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith(".")) continue;
        const target = resolve(dirname(path), specifier.text);
        const dependency = [
          target, target + ".ts", target + ".tsx",
          join(target, "index.ts"), join(target, "index.tsx"),
        ].find((candidate) => known.has(candidate));
        // JSON, CSS and external libraries are assets/leaf imports, not TS runtime modules.
        if (!dependency) continue;
        const from = label(path), to = label(dependency);
        if (from.startsWith("shared/"))
          assert.ok(to.startsWith("shared/"), "shared must stay platform-independent: " + from + " -> " + to);
        if (from.startsWith("src/"))
          assert.ok(!to.startsWith("worker/"), "client source must not import Worker: " + from + " -> " + to);
        if (from.startsWith("worker/"))
          assert.ok(!to.startsWith("src/"), "Worker must not import browser modules: " + from + " -> " + to);
        dependencies.push(dependency);
      }
      edges.set(path, [...new Set(dependencies)]);
      const lazy: string[] = [];
      const visitLazy = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteral(arg) && arg.text.startsWith(".")) {
            const target = resolve(dirname(path), arg.text);
            const dependency = [
              target, target + ".ts", target + ".tsx",
              join(target, "index.ts"), join(target, "index.tsx"),
            ].find((candidate) => known.has(candidate));
            assert.ok(dependency, "unresolved relative lazy TS import: " + label(path) + " -> " + arg.text);
            lazy.push(dependency);
          }
        }
        ts.forEachChild(node, visitLazy);
      };
      visitLazy(source);
      lazyEdges.set(path, [...new Set(lazy)]);
    }

    const resolved = new Set<string>(), visiting: string[] = [];
    const visit = (path: string) => {
      const start = visiting.indexOf(path);
      assert.equal(start, -1, "runtime import cycle: " +
        [...visiting.slice(Math.max(0, start)), path].map(label).join(" -> "));
      if (resolved.has(path)) return;
      visiting.push(path);
      for (const target of edges.get(path) || []) visit(target);
      visiting.pop();
      resolved.add(path);
    };
    for (const path of files) visit(path);

    // Include the rarely run GitHub setup CLI: its shared Discussions helpers
    // must not be treated as dead code just because the website does not import them.
    // Reader selection is a production import, including on Safari; the old
    // pages barrel and direct privacy route are still used by App.
    // These components are deliberately used by prerender/offline entrypoints
    // even when the client starts from a lazy Reader chunk.
    const reached = new Set<string>();
    const walk = (path: string) => {
      if (reached.has(path)) return;
      reached.add(path);
      for (const target of [...(edges.get(path) || []), ...(lazyEdges.get(path) || [])]) walk(target);
    };
    for (const path of [
      "src/client.tsx", "src/offline.tsx", "src/admin/main.tsx",
      "worker/index.ts", "scripts/prerender.tsx", "scripts/offline-preview.tsx",
      "scripts/setup-github.ts",
    ]) walk(resolve(path));
    for (const path of [
      "src/components/Boot.tsx", "src/components/Reader.tsx",
      "src/pages.tsx", "src/pages/Privacy.tsx", "src/lib/selection.ts",
      "src/features/discussions/model.ts", "src/features/reader/useReadingProgress.ts",
      "worker/comments.ts", "worker/comment-reads.ts", "worker/comment-shared.ts",
      "shared/discussions.ts",
    ]) assert.ok(reached.has(resolve(path)), path + " is still needed by a live/SSR/offline/CLI entrypoint");
    assert.ok(edges.get(resolve("src/components/Reader.tsx"))?.includes(resolve("src/lib/selection.ts")),
      "reader selection helper remains a production dependency, not merely a test fixture");
    assert.ok(edges.get(resolve("scripts/setup-github.ts"))?.includes(resolve("shared/discussions.ts")),
      "GitHub setup CLI keeps its shared discussion contract");
    assert.ok(edges.get(resolve("src/lib/router.tsx"))?.includes(resolve("src/lib/reader-loader.ts")),
      "route keeps the single reader loader entry");
    assert.ok(lazyEdges.get(resolve("src/lib/reader-loader.ts"))?.includes(resolve("src/components/Reader.tsx")),
      "literal lazy Reader target remains a reachable source module");
    assert.equal(edges.get(resolve("src/lib/reader-loader.ts"))?.includes(resolve("src/components/Reader.tsx")), false,
      "lazy Reader must not become a static eager import");
  });

});
