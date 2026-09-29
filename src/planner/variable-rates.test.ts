import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rateForNetwork } from "./networks.ts";
import {
  PLANNER_ZONE,
  clearActiveVariableFeed,
  energyPriceAt,
  matchVariableSite,
  quoteEnergy,
  superchargerUsdPerKwh,
  teslaSitesFromOcpi,
  type VariableFeed,
  type VariableSite,
} from "./variable-rates.ts";

const FX10 = { EUR: 10, DKK: 1, NOK: 1 };

function leiderdorp(): VariableSite {
  const days = null;
  return {
    id: "leiderdorp",
    networkId: "tesla",
    name: "Leiderdorp",
    lat: 52.160633,
    lng: 4.548872,
    ccy: "EUR",
    tz: "Europe/Amsterdam",
    bands: [
      { start: "00:00", end: "09:00", days, price: 0.46, fallback: false },
      { start: "09:00", end: "22:00", days, price: 0.59, fallback: false },
      { start: "22:00", end: "00:00", days, price: 0.46, fallback: false },
      { start: null, end: null, days: null, price: 0.56, fallback: true },
    ],
  };
}

function feed(site: VariableSite): VariableFeed {
  return {
    source: "test",
    updatedAt: "2026-09-29T16:00:00.000Z",
    note: "test",
    fx: FX10,
    sites: [site],
  };
}

function quoteAt(opts: { preferCheap: boolean; maxWaitMin: number; lat?: number; lng?: number }) {
  const site = leiderdorp();
  const matched = matchVariableSite([site], opts.lat ?? site.lat, opts.lng ?? site.lng, "tesla");
  if (!matched) return null;
  return quoteEnergy({
    site: matched,
    ymd: "2026-09-29",
    hhmm: "21:00",
    zone: PLANNER_ZONE,
    preferCheap: opts.preferCheap,
    maxWaitMin: opts.maxWaitMin,
    fxEur: 10,
  });
}

describe("variable stall rates", () => {
  it("uses the arrival-hour band, not the unrestricted fallback or the catalog average", () => {
    clearActiveVariableFeed();
    const hit = quoteAt({ preferCheap: false, maxWaitMin: 120 });
    assert.ok(hit);
    assert.equal(hit.rateKr, 5.9);
    assert.equal(hit.native, 0.59);
    assert.equal(hit.cheapWindow, false);
    assert.equal(hit.waitMin, 0);
    assert.equal(hit.label, "21:00");
    assert.notEqual(hit.rateKr, rateForNetwork("tesla", true));
    assert.notEqual(hit.native, 0.56);
  });

  it("cheapest mode waits for a cheaper band at the same site when the wait fits", () => {
    const hit = quoteAt({ preferCheap: true, maxWaitMin: 90 });
    assert.ok(hit);
    assert.equal(hit.rateKr, 4.6);
    assert.equal(hit.cheapWindow, true);
    assert.equal(hit.waitMin, 60);
    assert.equal(hit.label, "22:00 · wait 60 min");
  });

  it("stays on the arrival rate when the cheaper band is outside the allowed wait", () => {
    const hit = quoteAt({ preferCheap: true, maxWaitMin: 30 });
    assert.ok(hit);
    assert.equal(hit.rateKr, 5.9);
    assert.equal(hit.cheapWindow, false);
    assert.equal(hit.waitMin, 0);
  });

  it("does not match a stall outside the published site, so the catalog rate remains", () => {
    const site = leiderdorp();
    assert.equal(matchVariableSite([site], 37.3318, -121.8906, "tesla"), null);
    assert.equal(matchVariableSite([site], site.lat, site.lng, "ionity"), null);
    assert.equal(rateForNetwork("tesla", false), 4.103);
  });

  it("prefers the shorter overlapping band and ignores the fallback element", () => {
    const site = leiderdorp();
    site.bands = [
      { start: "09:00", end: "22:00", days: null, price: 0.5, fallback: false },
      { start: "16:00", end: "20:00", days: null, price: 0.8, fallback: false },
      { start: null, end: null, days: null, price: 0.1, fallback: true },
    ];
    assert.equal(energyPriceAt(site, "2026-09-29", "17:00"), 0.8);
    assert.equal(energyPriceAt(site, "2026-09-29", "10:00"), 0.5);
    assert.equal(energyPriceAt(site, "2026-09-29", "23:00"), 0.1);
  });

  it("prices a Costs supercharger session at the plug-in hour in the site zone", () => {
    const variable = feed(leiderdorp());
    // 12:00 America/Los_Angeles on 2026-09-29 is 21:00 Europe/Amsterdam (CEST/PDT).
    const peak = superchargerUsdPerKwh({
      kind: "supercharger",
      lat: 52.160633,
      lng: 4.548872,
      day: "2026-09-29",
      hour: 12,
      minute: 0,
      feed: variable,
    });
    const off = superchargerUsdPerKwh({
      kind: "supercharger",
      lat: 52.1607,
      lng: 4.549,
      day: "2026-09-29",
      hour: 13,
      minute: 0,
      feed: variable,
    });
    assert.ok(peak != null && off != null);
    assert.ok(Math.abs(peak - (0.59 * 10) / 6.85) < 1e-9);
    assert.ok(Math.abs(off - (0.46 * 10) / 6.85) < 1e-9);
    assert.equal(
      superchargerUsdPerKwh({
        kind: "supercharger",
        lat: 37.33,
        lng: -121.89,
        day: "2026-09-29",
        hour: 12,
        minute: 0,
        feed: variable,
      }),
      null,
    );
  });

  it("reads Tesla NL OCPI sites and does not invent a rate for flat networks", () => {
    const tariffs = [
      {
        id: "t-tesla",
        party_id: "TSL",
        currency: "EUR",
        elements: [
          {
            price_components: [{ type: "PARKING_TIME", price: 1, vat: null }],
            restrictions: { min_duration: 300 },
          },
          {
            price_components: [{ type: "ENERGY", price: 0.46, vat: null }],
            restrictions: {
              start_time: "00:00",
              end_time: "09:00",
              day_of_week: [
                "MONDAY",
                "TUESDAY",
                "WEDNESDAY",
                "THURSDAY",
                "FRIDAY",
                "SATURDAY",
                "SUNDAY",
              ],
            },
          },
          {
            price_components: [{ type: "ENERGY", price: 0.59, vat: null }],
            restrictions: { start_time: "09:00", end_time: "00:00" },
          },
          { price_components: [{ type: "ENERGY", price: 0.56, vat: null }], restrictions: null },
        ],
      },
      {
        id: "t-fastned",
        party_id: "FAS",
        currency: "EUR",
        elements: [
          { price_components: [{ type: "ENERGY", price: 0.6364, vat: 21 }], restrictions: null },
        ],
      },
      {
        id: "t-vat",
        party_id: "TSL",
        currency: "EUR",
        elements: [
          { price_components: [{ type: "ENERGY", price: 1, vat: 21 }], restrictions: null },
        ],
      },
    ];
    const locations = [
      {
        id: "loc-tesla",
        party_id: "TSL",
        name: "Hoorn, Netherlands",
        time_zone: "Europe/Amsterdam",
        coordinates: { latitude: "52.64", longitude: "5.06" },
        evses: [{ connectors: [{ tariff_ids: ["t-tesla"] }] }],
      },
      {
        id: "loc-fastned",
        party_id: "FAS",
        name: "Fastned Haarrijn",
        coordinates: { latitude: "52.1", longitude: "5.0" },
        evses: [{ connectors: [{ tariff_ids: ["t-fastned"] }] }],
      },
      {
        id: "loc-vat",
        party_id: "TSL",
        name: "VAT example",
        coordinates: { latitude: "52.2", longitude: "5.1" },
        time_zone: null,
        evses: [{ connectors: [{ tariff_ids: ["t-vat"] }] }],
      },
    ];
    const sites = teslaSitesFromOcpi(tariffs, locations);
    assert.deepEqual(
      sites.map((s) => s.name),
      ["Hoorn, Netherlands", "VAT example"],
    );
    const hoorn = sites[0];
    assert.equal(energyPriceAt(hoorn, "2026-09-29", "21:00"), 0.59);
    assert.equal(energyPriceAt(hoorn, "2026-09-29", "08:00"), 0.46);
    assert.notEqual(energyPriceAt(hoorn, "2026-09-29", "21:00"), 0.59 + 0.56);
    const vat = sites[1];
    assert.equal(vat.bands[0].price, 1.21);
    assert.equal(vat.tz, "Europe/Amsterdam");
  });
});
