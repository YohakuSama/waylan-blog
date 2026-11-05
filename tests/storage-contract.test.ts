import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { storage, transient } from "../src/lib/storage";

function fakeStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
  };
}

/** Replaces global stores only inside a synchronous test and restores original descriptors. */
function withStores(run: (persistent: ReturnType<typeof fakeStorage>, session: ReturnType<typeof fakeStorage>) => void) {
  const previousLocal = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousSession = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const persistent = fakeStorage(), session = fakeStorage();
  const define = (name: string, value: unknown) => {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const restore = (name: string, original?: PropertyDescriptor) => {
    if (original) Object.defineProperty(globalThis, name, original);
    else Reflect.deleteProperty(globalThis, name);
  };
  try {
    define("localStorage", persistent);
    define("sessionStorage", session);
    run(persistent, session);
  } finally {
    restore("localStorage", previousLocal);
    restore("sessionStorage", previousSession);
  }
}

describe("local and session storage boundary contracts", () => {
  it("retains independent echo-prefixed persistence, exact parse values and fallbacks", () => {
    withStores((local, session) => {
      const fallback = { old: true };
      assert.equal(storage.get("missing", fallback), fallback);
      assert.equal(transient.get("missing", fallback), fallback);
      assert.equal(storage.set("reader", { progress: 34 }), true);
      assert.equal(local.values.get("echo:reader"), '{"progress":34}');
      assert.deepEqual(storage.get("reader", fallback), { progress: 34 });
      assert.equal(transient.get("reader", "session-unset"), "session-unset");
      assert.equal(transient.set("reader", { draft: "saved" }), undefined);
      assert.deepEqual(transient.get("reader", fallback), { draft: "saved" });
      assert.equal(session.values.get("echo:reader"), '{"draft":"saved"}');
      assert.deepEqual(storage.get("reader", fallback), { progress: 34 });
      local.values.set("echo:bad", "{broken");
      session.values.set("echo:bad", "undefined");
      assert.equal(storage.get("bad", fallback), fallback);
      assert.equal(transient.get("bad", fallback), fallback);
      local.values.set("echo:null", "null");
      session.values.set("echo:zero", "0");
      session.values.set("echo:false", "false");
      assert.equal(storage.get("null", fallback), fallback);
      assert.equal(transient.get("zero", 17), 0);
      assert.equal(transient.get("false", true), false);
      assert.equal(storage.remove("reader"), true);
      assert.equal(transient.remove("reader"), undefined);
      assert.equal(local.values.has("echo:reader"), false);
      assert.equal(session.values.has("echo:reader"), false);
    });
  });

  it("preserves failure differences when storage APIs or global getters are denied", () => {
    withStores((local, session) => {
      local.getItem = () => { throw new Error("local read denied"); };
      session.getItem = () => { throw new Error("session read denied"); };
      assert.equal(storage.get("x", "fallback"), "fallback");
      assert.equal(transient.get("x", "fallback"), "fallback");
      local.setItem = () => { throw new Error("local write denied"); };
      session.setItem = () => { throw new Error("session write denied"); };
      local.removeItem = () => { throw new Error("local remove denied"); };
      session.removeItem = () => { throw new Error("session remove denied"); };
      assert.equal(storage.set("x", "v"), false);
      assert.equal(transient.set("x", "v"), undefined);
      assert.equal(storage.remove("x"), false);
      assert.equal(transient.remove("x"), undefined);

      Object.defineProperty(globalThis, "localStorage", {
        configurable: true, get() { throw new Error("global localStorage unavailable"); },
      });
      Object.defineProperty(globalThis, "sessionStorage", {
        configurable: true, get() { throw new Error("global sessionStorage unavailable"); },
      });
      assert.equal(storage.get("x", 7), 7);
      assert.equal(transient.get("x", 9), 9);
    });
  });
});
