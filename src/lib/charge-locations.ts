import { HOME_USD_PER_KWH, SC_USD_PER_KWH } from "@/lib/history";
import { geo } from "@/lib/places";

export type ChargeKind = "home" | "supercharger" | "custom";

export type ChargeLocation = {
  id: string;
  name: string;
  short: string;
  usdPerKwh: number;
  lat: number;
  lng: number;
  kind: ChargeKind;
  preset: boolean;
  radiusM: number;
};

export const HOME_LOCATION_ID = "loc-home";

export function defaultRadius(kind: ChargeKind) {
  if (kind === "home") return 80;
  if (kind === "supercharger") return 250;
  return 150;
}

export function clampRadius(n: number) {
  if (!Number.isFinite(n)) return defaultRadius("custom");
  return Math.min(2000, Math.max(25, Math.round(n)));
}

function site(
  id: string,
  name: string,
  short: string,
  usdPerKwh: number,
  lat: number,
  lng: number,
  kind: ChargeKind,
): ChargeLocation {
  return { id, name, short, usdPerKwh, lat, lng, kind, preset: true, radiusM: defaultRadius(kind) };
}

export const PRESET_LOCATIONS: ChargeLocation[] = [
  site(HOME_LOCATION_ID, "Home Wall Connector", "Home", HOME_USD_PER_KWH, 37.3852, -122.1141, "home"),
  site("loc-sj", "San Jose Supercharger", "San Jose", SC_USD_PER_KWH, 37.3318, -121.8906, "supercharger"),
  site("loc-gilroy", "Gilroy Supercharger", "Gilroy", SC_USD_PER_KWH, 37.0142, -121.5574, "supercharger"),
  site("loc-cruz", "Santa Cruz Supercharger", "Santa Cruz", SC_USD_PER_KWH, 36.9749, -122.0263, "supercharger"),
  site("loc-sf", "San Francisco Supercharger", "San Francisco", SC_USD_PER_KWH, 37.7841, -122.4075, "supercharger"),
  site("loc-napa", "Napa Supercharger", "Napa", SC_USD_PER_KWH, 38.2991, -122.2852, "supercharger"),
];

export function slugId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 28);
  return `loc-${slug || "site"}`;
}

export function uniqueLocationId(name: string, existing: { id: string }[]) {
  const base = slugId(name);
  if (!existing.some((l) => l.id === base)) return base;
  let n = 2;
  while (existing.some((l) => l.id === `${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export function metersBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function matchLocation(name: string, locations: ChargeLocation[]) {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return (
    locations.find((l) => l.id === name) ||
    locations.find((l) => l.name.toLowerCase() === n) ||
    locations.find((l) => l.short.toLowerCase() === n) ||
    locations.find((l) => n.includes(l.name.toLowerCase()) || l.name.toLowerCase().includes(n))
  );
}

export function matchByRadius(lat: number, lng: number, locations: ChargeLocation[]) {
  let best: ChargeLocation | undefined;
  let bestD = Infinity;
  for (const loc of locations) {
    const radius = loc.radiusM > 0 ? loc.radiusM : defaultRadius(loc.kind);
    const d = metersBetween({ lat, lng }, loc);
    if (d <= radius && d < bestD) {
      best = loc;
      bestD = d;
    }
  }
  return best;
}

export function resolveChargeLocation(
  locations: ChargeLocation[],
  input: { where?: string; lat?: number; lng?: number },
) {
  const named = input.where ? matchLocation(input.where, locations) : undefined;
  const fromName = input.where ? geo(input.where) : undefined;
  const lat = input.lat ?? fromName?.lat;
  const lng = input.lng ?? fromName?.lng;
  const byRadius =
    lat != null && lng != null ? matchByRadius(lat, lng, locations) : undefined;
  return byRadius ?? named;
}

export function inferKind(name: string): ChargeKind {
  const n = name.toLowerCase();
  if (n.includes("home") || n.includes("wall connector")) return "home";
  if (n.includes("supercharger") || n.includes("sc ")) return "supercharger";
  return "custom";
}

export function inferRate(kind: ChargeKind) {
  return kind === "supercharger" ? SC_USD_PER_KWH : HOME_USD_PER_KWH;
}

export function inferCoords(name: string): { lat: number; lng: number; short: string } {
  const known = geo(name);
  if (known) return known;
  const home = PRESET_LOCATIONS[0];
  return { lat: home.lat, lng: home.lng, short: name.split(",")[0].split("·")[0].trim() || name };
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

export function withRadius(loc: ChargeLocation): ChargeLocation {
  return loc.radiusM > 0 ? loc : { ...loc, radiusM: defaultRadius(loc.kind) };
}
