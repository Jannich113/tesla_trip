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
import { rateForNetwork, networkIdFor, roamExtra, EU_NETWORKS } from "./networks.ts";

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
});
