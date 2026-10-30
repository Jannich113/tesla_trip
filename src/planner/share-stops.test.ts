import assert from "node:assert/strict";
import { test } from "node:test";
import { forGoogle, GOOGLE_MAX_WAYPOINTS, shareStops, type ShareLeg } from "./share-stops.ts";

const p = (id: string, name: string, lat: number, lng = 10) => ({ id, name, lat, lng });
const leg = (from: ShareLeg["from"], to: ShareLeg["to"], charge: ShareLeg["charge"] = null): ShareLeg => ({
  from,
  to,
  accepted: Boolean(charge),
  charge,
});

test("adds charging stops between the user's stops, in driving order", () => {
  const start = p("a", "Odense", 55.4);
  const via = p("via-sc-1", "Supercharger Rødekro", 55.07);
  const end = p("b", "Hamburg", 53.55);
  const chargers: Record<string, { lat: number; lng: number }> = { "sc-1": { lat: 55.07, lng: 9.33 } };
  const out = shareStops([leg(start, via), leg(via, end, { locationId: "sc-1", name: "Tesla Rødekro" })], (id) => chargers[id]);
  assert.deepEqual(
    out.map((s) => [s.name, s.charge]),
    [
      ["Odense", false],
      ["Tesla Rødekro", true],
      ["Hamburg", false],
    ],
  );
  assert.equal(out[1].lng, 9.33);
});

test("a charger at a user stop is that stop, not an extra one", () => {
  const start = p("a", "Home", 55);
  const mid = p("m", "Kolding", 55.49);
  const end = p("b", "Hamburg", 53.55);
  const out = shareStops([leg(start, mid), leg(mid, end, { locationId: "k", name: "Kolding SC" })], () => ({ lat: 55.4901, lng: 10.0002 }));
  assert.deepEqual(out.map((s) => [s.name, s.charge]), [["Home", false], ["Kolding", true], ["Hamburg", false]]);
});

test("leaves out ferry ports, split points without a charge and unknown chargers", () => {
  const a = p("a", "København", 55.67);
  const portA = p("ferry-x-a", "Rødby", 54.65);
  const portB = p("ferry-x-b", "Puttgarden", 54.5);
  const via = p("via-q", "somewhere", 54.2);
  const b = p("b", "Hamburg", 53.55);
  const out = shareStops(
    [leg(a, portA), leg(portA, portB), leg(portB, via), leg(via, b, { locationId: "none", name: "No known charger", placeholder: true })],
    () => null,
  );
  assert.deepEqual(out.map((s) => s.name), ["København", "Hamburg"]);
});

test("Google gets at most 9 stops between start and end, keeping the user's own", () => {
  const stops = [
    { name: "start", lat: 0, lng: 0, charge: false },
    ...Array.from({ length: 12 }, (_, i) => ({ name: `c${i}`, lat: i + 1, lng: 0, charge: true })),
    { name: "visit", lat: 20, lng: 0, charge: false },
    { name: "end", lat: 30, lng: 0, charge: false },
  ];
  const { stops: g, dropped } = forGoogle(stops);
  assert.equal(g.length, GOOGLE_MAX_WAYPOINTS + 2);
  assert.equal(dropped, 13 - GOOGLE_MAX_WAYPOINTS);
  assert.ok(g.some((s) => s.name === "visit"));
  assert.equal(g[0].name, "start");
  assert.equal(g[g.length - 1].name, "end");
  assert.deepEqual(forGoogle(stops.slice(0, 5)), { stops: stops.slice(0, 5), dropped: 0 });
});
