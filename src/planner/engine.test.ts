import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMinutesHhmm,
  chargeSearchKm,
  costingFor,
  defaultSpeedEff,
  driveKwhAtSpeed,
  epaWhPerMi,
  hoursFrom,
  interpolateWhPerMi,
  waitMinUntil,
  waitMinUntilDated,
  addMinutesDateTime,
  minutesBetweenDateTime,
  asDateTime,
  waitDelayMin,
} from "./modes.ts";
import { rateForNetwork, networkIdFor, roamExtra, EU_NETWORKS, EU_REGIONS, regionalOwn, regionalRoam } from "./networks.ts";
import { alongFraction, pickViaOnPath, splitRoutedLeg } from "./insert.ts";
import { networkFromOsmTags, isDcStation } from "./osm-operator.ts";
import { estimateTolls, gatesOnPath } from "./tolls.ts";
import { toDkk, CATALOG_FX, NETWORK_NATIVE } from "./charge-fx.ts";
import { countryProfile } from "./country-profiles.ts";

describe("leg modes", () => {
  it("eco is shortest + avoids highways and tolls", () => {
    const c = costingFor("eco");
    assert.equal(c.shortest, true);
    assert.ok(c.use_highways < 0.2);
    assert.equal(c.use_tolls, 0);
  });

  it("standard is the recommended time route", () => {
    const c = costingFor("standard");
    assert.equal(c.shortest, false);
    assert.ok(c.use_highways > 0.4 && c.use_highways < 0.7);
  });

  it("fastest prefers highways and tolls", () => {
    const c = costingFor("fastest");
    assert.equal(c.shortest, false);
    assert.equal(c.use_highways, 1);
    assert.equal(c.use_tolls, 1);
  });

  it("cheapest uses the same recommended path as standard", () => {
    assert.deepEqual(costingFor("cheapest"), costingFor("standard"));
  });

  it("cheapest searches at least 30 km, 3× the detour", () => {
    assert.equal(chargeSearchKm("cheapest", 5), 30);
    assert.equal(chargeSearchKm("cheapest", 20), 60);
    assert.equal(chargeSearchKm("eco", 10), 10);
    assert.equal(chargeSearchKm("fastest", 10), 10);
  });

  it("hoursFrom starts pricing at the planned clock", () => {
    const hours = [{ hour: "18" }, { hour: "19" }, { hour: "07" }];
    assert.deepEqual(
      hoursFrom(hours, "19:10").map((h) => h.hour),
      ["19", "07"],
    );
    assert.deepEqual(
      hoursFrom(hours, "07:00").map((h) => h.hour),
      ["07"],
    );
  });

  it("addMinutesHhmm wraps midnight", () => {
    assert.equal(addMinutesHhmm("23:50", 20), "00:10");
    assert.equal(addMinutesHhmm("08:00", -90), "06:30");
  });

  it("epaWhPerMi uses usable pack / rated range", () => {
    assert.equal(Math.round(epaWhPerMi(75, 327)), 229);
  });

  it("interpolates kWh/mi between 50, 80, 110 and 130 km/t", () => {
    const eff = { 50: 180, 80: 220, 110: 280, 130: 340 };
    assert.equal(interpolateWhPerMi(eff, 50), 180);
    assert.equal(interpolateWhPerMi(eff, 130), 340);
    assert.equal(interpolateWhPerMi(eff, 80), 220);
    assert.equal(Math.round(interpolateWhPerMi(eff, 95)), 250);
    assert.ok(interpolateWhPerMi(eff, 40) === 180);
    assert.ok(interpolateWhPerMi(eff, 140) === 340);
  });

  it("faster average speed uses more kWh", () => {
    const eff = defaultSpeedEff(240);
    const miles = 50;
    const at50 = driveKwhAtSpeed(miles, (miles * 1.609344) / 50 * 3600, eff);
    const at130 = driveKwhAtSpeed(miles, (miles * 1.609344) / 130 * 3600, eff);
    assert.ok(at130 > at50);
  });

  it("waitMinUntil is 0 in the current hour and counts to a later cheap hour", () => {
    assert.equal(waitMinUntil("18:40", "18"), 0);
    assert.equal(waitMinUntil("18:40", "19"), 20);
    assert.equal(waitMinUntil("18:40", "02"), 7 * 60 + 20);
  });

  it("dated wait uses the calendar, not a 24h wrap", () => {
    assert.equal(waitMinUntilDated("2026-09-11T18:40", "2026-09-12", "02"), 7 * 60 + 20);
    assert.equal(waitMinUntilDated("2026-09-13T18:00", "2026-09-14", "02"), 8 * 60);
    assert.equal(minutesBetweenDateTime("2026-09-11T18:00", "2026-09-13T02:00"), 32 * 60);
    assert.equal(addMinutesDateTime("2026-09-11T23:30", 90), "2026-09-12T01:00");
    assert.equal(asDateTime("18:40").slice(11), "18:40");
  });

  it("wait does not count if the cheap slot finishes before leave", () => {
    assert.equal(
      waitDelayMin({
        readyAt: "2026-09-11T18:00",
        plannedStart: "2026-09-12T08:00",
        windowStart: "2026-09-12T02:00",
        chargeMin: 4 * 60,
      }),
      0,
    );
  });

  it("wait counts when the cheap slot delays leave", () => {
    assert.equal(
      waitDelayMin({
        readyAt: "2026-09-11T18:00",
        plannedStart: "2026-09-11T18:00",
        windowStart: "2026-09-12T02:00",
        chargeMin: 4 * 60,
      }),
      8 * 60,
    );
  });

  it("superchargers map to Tesla network", () => {
    assert.equal(networkIdFor("supercharger"), "tesla");
    assert.equal(networkIdFor("home"), null);
  });

  it("abo flag switches spot vs membership kWh", () => {
    assert.ok(rateForNetwork("ionity", false)! > rateForNetwork("ionity", true)!);
    assert.equal(rateForNetwork("clever", true), 0);
    assert.ok(rateForNetwork("clever", false)! > 1);
  });

  it("roaming extra is on eMSPs, not Tesla or Fastned", () => {
    const tesla = EU_NETWORKS.find((n) => n.id === "tesla")!;
    const enbw = EU_NETWORKS.find((n) => n.id === "enbw")!;
    assert.equal(roamExtra(tesla, true), null);
    assert.ok(roamExtra(enbw, true)! > 1);
  });

  it("covers the whole EU plus near-EU road countries", () => {
    const ids = EU_REGIONS.map((r) => r.id);
    for (const need of ["PL", "IT", "ES", "FI", "IE", "GR", "RO", "NO", "CH", "IS", "RS", "UA", "TR", "AL"]) {
      assert.ok(ids.includes(need as (typeof ids)[number]), need);
    }
    const tesla = EU_NETWORKS.find((n) => n.id === "tesla")!;
    assert.ok(regionalOwn(tesla, "PL", false)! > 0);
    assert.ok(regionalOwn(tesla, "ES", false)! > 0);
    assert.ok(regionalOwn(tesla, "NO", false)! > 0);
    const mer = EU_NETWORKS.find((n) => n.id === "mer")!;
    const recharge = EU_NETWORKS.find((n) => n.id === "recharge")!;
    assert.ok(regionalOwn(mer, "NO", false)! > 0);
    assert.ok(regionalOwn(recharge, "NO", false)! > regionalOwn(tesla, "NO", false)!);
  });

  it("regional roam is cheaper in DK partners than DE IONITY", () => {
    const clever = EU_NETWORKS.find((n) => n.id === "clever")!;
    const ionity = EU_NETWORKS.find((n) => n.id === "ionity")!;
    assert.equal(regionalRoam(clever, "DK", true), 0);
    assert.ok(regionalRoam(clever, "DE", true)! > 3);
    assert.ok(regionalOwn(ionity, "UK", false)! > regionalOwn(ionity, "FR", false)!);
    assert.equal(regionalRoam(EU_NETWORKS.find((n) => n.id === "tesla")!, "DE", true), null);
  });

  it("native tariffs convert through FX", () => {
    assert.equal(toDkk(1, "EUR", CATALOG_FX), 7.46);
    assert.equal(toDkk(1, "NOK", CATALOG_FX), 0.64);
    assert.equal(NETWORK_NATIVE.ionity.ccy, "EUR");
    assert.equal(NETWORK_NATIVE.recharge.ccy, "NOK");
  });

  it("every country has a charging profile", () => {
    for (const r of EU_REGIONS) {
      assert.ok(countryProfile(r.id), r.id);
    }
  });

  it("inserts a via charger when the pack cannot finish the leg", () => {
    const from = { id: "a", name: "A", lat: 37.4, lng: -122.2 };
    const mid = { id: "loc-mid", name: "Mid SC", short: "Mid", usdPerKwh: 0.4, lat: 37.0, lng: -121.8, kind: "supercharger" as const, preset: true, radiusM: 250 };
    const to = { id: "b", name: "B", lat: 36.5, lng: -121.4 };
    const path: [number, number][] = [
      [from.lat, from.lng],
      [mid.lat, mid.lng],
      [to.lat, to.lng],
    ];
    const route = { miles: 220, seconds: 4 * 3600, path, source: "air" as const };
    const frac = alongFraction(path, mid.lat, mid.lng);
    assert.ok(frac > 0.2 && frac < 0.8);
    const via = pickViaOnPath({
      path,
      locations: [mid],
      budgetKwh: 40,
      totalKwh: 80,
      mode: "standard",
      detourKm: 10,
    });
    assert.equal(via?.id, "loc-mid");
    const split = splitRoutedLeg(route, mid.lat, mid.lng);
    assert.ok(split);
    assert.ok(split!.before.miles < route.miles);
    assert.ok(split!.after.miles < route.miles);
    assert.ok(Math.abs(split!.before.miles + split!.after.miles - route.miles) < 0.01);
  });

  it("maps OSM operators to catalog networks", () => {
    assert.equal(networkFromOsmTags({ operator: "IONITY GmbH", name: "IONITY Padborg" }), "ionity");
    assert.equal(networkFromOsmTags({ brand: "Tesla", "tesla:supercharger": "yes" }), "tesla");
    assert.equal(networkFromOsmTags({ operator: "Mer", amenity: "charging_station" }), "mer");
    assert.equal(networkFromOsmTags({ operator: "Clever", name: "Clever Kolding" }), "clever");
    assert.ok(isDcStation({ "socket:ccs": "2", "charging_station:output": "150 kW" }));
  });

  it("prices Storebælt when the path crosses the bridge", () => {
    const path: [number, number][] = [
      [55.33, 10.9],
      [55.3417, 10.9944],
      [55.36, 11.1],
    ];
    assert.equal(gatesOnPath(path)[0]?.id, "storebaelt");
    const toll = estimateTolls(path, 12, false, "fastest");
    assert.ok(toll.kr >= 268);
    assert.equal(estimateTolls(path, 12, false, "eco").kr, 268);
  });
});
