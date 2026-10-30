import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChargeLocation } from "@/lib/charge-locations";
import {
  applyLiveRoutes,
  chargeMinutes,
  planTotals,
  corridorKey,
  lookupCachedRoute,
  pricePlan,
  primeRouteCache,
  routeOutdated,
  routeTooCoarse,
  UNKNOWN_CHARGER_KR_PER_KWH,
  type PlanStop,
  type PricedLeg,
  type RoutedLeg,
} from "./engine.ts";
import { defaultSpeedEff } from "./modes.ts";

/**
 * Charge placement on a synthetic straight road due north from 55°N, 10°E.
 * One degree of latitude is ~111 km; the car is a 75 kWh pack at ~250 Wh/mi.
 */
const KM_PER_DEG = 111.2;
const START: PlanStop = { id: "a", name: "Start", lat: 55, lng: 10 };

function road(km: number): RoutedLeg {
  const deg = km / KM_PER_DEG;
  const steps = Math.max(2, Math.round(km / 5));
  const path: [number, number][] = Array.from({ length: steps + 1 }, (_, i) => [55 + (deg * i) / steps, 10]);
  return { miles: km / 1.609, seconds: (km / 100) * 3600, path, source: "osrm" };
}

function endOf(km: number): PlanStop {
  return { id: "b", name: "End", lat: 55 + km / KM_PER_DEG, lng: 10 };
}

/** A Supercharger every `everyKm`, ~300 m off the road. */
function chargersEvery(everyKm: number, untilKm: number): ChargeLocation[] {
  const out: ChargeLocation[] = [];
  for (let km = everyKm; km < untilKm; km += everyKm) {
    out.push({
      id: `sc-${km}`,
      name: `Supercharger km ${km}`,
      short: `SC ${km}`,
      usdPerKwh: 0.5,
      lat: 55 + km / KM_PER_DEG,
      lng: 10.005,
      kind: "supercharger",
      preset: false,
      radiusM: 250,
    });
  }
  return out;
}

function charger(id: string, km: number, kind: ChargeLocation["kind"], usdPerKwh: number, lngOffset = 0.002) {
  return {
    id,
    name: id,
    short: id,
    usdPerKwh,
    lat: 55 + km / KM_PER_DEG,
    lng: 10 + lngOffset,
    kind,
    preset: false,
    radiusM: 250,
  } satisfies ChargeLocation;
}

/**
 * The trip from the bug report, reduced: the first charger sits ~220 km in, so the car
 * reaches it at ~29% — just above the 25% "must charge" line. A cheaper look-alike is 3 km on.
 */
const GAP = [
  charger("sc-220", 220, "supercharger", 0.5),
  charger("cheap-223", 223, "custom", 0.2, 0.004),
  charger("sc-480", 480, "supercharger", 0.5),
];

function plan(km: number, locations: ChargeLocation[], soc = 80, mode: "eco" | "fastest" | "cheapest" = "fastest"): PricedLeg[] {
  return pricePlan({
    stops: [START, endOf(km)],
    modes: [mode],
    detours: [12],
    routes: [road(km)],
    soc,
    usableKwh: 75,
    locations,
    hours: [],
    acKw: 11,
    acKr: 2,
    speedEff: defaultSpeedEff(250),
    departHhmm: "",
  });
}

const fromVia = (legs: PricedLeg[]) => legs.filter((l) => l.from.id.startsWith("via-"));

describe("pricePlan charge stops", () => {
  it("does not stop or charge on a trip the battery covers", () => {
    const legs = plan(120, chargersEvery(40, 120));
    assert.equal(legs.length, 1);
    assert.equal(legs[0].accepted && legs[0].charge ? 1 : 0, 0);
  });

  for (const mode of ["eco", "fastest", "cheapest"] as const) {
    it(`${mode}: charges at every charger the route is sent through (no drive-past stops)`, () => {
      const legs = plan(700, GAP, 80, mode);
      const vias = fromVia(legs);
      assert.ok(vias.length >= 2, `expected two charge stops on 700 km, got ${vias.length}`);
      for (const leg of vias) {
        assert.ok(leg.accepted, `${leg.from.name}: route goes here but the charge is not taken`);
        assert.ok(leg.charge && leg.charge.kwh > 0, `${leg.from.name}: route goes here but no kWh is charged`);
        assert.equal(leg.advice, "required");
      }
    });

    it(`${mode}: never invents an unknown-charger stop when a real charger is in range`, () => {
      const legs = plan(700, GAP, 80, mode);
      const fake = legs.filter((l) => l.from.id.startsWith("via-range-") || l.to.id.startsWith("via-range-"));
      assert.deepEqual(
        fake.map((l) => `${l.from.name}→${l.to.name}`),
        [],
        "the 220 km charger was skipped and a placeholder stop inserted instead",
      );
    });

    it(`${mode}: charges at the stall the route goes to, not a look-alike nearby`, () => {
      for (const leg of fromVia(plan(700, GAP, 80, mode))) {
        assert.equal(`via-${leg.charge?.locationId}`, leg.from.id, `charged at ${leg.charge?.name}, routed via ${leg.from.name}`);
      }
    });
  }

  // Chargers out of reach of the first charge stop, and a road with long gaps between chargers.
  const BEYOND: [number, ChargeLocation[]] = [800, [charger("sc-400", 400, "supercharger", 0.5), charger("sc-650", 650, "supercharger", 0.5)]];
  const SPARSE: [number, ChargeLocation[]] = [
    1100,
    [charger("sc-250", 250, "supercharger", 0.5), charger("sc-600", 600, "supercharger", 0.5), charger("sc-950", 950, "supercharger", 0.5)],
  ];
  const ROADS: Array<[string, number, ChargeLocation[]]> = [
    ["gap", 700, GAP],
    ["beyond", ...BEYOND],
    ["sparse", ...SPARSE],
    ["dense", 900, chargersEvery(40, 900)],
  ];

  for (const [road, km, locations] of ROADS) {
    for (const mode of ["eco", "fastest", "cheapest"] as const) {
      it(`${road}/${mode}: every charge happens where the car is, not further down the road`, () => {
        for (const leg of plan(km, locations, 80, mode)) {
          if (!leg.accepted || !leg.charge || leg.charge.placeholder) continue;
          const stall = locations.find((l) => l.id === leg.charge!.locationId);
          assert.ok(stall, `unknown stall ${leg.charge.locationId}`);
          const awayKm = Math.abs(stall.lat - leg.from.lat) * KM_PER_DEG;
          assert.ok(awayKm < 3, `${leg.from.name}→${leg.to.name} books a charge at ${stall.name}, ${awayKm.toFixed(0)} km away`);
        }
      });

      it(`${road}/${mode}: never charges twice in a row at the same place`, () => {
        const at = plan(km, locations, 80, mode)
          .filter((l) => l.accepted && l.charge)
          .map((l) => (l.charge!.placeholder ? `est@${l.from.id}` : l.charge!.locationId));
        for (let i = 1; i < at.length; i++) assert.notEqual(at[i], at[i - 1], `two charges in a row at ${at[i]}`);
      });

      it(`${road}/${mode}: a stop with no known charger is always an estimate`, () => {
        for (const leg of plan(km, locations, 80, mode)) {
          if (!leg.from.id.startsWith("via-range-")) continue;
          assert.equal(leg.charge?.placeholder, true, `${leg.from.name}: booked ${leg.charge?.name} instead of an estimate`);
        }
      });
    }
  }

  for (const km of [900, 2600, 3500]) {
    it(`${km} km: no leg uses more energy than the battery holds when it leaves`, () => {
      for (const leg of plan(km, chargersEvery(40, km))) {
        const used = (leg.kwh / 75) * 100;
        const realArrive = leg.startSoc - used;
        assert.ok(
          realArrive >= 7.5,
          `${leg.from.name}→${leg.to.name}: leaves at ${leg.startSoc.toFixed(0)}%, needs ${used.toFixed(0)}% (arrives at ${realArrive.toFixed(0)}%, shown as ${leg.arriveSoc.toFixed(0)}%)`,
        );
      }
    });
  }

  for (const mode of ["eco", "fastest", "cheapest"] as const) {
    it(`${mode}: charges above 80% to bridge a long gap instead of planning an estimate (#69)`, () => {
      const legs = plan(...SPARSE, 80, mode);
      const estimates = legs.filter((l) => l.accepted && l.charge?.placeholder);
      assert.deepEqual(estimates.map((l) => l.from.name), [], "planned estimate stops although a fuller charge reaches the next charger");
      const used = legs.filter((l) => l.accepted && l.charge).map((l) => l.charge!.locationId);
      assert.ok(used.includes("sc-600") && used.includes("sc-950"), `charged at ${used.join(", ")}`);
      const fuller = legs.filter((l) => l.accepted && l.charge && l.startSoc > 81);
      assert.ok(fuller.length >= 1, "expected at least one charge above 80%");
      for (const leg of legs) assert.ok(leg.startSoc <= 100.01, `${leg.from.name} leaves at ${leg.startSoc.toFixed(0)}%`);
    });
  }

  it("keeps the usual 80% when the next charger is within reach (#69)", () => {
    for (const leg of plan(700, GAP)) {
      if (leg.accepted && leg.charge) assert.ok(leg.startSoc <= 80.5, `${leg.from.name} charges to ${leg.startSoc.toFixed(0)}%`);
    }
  });

  it("charging above 80% takes longer per kWh (#69)", () => {
    const below = chargeMinutes(20, 30, 75, 150); // 30% → ~57%
    const above = chargeMinutes(20, 75, 75, 150); // 75% → ~102% capped in practice, mostly above 80%
    assert.ok(Math.abs(below - 8) < 0.01, `20 kWh at 150 kW below 80% should take 8 min, took ${below.toFixed(1)}`);
    assert.ok(above > below * 2, `above 80% took ${above.toFixed(1)} min vs ${below.toFixed(1)} below`);
  });

  it("counts every charge in the trip price", () => {
    const legs = plan(700, GAP);
    const charged = legs.filter((l) => l.accepted && l.charge).reduce((n, l) => n + l.charge!.kr, 0);
    const total = legs.reduce((n, l) => n + l.kr - l.tollKr, 0);
    assert.ok(charged > 0);
    assert.ok(Math.abs(total - charged) < 0.01, `trip ${total.toFixed(2)} kr vs charges ${charged.toFixed(2)} kr`);
  });

  it("never lists the same charger twice", () => {
    const legs = plan(900, chargersEvery(40, 900));
    const ids = legs.filter((l) => l.accepted && l.charge).map((l) => l.charge!.locationId);
    assert.deepEqual(ids, [...new Set(ids)]);
  });

  it("keeps the battery above the floor when chargers exist", () => {
    for (const leg of plan(900, chargersEvery(40, 900))) {
      assert.ok(leg.arriveSoc >= 8, `${leg.to.name}: arrives at ${leg.arriveSoc.toFixed(1)}%`);
    }
  });

  it("still plans and prices a charge where no charger is known, flagged as an estimate", () => {
    const legs = plan(700, []);
    const stops = fromVia(legs);
    assert.ok(stops.length >= 1, "expected at least one stop where the range runs out");
    for (const leg of stops) {
      assert.ok(leg.accepted, "placeholder stop must charge");
      assert.equal(leg.charge?.placeholder, true);
      assert.ok((leg.charge?.kwh ?? 0) > 0);
      assert.ok(Math.abs((leg.charge?.kr ?? 0) - (leg.charge?.kwh ?? 0) * UNKNOWN_CHARGER_KR_PER_KWH) < 0.01);
    }
    const total = legs.reduce((n, l) => n + l.kr, 0);
    assert.ok(total > 0, "the trip price must include the estimated charges");
    for (const leg of legs) {
      assert.ok(leg.arriveSoc >= 8, `${leg.to.name}: arrives at ${leg.arriveSoc.toFixed(1)}%`);
    }
  });

  it("does not mark real chargers as estimates", () => {
    for (const leg of plan(900, chargersEvery(40, 900))) {
      assert.notEqual(leg.charge?.placeholder, true);
    }
  });
});

describe("stored routes", () => {
  const from = { lat: 55.3959, lng: 10.3883 };
  const to = { lat: 60.251, lng: 25.011 };
  const long = (points: number): RoutedLeg => ({
    miles: 2560 / 1.609,
    seconds: 28 * 3600,
    source: "valhalla",
    ferries: [],
    path: Array.from({ length: points }, (_, i) => [from.lat + ((to.lat - from.lat) * i) / (points - 1), from.lng + ((to.lng - from.lng) * i) / (points - 1)]),
  });

  it("ignores a stored long route that is too coarse, so it gets fetched again", () => {
    primeRouteCache({ [corridorKey(from, to, "fastest")]: long(40) });
    assert.equal(lookupCachedRoute(from, to, "fastest"), undefined);
  });

  it("keeps a stored long route with enough points", () => {
    primeRouteCache({ [corridorKey(from, to, "eco")]: long(257) });
    assert.equal(lookupCachedRoute(from, to, "eco")?.path.length, 257);
  });
});

describe("routeTooCoarse", () => {
  const route = (km: number, points: number): RoutedLeg => ({
    miles: km / 1.609,
    seconds: km * 36,
    source: "osrm",
    path: Array.from({ length: points }, (_, i) => [55 + i * 0.01, 10]),
  });

  it("flags the old 40-point stored version of a 2,500 km route", () => {
    assert.equal(routeTooCoarse(route(2560, 40)), true);
  });

  it("accepts freshly fetched and newly stored routes", () => {
    assert.equal(routeTooCoarse(route(2560, 220)), false);
    assert.equal(routeTooCoarse(route(2560, 257)), false);
    assert.equal(routeTooCoarse(route(300, 40)), false);
  });
});

describe("ferry crossings (#71)", () => {
  // 620 km north from 55°N with a 20 km crossing at km 300–320 (Rødby–Puttgarden-like).
  const KM = 111.2;
  const at = (km: number): [number, number] => [55 + km / KM, 10];
  const path: [number, number][] = Array.from({ length: 125 }, (_, i) => at(i * 5));
  const crossing = { name: "Rødby (DK) - Puttgarden (D)", from: at(300), to: at(320), miles: 20 / 1.609, seconds: 2700 };
  const route: RoutedLeg = { miles: 620 / 1.609, seconds: (600 / 100) * 3600 + 2700, path, source: "valhalla", ferries: [crossing] };
  const chargers = [...chargersEvery(40, 620).filter((c) => (c.lat - 55) * KM < 300 || (c.lat - 55) * KM > 320), charger("in-the-sea", 310, "supercharger", 0.5)];
  const legs = pricePlan({
    stops: [START, endOf(620)],
    modes: ["fastest"],
    detours: [12],
    routes: [route],
    soc: 80,
    usableKwh: 75,
    locations: chargers,
    hours: [],
    acKw: 11,
    acKr: 2,
    speedEff: defaultSpeedEff(250),
    departHhmm: "",
  });
  const ferryLegs = legs.filter((l) => l.ferry);

  it("plans the crossing as its own leg", () => {
    assert.equal(ferryLegs.length, 1);
    // The test road is not at the real ports, so the router's names and time are used.
    assert.equal(ferryLegs[0].ferry?.known, false);
    assert.equal(ferryLegs[0].ferry?.crossingMin, 45);
    assert.equal(ferryLegs[0].from.name, "Rødby (DK)");
    assert.equal(ferryLegs[0].to.name, "Puttgarden (D)");
  });

  it("uses no battery on the ferry", () => {
    const f = ferryLegs[0];
    assert.equal(f.kwh, 0);
    assert.equal(f.arriveSoc, f.startSoc);
  });

  it("never charges on the ferry or at a charger in the water", () => {
    assert.equal(ferryLegs[0].charge, null);
    const used = legs.filter((l) => l.accepted && l.charge).map((l) => l.charge!.locationId);
    assert.ok(!used.includes("in-the-sea"), `charged at ${used.join(", ")}`);
  });

  it("counts check-in and crossing time, and only the driven distance as energy", () => {
    const f = ferryLegs[0];
    assert.equal(f.waitMin, f.ferry!.checkInMin + f.ferry!.departureWaitMin);
    const minutes = (Date.parse(f.arriveAt) - Date.parse(f.departAt)) / 60_000;
    assert.equal(minutes, f.ferry!.checkInMin + f.ferry!.departureWaitMin + f.ferry!.crossingMin);
    const drivenKm = legs.filter((l) => !l.ferry).reduce((n, l) => n + l.route.miles * 1.609, 0);
    assert.ok(Math.abs(drivenKm - 600) < 1, `driven ${drivenKm.toFixed(1)} km`);
  });

  it("counts the ferry fare in the trip price", () => {
    const f = ferryLegs[0];
    assert.ok(f.ferry!.fareKr > 0);
    assert.equal(f.kr, f.ferry!.fareKr);
    assert.equal(f.ferryKr, f.ferry!.fareKr);
    const t = planTotals(legs);
    assert.equal(t.ferryKr, f.ferry!.fareKr);
    const charged = legs.filter((l) => l.accepted && l.charge).reduce((n, l) => n + l.charge!.kr, 0);
    assert.ok(Math.abs(t.kr - t.tollKr - t.ferryKr - charged) < 0.01, `trip ${t.kr} kr = toll ${t.tollKr} + ferry ${t.ferryKr} + charges ${charged}`);
  });

  it("keeps the ferry leg when live routes are applied", () => {
    const live = applyLiveRoutes(legs, () => ({ ...route, ferries: [] }), defaultSpeedEff(250));
    const f = live.find((l) => l.ferry)!;
    assert.equal(f.kr, ferryLegs[0].kr);
    assert.equal(f.route, ferryLegs[0].route);
  });

  it("still arrives with charge to spare on both sides of the water", () => {
    for (const leg of legs) assert.ok(leg.arriveSoc >= 8, `${leg.from.name}→${leg.to.name} arrives at ${leg.arriveSoc.toFixed(0)}%`);
  });
});

describe("routeOutdated (#71)", () => {
  const base = (source: RoutedLeg["source"]): RoutedLeg => ({
    miles: 200,
    seconds: 12_000,
    source,
    path: Array.from({ length: 60 }, (_, i) => [55 + i * 0.05, 10] as [number, number]),
  });

  it("refetches a Valhalla route stored before ferries were read", () => {
    assert.equal(routeOutdated(base("valhalla")), true);
  });

  it("keeps Valhalla routes that carry their ferry list, even an empty one", () => {
    assert.equal(routeOutdated({ ...base("valhalla"), ferries: [] }), false);
  });

  it("keeps OSRM routes (OSRM never takes ferries)", () => {
    assert.equal(routeOutdated(base("osrm")), false);
  });
});

describe("battery limits and charging speed from the Car tab", () => {
  const base = {
    stops: [START, endOf(600)],
    modes: ["fastest" as const],
    detours: [12],
    routes: [road(600)],
    soc: 80,
    usableKwh: 75,
    locations: chargersEvery(40, 600),
    hours: [],
    acKw: 11,
    acKr: 2,
    speedEff: defaultSpeedEff(250),
    departHhmm: "",
  };
  const last = (legs: PricedLeg[]) => legs[legs.length - 1];

  it("arrives at the last stop with at least the destination limit", () => {
    const short = { ...base, stops: [START, endOf(300)], routes: [road(300)], locations: chargersEvery(40, 300) };
    const loose = pricePlan({ ...short, limits: { floorSoc: 8, destSoc: 8 } });
    const strict = pricePlan({ ...short, limits: { floorSoc: 8, destSoc: 40 } });
    assert.ok(last(loose).arriveSoc < 40, `loose arrives at ${last(loose).arriveSoc.toFixed(1)}%`);
    assert.ok(last(strict).arriveSoc >= 40 - 0.5, `strict arrives at ${last(strict).arriveSoc.toFixed(1)}%`);
  });

  it("never arrives at a charger below a higher floor", () => {
    const legs = pricePlan({ ...base, limits: { floorSoc: 20, destSoc: 20 } });
    for (const leg of legs) assert.ok(leg.arriveSoc >= 20 - 0.5, `${leg.to.name} at ${leg.arriveSoc.toFixed(1)}%`);
  });

  it("charges to the target the user set", () => {
    const legs = pricePlan({ ...base, soc: 60, routes: [road(900)], stops: [START, endOf(900)], locations: chargersEvery(40, 900), limits: { targetSoc: 90 } });
    const charged = legs.filter((l) => l.accepted && l.charge);
    assert.ok(charged.length > 0);
    assert.ok(charged.some((l) => l.startSoc > 81), `charged to ${charged.map((l) => l.startSoc.toFixed(0)).join(", ")}%`);
  });

  it("a slower-charging car spends longer at the same chargers", () => {
    const fast = pricePlan({ ...base, dcKw: 150 });
    const slow = pricePlan({ ...base, dcKw: 60 });
    const minutes = (legs: PricedLeg[]) => legs.reduce((n, l) => n + l.chargeMin, 0);
    assert.ok(minutes(fast) > 0);
    assert.ok(minutes(slow) > minutes(fast) * 2, `${minutes(slow).toFixed(0)} vs ${minutes(fast).toFixed(0)} min`);
  });

  it("without settings the planner keeps its built-in limits", () => {
    const legs = pricePlan(base);
    assert.deepEqual(legs.map((l) => l.to.id), pricePlan({ ...base, limits: {} }).map((l) => l.to.id));
  });
});


describe('a Danish Supercharger costs the Danish price', () => {
  it('prices the charge at 2.60 kr for an owner in Denmark', () => {
    const dk = chargersEvery(40, 600).map((c) => ({ ...c, networkId: 'tesla', country: 'DK' }));
    const legs = pricePlan({
      stops: [START, endOf(600)], modes: ['fastest'], detours: [12], routes: [road(600)], soc: 80, usableKwh: 75,
      locations: dk, hours: [], acKw: 11, acKr: 2, speedEff: defaultSpeedEff(250), departHhmm: '', memberships: { tesla: true },
    });
    const charged = legs.filter((l) => l.accepted && l.charge);
    assert.ok(charged.length > 0);
    for (const l of charged) assert.equal(l.charge!.rateKr, 2.6);
  });
});
