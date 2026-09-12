import { chargeFitScore, chargeSearchKm, CHEAP_STALL_KM, defaultFocus, extraMileageKr, type LegMode, type ModeFocus } from "./modes.ts";
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

export function pointAlongPath(path: [number, number][], frac: number): [number, number] {
  if (path.length === 0) return [0, 0];
  if (path.length === 1 || frac <= 0) return path[0];
  const target = pathMeters(path) * Math.min(1, Math.max(0, frac));
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const d = haversineM(
      { lat: path[i - 1][0], lng: path[i - 1][1] },
      { lat: path[i][0], lng: path[i][1] },
    );
    if (acc + d >= target) {
      const t = d > 0 ? (target - acc) / d : 0;
      return [
        path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t,
        path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t,
      ];
    }
    acc += d;
  }
  return path[path.length - 1];
}

/** Keep stalls spread along the corridor, not the 40 nearest (those all sit in one country). */
export function spreadAlongPath<T extends { id: string; lat: number; lng: number }>(
  locations: T[],
  path: [number, number][],
  buckets = 24,
  maxM = 50_000,
): T[] {
  if (!locations.length || path.length < 2) return [];
  const chosen = new Map<number, { loc: T; d: number }>();
  for (const loc of locations) {
    const d = minDistToPathM(loc.lat, loc.lng, path);
    if (d > maxM) continue;
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
  const locRate = (loc: ViaLoc) => {
    const netId = networkIdFor(loc.kind, loc.networkId);
    return (netId ? rateForNetwork(netId, Boolean(memberships[netId])) : null) ?? loc.usdPerKwh * 6.85;
  };
  let best: ViaLoc | null = null;
  let bestScore = -Infinity;
  for (const loc of locations) {
    if (exclude.has(loc.id) || loc.kind === "home") continue;
    const distM = minDistToPathM(loc.lat, loc.lng, path);
    if (distM > searchBand) continue;
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
  const pris = opts.mode === "cheapest" || (opts.focus ?? defaultFocus(opts.mode)) === "pris";
  const memberships = opts.memberships ?? {};
  const locRate = (loc: ViaLoc) => {
    const netId = networkIdFor(loc.kind, loc.networkId);
    return (netId ? rateForNetwork(netId, Boolean(memberships[netId])) : null) ?? loc.usdPerKwh * 6.85;
  };
  let best: ViaLoc | null = null;
  let bestScore = Infinity;
  let bestD = pris ? CHEAP_STALL_KM * 1000 : 80_000;
  for (const loc of opts.locations) {
    if (exclude.has(loc.id) || loc.kind === "home") continue;
    const energyTo = opts.totalKwh * alongFraction(opts.path, loc.lat, loc.lng);
    if (energyTo < minEnergy * 0.9 || energyTo > opts.budgetKwh * 1.02) continue;
    const d = haversineM({ lat, lng }, loc);
    if (d > (pris ? CHEAP_STALL_KM * 1000 : 80_000)) continue;
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
