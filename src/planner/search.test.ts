import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCoordinates, labelFromReverse, parseCoordinates } from "./search.ts";

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
