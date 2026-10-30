import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CAR_VARIANTS,
  clampLimits,
  CONDITION_FACTOR,
  drivingFactor,
  scaleSpeedEff,
  sessionDcKw,
  variantFor,
} from "./car-settings.ts";
import { defaultSpeedEff } from "./modes.ts";

test("every model has versions with sane figures and one default", () => {
  for (const [model, list] of Object.entries(CAR_VARIANTS)) {
    assert.ok(list.length >= 2, model);
    assert.equal(list.filter((x) => x.default).length, 1, `${model} default`);
    for (const x of list) {
      assert.ok(x.usableKwh >= 40 && x.usableKwh <= 130, `${model} ${x.id} kWh`);
      assert.ok(x.peakDcKw >= 100 && x.peakDcKw <= 350, `${model} ${x.id} kW`);
      assert.ok(x.epaRangeMi >= 200, `${model} ${x.id} range`);
    }
  }
});

test("an unknown version falls back to the model's default", () => {
  assert.equal(variantFor("juniper", "nope").id, "lr");
  assert.equal(variantFor("juniper", "perf").label, "Performance");
});

test("a session averages about 60% of peak DC power", () => {
  assert.equal(sessionDcKw(250), 150);
  assert.equal(sessionDcKw(170), 102);
});

test("driving style and conditions scale energy use", () => {
  assert.equal(drivingFactor("normal", {}), 1);
  assert.ok(drivingFactor("calm", {}) < 1);
  assert.ok(drivingFactor("brisk", {}) > 1);
  const winterTrailer = drivingFactor("normal", { winter: true, trailer: true });
  assert.ok(Math.abs(winterTrailer - CONDITION_FACTOR.winter * CONDITION_FACTOR.trailer) < 1e-9);
  const eff = defaultSpeedEff(250);
  const scaled = scaleSpeedEff(eff, 1.2);
  assert.ok(Math.abs(scaled[110] - eff[110] * 1.2) < 0.06);
  assert.equal(scaleSpeedEff(eff, 1), eff);
});

test("battery limits stay sane together", () => {
  assert.deepEqual(clampLimits({}), { floorSoc: 10, targetSoc: 80, destSoc: 20 });
  assert.deepEqual(clampLimits({ floorSoc: 1, targetSoc: 120, destSoc: 0 }), { floorSoc: 5, targetSoc: 100, destSoc: 5 });
  assert.equal(clampLimits({ floorSoc: 25, destSoc: 10 }).destSoc, 25);
});
