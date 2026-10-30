import assert from "node:assert/strict";
import { test } from "node:test";
import { fastestOfModes } from "./pick-route.ts";

const route = (seconds: number, source = "osrm", points = 10) => ({
  miles: 190,
  seconds,
  source,
  path: Array.from({ length: points }, (_, i) => [55 + i * 0.1, 10] as [number, number]),
});

test("Fastest uses a quicker route another mode found (#70: Eco 3:31 vs Fastest 3:41)", () => {
  const fastest = route(13_260); // 3 h 41 min, OSRM
  const eco = route(12_660, "valhalla"); // 3 h 31 min
  assert.equal(fastestOfModes(fastest, [eco, undefined])?.seconds, 12_660);
});

test("Fastest keeps its own route when it is already the quickest", () => {
  const fastest = route(12_000);
  assert.equal(fastestOfModes(fastest, [route(12_660), route(13_000)]), fastest);
});

test("Fastest waits for its own route instead of showing another mode's", () => {
  assert.equal(fastestOfModes(undefined, [route(12_000)]), undefined);
});

test("Fastest ignores straight-line placeholders and broken routes", () => {
  const fastest = route(13_000);
  assert.equal(fastestOfModes(fastest, [route(9_000, "air"), route(8_000, "osrm", 2), { ...route(7_000), seconds: 0 }]), fastest);
});

test("Cheapest drives around instead of paying for a ferry when it can (#71)", async () => {
  const { fastWithoutFerry, pickCheapAvoidRoute } = await import("./pick-route.ts");
  const ferry = { ...route(15_800, "valhalla"), ferries: [{}] }; // Copenhagen–Hamburg via Rødby: 263 min
  const around = { ...route(18_300), ferries: [] as unknown[] }; // via Jutland: 305 min
  const ref = fastWithoutFerry(ferry, [around]);
  assert.equal(ref, null);
  assert.equal(pickCheapAvoidRoute(ref, [around], { tolls: true, roadFees: true }), around);
});

test("Cheapest keeps the ferry when every option takes one", async () => {
  const { fastWithoutFerry } = await import("./pick-route.ts");
  const ferry = { ...route(15_800, "valhalla"), ferries: [{}] };
  assert.equal(fastWithoutFerry(ferry, [{ ...route(16_000), ferries: [{}] }]), ferry);
  assert.equal(fastWithoutFerry(ferry, []), ferry);
});
