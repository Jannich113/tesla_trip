import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cacheGet, cacheInvalidate, cacheSet, elprisTtlMs, ELPRIS_TTL_MS } from "./cache.ts";

describe("cache invalidation", () => {
  it("expires after ttl", async () => {
    cacheSet("t", "a", 1, 20);
    assert.equal(cacheGet("t", "a"), 1);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(cacheGet("t", "a"), undefined);
  });

  it("invalidate drops a key and a namespace", () => {
    cacheSet("t", "a", 1, 60_000);
    cacheSet("t", "b", 2, 60_000);
    cacheInvalidate("t", "a");
    assert.equal(cacheGet("t", "a"), undefined);
    assert.equal(cacheGet("t", "b"), 2);
    cacheInvalidate("t");
    assert.equal(cacheGet("t", "b"), undefined);
  });

  it("elpris ttl never crosses the next hour", () => {
    const at = Date.parse("2026-09-11T10:58:00Z");
    const ttl = elprisTtlMs(at);
    assert.ok(ttl <= ELPRIS_TTL_MS);
    assert.ok(ttl <= 2 * 60 * 1000 + 10_000);
  });
});
