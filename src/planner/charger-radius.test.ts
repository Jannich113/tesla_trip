import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chargerMark, chargePickRadiusM, chargersWithinRadius } from "./charger-radius.ts";
import { chargeSearchKm, stallKw } from "./modes.ts";
import { rateForNetwork } from "./networks.ts";

describe("charger pick radius", () => {
  it("follows charge search for each mode", () => {
    assert.equal(chargePickRadiusM("fastest", 12), chargeSearchKm("fastest", 12) * 1000);
    assert.equal(chargePickRadiusM("eco", 12), chargeSearchKm("eco", 12) * 1000);
    assert.equal(chargePickRadiusM("cheapest", 40), 40_000);
    assert.ok(chargePickRadiusM("eco", 12) > chargePickRadiusM("fastest", 12));
  });

  it("keeps stalls inside the circle and drops home, far, and duplicate ids", () => {
    const origin = { lat: 55.68, lng: 12.57 };
    const radius = chargePickRadiusM("fastest", 12);
    const rows = chargersWithinRadius(
      [
        { id: "near", lat: 55.7, lng: 12.57, kind: "supercharger" },
        { id: "far", lat: 56.4, lng: 12.57, kind: "custom" },
        { id: "home", lat: 55.68, lng: 12.57, kind: "home" },
        { id: "near", lat: 55.71, lng: 12.57, kind: "supercharger" },
      ],
      origin,
      radius,
    );
    assert.deepEqual(
      rows.map((r) => r.loc.id),
      ["near"],
    );
    assert.ok(rows[0].distM <= radius);
  });

  it("marks network, kW, and price when known", () => {
    const on = chargerMark(
      { kind: "supercharger", networkId: "tesla", usdPerKwh: 0.4 },
      { tesla: true },
      11,
    );
    assert.equal(on.network, "Tesla Supercharger");
    assert.equal(on.short, "Tesla");
    assert.equal(on.kw, stallKw("supercharger", 11));
    assert.equal(on.priceKr, rateForNetwork("tesla", true));

    const unknown = chargerMark({ kind: "custom", networkId: null, usdPerKwh: 0 }, {}, 11);
    assert.equal(unknown.network, "DC");
    assert.equal(unknown.kw, stallKw("custom", 11));
    assert.equal(unknown.priceKr, null);
  });
});
