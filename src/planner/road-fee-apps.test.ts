import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ROAD_FEE_APPS } from "./country-profiles.ts";
import { feeCountryAt, suggestRoadFeeApps } from "./road-fee-apps.ts";
import { tollRegionIdsOnPath } from "./tolls.ts";

function ids(path: [number, number][]) {
  return suggestRoadFeeApps(path).map((s) => s.id);
}

describe("road fee app suggestions", () => {
  it("suggests nothing for an empty path and has no manual toggle", () => {
    assert.deepEqual(suggestRoadFeeApps([]), []);
    assert.equal(suggestRoadFeeApps.length, 1);
  });

  it("suggests AutoPASS, ePass24, and Bil i Oslo when the route enters Oslo", () => {
    const suggestions = suggestRoadFeeApps([
      [59.91, 10.75],
      [59.93, 10.77],
    ]);
    assert.deepEqual(
      ids([
        [59.91, 10.75],
        [59.93, 10.77],
      ]),
      ["autopass", "epass24", "bil-i-oslo"],
    );
    const oslo = suggestions.find((s) => s.id === "bil-i-oslo");
    assert.equal(oslo?.kind, "city-parking");
    assert.match(oslo?.reason ?? "", /Oslo/);
    assert.equal(suggestions.find((s) => s.id === "autopass")?.reason, "Route enters Norway");
  });

  it("suggests Norway road fees in Bergen but not Oslo parking", () => {
    assert.deepEqual(
      ids([
        [60.3913, 5.3221],
        [60.4, 5.35],
      ]),
      ["autopass", "epass24"],
    );
  });

  it("does not suggest Norway or Oslo apps for a Copenhagen hop", () => {
    const got = ids([
      [55.676, 12.568],
      [55.68, 12.57],
    ]);
    assert.equal(got.includes("autopass"), false);
    assert.equal(got.includes("epass24"), false);
    assert.equal(got.includes("bil-i-oslo"), false);
  });

  it("suggests ePass24 in Sweden without AutoPASS or Bil i Oslo", () => {
    assert.deepEqual(
      ids([
        [59.329, 18.068],
        [59.33, 18.07],
      ]),
      ["epass24"],
    );
    const both = suggestRoadFeeApps([
      [59.91, 10.75],
      [59.329, 18.068],
    ]);
    assert.equal(both.find((s) => s.id === "epass24")?.reason, "Route enters Norway and Sweden");
  });

  it("does not suggest Oslo parking unless the path comes within the city", () => {
    assert.equal(
      ids([
        [60.193, 11.1],
        [60.2, 11.12],
      ]).includes("bil-i-oslo"),
      false,
    );
    assert.equal(
      ids([
        [60.1, 10.75],
        [60.12, 10.76],
      ]).includes("bil-i-oslo"),
      false,
    );
  });

  it("suggests BroBizz when the segment crosses Storebælt, not for a Jutland hop", () => {
    const crossing = tollRegionIdsOnPath([
      [55.336, 11.139],
      [55.312, 10.79],
    ]);
    assert.deepEqual(crossing, ["storebaelt"]);
    const suggested = suggestRoadFeeApps([
      [55.336, 11.139],
      [55.312, 10.79],
    ]);
    assert.equal(
      suggested.some((s) => s.id === "brobizz"),
      true,
    );
    assert.match(suggested.find((s) => s.id === "brobizz")?.reason ?? "", /Storebælt/);
    assert.equal(
      ids([
        [56.15, 10.2],
        [56.16, 10.21],
      ]).includes("brobizz"),
      false,
    );
  });

  it("suggests BroBizz for the Øresund corridor", () => {
    const suggested = suggestRoadFeeApps([
      [55.57, 12.65],
      [55.57, 13.0],
    ]);
    assert.equal(
      suggested.some((s) => s.id === "brobizz"),
      true,
    );
    assert.match(suggested.find((s) => s.id === "brobizz")?.reason ?? "", /Øresund/);
  });

  it("names both bridges once when the route crosses Storebælt and Øresund", () => {
    const suggested = suggestRoadFeeApps([
      [55.3417, 10.9944],
      [55.573, 12.847],
    ]);
    const hits = suggested.filter((s) => s.id === "brobizz");
    assert.equal(hits.length, 1);
    assert.match(hits[0].reason, /Storebælt/);
    assert.match(hits[0].reason, /Øresund/);
  });

  it("does not invent a Germany PKW-Maut app", () => {
    assert.equal(
      ROAD_FEE_APPS.some((app) =>
        app.triggers.some((t) => t.kind === "country" && t.country === "DE"),
      ),
      false,
    );
    const berlin = ids([
      [52.52, 13.405],
      [52.53, 13.41],
    ]);
    const munich = ids([
      [48.137, 11.575],
      [48.14, 11.58],
    ]);
    assert.deepEqual(berlin, []);
    assert.equal(munich.includes("asfinag"), false);
    assert.equal(feeCountryAt(52.52, 13.405), "DE");
    assert.equal(feeCountryAt(48.137, 11.575), "DE");
  });

  it("suggests the national vignette when the route enters that country", () => {
    assert.equal(feeCountryAt(48.208, 16.373), "AT");
    assert.equal(feeCountryAt(47.269, 11.404), "AT");
    assert.equal(feeCountryAt(47.5, 9.75), "AT");
    assert.equal(feeCountryAt(47.809, 13.055), "AT");
    assert.deepEqual(
      ids([
        [48.208, 16.373],
        [47.269, 11.404],
      ]),
      ["asfinag"],
    );

    assert.equal(feeCountryAt(50.075, 14.438), "CZ");
    assert.equal(feeCountryAt(49.195, 16.608), "CZ");
    assert.deepEqual(
      ids([
        [50.075, 14.438],
        [49.195, 16.608],
      ]),
      ["edalnice"],
    );

    assert.equal(feeCountryAt(48.148, 17.107), "SK");
    assert.deepEqual(
      ids([
        [48.148, 17.107],
        [48.15, 17.11],
      ]),
      ["eznamka"],
    );

    assert.equal(feeCountryAt(47.498, 19.04), "HU");
    assert.equal(feeCountryAt(48.103, 20.778), "HU");
    assert.deepEqual(
      ids([
        [47.498, 19.04],
        [48.103, 20.778],
      ]),
      ["ematric"],
    );

    assert.equal(feeCountryAt(46.948, 7.447), "CH");
    assert.equal(feeCountryAt(47.376, 8.541), "CH");
    assert.deepEqual(
      ids([
        [46.948, 7.447],
        [47.376, 8.541],
      ]),
      ["swiss-e-vignette"],
    );

    assert.equal(feeCountryAt(42.698, 23.322), "BG");
    assert.deepEqual(
      ids([
        [42.698, 23.322],
        [42.7, 23.33],
      ]),
      ["bgtoll"],
    );
  });

  it("keeps catalog links as https install or sign-up targets", () => {
    const idsSeen = new Set<string>();
    for (const app of ROAD_FEE_APPS) {
      assert.equal(idsSeen.has(app.id), false);
      idsSeen.add(app.id);
      assert.ok(app.links.length > 0);
      assert.ok(app.summary.length > 0);
      for (const link of app.links) {
        assert.equal(link.href.startsWith("https://"), true);
        assert.equal(/\/pay\b|checkout|payment-intent/i.test(link.href), false);
      }
    }
  });
});
