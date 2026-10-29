import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AddressHit,
  dedupeHits,
  editDistance,
  formatCoordinates,
  hitFromPhoton,
  labelFromReverse,
  matchScore,
  normalize,
  parseCoordinates,
  rankHits,
} from "./search.ts";

const hit = (name: string, kind: string, lat = 55, lng = 10): AddressHit => ({
  name,
  label: name,
  kind,
  lat,
  lng,
});

test("normalize spells out Danish letters and drops accents", () => {
  assert.equal(normalize("Køge Å"), "koege aa");
  assert.equal(normalize("Ærø"), "aeroe");
  assert.equal(normalize("Lübeck"), "lubeck");
});

test("editDistance counts a swapped letter pair as one edit", () => {
  assert.equal(editDistance("odnese", "odense"), 1);
  assert.equal(editDistance("hambrg", "hamburg"), 1);
  assert.equal(editDistance("aarhsu", "aarhus"), 1);
  assert.equal(editDistance("odense", "odense"), 0);
});

test("matchScore treats partial typing as a full match", () => {
  assert.equal(matchScore("Odens", "Odense").score, 1);
  assert.equal(matchScore("Odens", "Odense").exactName, true);
  assert.ok(matchScore("Odnese", "Odense").score > 0.7);
  assert.equal(matchScore("Odnese", "Odense").exactName, false);
});

test("rankHits puts the misspelled city above look-alike rivers and restaurants", () => {
  // Photon's real order for "Odnese" (top) and "Hambrg" (bottom), trimmed.
  const odnese = [
    hit("Odneselvi", "river"),
    hit("Odneselvi", "river", 61),
    hit("Odense", "city"),
    hit("Odense Å", "river"),
  ];
  assert.equal(rankHits("Odnese", odnese)[0].name, "Odense");
  assert.equal(rankHits("Odnese", odnese)[0].corrected, true);

  const hambrg = [
    hit("HAMBRGR", "restaurant"),
    hit("HamBrgr", "fast_food"),
    hit("Hamburg", "city"),
    hit("Hamborg", "residential"),
  ];
  assert.equal(rankHits("Hambrg", hambrg)[0].name, "Hamburg");
});

test("rankHits keeps an exact address first and does not mark it corrected", () => {
  const ranked = rankHits("Englandsgade 2", [
    { ...hit("Englandsgade 2", "house"), label: "Englandsgade 2, Odense C, Danmark" },
    { ...hit("Englandsgade", "residential"), label: "Englandsgade, Esbjerg, Danmark" },
  ]);
  assert.equal(ranked[0].label, "Englandsgade 2, Odense C, Danmark");
  assert.equal(ranked[0].corrected, false);
});

test("hitFromPhoton builds a readable label and skips nameless features", () => {
  const h = hitFromPhoton({
    geometry: { coordinates: [10.383, 55.396] },
    properties: { street: "Vestergade", housenumber: "12", city: "Odense C", country: "Danmark", osm_value: "house" },
  });
  assert.deepEqual(h, {
    label: "Vestergade 12, Odense C, Danmark",
    name: "Vestergade 12",
    lat: 55.396,
    lng: 10.383,
    kind: "house",
  });
  assert.equal(hitFromPhoton({ geometry: { coordinates: [10, 55] }, properties: {} }), null);
});

test("dedupeHits drops the same place listed twice", () => {
  const out = dedupeHits([hit("Odense", "city", 55.3959, 10.3883), hit("Odense", "station", 55.3961, 10.3881)]);
  assert.equal(out.length, 1);
});

test("parseCoordinates reads lat, lng in common separators", () => {
  assert.deepEqual(parseCoordinates("55.4038, 10.4024"), { lat: 55.4038, lng: 10.4024 });
  assert.deepEqual(parseCoordinates("55.4038 10.4024"), { lat: 55.4038, lng: 10.4024 });
  assert.deepEqual(parseCoordinates(" 55.4038;10.4024 "), { lat: 55.4038, lng: 10.4024 });
  assert.deepEqual(parseCoordinates("-33.86, 151.2"), { lat: -33.86, lng: 151.2 });
});

test("parseCoordinates rejects addresses and out-of-range values", () => {
  assert.equal(parseCoordinates("Vestergade 12"), null);
  assert.equal(parseCoordinates("Odense"), null);
  assert.equal(parseCoordinates("95, 10"), null);
  assert.equal(parseCoordinates("55, 190"), null);
  assert.equal(parseCoordinates("5000 Odense"), null);
});

test("formatCoordinates keeps five decimals", () => {
  assert.equal(formatCoordinates(55.403812, 10.4024), "55.40381, 10.40240");
});

test("labelFromReverse prefers a name, then street and number, then town", () => {
  assert.equal(
    labelFromReverse({ name: "Tesla Supercharger", address: { city: "Odense", country: "Danmark" } }),
    "Tesla Supercharger, Odense, Danmark",
  );
  assert.equal(
    labelFromReverse({ address: { road: "Vestergade", house_number: "12", city: "Odense", country: "Danmark" } }),
    "Vestergade 12, Odense, Danmark",
  );
  assert.equal(labelFromReverse({ address: { village: "Tarup", country: "Danmark" } }), "Tarup, Danmark");
  assert.equal(labelFromReverse({ display_name: "Somewhere" }), "Somewhere");
});
