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
  kwhPerMiFrom100km,
  KWH_100KM_TO_KWH_MI,
  waitMinUntil,
  waitMinUntilDated,
  addMinutesDateTime,
  minutesBetweenDateTime,
  asDateTime,
  waitDelayMin,
  cheapDetourKm,
  detourPays,
  detourSavings,
  pathMode,
  routeAb,
  stallKw,
  timePenalized,
} from "./modes.ts";
import { rateForNetwork, networkIdFor, roamExtra, EU_NETWORKS, EU_REGIONS, regionalOwn, regionalRoam } from "./networks.ts";
import { pickCheapAvoidRoute, pickEcoRoute, pickRouted } from "./pick-route.ts";
import { alongFraction, pickViaAtRange, pickViaOnPath, splitRoutedLeg } from "./insert.ts";
import { networkFromOsmTags, isDcStation, networkFromOperator } from "./osm-operator.ts";
import { estimateTolls, gatesOnPath } from "./tolls.ts";
import { seedsAlongPath } from "./seed-chargers.ts";
import { toDkk, CATALOG_FX, NETWORK_NATIVE } from "./charge-fx.ts";
import { encodePolyline, decodePolyline, polylineBufferKm, chargersOnPath, simplifyPath } from "./polyline.ts";
import { countryProfile } from "./country-profiles.ts";

describe("leg modes", () => {
  it("eco avoids highways and tolls", () => {
    const c = costingFor("eco");
    assert.equal(c.shortest, false);
    assert.equal(c.use_highways, 0.25);
    assert.equal(c.use_tolls, 0);
  });

  it("fastest prefers highways and tolls", () => {
    const c = costingFor("fastest");
    assert.equal(c.shortest, false);
    assert.equal(c.use_highways, 1);
    assert.equal(c.use_tolls, 1);
  });

  it("cheapest uses the same roads as fastest so it can hit cheap HPC", () => {
    const c = costingFor("cheapest");
    assert.equal(c.use_highways, costingFor("fastest").use_highways);
    assert.equal(c.use_tolls, costingFor("fastest").use_tolls);
  });

  it("charge search is wider for eco and cheapest", () => {
    assert.ok(chargeSearchKm("cheapest", 12) >= 40);
    assert.ok(chargeSearchKm("eco", 8) >= 30);
    assert.ok(chargeSearchKm("fastest", 18) >= 18);
    assert.equal(formatWaitCap(0), "0");
    assert.equal(formatWaitCap(30), "30m");
    assert.equal(formatWaitCap(120), "2h");
  });

  it("cheapest may detour up to 15% of fastest time", () => {
    assert.equal(cheapDetourKm(2 * 3600), 24);
    assert.equal(cheapDetourKm(15 * 3600), 80);
    assert.ok(chargeSearchKm("cheapest", 12, "pris", 2 * 3600) >= 24);
    assert.ok(chargeSearchKm("cheapest", 12, "pris", 15 * 3600) >= 80);
  });

  it("detour savings is net kr vs extra drive time", () => {
    const save = detourSavings(
      { kr: 700, tollKr: 200, driveMin: 900, mi: 900 },
      { kr: 540, tollKr: 200, driveMin: 980, mi: 915 },
    );
    assert.equal(save.chargeSaved, 160);
    assert.equal(save.tollSaved, 0);
    assert.equal(save.net, 160);
    assert.equal(save.extraMin, 80);
    assert.equal(save.significant, false);
  });

  it("A/B picks significant savings, else the faster road", () => {
    const fast = { kr: 800, tollKr: 200, driveMin: 900, mi: 900 };
    const cheapWin = { kr: 500, tollKr: 200, driveMin: 910, mi: 905 };
    const cheapLose = { kr: 780, tollKr: 200, driveMin: 980, mi: 920 };
    assert.equal(routeAb(fast, cheapWin).overall, "b");
    assert.equal(routeAb(fast, cheapLose).overall, "a");
    assert.equal(routeAb(fast, cheapWin).cost, "b");
  });

  it("penalizes a route 2× slower than fastest", () => {
    const fast = { kr: 800, tollKr: 200, driveMin: 900, mi: 900 };
    const eco = { kr: 200, tollKr: 0, driveMin: 1800, mi: 1100 };
    assert.equal(timePenalized(900, 1800), true);
    assert.equal(timePenalized(900, 1700), false);
    const ab = routeAb(fast, eco);
    assert.equal(ab.bSlow, true);
    assert.equal(ab.overall, "a");
  });

  it("only detours when savings are significant", () => {
    assert.equal(detourPays({ baseKr: 100, stallKr: 90, extraKr: 8, distM: 2000 }), true);
    assert.equal(detourPays({ baseKr: 100, stallKr: 90, extraKr: 8, distM: 12000 }), false);
    assert.equal(detourPays({ baseKr: 100, stallKr: 40, extraKr: 12, distM: 12000 }), true);
    assert.equal(detourPays({ baseKr: 100, stallKr: 50, extraKr: 20, distM: 12000 }), false);
  });

  it("eco and cheapest search farther for chargers than fastest", () => {
    assert.ok(chargeSearchKm("eco", 12) > chargeSearchKm("fastest", 12));
    assert.ok(chargeSearchKm("cheapest", 12) > chargeSearchKm("fastest", 12));
    assert.ok(chargeSearchKm("eco", 12) >= 30);
  });

  it("default focus matches the mode", () => {
    assert.equal(pathMode("eco"), "eco");
    assert.equal(pathMode("fastest"), "fastest");
    assert.equal(pathMode("cheapest"), "fastest");
    assert.equal(pathMode("cheapest", true), "eco");
    assert.equal(pathMode("cheapest", { motorways: true }), "eco");
    assert.equal(pathMode("cheapest", { tolls: true, roadFees: true }), "cheapest");
  });

  it("cheapest avoid toggles split motorways, gates and road fees", () => {
    const noTolls = costingFor("cheapest", { tolls: true });
    assert.equal(noTolls.use_highways, 1);
    assert.equal(noTolls.use_tolls, 0);
    const noMoto = costingFor("cheapest", { motorways: true });
    assert.equal(noMoto.use_highways, 0.25);
  });

  it("cheapest skips a gate only if the detour stays under 15%", () => {
    const gatePath: [number, number][] = [
      [55.33, 10.9],
      [55.3417, 10.9944],
      [55.36, 11.1],
    ];
    const skipPath: [number, number][] = [
      [55.4, 10.4],
      [55.5, 9.5],
      [55.4, 9.4],
    ];
    const fast = { miles: 12, seconds: 1000, path: gatePath, source: "osrm", hasToll: true };
    const near = { miles: 14, seconds: 1100, path: skipPath, source: "valhalla", hasToll: false };
    const far = { miles: 40, seconds: 2000, path: skipPath, source: "osrm", hasToll: false };
    assert.equal(pickCheapAvoidRoute(fast, [near], { tolls: true })?.source, "valhalla");
    assert.equal(pickCheapAvoidRoute(fast, [far], { tolls: true })?.source, "osrm");
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

  it("1 kWh/100 km is 0.0161 kWh/mile", () => {
    assert.equal(kwhPerMiFrom100km(1), 0.0161);
    assert.equal(KWH_100KM_TO_KWH_MI, 0.0161);
    const eff = { 50: 16.1, 80: 16.1, 110: 16.1, 130: 16.1 };
    const seconds = (100 * 1.609344) / 80 * 3600;
    assert.ok(Math.abs(driveKwhAtSpeed(100, seconds, eff) - 25.921) < 0.02);
  });

  it("interpolates kWh/100 km between 50, 80, 110 and 130 km/t", () => {
    const eff = { 50: 12, 80: 16, 110: 19, 130: 22 };
    assert.ok(Math.abs(interpolateWhPerMi(eff, 80) - 16 * 16.1) < 0.2);
    const slow = driveKwhAtSpeed(50, (50 * 1.609344) / 50 * 3600, defaultSpeedEff(240));
    const fast = driveKwhAtSpeed(50, (50 * 1.609344) / 130 * 3600, defaultSpeedEff(240));
    assert.ok(fast > slow);
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

  it("DC stalls are not timed at home AC kW", () => {
    assert.equal(stallKw("supercharger", 11), 150);
    assert.equal(stallKw("home", 11), 11);
    const kwh = 177;
    const dcMin = (kwh / stallKw("supercharger", 11)) * 60;
    const acMin = (kwh / 11) * 60;
    assert.ok(dcMin < 90);
    assert.ok(acMin > 14 * 60);
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

  it("motorway km tolls apply to fastest and cheapest, not eco", () => {
    const path: [number, number][] = [
      [48.85, 2.35],
      [45.75, 4.85],
      [43.3, 5.4],
    ];
    const fast = estimateTolls(path, 480, false, "fastest");
    const cheap = estimateTolls(path, 480, false, "cheapest");
    const eco = estimateTolls(path, 480, true, "eco");
    assert.ok(fast.kr > 200);
    assert.equal(cheap.kr, fast.kr);
    assert.equal(eco.kr, 0);
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

  it("eco keeps the no-toll road; fastest keeps the quicker one", () => {
    const path = Array.from({ length: 12 }, (_, i) => [48.8 - i * 0.5, 2.3 + i * 0.8] as [number, number]);
    const highway = { miles: 890, seconds: 15 * 3600, path, source: "valhalla", tollKr: 400 };
    const quiet = { miles: 1100, seconds: 34 * 3600, path, source: "osrm", tollKr: 0 };
    assert.equal(pickRouted("fastest", [highway, quiet])?.seconds, highway.seconds);
    assert.equal(pickRouted("eco", [highway, quiet])?.tollKr, 0);
    assert.equal(pickRouted("cheapest", [highway, quiet])?.seconds, highway.seconds);
  });

  it("eco drops a quiet road that is 2× slower than Fastest", () => {
    const path = Array.from({ length: 12 }, (_, i) => [48.8 - i * 0.5, 2.3 + i * 0.8] as [number, number]);
    const highway = { miles: 890, seconds: 15 * 3600, path, source: "valhalla", tollKr: 400 };
    const crawl = { miles: 1100, seconds: 34 * 3600, path, source: "osrm", tollKr: 0 };
    const reasonable = { miles: 980, seconds: 18 * 3600, path, source: "osrm", tollKr: 0 };
    assert.equal(pickEcoRoute(highway, [crawl])?.seconds, crawl.seconds);
    assert.equal(pickEcoRoute(highway, [crawl, reasonable])?.seconds, reasonable.seconds);
  });

  it("finds a via on the Paris–Rome corridor for every mode", () => {
    const path: [number, number][] = [
      [48.8566, 2.3522],
      [47.798, 3.567],
      [47.025, 4.848],
      [45.748, 4.846],
      [45.07, 7.686],
      [45.464, 9.19],
      [44.494, 11.342],
      [43.77, 11.254],
      [41.9028, 12.4964],
    ];
    const locations = seedsAlongPath(path, 40_000);
    assert.ok(locations.length >= 4, `seeds ${locations.length}`);
    for (const mode of ["eco", "fastest", "cheapest"] as const) {
      const via = pickViaOnPath({
        path,
        locations,
        budgetKwh: 60,
        totalKwh: 200,
        mode,
        detourKm: 12,
      });
      assert.ok(via, `${mode} via`);
    }
    const near = pickViaOnPath({
      path,
      locations,
      budgetKwh: 36,
      totalKwh: 200,
      mode: "fastest",
      detourKm: 18,
    });
    assert.ok(near, "via within current SOC range");
    const frac = alongFraction(path, near!.lat, near!.lng);
    assert.ok(frac * 200 <= 36 * 0.96, `via at ${frac} uses too much energy`);
  });

  it("charge stop arrives between 8% and 25%", () => {
    const path: [number, number][] = [
      [55.4, 10.4],
      [54.8, 9.4],
      [53.5, 10.0],
      [51.2, 6.8],
      [48.8, 9.2],
      [45.5, 9.2],
      [41.9, 12.5],
    ];
    const locations = seedsAlongPath(path, 40_000);
    const soc = 70;
    const usable = 75;
    const budgetKwh = ((soc - 8) / 100) * usable;
    const minKwh = ((soc - 25) / 100) * usable;
    const via = pickViaOnPath({
      path,
      locations,
      budgetKwh,
      minKwh,
      totalKwh: 280,
      mode: "fastest",
      detourKm: 18,
    });
    assert.ok(via, "via in 8–25% band");
    const energy = 280 * alongFraction(path, via!.lat, via!.lng);
    const arrive = soc - (energy / usable) * 100;
    assert.ok(arrive >= 8, `arrive ${arrive} below 8%`);
    assert.ok(arrive <= 25, `arrive ${arrive} above 25%`);
  });

  it("1200 mile trip inserts several charge vias", () => {
    const from = { lat: 55.4, lng: 10.4 };
    const to = { lat: 41.9, lng: 12.5 };
    const path: [number, number][] = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      path.push([from.lat + (to.lat - from.lat) * t, from.lng + (to.lng - from.lng) * t]);
    }
    const locations = path.slice(1, -1).map((p, i) => ({
      id: `sc-${i}`,
      lat: p[0],
      lng: p[1],
      kind: "supercharger" as const,
      usdPerKwh: 0.4,
      name: `SC ${i}`,
      short: `SC${i}`,
    }));
    const eff = defaultSpeedEff(240);
    let route: { miles: number; seconds: number; path: [number, number][]; source: "osrm" | "valhalla" | "air" } = {
      miles: 1200,
      seconds: 18 * 3600,
      path,
      source: "osrm",
    };
    let soc = 68;
    const used = new Set<string>();
    const vias: string[] = [];
    for (let d = 0; d < 12; d++) {
      const kwh = driveKwhAtSpeed(route.miles, route.seconds, eff);
      const pack = soc < 25 ? 80 : soc;
      const floorKwh = Math.max(4, ((pack - 8) / 100) * 75);
      if (kwh <= floorKwh * 0.98) break;
      const via = pickViaAtRange({
        path: route.path,
        locations,
        budgetKwh: floorKwh,
        minKwh: Math.max(0, ((pack - 25) / 100) * 75),
        totalKwh: kwh,
        mode: "fastest",
        detourKm: 18,
        excludeIds: used,
      });
      if (!via) break;
      const split = splitRoutedLeg(route, via.lat, via.lng);
      if (!split) break;
      used.add(via.id);
      vias.push(via.id);
      const usedKwh = driveKwhAtSpeed(split.before.miles, split.before.seconds, eff);
      soc = Math.max(15, soc - (usedKwh / 75) * 100);
      soc = 80;
      route = split.after;
    }
    assert.ok(vias.length >= 4, `vias ${vias.length}`);
  });
});
