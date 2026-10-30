import assert from "node:assert/strict";
import { test } from "node:test";
import { FERRY_LINES, ferriesFromManeuvers, ferryInfo, guessFareKr, ferryPortNames, matchFerryLine, splitAtFerry } from "./ferries.ts";

// Copenhagen → Hamburg as Valhalla returns it (2026-10-30), trimmed to the ferry part.
const shape: [number, number][] = Array.from({ length: 1700 }, (_, i) => [55.6 - i * 0.0007, 12.5 - i * 0.0007]);
shape[1659] = [54.6545, 11.3505]; // Rødby harbour
shape[1668] = [54.5013, 11.2271]; // Puttgarden harbour
const maneuvers = [
  { type: 23, instruction: "Keep right to take E 47/Sydmotorvejen toward Rødby/Gedser.", length: 121.7, time: 4074, begin_shape_index: 585, end_shape_index: 1659 },
  { type: 28, instruction: "Take the Rødby (DK) - Puttgarden (D)/E 47 Ferry.", street_names: ["Rødby (DK) - Puttgarden (D)", "E 47"], length: 18.968, time: 3046, begin_shape_index: 1659, end_shape_index: 1668 },
  { type: 29, instruction: "Drive southwest on E 47.", length: 2.6, time: 194, begin_shape_index: 1668, end_shape_index: 1749 },
];

test("reads the ferry crossing out of Valhalla's maneuvers", () => {
  const ferries = ferriesFromManeuvers(maneuvers, shape);
  assert.equal(ferries.length, 1);
  assert.equal(ferries[0].name, "Rødby (DK) - Puttgarden (D)");
  assert.deepEqual(ferries[0].from, [54.6545, 11.3505]);
  assert.deepEqual(ferries[0].to, [54.5013, 11.2271]);
  assert.equal(ferries[0].miles, 18.968);
  assert.equal(ferries[0].seconds, 3046);
});

test("a route without a ferry has no crossings", () => {
  assert.deepEqual(ferriesFromManeuvers(maneuvers.filter((m) => m.type !== 28), shape), []);
});

test("matches the crossing to the catalog in either direction", () => {
  const [crossing] = ferriesFromManeuvers(maneuvers, shape);
  assert.equal(matchFerryLine(crossing)?.id, "rodby-puttgarden");
  assert.equal(matchFerryLine({ from: crossing.to, to: crossing.from })?.id, "rodby-puttgarden");
});

test("does not match a crossing far from any catalog port", () => {
  assert.equal(matchFerryLine({ from: [40.6, 14.3], to: [40.55, 14.24] }), null); // Naples area
});

test("known crossings get operator, check-in, a price estimate and a booking link", () => {
  const info = ferryInfo(ferriesFromManeuvers(maneuvers, shape)[0]);
  assert.equal(info.known, true);
  assert.deepEqual(info.operators, ["Scandlines"]);
  assert.equal(info.crossingMin, 45);
  assert.ok(info.checkInMin > 0);
  assert.ok(info.priceKr && info.priceKr.from < info.priceKr.to);
  assert.match(info.bookingUrl ?? "", /^https:\/\//);
  // The fare counted in the trip price is the middle of the range.
  assert.equal(info.fareKr, 700);
});

test("an unknown crossing still costs something: a guess from its length", () => {
  const short = ferryInfo({ name: "Short", from: [40.6, 14.3], to: [40.55, 14.24], miles: 3, seconds: 20 * 60 });
  const long = ferryInfo({ name: "Long", from: [40.6, 14.3], to: [39.0, 15.0], miles: 100, seconds: 8 * 3600 });
  assert.ok(short.fareKr >= 300, `${short.fareKr}`);
  assert.ok(long.fareKr > short.fareKr * 2, `${long.fareKr} vs ${short.fareKr}`);
  assert.equal(guessFareKr(60), 650);
});

test("unknown crossings keep the router's time, a default check-in and no price", () => {
  const info = ferryInfo({ name: "Some Ferry", from: [40.6, 14.3], to: [40.55, 14.24], miles: 10, seconds: 1800 });
  assert.equal(info.known, false);
  assert.equal(info.crossingMin, 30);
  assert.equal(info.priceKr, null);
  assert.equal(info.bookingUrl, null);
});

test("catalog entries are complete and sane", () => {
  const ids = new Set<string>();
  for (const l of FERRY_LINES) {
    assert.ok(!ids.has(l.id), `duplicate ${l.id}`);
    ids.add(l.id);
    assert.ok(l.operators.length > 0, l.id);
    assert.ok(l.crossingMin > 0 && l.checkInMin > 0, l.id);
    assert.ok(l.priceKr.from > 0 && l.priceKr.from <= l.priceKr.to, l.id);
    assert.match(l.bookingUrl, /^https:\/\/www\./, l.id);
    for (const p of l.ports) assert.ok(p.lat > 50 && p.lat < 62 && p.lng > 7 && p.lng < 26, `${l.id} ${p.name}`);
  }
});

test("splitAtFerry cuts the route at the ports and keeps the ferry's own distance and time", () => {
  // 3 points before Rødby, the crossing, 3 points after Puttgarden.
  const path: [number, number][] = [[55.2, 11.8], [55.0, 11.6], [54.8, 11.45], [54.6545, 11.3505], [54.5013, 11.2271], [54.3, 11.0], [54.0, 10.6], [53.55, 10.0]];
  const crossing = { name: "Rødby (DK) - Puttgarden (D)", from: [54.6545, 11.3505] as [number, number], to: [54.5013, 11.2271] as [number, number], miles: 11.8, seconds: 2700 };
  const parts = splitAtFerry({ miles: 200, seconds: 3 * 3600, path, source: "valhalla" }, crossing);
  assert.ok(parts && parts.before && parts.after);
  assert.deepEqual(parts.before.path.at(-1), crossing.from);
  assert.deepEqual(parts.after.path[0], crossing.to);
  assert.equal(parts.crossing.miles, 11.8);
  assert.equal(parts.crossing.seconds, 2700);
  const miles = parts.before.miles + parts.after.miles;
  const seconds = parts.before.seconds + parts.after.seconds;
  assert.ok(Math.abs(miles - (200 - 11.8)) < 0.01);
  assert.ok(Math.abs(seconds - (3 * 3600 - 2700)) < 0.01);
});

test("splitAtFerry leaves out the drive when the route starts at the port", () => {
  const path: [number, number][] = [[54.6545, 11.3505], [54.5013, 11.2271], [54.0, 10.6]];
  const parts = splitAtFerry(
    { miles: 50, seconds: 4000, path, source: "valhalla" },
    { name: "x", from: [54.6545, 11.3505], to: [54.5013, 11.2271], miles: 11.8, seconds: 2700 },
  );
  assert.equal(parts?.before, null);
  assert.ok(parts?.after);
});

test("ferryPortNames uses the catalog's names in travel direction", () => {
  const south = { name: "Rødby (DK) - Puttgarden (D)", from: [54.6545, 11.3505] as [number, number], to: [54.5013, 11.2271] as [number, number], miles: 11.8, seconds: 2700 };
  assert.deepEqual(ferryPortNames(south), ["Rødby", "Puttgarden"]);
  assert.deepEqual(ferryPortNames({ ...south, from: south.to, to: south.from }), ["Puttgarden", "Rødby"]);
  assert.deepEqual(ferryPortNames({ name: "Pozzuoli - Ischia", from: [40.82, 14.12], to: [40.74, 13.94], miles: 9, seconds: 3600 }), ["Pozzuoli", "Ischia"]);
});

test("Fastest and Eco are neutral about ferries; Cheapest avoids them (#71)", async () => {
  const { costingFor, FERRY_AVOID, FERRY_NEUTRAL } = await import("./modes.ts");
  assert.equal(costingFor("fastest").use_ferry, FERRY_NEUTRAL);
  assert.equal(costingFor("eco").use_ferry, FERRY_NEUTRAL);
  assert.equal(costingFor("cheapest").use_ferry, FERRY_AVOID);
  assert.equal(costingFor("cheapest", { motorways: true, tolls: true, roadFees: true }).use_ferry, FERRY_AVOID);
});

test("Avoid ferries asks the router never to take one, in every mode (#71)", async () => {
  const { costingFor, FERRY_NEVER } = await import("./modes.ts");
  for (const mode of ["fastest", "eco", "cheapest"] as const) {
    assert.equal(costingFor(mode, false, true).use_ferry, FERRY_NEVER, mode);
  }
});

test("Avoid ferries drops routes over water, unless every route crosses (an island)", async () => {
  const { withoutFerries } = await import("./drive.ts");
  const ferry = { id: "ferry", ferries: [{}] };
  const dry = { id: "dry", ferries: [] };
  const osrm: { id: string; ferries?: unknown[] } = { id: "osrm" };
  assert.deepEqual(withoutFerries([ferry, dry, osrm], true).map((r) => r.id), ["dry", "osrm"]);
  assert.deepEqual(withoutFerries([ferry, dry], false).map((r) => r.id), ["ferry", "dry"]);
  assert.deepEqual(withoutFerries([ferry], true).map((r) => r.id), ["ferry"]);
});

test("Avoid-ferries routes are cached apart from plain ones", async () => {
  const { corridorKey, primeRouteCache, lookupCachedRoute } = await import("./engine.ts");
  const from = { lat: 55.1, lng: 12.1 };
  const to = { lat: 53.6, lng: 10.0 };
  assert.notEqual(corridorKey(from, to, "fastest"), corridorKey(from, to, "fastest", true));
  const path = Array.from({ length: 40 }, (_, i) => [55.1 - i * 0.04, 12.1 - i * 0.05] as [number, number]);
  primeRouteCache({ [corridorKey(from, to, "fastest", true)]: { miles: 150, seconds: 9000, path, source: "valhalla", ferries: [] } });
  assert.equal(lookupCachedRoute(from, to, "fastest"), undefined);
  assert.equal(lookupCachedRoute(from, to, "fastest", true)?.miles, 150);
});

test("the plan counts half the gap between sailings as the wait, at most 90 min", async () => {
  const { departureWaitMin, MAX_DEPARTURE_WAIT_MIN } = await import("./ferries.ts");
  assert.equal(departureWaitMin(30), 15);
  assert.equal(departureWaitMin(120), 60);
  assert.equal(departureWaitMin(1440), MAX_DEPARTURE_WAIT_MIN);
  assert.equal(departureWaitMin(null), 0);
  const rodby = ferryInfo({ name: "Rødby - Puttgarden", from: [54.656, 11.352], to: [54.5, 11.226], miles: 12, seconds: 2700 });
  assert.equal(rodby.everyMin, 30);
  assert.equal(rodby.departureWaitMin, 15);
  const unknown = ferryInfo({ name: "Some Ferry", from: [40.6, 14.3], to: [40.55, 14.24], miles: 10, seconds: 1800 });
  assert.equal(unknown.everyMin, null);
  assert.equal(unknown.departureWaitMin, 0);
});

test("every catalog crossing has a typical departure gap", () => {
  for (const l of FERRY_LINES) {
    const info = ferryInfo({ name: l.name, from: [l.ports[0].lat, l.ports[0].lng], to: [l.ports[1].lat, l.ports[1].lng], miles: 10, seconds: 600 });
    assert.ok(info.everyMin && info.everyMin >= 15, `${l.id}: ${info.everyMin}`);
  }
});
