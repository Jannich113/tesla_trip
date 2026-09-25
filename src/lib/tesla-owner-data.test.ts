import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  demoOwnerSnapshot,
  mapFleetVehicleData,
  pickOwnerVehicle,
  tokenHasDeniedScopes,
  vehicleDataEndpoints,
} from "./tesla-owner-data.ts";

const DEMO = "DEMOYTEST0JUNIPER";

describe("pickOwnerVehicle", () => {
  it("refuses driver access on an exact VIN match", () => {
    const result = pickOwnerVehicle(
      [{ vin: DEMO, access_type: "DRIVER", id: 1 }],
      DEMO,
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "driver");
  });

  it("accepts the first OWNER vehicle when configured VIN is demo", () => {
    const result = pickOwnerVehicle(
      [
        { vin: "5YJ3E1EA1KF000001", access_type: "DRIVER", id: 1 },
        { vin: "5YJ3E1EA1KF000002", access_type: "OWNER", id: 2 },
      ],
      DEMO,
    );
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.vehicle.vin, "5YJ3E1EA1KF000002");
  });

  it("returns not_owner when empty", () => {
    const result = pickOwnerVehicle([], DEMO);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "not_owner");
  });
});

describe("mapFleetVehicleData location privacy", () => {
  const raw = {
    vin: "5YJ3E1EA1KF000002",
    display_name: "Juniper",
    state: "online",
    charge_state: {
      battery_level: 71,
      charge_limit_soc: 80,
      charging_state: "Disconnected",
      battery_range: 230,
    },
    drive_state: { latitude: 55.6761, longitude: 12.5683, shift_state: "P" },
    vehicle_state: { locked: true, sentry_mode: false, odometer: 12000 },
    climate_state: { is_climate_on: false, inside_temp: 21 },
  };

  it("includes coordinates when includeLocation is true", () => {
    const snap = mapFleetVehicleData(raw, {
      includeLocation: true,
      fallbackVin: DEMO,
      fetchedAt: 1,
    });
    assert.equal(snap.source, "fleet");
    assert.deepEqual(snap.location, { lat: 55.6761, lng: 12.5683 });
    assert.equal(snap.locationHidden, false);
    assert.equal(snap.batteryLevel, 71);
  });

  it("strips coordinates when includeLocation is false", () => {
    const snap = mapFleetVehicleData(raw, {
      includeLocation: false,
      fallbackVin: DEMO,
      fetchedAt: 1,
    });
    assert.equal(snap.location, null);
    assert.equal(snap.locationHidden, true);
  });
});

describe("demoOwnerSnapshot", () => {
  it("hides location when privacy is off", () => {
    const snap = demoOwnerSnapshot({
      includeLocation: false,
      reason: "not_linked",
      fetchedAt: 1,
    });
    assert.equal(snap.source, "demo");
    assert.equal(snap.location, null);
    assert.equal(snap.locationHidden, true);
  });
});

describe("tokenHasDeniedScopes", () => {
  it("rejects command scopes", () => {
    assert.equal(tokenHasDeniedScopes("openid vehicle_cmds"), true);
    assert.equal(
      tokenHasDeniedScopes("openid vehicle_charging_cmds offline_access"),
      true,
    );
  });

  it("allows read-only scopes", () => {
    assert.equal(
      tokenHasDeniedScopes(
        "openid offline_access vehicle_device_data vehicle_location",
      ),
      false,
    );
  });
});

describe("vehicleDataEndpoints", () => {
  it("omits location_data unless requested", () => {
    assert.equal(vehicleDataEndpoints(false).includes("location_data"), false);
    assert.equal(vehicleDataEndpoints(true).includes("location_data"), true);
    assert.equal(vehicleDataEndpoints(true).includes("vehicle_cmds"), false);
  });
});
