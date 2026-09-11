import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMinutesHhmm,
  chargeSearchKm,
  chargeFitScore,
  costingFor,
  defaultSpeedEff,
  driveKwhAtSpeed,
  epaWhPerMi,
  formatWaitCap,
  hoursFrom,
  interpolateWhPerMi,
  waitMinUntil,
  waitMinUntilDated,
  addMinutesDateTime,
  minutesBetweenDateTime,
  asDateTime,
  waitDelayMin,
  pathMode,
} from "./modes.ts";
import { rateForNetwork, networkIdFor, roamExtra, EU_NETWORKS, EU_REGIONS, regionalOwn, regionalRoam } from "./networks.ts";
import { alongFraction, pickViaOnPath, splitRoutedLeg } from "./insert.ts";
import { networkFromOsmTags, isDcStation, networkFromOperator } from "./osm-operator.ts";
import { estimateTolls, gatesOnPath } from "./tolls.ts";
import { seedsAlongPath } from "./seed-chargers.ts";
import { toDkk, CATALOG_FX, NETWORK_NATIVE } from "./charge-fx.ts";
import { encodePolyline, decodePolyline, polylineBufferKm, chargersOnPath, simplifyPath } from "./polyline.ts";
import { countryProfile } from "./country-profiles.ts";

describe("leg modes", () => {
  it("eco is shortest + avoids highways and tolls", () => {
    const c = costingFor("eco");
    assert.equal(c.shortest, true);
    assert.equal(c.use_highways, 0);
    assert.equal(c.use_tolls, 0);
  });

  it("fastest prefers highways and tolls", () => {
    const c = costingFor("fastest");
    assert.equal(c.shortest, false);
    assert.equal(c.use_highways, 1);
    assert.equal(c.use_tolls, 1);
  });

  it("cheapest uses the same path as fastest", () => {
    assert.deepEqual(costingFor("cheapest"), costingFor("fastest"));
  });

  it("charge search radius equals the detour for every mode", () => {
    assert.equal(chargeSearchKm("cheapest", 12), 12);
    assert.equal(chargeSearchKm("eco", 8), 8);
    assert.equal(chargeSearchKm("fastest", 18, "pris"), 23);
    assert.equal(formatWaitCap(0), "0");
    assert.equal(formatWaitCap(30), "30m");
    assert.equal(formatWaitCap(120), "2h");
  });

  it("default focus matches the mode", () => {
    assert.equal(pathMode("eco"), "eco");
    assert.equal(pathMode("fastest"), "fastest");
    assert.equal(pathMode("cheapest"), "fastest");
    assert.equal(pathMode("cheapest", true), "eco");
  });

  it("time takes the highway corridor at 130 km/t", () => {
    const highway = chargeFitScore("time", { distM: 8000, kr: 90, dc: true });
    const local = chargeFitScore("time", { distM: 8000, kr: 20, dc: false });
    assert.ok(highway < local);
  });

  it("each focus ranks a different charger first", () => {
    const closeAc = chargeFitScore("distance", { distM: 400, kr: 80, dc: false });
    const farDc = chargeFitScore("distance", { distM: 9000, kr: 40, dc: true });
    assert.ok(closeAc < farDc);
    const cheapFar = chargeFitScore("pris", { distM: 8000, kr: 20, extraDriveKr: 6, dc: false });
    const dearNear = chargeFitScore("pris", { distM: 400, kr: 90, extraDriveKr: 0.4, dc: true });
    assert.ok(cheapFar < dearNear);
    const closeDc = chargeFitScore("time", { distM: 800, kr: 90, dc: true });
    const farCheap = chargeFitScore("time", { distM: 8000, kr: 20, dc: false });
    assert.ok(closeDc < farCheap);
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
      mode: "fastest",
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

  it("seeds IONITY and Tesla on a Kolding–Padborg corridor", () => {
    const path: [number, number][] = [
      [55.5324, 9.4918],
      [55.1, 9.42],
      [54.8236, 9.3594],
    ];
    const hits = seedsAlongPath(path, 28_000);
    const ids = hits.map((h) => h.networkId);
    assert.ok(ids.includes("tesla"), ids.join(","));
    assert.ok(ids.includes("ionity"), ids.join(","));
    assert.equal(networkFromOperator("CLEVER"), "clever");
    assert.equal(networkFromOperator("Tesla Supercharger Kolding"), "tesla");
    assert.ok(hits.some((h) => /padborg/i.test(h.name)));
  });

  it("encodes a Google polyline that round-trips", () => {
    const path: [number, number][] = [
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ];
    const encoded = encodePolyline(path);
    assert.equal(encoded, "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    const back = decodePolyline(encoded);
    assert.equal(back.length, 3);
    assert.ok(Math.abs(back[0][0] - 38.5) < 1e-5);
    assert.ok(Math.abs(back[2][1] + 126.453) < 1e-5);
  });

  it("sizes the polyline buffer by trip length", () => {
    const short: [number, number][] = [
      [55.53, 9.49],
      [55.56, 9.55],
    ];
    const mid: [number, number][] = [
      [55.5324, 9.4918],
      [55.1, 9.42],
      [54.8236, 9.3594],
    ];
    const far: [number, number][] = [
      [55.68, 12.57],
      [54.8, 9.36],
      [53.55, 9.99],
      [52.52, 13.4],
    ];
    assert.equal(polylineBufferKm(short).tight, 6);
    assert.equal(polylineBufferKm(mid).tight, 8);
    assert.ok(polylineBufferKm(mid).wide <= 14);
    assert.equal(polylineBufferKm(far).tight, 12);
    assert.equal(polylineBufferKm(far).wide, 18);
    const kept = chargersOnPath(
      [
        { lat: 55.5126, lng: 9.4629 },
        { lat: 56.2, lng: 10.2 },
      ],
      mid,
      8,
    );
    assert.equal(kept.length, 1);
  });

  it("simplifies a dense path without dropping the ends", () => {
    const path: [number, number][] = [];
    for (let i = 0; i <= 400; i++) path.push([55.5 + i * 0.002, 9.4 + i * 0.001]);
    const slim = simplifyPath(path, 80);
    assert.ok(slim.length <= 81);
    assert.ok(slim.length > 20);
    assert.equal(slim[0][0], path[0][0]);
    assert.equal(slim.at(-1)?.[0], path.at(-1)?.[0]);
  });
});
