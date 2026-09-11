import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addMinutesHhmm,
  chargeSearchKm,
  costingFor,
  epaWhPerMi,
  hoursFrom,
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
});
