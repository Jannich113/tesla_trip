import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSpotDay,
  dkkPerEurFromNordPool,
  hoursFromQuarters,
  nordPoolCurrency,
  nordPoolDayUrl,
  quartersFromDay,
} from "./nordpool.ts";

describe("nord pool day-ahead", () => {
  it("asks for DKK in the Nordics and EUR in Germany and the Netherlands", () => {
    assert.equal(nordPoolCurrency("DK1"), "DKK");
    assert.equal(nordPoolCurrency("NO4"), "DKK");
    assert.equal(nordPoolCurrency("SE1"), "DKK");
    assert.equal(nordPoolCurrency("FI"), "DKK");
    assert.equal(nordPoolCurrency("GER"), "EUR");
    assert.equal(nordPoolCurrency("NL"), "EUR");
    const url = new URL(nordPoolDayUrl("GER", "2026-09-29", "EUR"));
    assert.equal(url.hostname, "dataportal-api.nordpoolgroup.com");
    assert.equal(url.pathname, "/api/DayAheadPrices");
    assert.equal(url.searchParams.get("deliveryArea"), "GER");
    assert.equal(url.searchParams.get("market"), "DayAhead");
    assert.equal(url.searchParams.get("currency"), "EUR");
  });

  it("rejects a missing or identity exchange rate", () => {
    assert.equal(dkkPerEurFromNordPool({ currency: "EUR", exchangeRate: 1 }), null);
    assert.equal(dkkPerEurFromNordPool({ currency: "DKK", exchangeRate: 7.47 }), 7.47);
    assert.equal(dkkPerEurFromNordPool({ currency: "DKK", exchangeRate: 1 }), null);
  });

  it("averages 15-minute DKK/MWh into kr/kWh hours", () => {
    const quarters = quartersFromDay(
      {
        currency: "DKK",
        multiAreaEntries: [
          { deliveryStart: "2026-09-28T22:00:00Z", entryPerArea: { DK1: 1000 } },
          { deliveryStart: "2026-09-28T22:15:00Z", entryPerArea: { DK1: 2000 } },
          { deliveryStart: "2026-09-28T22:30:00Z", entryPerArea: { DK1: 3000 } },
          { deliveryStart: "2026-09-28T22:45:00Z", entryPerArea: { DK1: 4000 } },
          { deliveryStart: "2026-09-28T23:00:00Z", entryPerArea: { DK1: null } },
        ],
      },
      "DK1",
      7.5,
    );
    const hours = hoursFromQuarters(quarters);
    assert.equal(hours.length, 1);
    assert.equal(hours[0].timeDk, "2026-09-29T00:00:00");
    assert.equal(hours[0].hour, "00");
    assert.equal(hours[0].krPerKwh, 2.5);
  });

  it("converts EUR/MWh with the auction rate and does not invent a missing area", () => {
    const quarters = quartersFromDay(
      {
        currency: "EUR",
        multiAreaEntries: [
          { deliveryStart: "2026-09-28T22:00:00Z", entryPerArea: { NL: 100, GER: 200 } },
        ],
      },
      "NL",
      7.5,
    );
    assert.equal(quarters.length, 1);
    assert.equal(quarters[0].dkkPerMwh, 750);
    const skipped = quartersFromDay(
      {
        currency: "EUR",
        multiAreaEntries: [{ deliveryStart: "2026-09-28T22:00:00Z", entryPerArea: { NL: 100 } }],
      },
      "GER",
      7.5,
    );
    assert.equal(skipped.length, 0);
  });

  it("splits today and tomorrow in Copenhagen time", () => {
    const now = new Date("2026-09-29T08:30:00Z");
    const day = buildSpotDay(
      "SE3",
      [{ timeDk: "2026-09-29T10:00:00", dkkPerMwh: 500 }],
      [{ timeDk: "2026-09-30T01:00:00", dkkPerMwh: 800 }],
      now,
    );
    assert.equal(day.source, "Nord Pool");
    assert.equal(day.country, "SE");
    assert.equal(day.area, "SE3");
    assert.equal(day.today.length, 1);
    assert.equal(day.today[0].krPerKwh, 0.5);
    assert.equal(day.current?.hour, "10");
    assert.equal(day.tomorrow.length, 1);
    assert.equal(day.tomorrow[0].krPerKwh, 0.8);
  });
});
