/**
 * Bidding zones the Elpris screen can price from a public day-ahead feed.
 * Natural Earth outlines are only used to decide whether a planned route is
 * in the selected country. They do not invent a price.
 */
import { PRICE_AREA_RINGS } from "./price-area-rings.ts";

export const PRICE_COUNTRIES = [
  {
    id: "DK",
    name: "Danmark",
    areas: [
      { id: "DK1", label: "DK1", hint: "Vest · Jylland & Fyn" },
      { id: "DK2", label: "DK2", hint: "Øst · Sjælland & Bornholm" },
    ],
  },
  {
    id: "NO",
    name: "Norge",
    areas: [
      { id: "NO1", label: "NO1", hint: "Østlandet" },
      { id: "NO2", label: "NO2", hint: "Sørlandet" },
      { id: "NO3", label: "NO3", hint: "Midt-Norge" },
      { id: "NO4", label: "NO4", hint: "Nord-Norge" },
      { id: "NO5", label: "NO5", hint: "Vestlandet" },
    ],
  },
  {
    id: "SE",
    name: "Sverige",
    areas: [
      { id: "SE1", label: "SE1", hint: "Luleå" },
      { id: "SE2", label: "SE2", hint: "Sundsvall" },
      { id: "SE3", label: "SE3", hint: "Stockholm" },
      { id: "SE4", label: "SE4", hint: "Malmö" },
    ],
  },
  {
    id: "FI",
    name: "Finland",
    areas: [{ id: "FI", label: "FI", hint: "Hele Finland" }],
  },
  {
    id: "DE",
    name: "Tyskland",
    areas: [{ id: "GER", label: "GER", hint: "Hele Tyskland" }],
  },
  {
    id: "NL",
    name: "Nederlandene",
    areas: [{ id: "NL", label: "NL", hint: "Hele Nederlandene" }],
  },
] as const;

export type PriceCountry = (typeof PRICE_COUNTRIES)[number]["id"];
export type PriceArea = (typeof PRICE_COUNTRIES)[number]["areas"][number]["id"];

export const PRICE_AREA_IDS: PriceArea[] = PRICE_COUNTRIES.flatMap((c) => c.areas.map((a) => a.id));

const COUNTRY_IDS: PriceCountry[] = PRICE_COUNTRIES.map((c) => c.id);

export function isPriceCountry(value: string | null | undefined): value is PriceCountry {
  return COUNTRY_IDS.includes(value as PriceCountry);
}

export function isPriceArea(value: string | null | undefined): value is PriceArea {
  return PRICE_AREA_IDS.includes(value as PriceArea);
}

export function countryOf(area: PriceArea): PriceCountry {
  for (const country of PRICE_COUNTRIES) {
    if (country.areas.some((a) => a.id === area)) return country.id;
  }
  return "DK";
}

export function areasForCountry(country: PriceCountry) {
  return PRICE_COUNTRIES.find((c) => c.id === country)?.areas ?? PRICE_COUNTRIES[0].areas;
}

/** DK1 is the car default. Other countries use their first listed zone. */
export function defaultArea(country: PriceCountry): PriceArea {
  return areasForCountry(country)[0].id;
}

type Ring = readonly (readonly number[])[];
type Polygon = readonly Ring[];

const RINGS = PRICE_AREA_RINGS as Record<PriceCountry, readonly Polygon[]>;

function pointInRing(lng: number, lat: number, ring: Ring) {
  let inside = false;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0];
    const y1 = ring[i][1];
    const x2 = ring[i + 1][0];
    const y2 = ring[i + 1][1];
    if (y1 > lat !== y2 > lat && lng < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function covers(country: PriceCountry, lng: number, lat: number) {
  for (const rings of RINGS[country]) {
    if (!pointInRing(lng, lat, rings[0])) continue;
    if (rings.slice(1).some((hole) => pointInRing(lng, lat, hole))) continue;
    return true;
  }
  return false;
}

function segmentKm(lng: number, lat: number, x1: number, y1: number, x2: number, y2: number) {
  const lat0 = (lat * Math.PI) / 180;
  const xy = (lon: number, la: number) => [
    ((lon * Math.PI) / 180) * Math.cos(lat0) * 6371,
    ((la * Math.PI) / 180) * 6371,
  ];
  const [px, py] = xy(lng, lat);
  const [ax, ay] = xy(x1, y1);
  const [bx, by] = xy(x2, y2);
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function nearestKm(country: PriceCountry, lng: number, lat: number) {
  let best = Number.POSITIVE_INFINITY;
  for (const rings of RINGS[country]) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        best = Math.min(
          best,
          segmentKm(lng, lat, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]),
        );
      }
    }
  }
  return best;
}

/**
 * Country of a stop. Coastal cities can sit just outside the simplified
 * shoreline, so a unique neighbour within 25 km still counts.
 */
export function countryAt(lat: number, lng: number): PriceCountry | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const inside = COUNTRY_IDS.filter((id) => covers(id, lng, lat));
  if (inside.length === 1) return inside[0];
  if (inside.length > 1) return null;
  const dists = COUNTRY_IDS.map((id) => ({ id, km: nearestKm(id, lng, lat) })).sort(
    (a, b) => a.km - b.km,
  );
  if (dists[0] && dists[0].km <= 25 && dists[1] && dists[1].km - dists[0].km >= 8) {
    return dists[0].id;
  }
  return null;
}

/**
 * Planner spot follows the selected zone only when the route is in that
 * country. A DK selection stays the car default (DK1/DK2) even if the route
 * is abroad — we do not guess a foreign zone. A foreign selection that does
 * not match the route falls back to DK1.
 */
export function areaForPlanner(
  selected: PriceArea,
  points: { lat: number; lng: number }[],
): PriceArea {
  if (!isPriceArea(selected)) return "DK1";
  if (points.length === 0) return selected;
  const want = countryOf(selected);
  let matches = false;
  for (const point of points) {
    if (countryAt(point.lat, point.lng) === want) {
      matches = true;
      break;
    }
  }
  if (matches || want === "DK") return selected;
  return "DK1";
}
