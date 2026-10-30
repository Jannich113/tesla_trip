import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChargeLocation } from "@/lib/charge-locations";
import { chargeChain } from "./charge-chain.ts";
import { pricePlan, type PlanStop, type PricedCharge, type PricedLeg, type RoutedLeg } from "./engine.ts";
import { defaultSpeedEff } from "./modes.ts";

const KM_PER_DEG = 111.2;

function road(km: number): RoutedLeg {
  const steps = Math.round(km / 5);
  const path: [number, number][] = Array.from({ length: steps + 1 }, (_, i) => [55 + (km / KM_PER_DEG) * (i / steps), 10]);
  return { miles: km / 1.609, seconds: (km / 100) * 3600, path, source: "osrm" };
}

function sc(id: string, km: number): ChargeLocation {
  return { id, name: id, short: id, usdPerKwh: 0.5, lat: 55 + km / KM_PER_DEG, lng: 10.002, kind: "supercharger", preset: false, radiusM: 250 };
}

function trip(km: number, locations: ChargeLocation[]) {
  return pricePlan({
    stops: [
      { id: "a", name: "Odense", lat: 55, lng: 10 },
      { id: "b", name: "Malmi", lat: 55 + km / KM_PER_DEG, lng: 10 },
    ],
    modes: ["fastest"],
    detours: [12],
    routes: [road(km)],
    soc: 80,
    usableKwh: 75,
    locations,
    hours: [],
    acKw: 11,
    acKr: 2,
    speedEff: defaultSpeedEff(250),
    departHhmm: "",
  });
}

const tesla = () => "Tesla ad-hoc";

describe("chargeChain", () => {
  it("lists start, each required charge with network and price, then the destination", () => {
    const chain = chargeChain(trip(700, [sc("sc-220", 220), sc("sc-480", 480)]), tesla);
    assert.deepEqual(
      chain.map((e) => (e.type === "charge" ? `charge:${e.name}:${e.status}` : `${e.type}:${e.name}`)),
      ["stop:Odense", "charge:sc-220:required", "charge:sc-480:required", "stop:Malmi"],
    );
    for (const e of chain) {
      if (e.type !== "charge") continue;
      assert.equal(e.network, "Tesla ad-hoc");
      assert.ok(e.kwh > 0 && e.kr > 0 && e.rateKr > 0);
      assert.equal(e.placeholder, false);
    }
  });

  it("never shows a bare drive-past row for a real trip", () => {
    const chain = chargeChain(trip(700, [sc("sc-220", 220), sc("sc-480", 480)]), tesla);
    assert.deepEqual(chain.filter((e) => e.type === "pass"), []);
  });

  it("flags stops with no known charger, with a location to search from and no network", () => {
    const chain = chargeChain(trip(700, []), tesla);
    const est = chain.filter((e) => e.type === "charge");
    assert.ok(est.length >= 1);
    for (const e of est) {
      if (e.type !== "charge") continue;
      assert.equal(e.placeholder, true);
      assert.equal(e.name, "No known charger");
      assert.equal(e.network, null);
      assert.ok(e.lat !== null && e.lng !== null, "needs coordinates for the charger search link");
      assert.ok(e.kwh > 0 && e.kr > 0);
    }
  });

  // Hand-made legs for the cases a straight test road does not produce.
  const stop = (id: string, name: string): PlanStop => ({ id, name, lat: 55, lng: 10 });
  const charge = (name: string): PricedCharge =>
    ({ locationId: name, name, kind: "custom", kwh: 20, kr: 60, rateKr: 3, label: "", inBand: true, distM: 0, windowLabel: "", cheapWindow: false, waitMin: 0 });
  const leg = (from: PlanStop, to: PlanStop, extra: Partial<PricedLeg>): PricedLeg =>
    ({ from, to, userIndex: 0, accepted: false, needed: false, suggested: false, advice: null, charge: null, ...extra }) as PricedLeg;

  it("offers a cheap optional charge without putting it in the plan", () => {
    const chain = chargeChain(
      [leg(stop("a", "A"), stop("b", "B"), { suggested: true, advice: "suggested", charge: charge("Clever Kolding") })],
      () => "Clever",
    );
    const c = chain.find((e) => e.type === "charge");
    assert.equal(c?.type === "charge" && c.status, "optional");
  });

  it("marks an optional charge the user added", () => {
    const chain = chargeChain(
      [leg(stop("a", "A"), stop("b", "B"), { suggested: true, accepted: true, advice: "suggested", charge: charge("Clever Kolding") })],
      () => "Clever",
    );
    const c = chain.find((e) => e.type === "charge");
    assert.equal(c?.type === "charge" && c.status, "optional-added");
  });

  it("puts a via's charge in the via's place instead of listing the via twice", () => {
    const via = stop("via-sc-1", "Moraberg");
    const chain = chargeChain(
      [
        leg(stop("a", "A"), via, {}),
        leg(via, stop("b", "B"), { accepted: true, needed: true, advice: "required", charge: charge("Moraberg") }),
      ],
      () => "Tesla ad-hoc",
    );
    assert.deepEqual(
      chain.map((e) => `${e.type}:${e.name}`),
      ["stop:A", "charge:Moraberg", "stop:B"],
    );
  });

  it("keeps a drive-past via visible if the engine ever produces one", () => {
    const via = stop("via-sc-1", "Moraberg");
    const chain = chargeChain([leg(stop("a", "A"), via, {}), leg(via, stop("b", "B"), {})], () => null);
    assert.deepEqual(chain.map((e) => `${e.type}:${e.name}`), ["stop:A", "pass:Moraberg", "stop:B"]);
  });
});

describe("chargeChain charge level (#69)", () => {
  const KM = 111.2;
  const road = (km: number): RoutedLeg => {
    const n = Math.round(km / 5);
    return { miles: km / 1.609, seconds: (km / 100) * 3600, source: "osrm", path: Array.from({ length: n + 1 }, (_, i) => [55 + (km / KM) * (i / n), 10]) };
  };
  const stall = (id: string, km: number): ChargeLocation => ({ id, name: id, short: id, usdPerKwh: 0.5, lat: 55 + km / KM, lng: 10.002, kind: "supercharger", preset: false, radiusM: 250 });
  const legs = pricePlan({
    stops: [{ id: "a", name: "Start", lat: 55, lng: 10 }, { id: "b", name: "End", lat: 55 + 1100 / KM, lng: 10 }],
    modes: ["fastest"], detours: [12], routes: [road(1100)], soc: 80, usableKwh: 75,
    locations: [stall("sc-250", 250), stall("sc-600", 600), stall("sc-950", 950)],
    hours: [], acKw: 11, acKr: 2, speedEff: defaultSpeedEff(250), departHhmm: "",
  });
  const charges = chargeChain(legs, tesla).filter((e) => e.type === "charge");

  it("shows the level when a charge goes above 80%", () => {
    const fuller = charges.filter((e) => e.type === "charge" && e.toSoc !== null);
    assert.ok(fuller.length >= 1, "no charge shows a level above 80%");
    for (const e of fuller) if (e.type === "charge") assert.ok(e.toSoc! > 80 && e.toSoc! <= 100);
  });

  it("leaves the level out for a normal 80% charge", () => {
    const normal = chargeChain(trip(700, [sc("sc-220", 220), sc("sc-480", 480)]), tesla).filter((e) => e.type === "charge");
    for (const e of normal) if (e.type === "charge") assert.equal(e.toSoc, null);
  });
});

describe("chargeChain ferry rows (#71)", () => {
  const ferry = { name: "Rødby – Puttgarden", operators: ["Scandlines"], crossingMin: 45, checkInMin: 15, priceKr: { from: 500, to: 900 }, bookingUrl: "https://www.scandlines.dk", known: true };
  const stop = (id: string, name: string): PlanStop => ({ id, name, lat: 55, lng: 10 });
  const leg = (from: PlanStop, to: PlanStop, extra: Partial<PricedLeg>): PricedLeg =>
    ({ from, to, userIndex: 0, accepted: false, needed: false, suggested: false, advice: null, charge: null, ...extra }) as PricedLeg;

  it("shows the crossing between the two ports", () => {
    const a = stop("ferry-1-a", "Rødby");
    const b = stop("ferry-1-b", "Puttgarden");
    const chain = chargeChain(
      [leg(stop("s", "København"), a, {}), leg(a, b, { ferry }), leg(b, stop("e", "Hamburg"), {})],
      () => null,
    );
    assert.deepEqual(
      chain.map((e) => `${e.type}:${e.name}`),
      ["stop:København", "stop:Rødby", "ferry:Rødby – Puttgarden", "stop:Puttgarden", "stop:Hamburg"],
    );
    const row = chain.find((e) => e.type === "ferry");
    assert.equal(row?.type === "ferry" && row.ferry.bookingUrl, "https://www.scandlines.dk");
  });
});

describe("chargeChain optional offers", () => {
  const stop = (id: string, name: string): PlanStop => ({ id, name, lat: 55, lng: 10 });
  const charge = (name: string): PricedCharge =>
    ({ locationId: name, name, kind: "supercharger", kwh: 20, kr: 60, rateKr: 3, label: "", inBand: true, distM: 0, windowLabel: "", cheapWindow: false, waitMin: 0 });
  const leg = (from: PlanStop, to: PlanStop, extra: Partial<PricedLeg>): PricedLeg =>
    ({ from, to, userIndex: 0, accepted: false, needed: false, suggested: false, advice: null, charge: null, ...extra }) as PricedLeg;

  it("hides an offer at the charger where the next leg charges anyway (seen at Lübeck)", () => {
    const lubeck = stop("via-sc-lubeck", "Lübeck");
    const chain = chargeChain(
      [
        leg(stop("a", "Puttgarden"), lubeck, { suggested: true, advice: "suggested", charge: charge("Lübeck") }),
        leg(lubeck, stop("b", "Hamburg"), { accepted: true, needed: true, advice: "required", charge: charge("Lübeck") }),
      ],
      () => "Tesla Supercharger",
    );
    const charges = chain.filter((e) => e.type === "charge");
    assert.equal(charges.length, 1);
    assert.equal(charges[0].type === "charge" && charges[0].status, "required");
  });

  it("keeps an offer at a different charger", () => {
    const chain = chargeChain(
      [
        leg(stop("a", "A"), stop("via-x", "X"), { suggested: true, advice: "suggested", charge: charge("Kolding") }),
        leg(stop("via-x", "X"), stop("b", "B"), { accepted: true, needed: true, advice: "required", charge: charge("Lübeck") }),
      ],
      () => null,
    );
    assert.equal(chain.filter((e) => e.type === "charge").length, 2);
  });
});
