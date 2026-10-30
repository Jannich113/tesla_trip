import assert from "node:assert/strict";
import { test } from "node:test";
import { nextChargerList, partialRetryDelayMs } from "./charger-list.ts";

const row = (id: string) => ({ id });

test("a complete answer replaces the list and is cached", () => {
  const out = nextChargerList([row("a"), row("b")], [row("c")], false);
  assert.deepEqual(out, { rows: [row("c")], cache: true, retry: false });
});

test("a throttled answer never shrinks a list we already have", () => {
  // The bug in #68: a second lookup got 7 chargers instead of 270 and replaced the list.
  const known = Array.from({ length: 270 }, (_, i) => row(`k${i}`));
  const out = nextChargerList(known, known.slice(0, 7), true);
  assert.equal(out.rows.length, 270);
  assert.equal(out.cache, false);
  assert.equal(out.retry, true);
});

test("a partial answer still adds chargers it did find", () => {
  const out = nextChargerList([row("a")], [row("a"), row("new")], true);
  assert.deepEqual(out.rows.map((r) => r.id).sort(), ["a", "new"]);
});

test("a partial answer with nothing known yet is shown but not cached", () => {
  const out = nextChargerList(undefined, [row("a")], true);
  assert.deepEqual(out, { rows: [row("a")], cache: false, retry: true });
});

test("partial answers are retried a few times, then left alone", () => {
  assert.equal(partialRetryDelayMs(0), 20_000);
  assert.ok((partialRetryDelayMs(2) ?? 0) > (partialRetryDelayMs(1) ?? 0));
  assert.equal(partialRetryDelayMs(3), null);
});
