import { VEHICLE } from "@/lib/vehicle";

export type FleetVehicleListItem = {
  id?: number;
  vehicle_id?: number;
  vin?: string;
  display_name?: string;
  state?: string;
  access_type?: string;
};

export type TeslaOwnerVehicleSnapshot = {
  source: "fleet" | "demo";
  vin: string;
  displayName: string;
  state: string;
  batteryLevel: number | null;
  chargeLimitSoc: number | null;
  chargingState: string | null;
  chargePowerKw: number | null;
  batteryRangeMi: number | null;
  locked: boolean | null;
  sentryMode: boolean | null;
  odometerMi: number | null;
  shiftState: string | null;
  speedMph: number | null;
  isClimateOn: boolean | null;
  insideTempC: number | null;
  location: { lat: number; lng: number } | null;
  locationHidden: boolean;
  fetchedAt: number;
  reason?:
    | "not_configured"
    | "not_linked"
    | "not_owner"
    | "driver"
    | "denied"
    | "error"
    | "asleep";
};

export function isDemoOwnerVin(vin: string = VEHICLE.vin): boolean {
  return vin === VEHICLE.vin || vin.startsWith("DEMO");
}

export function isOwnerAccessType(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (typeof value !== "string") return false;
  return value.toUpperCase() === "OWNER";
}

export function pickOwnerVehicle(
  list: FleetVehicleListItem[] | undefined,
  configuredVin: string = VEHICLE.vin,
):
  | { ok: true; vehicle: FleetVehicleListItem }
  | { ok: false; reason: "not_owner" | "driver" } {
  const vehicles = list ?? [];
  if (vehicles.length === 0) return { ok: false, reason: "not_owner" };

  const exact = vehicles.find((v) => v.vin === configuredVin);
  if (exact) {
    if (!isOwnerAccessType(exact.access_type)) return { ok: false, reason: "driver" };
    return { ok: true, vehicle: exact };
  }

  if (!isDemoOwnerVin(configuredVin)) return { ok: false, reason: "not_owner" };

  const owners = vehicles.filter((v) => isOwnerAccessType(v.access_type));
  if (vehicles.length > 0 && owners.length === 0) return { ok: false, reason: "driver" };
  if (owners.length === 0) return { ok: false, reason: "not_owner" };
  return { ok: true, vehicle: owners[0]! };
}

type FleetVehicleDataResponse = {
  vin?: string;
  display_name?: string;
  state?: string;
  charge_state?: {
    battery_level?: number;
    usable_battery_level?: number;
    charge_limit_soc?: number;
    charging_state?: string;
    charger_power?: number;
    battery_range?: number;
  };
  vehicle_state?: {
    locked?: boolean;
    sentry_mode?: boolean;
    odometer?: number;
    vehicle_name?: string;
  };
  drive_state?: {
    shift_state?: string | null;
    speed?: number | null;
    latitude?: number;
    longitude?: number;
  };
  climate_state?: {
    is_climate_on?: boolean;
    inside_temp?: number;
  };
  location_data?: {
    latitude?: number;
    longitude?: number;
  };
};

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function mapFleetVehicleData(
  raw: FleetVehicleDataResponse | null | undefined,
  opts: { includeLocation: boolean; fallbackVin: string; fetchedAt?: number },
): TeslaOwnerVehicleSnapshot {
  const fetchedAt = opts.fetchedAt ?? Date.now();
  if (!raw) {
    return demoOwnerSnapshot({
      includeLocation: opts.includeLocation,
      reason: "error",
      fetchedAt,
    });
  }
  const charge = raw.charge_state;
  const vehicle = raw.vehicle_state;
  const drive = raw.drive_state;
  const climate = raw.climate_state;
  const locSrc = raw.location_data ?? drive;
  let location: { lat: number; lng: number } | null = null;
  if (opts.includeLocation) {
    const lat = num(locSrc?.latitude);
    const lng = num(locSrc?.longitude);
    if (lat != null && lng != null) location = { lat, lng };
  }
  return {
    source: "fleet",
    vin: str(raw.vin) ?? opts.fallbackVin,
    displayName: str(raw.display_name) ?? str(vehicle?.vehicle_name) ?? "Vehicle",
    state: str(raw.state) ?? "unknown",
    batteryLevel: num(charge?.usable_battery_level) ?? num(charge?.battery_level),
    chargeLimitSoc: num(charge?.charge_limit_soc),
    chargingState: str(charge?.charging_state),
    chargePowerKw: num(charge?.charger_power),
    batteryRangeMi: num(charge?.battery_range),
    locked: bool(vehicle?.locked),
    sentryMode: bool(vehicle?.sentry_mode),
    odometerMi: num(vehicle?.odometer),
    shiftState: drive?.shift_state == null ? null : str(drive.shift_state),
    speedMph: num(drive?.speed),
    isClimateOn: bool(climate?.is_climate_on),
    insideTempC: num(climate?.inside_temp),
    location,
    locationHidden: !opts.includeLocation,
    fetchedAt,
  };
}

export function demoOwnerSnapshot(opts: {
  includeLocation: boolean;
  reason?: TeslaOwnerVehicleSnapshot["reason"];
  fetchedAt?: number;
}): TeslaOwnerVehicleSnapshot {
  return {
    source: "demo",
    vin: VEHICLE.vin,
    displayName: VEHICLE.name,
    state: "demo",
    batteryLevel: 68,
    chargeLimitSoc: 80,
    chargingState: "Disconnected",
    chargePowerKw: 0,
    batteryRangeMi: 220,
    locked: true,
    sentryMode: true,
    odometerMi: 15247,
    shiftState: "P",
    speedMph: 0,
    isClimateOn: false,
    insideTempC: 22,
    location: opts.includeLocation ? { lat: 37.3852, lng: -122.1141 } : null,
    locationHidden: !opts.includeLocation,
    fetchedAt: opts.fetchedAt ?? Date.now(),
    reason: opts.reason ?? "not_linked",
  };
}

export function vehicleDataEndpoints(includeLocation: boolean): string {
  const base = ["charge_state", "climate_state", "drive_state", "vehicle_state"];
  if (includeLocation) base.push("location_data");
  return base.join(";");
}

export const TESLA_COMMAND_SCOPES = [
  "vehicle_cmds",
  "vehicle_charging_cmds",
] as const;

export function tokenHasDeniedScopes(scopeField: unknown): boolean {
  if (typeof scopeField !== "string" || !scopeField.trim()) return false;
  const granted = new Set(
    scopeField.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
  return TESLA_COMMAND_SCOPES.some((s) => granted.has(s));
}
