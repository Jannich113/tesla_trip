import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pricePlan, type PlanStop, type RoutedLeg } from "./engine.ts";
import { haversineM } from "./insert.ts";
import { defaultSpeedEff } from "./modes.ts";
import { seedsAlongPath } from "./seed-chargers.ts";
import type { ChargeLocation } from "../lib/charge-locations.ts";

function stop(id: string, name: string, lat: number, lng: number): PlanStop {
  return { id, name, lat, lng };
}

type Trip = { name: string; from: PlanStop; to: PlanStop; via: [number, number][] };

const trips: Trip[] = [
  {
    name: "Svendborg–Barcelona",
    from: stop("svendborg", "Svendborg", 55.059, 10.607),
    to: stop("barcelona", "Barcelona", 41.387, 2.168),
    via: [
      [53.55, 9.993],
      [50.63, 5.58],
      [48.749, 2.366],
      [45.748, 4.846],
      [43.61, 3.877],
      [41.979, 2.821],
    ],
  },
  {
    name: "Oslo–Rome",
    from: stop("oslo", "Oslo", 59.913, 10.752),
    to: stop("rome", "Rome", 41.902, 12.496),
    via: [
      [53.55, 9.993],
      [48.137, 11.576],
      [45.464, 9.19],
      [43.77, 11.254],
    ],
  },
  {
    name: "Amsterdam–Madrid",
    from: stop("amsterdam", "Amsterdam", 52.367, 4.904),
    to: stop("madrid", "Madrid", 40.417, -3.704),
    via: [
      [48.749, 2.366],
      [45.748, 4.846],
      [43.61, 3.877],
      [41.656, -0.879],
    ],
  },
  {
    name: "Hamburg–Budapest",
    from: stop("hamburg", "Hamburg", 53.551, 9.994),
    to: stop("budapest", "Budapest", 47.498, 19.04),
    via: [
      [52.52, 13.405],
      [50.075, 14.437],
      [48.208, 16.373],
    ],
  },
  {
    name: "Copenhagen–Milan",
    from: stop("cph", "Copenhagen", 55.676, 12.568),
    to: stop("milan", "Milan", 45.464, 9.19),
    via: [
      [53.55, 9.993],
      [50.11, 8.682],
      [47.376, 8.541],
    ],
  },
];

function routeBetween(from: PlanStop, to: PlanStop, via: [number, number][] = []): RoutedLeg {
  const pts: [number, number][] = [[from.lat, from.lng], ...via, [to.lat, to.lng]];
  const path: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    for (let s = 0; s < 12; s++) {
      const t = s / 12;
      path.push([
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
      ]);
    }
  }
  path.push([to.lat, to.lng]);
  let meters = 0;
  for (let i = 1; i < path.length; i++) {
    meters += haversineM(
      { lat: path[i - 1][0], lng: path[i - 1][1] },
      { lat: path[i][0], lng: path[i][1] },
    );
  }
  const miles = (meters * 1.15) / 1609.344;
  return { miles, seconds: (miles / 62) * 3600, path, source: "osrm" };
}

function stallsEvery(path: [number, number][], everyMi: number, tag: string): ChargeLocation[] {
  const out: ChargeLocation[] = [];
  let walked = 0;
  let next = everyMi;
  for (let i = 1; i < path.length; i++) {
    walked +=
      haversineM(
        { lat: path[i - 1][0], lng: path[i - 1][1] },
        { lat: path[i][0], lng: path[i][1] },
      ) / 1609.344;
    if (walked < next) continue;
    const n = out.length + 1;
    out.push({
      id: `${tag}-tesla-${n}`,
      name: `Tesla ${tag} ${n}`,
      short: `T${n}`,
      lat: path[i][0],
      lng: path[i][1],
      kind: "supercharger",
      usdPerKwh: 0.45,
      preset: false,
      radiusM: 250,
      networkId: "tesla",
    });
    next += everyMi;
  }
  return out;
}

function planTrip(trip: Trip) {
  const route = routeBetween(trip.from, trip.to, trip.via);
  const seeded = seedsAlongPath(route.path, 45_000) as ChargeLocation[];
  const byId = new Map([...seeded, ...stallsEvery(route.path, 140, trip.from.id)].map((l) => [l.id, l]));
  const legs = pricePlan({
    stops: [trip.from, trip.to],
    modes: ["fastest"],
    focuses: ["time"],
    detours: [12],
    routes: [route],
    usableKwh: 75,
    soc: 80,
    locations: [...byId.values()],
    hours: [{ hour: "12", krPerKwh: 1.2, timeDk: "2026-09-29T12:00:00", orePerKwh: 120 }],
    acKw: 11,
    acKr: 1.2,
    speedEff: defaultSpeedEff(250),
    departHhmm: "2026-09-29T12:00",
    memberships: { tesla: true },
    preferredNetwork: "tesla",
    variable: null,
  });
  return { route, legs };
}

function planSeeds(trip: Trip) {
  const route = routeBetween(trip.from, trip.to, trip.via);
  const locations = seedsAlongPath(route.path, 45_000) as ChargeLocation[];
  const legs = pricePlan({
    stops: [trip.from, trip.to],
    modes: ["fastest"],
    focuses: ["time"],
    detours: [12],
    routes: [route],
    usableKwh: 75,
    soc: 80,
    locations,
    hours: [{ hour: "12", krPerKwh: 1.2, timeDk: "2026-09-29T12:00:00", orePerKwh: 120 }],
    acKw: 11,
    acKr: 1.2,
    speedEff: defaultSpeedEff(250),
    departHhmm: "2026-09-29T12:00",
    memberships: { tesla: true },
    preferredNetwork: "tesla",
    variable: null,
  });
  return { route, legs, locations };
}

describe("trip planner", () => {
  for (const trip of trips) {
    it(`keeps a Tesla on the whole route (${trip.name})`, () => {
      const { route, legs } = planTrip(trip);
      const names = legs.map((l) => `${l.from.name}→${l.to.name} ${Math.round(l.route.miles)}mi`);
      const detail = `${trip.name}: ${names.join(" | ")}`;
      assert.equal(legs.at(-1)?.to.id, trip.to.id, detail);
      const tooFar = legs.filter((l) => l.route.miles > 320);
      assert.equal(tooFar.length, 0, detail);
      const sum = legs.reduce((n, l) => n + l.route.miles, 0);
      assert.ok(Math.abs(sum - route.miles) / route.miles < 0.08, `${detail} sum ${sum.toFixed(0)} vs ${route.miles.toFixed(0)}`);
      const billed = legs.filter((l) => l.accepted && l.charge);
      assert.ok(billed.length >= 2, detail);
      for (const leg of billed) {
        assert.equal(leg.from.id, `via-${leg.charge?.locationId}`, detail);
        assert.match(leg.charge?.locationId ?? "", /tesla/, detail);
      }
      const last = billed.at(-1)!;
      const toDest = haversineM(last.from, trip.to);
      const toStart = haversineM(last.from, trip.from);
      assert.ok(toDest < toStart, `${detail} last charge is still near the start`);
    });
  }
});

describe("trip planner, real stalls only", () => {
  for (const trip of trips) {
    it(`does not skip the rest of the drive (${trip.name})`, () => {
      const { legs } = planSeeds(trip);
      const names = legs.map((l) => `${l.from.name}→${l.to.name} ${Math.round(l.route.miles)}mi`);
      const tooFar = legs.filter((l) => l.route.miles > 320);
      assert.equal(tooFar.length, 0, `${trip.name}: ${names.join(" | ")}`);
      const billed = legs.filter((l) => l.accepted && l.charge);
      const last = billed.at(-1);
      assert.ok(last, `${trip.name} has no charge`);
      assert.ok(
        haversineM(last!.from, trip.to) < haversineM(last!.from, trip.from),
        `${trip.name} last charge is still near the start`,
      );
    });
  }

  it("a motorway through France and Spain is not free", () => {
    const { legs } = planSeeds(trips[0]);
    const toll = legs.reduce((n, l) => n + l.tollKr, 0);
    assert.ok(toll > 50, `toll ${toll} kr`);
  });
});
