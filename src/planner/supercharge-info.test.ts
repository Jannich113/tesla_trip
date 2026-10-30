import assert from "node:assert/strict";
import { test } from "node:test";
import { inPathBox, superchargerFromSite } from "./supercharge-info.ts";

// The real record for Rēzekne, Latvia (supercharge.info, 2026-10-30), trimmed.
const rezekne = {
  id: 3617,
  name: "Rezekne, Latvia",
  status: "OPEN",
  address: { city: "Rēzekne", country: "Latvia" },
  gps: { latitude: 56.514664, longitude: 27.350934 },
  stallCount: 4,
  powerKilowatt: 150,
};

test("an open site becomes a Tesla Supercharger the planner can use", () => {
  const row = superchargerFromSite(rezekne);
  assert.ok(row);
  assert.equal(row.id, "sci-3617");
  assert.equal(row.name, "Tesla Supercharger Rēzekne");
  assert.equal(row.kind, "supercharger");
  assert.equal(row.networkId, "tesla");
  assert.equal(row.lat, 56.514664);
  assert.equal(row.lng, 27.350934);
  assert.ok(row.usdPerKwh > 0);
});

test("planned, closed and broken sites are skipped", () => {
  for (const status of ["PLAN", "CONSTRUCTION", "PERMIT", "CLOSED_PERM", "CLOSED_TEMP", undefined]) {
    assert.equal(superchargerFromSite({ ...rezekne, status }), null, String(status));
  }
  assert.equal(superchargerFromSite({ ...rezekne, gps: {} }), null);
  assert.equal(superchargerFromSite({ ...rezekne, id: undefined }), null);
});

test("falls back to the site name when the city is missing", () => {
  assert.equal(superchargerFromSite({ ...rezekne, address: {} })?.name, "Tesla Supercharger Rezekne");
});

test("inPathBox keeps sites near the route's area and drops far ones", () => {
  const riga2daugavpils: [number, number][] = [[56.95, 24.1], [56.5, 25.3], [55.87, 26.54]];
  const rows = [
    { id: "near", lat: 56.6, lng: 25.0 },
    { id: "edge", lat: 55.8, lng: 26.7 }, // just outside the box, inside the margin
    { id: "oslo", lat: 59.91, lng: 10.75 },
  ];
  assert.deepEqual(inPathBox(rows, riga2daugavpils, 15).map((r) => r.id), ["near", "edge"]);
  assert.deepEqual(inPathBox(rows, [[56, 25]], 15), []);
});
