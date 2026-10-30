/**
 * Tesla Superchargers from supercharge.info's public site list (#72). It is
 * community-maintained, has no stated data license, and is credited in the planner.
 * Fetched once a day on the server; this module only maps and filters it.
 */
import { rateAt } from "./networks.ts";
import { COUNTRY_PROFILES } from "./country-profiles.ts";

export const SUPERCHARGE_INFO_URL = "https://supercharge.info/service/supercharge/allSites";
export const SUPERCHARGE_INFO_CREDIT = "supercharge.info";

const DKK_PER_USD = 6.85;

export type SuperchargeInfoSite = {
  id?: number;
  name?: string;
  status?: string;
  address?: { city?: string; country?: string };
  gps?: { latitude?: number; longitude?: number };
  stallCount?: number;
  powerKilowatt?: number;
};

export type SuperchargerRow = {
  id: string;
  name: string;
  short: string;
  lat: number;
  lng: number;
  kind: "supercharger";
  networkId: "tesla";
  country: string | null;
  usdPerKwh: number;
  operator: string;
  preset: false;
  radiusM: number;
};

const COUNTRY_ALIASES: Record<string, string> = {
  "united kingdom": "UK",
  "great britain": "UK",
  "czech republic": "CZ",
  czechia: "CZ",
  "the netherlands": "NL",
  netherlands: "NL",
  "bosnia and herzegovina": "BA",
  "north macedonia": "MK",
  macedonia: "MK",
  turkiye: "TR",
};

/** supercharge.info gives country names ("Denmark"); the price catalog uses codes. */
export function countryCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  if (COUNTRY_ALIASES[key]) return COUNTRY_ALIASES[key];
  return COUNTRY_PROFILES.find((c) => c.name.toLowerCase() === key)?.id ?? null;
}

/** An open Supercharger as a planner charger; null for planned, closed or broken entries. */
export function superchargerFromSite(site: SuperchargeInfoSite): SuperchargerRow | null {
  if (site.status !== "OPEN") return null;
  const lat = Number(site.gps?.latitude);
  const lng = Number(site.gps?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || site.id == null) return null;
  const place = site.address?.city || site.name?.split(",")[0]?.trim() || "Supercharger";
  const country = countryCodeFromName(site.address?.country);
  return {
    id: `sci-${site.id}`,
    name: `Tesla Supercharger ${place}`,
    short: place.slice(0, 22),
    lat,
    lng,
    kind: "supercharger",
    networkId: "tesla",
    country,
    usdPerKwh: (rateAt("tesla", false, country) ?? 3.3) / DKK_PER_USD,
    operator: "Tesla",
    preset: false,
    radiusM: 250,
  };
}

/**
 * Rows inside the path's bounding box grown by `marginKm`: a cheap first cut of ~9,000
 * Superchargers before the exact distance-to-road check.
 */
export function inPathBox<T extends { lat: number; lng: number }>(rows: T[], path: [number, number][], marginKm: number): T[] {
  if (path.length < 2) return [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of path) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  const dLat = marginKm / 111.2;
  const dLng = marginKm / (111.2 * Math.max(0.2, Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))));
  return rows.filter(
    (r) => r.lat >= minLat - dLat && r.lat <= maxLat + dLat && r.lng >= minLng - dLng && r.lng <= maxLng + dLng,
  );
}
