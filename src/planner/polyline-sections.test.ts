import assert from "node:assert/strict";
import { test } from "node:test";
import { locationsNearPath, minDistToPathM, spreadAlongPath, spreadBuckets } from "./insert.ts";
import { pathCoveredBy, pathLengthKm, routePointBudget, simplifyPath, splitPathByKm } from "./polyline.ts";

// Due north from 55°N in 10 km steps: 2,600 km, like Odense to Helsinki.
const KM_PER_DEG = 111.2;
const route: [number, number][] = Array.from({ length: 261 }, (_, i) => [55 + (i * 10) / KM_PER_DEG, 10]);

test("splitPathByKm cuts a long route into ~250 km sections", () => {
  const parts = splitPathByKm(route, 250);
  assert.ok(parts.length >= 10 && parts.length <= 11, `got ${parts.length} sections`);
  for (const part of parts.slice(0, -1)) {
    const km = pathLengthKm(part);
    assert.ok(km >= 249 && km <= 262, `section is ${km.toFixed(0)} km`);
  }
});

test("splitPathByKm covers the whole route with no gaps", () => {
  const parts = splitPathByKm(route, 250);
  assert.deepEqual(parts[0][0], route[0]);
  assert.deepEqual(parts.at(-1)!.at(-1), route.at(-1));
  for (let i = 1; i < parts.length; i++) assert.deepEqual(parts[i][0], parts[i - 1].at(-1));
  const total = parts.reduce((n, p) => n + pathLengthKm(p), 0);
  assert.ok(Math.abs(total - pathLengthKm(route)) < 0.5);
});

test("splitPathByKm leaves a short route whole", () => {
  const short = route.slice(0, 11);
  assert.deepEqual(splitPathByKm(short, 250), [short]);
});

test("spreadBuckets keeps one charger per ~15 km on long trips", () => {
  assert.equal(spreadBuckets(100), 28);
  assert.equal(spreadBuckets(420), 28);
  assert.ok(spreadBuckets(2560) >= 170, `only ${spreadBuckets(2560)} for Odense–Helsinki`);
  assert.equal(spreadBuckets(10_000), 200);
});

test("spreadAlongPath on a long trip leaves no stretch longer than a range window without a charger", () => {
  // A charger every 5 km, 2 km off the road, along the whole 2,600 km route.
  const chargers = route.filter((_, i) => i % 1 === 0).map(([lat, lng], i) => ({ id: `c${i}`, lat, lng: lng + 0.03 }));
  const kept = spreadAlongPath(chargers, route, spreadBuckets(pathLengthKm(route)), 55_000)
    .map((c) => (c.lat - 55) * KM_PER_DEG)
    .sort((a, b) => a - b);
  let worstGap = 0;
  for (let i = 1; i < kept.length; i++) worstGap = Math.max(worstGap, kept[i] - kept[i - 1]);
  assert.ok(worstGap <= 25, `largest gap between kept chargers is ${worstGap.toFixed(0)} km`);
});

test("locationsNearPath keeps every charger beside the road on a long trip", () => {
  // 260 chargers, 2 km off a 2,600 km road: all are within 5 km of it.
  const chargers = route.map(([lat, lng], i) => ({ id: `c${i}`, lat, lng: lng + 0.03 }));
  const near = locationsNearPath(chargers, route, 5_000);
  assert.equal(near.length, chargers.length, `kept ${near.length} of ${chargers.length}`);
});

test("locationsNearPath sees chargers between widely spaced route points", () => {
  // A simplified route: one point every ~55 km, the way the app sends long legs.
  const sparse = route.filter((_, i) => i % 5 === 0);
  const chargers = route.map(([lat, lng], i) => ({ id: `c${i}`, lat, lng: lng + 0.03 }));
  const near = locationsNearPath(chargers, sparse, 5_000);
  assert.equal(near.length, chargers.length, `kept ${near.length} of ${chargers.length}`);
});

// A winding coastal road: 2,600 km north with ±15 km bends every ~60 km, sampled every 2 km.
const winding: [number, number][] = Array.from({ length: 1301 }, (_, i) => {
  const km = i * 2;
  return [55 + km / KM_PER_DEG, 10 + (15 * Math.sin((km / 60) * 2 * Math.PI)) / (KM_PER_DEG * Math.cos((55 * Math.PI) / 180))];
});
const onRoad = winding.filter((_, i) => i % 10 === 5).map(([lat, lng], i) => ({ id: `w${i}`, lat, lng }));

test("routePointBudget keeps one point per ~10 km on long routes", () => {
  assert.equal(routePointBudget(120), 40);
  assert.ok(routePointBudget(2600) >= 250);
  assert.equal(routePointBudget(9000), 260);
});

test("a stored long route still sees chargers that sit on the real road", () => {
  const stored = simplifyPath(winding, routePointBudget(pathLengthKm(winding)));
  const far = onRoad.filter((c) => minDistToPathM(c.lat, c.lng, stored) > 12_000);
  assert.equal(far.length, 0, `${far.length} of ${onRoad.length} on-road chargers measure over 12 km away`);
});

test("the old flat 40-point route lost chargers on a winding road (documents the bug)", () => {
  const stored = simplifyPath(winding, 40);
  const far = onRoad.filter((c) => minDistToPathM(c.lat, c.lng, stored) > 12_000);
  assert.ok(far.length >= 20, `expected many lost chargers, got ${far.length}`);
});

test("pathCoveredBy treats a parallel road a few km away as covered", () => {
  const twin = route.map(([lat, lng]) => [lat, lng + 0.05] as [number, number]); // ~3 km east
  for (const part of splitPathByKm(twin, 250)) assert.equal(pathCoveredBy(part, [route], 8_000), true);
});

test("pathCoveredBy does not treat a different road as covered", () => {
  const other = route.map(([lat, lng]) => [lat, lng + 1] as [number, number]); // ~60 km east
  assert.equal(pathCoveredBy(other.slice(0, 30), [route], 8_000), false);
  assert.equal(pathCoveredBy(route.slice(0, 30), [], 8_000), false);
});
