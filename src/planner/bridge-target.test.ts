import assert from "node:assert/strict";
import { test } from "node:test";
import { bridgeTargetSoc } from "./insert.ts";

// Straight road north from 55°N; ~0.17 kWh per km, a 75 kWh pack.
const KM_PER_DEG = 111.2;
const KWH_PER_KM = 0.17;
const road = (km: number): [number, number][] =>
  Array.from({ length: Math.round(km / 5) + 1 }, (_, i) => [55 + (i * 5) / KM_PER_DEG, 10]);
const at = (id: string, km: number) => ({ id, name: id, short: id, lat: 55 + km / KM_PER_DEG, lng: 10.002, kind: "supercharger" as const, usdPerKwh: 0.5 });
const target = (km: number, chargers: ReturnType<typeof at>[]) =>
  bridgeTargetSoc({ path: road(km), totalKwh: km * KWH_PER_KM, usableKwh: 75, locations: chargers, bandM: 28_000 });

test("charges to 80% when the rest of the leg fits", () => {
  assert.equal(target(250, []), 80);
});

test("charges to 80% when a charger is within 80% reach", () => {
  assert.equal(target(700, [at("a", 250), at("b", 600)]), 80);
});

test("charges fuller when the next charger is beyond 80% but within 100% (#69 SPARSE: 350 km gap)", () => {
  const soc = target(850, [at("next", 350)]);
  const need = 8 + ((350 * KWH_PER_KM) / 75) * 100; // floor + energy to the charger
  assert.ok(soc > 80 && soc <= 100, `got ${soc}%`);
  assert.ok(soc >= need, `${soc}% does not reach the charger (needs ${need.toFixed(0)}%)`);
});

test("charges fuller to reach the destination when there is no charger in between", () => {
  const soc = target(360, []);
  assert.ok(soc > 80 && soc <= 100, `got ${soc}%`);
});

test("stays at 80% when even 100% cannot reach the next charger", () => {
  assert.equal(target(900, [at("far", 600)]), 80);
});

test("ignores a charger right at the start and chargers it is told to skip", () => {
  const chargers = [at("here", 2), at("used", 200), at("next", 350)];
  const soc = bridgeTargetSoc({ path: road(850), totalKwh: 850 * KWH_PER_KM, usableKwh: 75, locations: chargers, bandM: 28_000, excludeIds: ["used"] });
  assert.ok(soc > 80, `got ${soc}%`);
});
