import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
export function database() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  function prepare(sql: string, values: any[] = []): any {
    return {
      bind(...args: any[]) {
        return prepare(sql, args);
      },
      async first(column?: string) {
        const row = sqlite.prepare(sql).get(...values) as any;
        return row ? (column ? row[column] : { ...row }) : null;
      },
      async all() {
        return {
          results: sqlite
            .prepare(sql)
            .all(...values)
            .map((row) => ({ ...row })),
          success: true,
          meta: {},
        };
      },
      async run() {
        const result = sqlite.prepare(sql).run(...values);
        return {
          success: true,
          results: [],
          meta: { changes: Number(result.changes) },
        };
      },
    };
  }
  const db = {
    prepare,
    async batch(statements: any[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, sqlite };
}
