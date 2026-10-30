import assert from "node:assert/strict";
import { test } from "node:test";
import { overpassCorridorQuery, sectionNeedsOsm } from "./osm-query.ts";

const road: [number, number][] = Array.from({ length: 251 }, (_, i) => [56.95 - i * 0.004, 24.1 + i * 0.01]);

test("overpassCorridorQuery searches along the whole section, not sample points", () => {
  const q = overpassCorridorQuery(road, 12_000);
  const m = q.match(/\(around:(\d+),([^)]*)\)/);
  assert.ok(m, q);
  assert.equal(m[1], "12000");
  const coords = m[2].split(",").map(Number);
  assert.equal(coords.length % 2, 0);
  assert.deepEqual(coords.slice(0, 2), [56.95, 24.1]);
  assert.deepEqual(coords.slice(-2), [Number(road.at(-1)![0].toFixed(5)), Number(road.at(-1)![1].toFixed(5))]);
});

test("overpassCorridorQuery keeps the query small on long sections", () => {
  const q = overpassCorridorQuery(road, 12_000, 60);
  const pairs = q.match(/\(around:\d+,([^)]*)\)/)![1].split(",").length / 2;
  assert.equal(pairs, 60);
});

test("overpassCorridorQuery asks for charging stations with their tags", () => {
  const q = overpassCorridorQuery(road.slice(0, 3), 5_000);
  assert.match(q, /nwr\["amenity"="charging_station"\]/);
  assert.match(q, /out center tags;/);
});

test("sectionNeedsOsm asks where chargers bunch up and leave a long gap (#72: Riga→Daugavpils)", () => {
  // 9 chargers, all in the first 30 km out of Riga: plenty by count, 200 km gap after them.
  assert.equal(sectionNeedsOsm([2, 4, 6, 9, 12, 15, 20, 25, 28], 228), true);
});

test("sectionNeedsOsm counts the stretch from the start and to the end", () => {
  assert.equal(sectionNeedsOsm([70, 120], 150), true); // 70 km before the first
  assert.equal(sectionNeedsOsm([40, 80], 150), true); // 70 km after the last
  assert.equal(sectionNeedsOsm([], 50), false); // short section, nothing needed
  assert.equal(sectionNeedsOsm([], 120), true);
});

test("sectionNeedsOsm leaves well-covered sections alone (no extra requests)", () => {
  const germany = Array.from({ length: 40 }, (_, i) => i * 6);
  assert.equal(sectionNeedsOsm(germany, 240), false);
  assert.equal(sectionNeedsOsm([55, 110, 165, 220], 250), false);
});
