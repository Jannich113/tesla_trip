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
} from "./modes.ts";

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
    const slow = driveKwhAtSpeed(miles, (50 / 50) * 3600, eff); // 50 km/t-ish wait
    const at50 = driveKwhAtSpeed(miles, (miles * 1.609344) / 50 * 3600, eff);
    const at130 = driveKwhAtSpeed(miles, (miles * 1.609344) / 130 * 3600, eff);
    assert.ok(at130 > at50);
  });
});
