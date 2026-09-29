import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  areaForPlanner,
  countryAt,
  countryOf,
  defaultArea,
  isPriceArea,
  PRICE_AREA_IDS,
} from "./price-areas.ts";

describe("price areas", () => {
  it("keeps DK1 as the default and lists real Nord Pool zones only", () => {
    assert.equal(defaultArea("DK"), "DK1");
    assert.equal(defaultArea("NO"), "NO1");
    assert.equal(defaultArea("DE"), "GER");
    assert.equal(countryOf("GER"), "DE");
    assert.equal(countryOf("NL"), "NL");
    assert.equal(isPriceArea("DK1"), true);
    assert.equal(isPriceArea("DE"), false);
    assert.equal(isPriceArea("DE-LU"), false);
    assert.deepEqual(PRICE_AREA_IDS, [
      "DK1",
      "DK2",
      "NO1",
      "NO2",
      "NO3",
      "NO4",
      "NO5",
      "SE1",
      "SE2",
      "SE3",
      "SE4",
      "FI",
      "GER",
      "NL",
    ]);
  });

  it("places cities in the country the public feed covers", () => {
    const cities: [string, number, number, string | null][] = [
      ["Copenhagen", 55.676, 12.568, "DK"],
      ["Aarhus", 56.162, 10.203, "DK"],
      ["Odense", 55.396, 10.388, "DK"],
      ["Bornholm", 55.103, 14.918, "DK"],
      ["Oslo", 59.913, 10.752, "NO"],
      ["Bergen", 60.391, 5.322, "NO"],
      ["Tromsø", 69.649, 18.956, "NO"],
      ["Stockholm", 59.329, 18.069, "SE"],
      ["Malmö", 55.605, 13.003, "SE"],
      ["Luleå", 65.584, 22.155, "SE"],
      ["Helsinki", 60.17, 24.938, "FI"],
      ["Berlin", 52.52, 13.405, "DE"],
      ["Flensburg", 54.793, 9.437, "DE"],
      ["Amsterdam", 52.367, 4.904, "NL"],
      ["Paris", 48.857, 2.352, null],
    ];
    for (const [name, lat, lng, expect] of cities) {
      assert.equal(countryAt(lat, lng), expect, name);
    }
  });

  it("uses the selected zone only when the route is in that country", () => {
    const oslo = [{ lat: 59.913, lng: 10.752 }];
    const berlin = [{ lat: 52.52, lng: 13.405 }];
    assert.equal(areaForPlanner("NO2", []), "NO2");
    assert.equal(areaForPlanner("NO2", oslo), "NO2");
    assert.equal(areaForPlanner("GER", berlin), "GER");
    assert.equal(areaForPlanner("GER", oslo), "DK1");
    assert.equal(areaForPlanner("DK2", oslo), "DK2");
    assert.equal(areaForPlanner("DK1", berlin), "DK1");
  });
});
