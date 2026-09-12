import { chargeFitScore, chargeSearchKm, CHEAP_STALL_KM, defaultFocus, extraMileageKr, type LegMode, type ModeFocus } from "./modes.ts";
import { geohashesAlongPath, inGeohashSet } from "./geohash.ts";
import { networkIdFor, rateForNetwork } from "./networks.ts";

export type ViaLoc = {
  id: string;
  lat: number;
  lng: number;
  kind: string;
  usdPerKwh: number;
  name?: string;
  short?: string;
  networkId?: string | null;
};

export type SplitRoute = {
  miles: number;
  seconds: number;
  path: [number, number][];
  source: "valhalla" | "osrm" | "air";
};

const DEG = Math.PI / 180;
const M_PER_DEG = 111_320;
const HALF_DEG = DEG / 2;

/** Equirectangular meters. Right for charger ranking and path length in Europe. */
function approxM(lat: number, lng: number, plat: number, plng: number) {
  const dLat = plat - lat;
  const dLng = (plng - lng) * Math.cos((lat + plat) * HALF_DEG);
  return Math.hypot(dLat, dLng) * M_PER_DEG;
}

/** Local: equirectangular. Long haul (>15°): spherical law of cosines. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  if (dLat < 15 && dLat > -15 && dLng < 15 && dLng > -15) {
    return approxM(a.lat, a.lng, b.lat, b.lng);
  }
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const cos =
    Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng * DEG);
  return 6_371_000 * Math.acos(Math.min(1, Math.max(-1, cos)));
}

export const distanceM = haversineM;

const cumCache = new WeakMap<[number, number][], number[]>();

function cumMeters(path: [number, number][]) {
  const hit = cumCache.get(path);
  if (hit) return hit;
  const cum = [0];
  for (let i = 1; i < path.length; i++) {
    cum.push(cum[i - 1] + approxM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]));
  }
  cumCache.set(path, cum);
  return cum;
}

function sampleStep(path: [number, number][]) {
  return Math.max(1, Math.floor(path.length / 48));
}

export function minDistToPathM(lat: number, lng: number, path: [number, number][]) {
  if (path.length === 0) return Infinity;
  const step = sampleStep(path);
  let best = Infinity;
  for (let i = 0; i < path.length; i += step) {
    const d = approxM(lat, lng, path[i][0], path[i][1]);
    if (d < best) best = d;
  }
  const last = path[path.length - 1];
  return Math.min(best, approxM(lat, lng, last[0], last[1]));
}

export function pathMeters(path: [number, number][]) {
  const cum = cumMeters(path);
  return cum[cum.length - 1] ?? 0;
}

export function closestPathIndex(path: [number, number][], lat: number, lng: number) {
  let best = 0;
  let bestD = Infinity;
  const step = sampleStep(path);
  for (let i = 0; i < path.length; i += step) {
    const d = approxM(lat, lng, path[i][0], path[i][1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const last = path.length - 1;
  if (last > 0 && approxM(lat, lng, path[last][0], path[last][1]) < bestD) return last;
  return best;
}

export function alongFraction(path: [number, number][], lat: number, lng: number) {
  const cum = cumMeters(path);
  const total = cum[cum.length - 1] ?? 0;
  if (total <= 0) return 0;
  const idx = closestPathIndex(path, lat, lng);
  return cum[idx] / total;
}

export function pointAlongPath(path: [number, number][], frac: number): [number, number] {
  if (path.length === 0) return [0, 0];
  if (path.length === 1 || frac <= 0) return path[0];
  const cum = cumMeters(path);
  const total = cum[cum.length - 1] ?? 0;
  if (total <= 0) return path[0];
  const target = total * Math.min(1, Math.max(0, frac));
  for (let i = 1; i < path.length; i++) {
    if (cum[i] >= target) {
      const span = cum[i] - cum[i - 1];
      const t = span > 0 ? (target - cum[i - 1]) / span : 0;
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ];
    }
  }
  return path[path.length - 1];
}

/** Drop chargers whose geohash cell is not on the corridor (plus 8 neighbors). */
export function locationsNearPath<T extends { lat: number; lng: number }>(
  locations: T[],
  path: [number, number][],
  maxM: number,
): T[] {
  if (!locations.length || path.length < 2) return [];
  if (locations.length < 48) {
    return locations.filter((l) => minDistToPathM(l.lat, l.lng, path) <= maxM);
  }
  const cells = geohashesAlongPath(path);
  const out: T[] = [];
  for (const loc of locations) {
    if (!inGeohashSet(loc.lat, loc.lng, cells)) continue;
    if (minDistToPathM(loc.lat, loc.lng, path) <= maxM) out.push(loc);
  }
  return out;
}

/** Keep stalls spread along the corridor, not the 40 nearest (those all sit in one country). */
export function spreadAlongPath<T extends { id: string; lat: number; lng: number }>(
  locations: T[],
  path: [number, number][],
  buckets = 24,
  maxM = 50_000,
): T[] {
  if (!locations.length || path.length < 2) return [];
  const nearby = locationsNearPath(locations, path, maxM);
  const chosen = new Map<number, { loc: T; d: number }>();
  for (const loc of nearby) {
    const d = minDistToPathM(loc.lat, loc.lng, path);
    const frac = alongFraction(path, loc.lat, loc.lng);
    if (frac < 0.02 || frac > 0.98) continue;
    const b = Math.min(buckets - 1, Math.floor(frac * buckets));
    const prev = chosen.get(b);
    if (!prev || d < prev.d) chosen.set(b, { loc, d });
  }
  return [...chosen.values()].map((x) => x.loc);
}

export function splitRoutedLeg(route: SplitRoute, lat: number, lng: number): { before: SplitRoute; after: SplitRoute } | null {
  if (route.path.length < 2) return null;
  let idx = closestPathIndex(route.path, lat, lng);
  idx = Math.max(1, Math.min(route.path.length - 2, idx));
  const via = route.path[idx];
  const beforePath = route.path.slice(0, idx + 1);
  const afterPath = route.path.slice(idx);
  if (beforePath.length < 2 || afterPath.length < 2) return null;
  const total = pathMeters(route.path) || 1;
  const frac = Math.min(0.95, Math.max(0.05, pathMeters(beforePath) / total));
  return {
    before: {
      miles: route.miles * frac,
      seconds: route.seconds * frac,
      path: beforePath,
      source: route.source,
    },
    after: {
      miles: route.miles * (1 - frac),
      seconds: route.seconds * (1 - frac),
      path: afterPath,
      source: route.source,
    },
  };
}

export function pickViaOnPath(opts: {
  path: [number, number][];
  locations: ViaLoc[];
  budgetKwh: number;
  totalKwh: number;
  mode: LegMode;
  focus?: ModeFocus;
  detourKm: number;
  excludeIds?: Iterable<string>;
  memberships?: Record<string, boolean>;
  /** Energy that drops SOC to 25%. Prefer a stall after this (lower = faster DC). */
  minKwh?: number;
}): ViaLoc | null {
  const { path, locations, budgetKwh, totalKwh, mode, detourKm } = opts;
  const focus = opts.focus ?? defaultFocus(mode);
  const memberships = opts.memberships ?? {};
  if (totalKwh <= 0 || budgetKwh <= 0 || path.length < 2) return null;
  const exclude = new Set(opts.excludeIds ?? []);
  const searchBand =
    mode === "cheapest" || focus === "pris"
      ? CHEAP_STALL_KM * 1000
      : Math.max(chargeSearchKm(mode, detourKm, focus) * 1000, 12_000);
  const pool = locationsNearPath(locations, path, searchBand);
  const locRate = (loc: ViaLoc) => {
    const netId = networkIdFor(loc.kind, loc.networkId);
    return (netId ? rateForNetwork(netId, Boolean(memberships[netId])) : null) ?? loc.usdPerKwh * 6.85;
  };
  let best: ViaLoc | null = null;
  let bestScore = -Infinity;
  for (const loc of pool) {
    if (exclude.has(loc.id) || loc.kind === "home") continue;
    const distM = minDistToPathM(loc.lat, loc.lng, path);
    const frac = alongFraction(path, loc.lat, loc.lng);
    if (frac < 0.02 || frac > 0.92) continue;
    const energyTo = totalKwh * frac;
    if (energyTo > budgetKwh * 0.99) continue;
    const minEnergy = Math.max(0, opts.minKwh ?? budgetKwh * 0.45);
    if (energyTo < minEnergy) continue;
    const rate = locRate(loc);
    if (!(rate > 0)) continue;
    const extraKm = distM / 1000;
    if (focus === "pris" && extraKm > CHEAP_STALL_KM) continue;
    const extraKr = extraMileageKr(distM);
    const fit = chargeFitScore(focus, {
      distM,
      kr: rate * 20,
      dc: loc.kind === "supercharger",
      extraDriveKr: extraKr,
      extraKwh: (distM / 1000) * 0.2,
    });
    const along = energyTo * 24;
    const unused = (budgetKwh - energyTo) * 10;
    const score =
      focus === "pris"
        ? -(rate * 50 + extraKr) + energyTo * 0.05
        : along - unused - fit;
    if (score > bestScore) {
      bestScore = score;
      best = loc;
    }
  }
  return best;
}

/** If nothing sits in the energy window, take a stall in-band near remaining range — never snap backward. */
export function pickViaAtRange(opts: Parameters<typeof pickViaOnPath>[0]): ViaLoc | null {
  const hit = pickViaOnPath(opts);
  if (hit) return hit;
  const minEnergy = Math.max(0, opts.minKwh ?? opts.budgetKwh * 0.45);
  const targetKwh = minEnergy + 0.85 * Math.max(0, opts.budgetKwh - minEnergy);
  const frac = Math.min(0.82, Math.max(0.08, targetKwh / Math.max(opts.totalKwh, 1)));
  const [lat, lng] = pointAlongPath(opts.path, frac);
  const exclude = new Set(opts.excludeIds ?? []);
  const focus = opts.focus ?? defaultFocus(opts.mode);
  const pris = opts.mode === "cheapest" || focus === "pris";
  const memberships = opts.memberships ?? {};
  const locRate = (loc: ViaLoc) => {
    const netId = networkIdFor(loc.kind, loc.networkId);
    return (netId ? rateForNetwork(netId, Boolean(memberships[netId])) : null) ?? loc.usdPerKwh * 6.85;
  };
  const band = pris
    ? CHEAP_STALL_KM * 1000
    : Math.max(chargeSearchKm(opts.mode, opts.detourKm, focus) * 1000, 18_000);
  const pool = locationsNearPath(opts.locations, opts.path, band);
  let best: ViaLoc | null = null;
  let bestScore = Infinity;
  let bestD = band;
  for (const loc of pool) {
    if (exclude.has(loc.id) || loc.kind === "home") continue;
    const energyTo = opts.totalKwh * alongFraction(opts.path, loc.lat, loc.lng);
    if (energyTo < minEnergy * 0.9 || energyTo > opts.budgetKwh * 1.02) continue;
    const d = approxM(lat, lng, loc.lat, loc.lng);
    if (d > band) continue;
    if (pris) {
      const cost = locRate(loc) * 50 + extraMileageKr(d);
      if (cost < bestScore - 0.5 || (Math.abs(cost - bestScore) <= 0.5 && d < bestD)) {
        bestScore = cost;
        bestD = d;
        best = loc;
      }
    } else if (d < bestD) {
      bestD = d;
      best = loc;
    }
  }
  if (best) return best;
  return {
    id: `range-${lat.toFixed(3)},${lng.toFixed(3)}`,
    lat,
    lng,
    kind: "custom",
    usdPerKwh: 0.48,
    name: "Charge",
    short: "Charge",
  };
}
