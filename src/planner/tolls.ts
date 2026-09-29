import { minDistToPathM } from "./insert.ts";
import { asCheapAvoid, type CheapAvoid, type LegMode } from "./modes.ts";

export type TollGate = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kr: number;
};

/** One-way passenger-car list prices, DKK. */
export const TOLL_GATES: TollGate[] = [
  { id: "storebaelt", name: "Storebælt", lat: 55.3417, lng: 10.9944, kr: 268 },
  { id: "oresund", name: "Øresund", lat: 55.573, lng: 12.847, kr: 418 },
  { id: "svinesund", name: "Svinesund", lat: 59.094, lng: 11.271, kr: 32 },
  { id: "orebrotunnel", name: "Mælefjelltunnelen", lat: 59.48, lng: 8.2, kr: 86 },
];

/** Extra kr/km on tolled motorways when the route is actually tolled.
 *  Cars: FR ~€0.10/km, IT ~€0.08/km. Eco only skips this if the path has no toll. */
const TOLL_KR_PER_KM: { lat0: number; lat1: number; lng0: number; lng1: number; kr: number }[] = [
  { lat0: 42.3, lat1: 51.2, lng0: -5.2, lng1: 8.3, kr: 0.75 }, // FR ~€0.10/km
  { lat0: 36.6, lat1: 47.1, lng0: 6.5, lng1: 18.6, kr: 0.60 }, // IT
  { lat0: 36.0, lat1: 43.8, lng0: -9.5, lng1: 3.4, kr: 0.45 }, // ES/PT
  { lat0: 42.3, lat1: 46.6, lng0: 13.3, lng1: 19.5, kr: 0.42 }, // HR
  { lat0: 57.9, lat1: 71.2, lng0: 4.5, lng1: 31.5, kr: 0.55 }, // NO AutoPASS
];

export function gatesOnPath(path: [number, number][], maxM = 4000) {
  if (path.length < 2) return [];
  return TOLL_GATES.filter((g) => minDistToPathM(g.lat, g.lng, path) <= maxM);
}

function kmRateAt(lat: number, lng: number) {
  const hit = TOLL_KR_PER_KM.find((b) => lat >= b.lat0 && lat <= b.lat1 && lng >= b.lng0 && lng <= b.lng1);
  return hit?.kr ?? 0;
}

export function estimateTolls(
  path: [number, number][],
  miles: number,
  hasToll: boolean,
  mode: LegMode,
) {
  const gates = gatesOnPath(path);
  const gateKr = gates.reduce((n, g) => n + g.kr, 0);
  const rate =
    path.length > 0
      ? path.reduce((n, [lat, lng]) => n + kmRateAt(lat, lng), 0) / path.length
      : 0;
  const km = miles * 1.609344;
  // km motorway rate only when the router marked the road as tolled.
  // A free detour through Italy must not pick up IT €/km — that's why
  // "Avoid toll gates" was showing a *higher* toll than Fastest.
  const roadKr = hasToll && mode !== "eco" ? km * rate : 0;
  const rawRoadKr = hasToll && mode !== "eco" ? km * rate : 0;
  const kr = Math.round((gateKr + roadKr) * 10) / 10;
  const label = gates.length ? gates.map((g) => g.name).join(" · ") : roadKr > 1 ? "Road toll" : "";
  return {
    kr,
    gateKr,
    roadKr: Math.round(rawRoadKr * 10) / 10,
    label,
    hasToll: hasToll || gates.length > 0 || rawRoadKr > 1,
    gates,
  };
}

/** Fees the cheapest avoid-toggles are trying to skip on this geometry. */
export function avoidableFeeKr(
  path: [number, number][],
  miles: number,
  hasToll: boolean,
  avoid: boolean | CheapAvoid,
) {
  const a = asCheapAvoid(avoid);
  const t = estimateTolls(path, miles, hasToll, "fastest");
  if (a.tolls) return t.gateKr + t.roadKr;
  if (a.roadFees) return t.roadKr;
  return 0;
}

function distToSegmentM(lat: number, lng: number, a: [number, number], b: [number, number]) {
  const lat0 = ((a[0] + b[0]) * 0.5 * Math.PI) / 180;
  const mLat = 111_320;
  const mLng = Math.cos(lat0) * mLat;
  const px = lng * mLng;
  const py = lat * mLat;
  const ax = a[1] * mLng;
  const ay = a[0] * mLat;
  const bx = b[1] * mLng;
  const by = b[0] * mLat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Meters from a point to the closest vertex or segment of the path. */
export function distToPathM(lat: number, lng: number, path: [number, number][]) {
  if (path.length === 0) return Infinity;
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const dLat = path[i][0] - lat;
    const dLng = (path[i][1] - lng) * Math.cos(((path[i][0] + lat) * 0.5 * Math.PI) / 180);
    best = Math.min(best, Math.hypot(dLat, dLng) * 111_320);
    if (i < path.length - 1) best = Math.min(best, distToSegmentM(lat, lng, path[i], path[i + 1]));
  }
  return best;
}

/**
 * Toll corridors the geometry actually enters. Country and city apps use
 * their own triggers; this is only the bridge/tunnel gates.
 */
export function tollRegionIdsOnPath(path: [number, number][], maxM = 4000) {
  if (path.length === 0) return [];
  return TOLL_GATES.filter((g) => distToPathM(g.lat, g.lng, path) <= maxM).map((g) => g.id);
}
