import { chargeFitScore, chargeSearchKm, type LegMode } from "./modes.ts";

export type ViaLoc = {
  id: string;
  lat: number;
  lng: number;
  kind: string;
  usdPerKwh: number;
  name?: string;
  short?: string;
};

export type SplitRoute = {
  miles: number;
  seconds: number;
  path: [number, number][];
  source: "valhalla" | "osrm" | "air";
};

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function minDistToPathM(lat: number, lng: number, path: [number, number][]) {
  if (path.length === 0) return Infinity;
  const step = Math.max(1, Math.floor(path.length / 40));
  let best = Infinity;
  for (let i = 0; i < path.length; i += step) {
    const d = haversineM({ lat, lng }, { lat: path[i][0], lng: path[i][1] });
    if (d < best) best = d;
  }
  const last = path[path.length - 1];
  best = Math.min(best, haversineM({ lat, lng }, { lat: last[0], lng: last[1] }));
  return best;
}

export function pathMeters(path: [number, number][]) {
  let n = 0;
  for (let i = 1; i < path.length; i++) {
    n += haversineM({ lat: path[i - 1][0], lng: path[i - 1][1] }, { lat: path[i][0], lng: path[i][1] });
  }
  return n;
}

export function closestPathIndex(path: [number, number][], lat: number, lng: number) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversineM({ lat, lng }, { lat: path[i][0], lng: path[i][1] });
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export function alongFraction(path: [number, number][], lat: number, lng: number) {
  const total = pathMeters(path);
  if (total <= 0) return 0;
  const idx = closestPathIndex(path, lat, lng);
  return pathMeters(path.slice(0, idx + 1)) / total;
}

export function splitRoutedLeg(route: SplitRoute, lat: number, lng: number): { before: SplitRoute; after: SplitRoute } | null {
  if (route.path.length < 2) return null;
  let idx = closestPathIndex(route.path, lat, lng);
  idx = Math.max(1, Math.min(route.path.length - 2, idx));
  const via: [number, number] = [lat, lng];
  const beforePath: [number, number][] = [...route.path.slice(0, idx + 1), via];
  const afterPath: [number, number][] = [via, ...route.path.slice(idx)];
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
  detourKm: number;
  excludeIds?: Iterable<string>;
}): ViaLoc | null {
  const { path, locations, budgetKwh, totalKwh, mode, detourKm } = opts;
  if (totalKwh <= 0 || budgetKwh <= 0 || path.length < 2) return null;
  const exclude = new Set(opts.excludeIds ?? []);
  const searchBand = Math.max(chargeSearchKm(mode, detourKm) * 1000, 4_000);
  let best: ViaLoc | null = null;
  let bestScore = -Infinity;
  for (const loc of locations) {
    if (exclude.has(loc.id) || loc.kind === "home") continue;
    const distM = minDistToPathM(loc.lat, loc.lng, path);
    if (distM > searchBand) continue;
    const frac = alongFraction(path, loc.lat, loc.lng);
    if (frac < 0.12 || frac > 0.88) continue;
    const energyTo = totalKwh * frac;
    if (energyTo > budgetKwh * 0.95) continue;
    const fit = chargeFitScore(mode, {
      distM,
      kr: loc.usdPerKwh * 6.85 * 20,
      dc: loc.kind === "supercharger",
      extraDriveKr: (distM / 1000) * 1.2,
    });
    const score = energyTo * 6 - fit;
    if (score > bestScore) {
      bestScore = score;
      best = loc;
    }
  }
  return best;
}
