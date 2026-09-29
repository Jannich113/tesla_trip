import { countryAt } from "../lib/price-areas.ts";
import { ROAD_FEE_APPS, countryProfile, type RoadFeeApp } from "./country-profiles.ts";
import type { EuRegion } from "./networks.ts";
import { haversineM } from "./insert.ts";
import { TOLL_GATES, distToPathM, tollRegionIdsOnPath } from "./tolls.ts";

export type RoadFeeSuggestion = {
  id: string;
  name: string;
  kind: RoadFeeApp["kind"];
  summary: string;
  links: RoadFeeApp["links"];
  /** Why the route matched. Display copy, not a payment step. */
  reason: string;
};

type Ring = readonly (readonly [number, number])[];

/**
 * Approximate country outlines for fee apps that are outside the Elpris
 * country shapes (those win via countryAt). First-match is not used: when
 * two outlines contain a point, the closer anchor wins.
 */
const FEE_COUNTRY_RINGS: { id: EuRegion; anchor: [number, number]; ring: Ring }[] = [
  {
    id: "CH",
    anchor: [46.8, 8.23],
    ring: [
      [45.82, 5.96],
      [45.82, 10.49],
      [47.05, 10.49],
      [47.05, 5.96],
    ],
  },
  {
    id: "CH",
    anchor: [46.8, 8.23],
    ring: [
      [47.05, 5.96],
      [47.05, 9.55],
      [47.81, 9.55],
      [47.81, 5.96],
    ],
  },
  {
    id: "AT",
    anchor: [47.6, 14.6],
    ring: [
      [47.58, 9.55],
      [47.55, 9.9],
      [47.45, 10.5],
      [47.42, 11.15],
      [47.6, 12.0],
      [47.75, 12.5],
      [47.95, 13.0],
      [48.3, 13.4],
      [48.55, 14.0],
      [48.85, 15.2],
      [48.75, 16.4],
      [48.2, 16.95],
      [47.7, 16.9],
      [46.85, 16.1],
      [46.5, 14.6],
      [46.55, 13.2],
      [46.7, 12.3],
      [46.85, 11.2],
      [46.95, 10.45],
      [47.1, 9.8],
    ],
  },
  {
    id: "CZ",
    anchor: [49.8, 15.5],
    ring: [
      [48.55, 12.09],
      [48.55, 18.87],
      [51.06, 18.87],
      [51.06, 12.09],
    ],
  },
  {
    id: "SK",
    anchor: [48.67, 19.5],
    ring: [
      [48.1, 16.9],
      [48.7, 17.05],
      [49.1, 18.05],
      [49.5, 18.6],
      [49.55, 22.2],
      [49.05, 22.55],
      [48.55, 22.25],
      [48.4, 21.0],
      [48.25, 19.8],
      [47.8, 18.5],
      [47.75, 17.15],
    ],
  },
  {
    id: "HU",
    anchor: [47.16, 19.4],
    ring: [
      [47.85, 16.2],
      [46.85, 16.1],
      [45.75, 17.9],
      [45.8, 20.9],
      [46.45, 21.4],
      [47.15, 21.7],
      [48.55, 22.35],
      [48.5, 20.4],
      [48.05, 19.3],
      [47.9, 17.35],
    ],
  },
  {
    id: "BG",
    anchor: [42.73, 25.4],
    ring: [
      [41.24, 22.36],
      [41.24, 28.61],
      [44.22, 28.61],
      [44.22, 22.36],
    ],
  },
];

const CITIES: { id: string; name: string; lat: number; lng: number; radiusM: number }[] = [
  { id: "oslo", name: "Oslo", lat: 59.9139, lng: 10.7522, radiusM: 12_000 },
];

function pointInRing(lat: number, lng: number, ring: Ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const y1 = ring[i][0];
    const x1 = ring[i][1];
    const y2 = ring[j][0];
    const x2 = ring[j][1];
    if (y1 > lat !== y2 > lat && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

/** Country for a fee-app trigger. Elpris shapes win; other countries use the outlines above. */
function outlinedCountry(lat: number, lng: number): EuRegion | null {
  let best: { id: EuRegion; score: number } | null = null;
  for (const country of FEE_COUNTRY_RINGS) {
    if (!pointInRing(lat, lng, country.ring)) continue;
    const dLat = lat - country.anchor[0];
    const dLng = lng - country.anchor[1];
    const score = dLat * dLat + dLng * dLng;
    if (!best || score < best.score) best = { id: country.id, score };
  }
  return best?.id ?? null;
}

export function feeCountryAt(lat: number, lng: number): EuRegion | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const outlined = outlinedCountry(lat, lng);
  const priced = countryAt(lat, lng);
  // The Elpris Germany shape spills over the Alps into western Austria and
  // the Rhine into Switzerland. A point inside those fee outlines is the
  // vignette country, not Germany.
  if (outlined && priced === "DE" && (outlined === "AT" || outlined === "CH")) return outlined;
  if (priced) return priced;
  return outlined;
}

function countriesOnPath(path: [number, number][]) {
  const found = new Set<EuRegion>();
  const stepM = 20_000;
  const visit = (lat: number, lng: number) => {
    const id = feeCountryAt(lat, lng);
    if (id) found.add(id);
  };
  for (let i = 0; i < path.length; i++) {
    visit(path[i][0], path[i][1]);
    if (i === path.length - 1) break;
    const a = path[i];
    const b = path[i + 1];
    const metres = haversineM({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
    const steps = Math.floor(metres / stepM);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      visit(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    }
  }
  return found;
}

function citiesOnPath(path: [number, number][]) {
  const found = new Set<string>();
  for (const city of CITIES) {
    if (distToPathM(city.lat, city.lng, path) <= city.radiusM) found.add(city.id);
  }
  return found;
}

function cityName(id: string) {
  return CITIES.find((c) => c.id === id)?.name ?? id;
}

function gateName(id: string) {
  return TOLL_GATES.find((g) => g.id === id)?.name ?? id;
}

function reasonFor(
  app: RoadFeeApp,
  countries: Set<EuRegion>,
  cities: Set<string>,
  gates: Set<string>,
) {
  const entered: string[] = [];
  const crossed: string[] = [];
  for (const trigger of app.triggers) {
    if (trigger.kind === "country" && countries.has(trigger.country)) {
      entered.push(countryProfile(trigger.country)?.name ?? trigger.country);
    } else if (trigger.kind === "city" && cities.has(trigger.cityId)) {
      entered.push(cityName(trigger.cityId));
    } else if (trigger.kind === "toll-region" && gates.has(trigger.gateId)) {
      crossed.push(gateName(trigger.gateId));
    }
  }
  const parts: string[] = [];
  if (entered.length) parts.push(`Route enters ${entered.join(" and ")}`);
  if (crossed.length) parts.push(`Route crosses ${crossed.join(" and ")}`);
  return parts.join(" · ");
}

/**
 * Road-fee and city-parking apps to suggest for this geometry.
 * Triggers are country, city, or toll corridor. There is no manual toggle.
 * The result is a suggestion list (install / sign-up links), not a charge.
 */
export function suggestRoadFeeApps(path: [number, number][]): RoadFeeSuggestion[] {
  if (path.length === 0) return [];
  const countries = countriesOnPath(path);
  const cities = citiesOnPath(path);
  const gates = new Set(tollRegionIdsOnPath(path));
  const out: RoadFeeSuggestion[] = [];
  for (const app of ROAD_FEE_APPS) {
    const reason = reasonFor(app, countries, cities, gates);
    if (!reason) continue;
    out.push({
      id: app.id,
      name: app.name,
      kind: app.kind,
      summary: app.summary,
      links: app.links,
      reason,
    });
  }
  return out;
}
