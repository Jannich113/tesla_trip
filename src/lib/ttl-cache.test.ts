import assert from "node:assert/strict";
import { test } from "node:test";
import { TtlCache } from "./ttl-cache.ts";

test("TtlCache returns values until they expire", () => {
  let now = 0;
  const cache = new TtlCache<number>(1_000, 10, () => now);
  cache.set("a", 1);
  now = 999;
  assert.equal(cache.get("a"), 1);
  now = 1_001;
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.size, 0);
});

test("TtlCache keeps empty results (a section with no chargers is still an answer)", () => {
  const cache = new TtlCache<number[]>(1_000);
  cache.set("empty", []);
  assert.deepEqual(cache.get("empty"), []);
});

test("TtlCache evicts the oldest entry past its size cap", () => {
  const cache = new TtlCache<string>(60_000, 2);
  cache.set("a", "A");
  cache.set("b", "B");
  cache.set("c", "C");
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), "B");
  assert.equal(cache.get("c"), "C");
});
