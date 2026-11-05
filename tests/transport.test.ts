import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import worker from "../worker/index";
import { cookie, cookieName } from "../worker/security";
import type { Env } from "../worker/types";

describe("HTTPS transport safeguards", () => {
  it("redirects HTTP API requests before OAuth cookies or state are created", async () => {
    const cases: Array<[string, string]> = [
      ["/api/auth/github?return=%2Ffeed", "GET"],
      ["/api/auth/callback?state=sample", "GET"],
      ["/api/logout", "POST"],
      ["/api/not-found", "GET"],
    ];
    for (const [path, method] of cases) {
      const response = await worker.fetch(
        new Request("http://waylan.org" + path, { method }),
        {} as Env,
      );
      assert.equal(response.status, 308, path);
      assert.equal(
        response.headers.get("Location"),
        "https://waylan.org" + path,
        path,
      );
      assert.equal(response.headers.get("Set-Cookie"), null, path);
    }
  });

  it("preserves the documented loopback-only HTTP development flow", async () => {
    const local = new Request("http://localhost:8787/api/auth/github");
    const localEnv = { SITE_ORIGIN: "http://localhost:8787" } as Env;
    const response = await worker.fetch(local, localEnv);
    assert.equal(response.status, 503, "local dev should reach auth readiness, not HTTPS redirect");
    const localName = cookieName(local, "oauth");
    assert.equal(localName, "echo_oauth");
    assert.equal(cookie(local, localName, "test-value", 60).includes("; Secure"), false);

    const publicEnv = { SITE_ORIGIN: "https://waylan.org" } as Env;
    const redirected = await worker.fetch(local, publicEnv);
    assert.equal(redirected.status, 308, "a production config must not accept local HTTP");
    assert.equal(redirected.headers.get("Set-Cookie"), null);
  });

  it("never generates an unprefixed or non-Secure authentication cookie", () => {
    const insecureRequest = new Request("http://waylan.org/api/auth/github");
    for (const kind of ["oauth", "session"]) {
      const name = cookieName(insecureRequest, kind);
      assert.equal(name, `__Host-echo_${kind}`);
      const header = cookie(insecureRequest, name, "test-value", 600);
      assert.ok(header.startsWith(`${name}=test-value; Path=/;`));
      assert.match(header, /; HttpOnly;/);
      assert.match(header, /; SameSite=Lax;/);
      assert.match(header, /; Secure$/);
    }
  });

  it("sends HSTS for HTTPS API errors and configures it for static assets", async () => {
    const response = await worker.fetch(
      new Request("https://waylan.org/api/not-found"),
      {} as Env,
    );
    assert.equal(response.status, 404);
    assert.equal(
      response.headers.get("Strict-Transport-Security"),
      "max-age=86400",
    );
    const staticHeaders = readFileSync(
      new URL("../public/_headers", import.meta.url),
      "utf8",
    );
    assert.match(staticHeaders, /^\s+Strict-Transport-Security: max-age=86400\s*$/m);
  });
});
