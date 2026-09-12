import { CHEAP_AVOID_FRAC, SLOW_TIME_FACTOR, type CheapAvoid, type LegMode } from "./modes.ts";
import { avoidableFeeKr } from "./tolls.ts";

export type DriveCandidate = {
  miles: number;
  seconds: number;
  path: [number, number][];
  source: string;
  hasToll?: boolean;
  tollKr?: number;
};

export function pickRouted<T extends DriveCandidate>(mode: LegMode, routes: T[]): T | null {
  const list = routes.filter((r) => r.path.length >= 3 && r.miles > 0);
  if (!list.length) return null;
  if (mode === "eco") {
    return list.reduce((best, r) => {
      const rt = r.tollKr ?? 0;
      const bt = best.tollKr ?? 0;
      if (rt !== bt) return rt < bt ? r : best;
      return r.seconds < best.seconds ? r : best;
    });
  }
  return list.reduce((best, r) => (r.seconds < best.seconds ? r : best));
}

/** Fastest must be the lowest drive time among real candidates. */
export function pickFastestRoute<T extends DriveCandidate>(routes: T[]): T | null {
  return pickRouted("fastest", routes);
}

/** Prefer a quiet road under 2× Fastest. Never fall back to the motorway. */
export function pickEcoRoute<T extends DriveCandidate>(fast: T | null, cands: T[]): T | null {
  const cap = fast && fast.seconds > 0 ? fast.seconds * SLOW_TIME_FACTOR : Infinity;
  const quiet = cands.filter((r) => r.path.length >= 3 && r.miles > 0 && r.seconds > 0);
  const under = quiet.filter((r) => r.seconds <= cap);
  return pickRouted("eco", under.length ? under : quiet);
}

/** Skip gates/road fees only when the extra time stays within CHEAP_AVOID_FRAC of Fastest. */
export function pickCheapAvoidRoute<T extends DriveCandidate>(
  fast: T | null,
  cands: T[],
  avoid: CheapAvoid,
  frac = CHEAP_AVOID_FRAC,
): T | null {
  const a = { tolls: Boolean(avoid.tolls), roadFees: Boolean(avoid.roadFees) };
  if (!a.tolls && !a.roadFees) return fast ?? pickRouted("fastest", cands);
  const fee = (r: T) => avoidableFeeKr(r.path, r.miles, Boolean(r.hasToll), a);
  if (!fast || fast.seconds <= 0 || fast.path.length < 3) {
    const ok = cands.filter((r) => r.path.length >= 3 && r.miles > 0);
    return ok.sort((x, y) => fee(x) - fee(y) || x.seconds - y.seconds)[0] ?? null;
  }
  const cap = fast.seconds * (1 + frac);
  let best = fast;
  let bestFee = fee(fast);
  for (const r of cands) {
    if (r.path.length < 3 || r.seconds <= 0 || r.seconds > cap) continue;
    const f = fee(r);
    if (f < bestFee - 15 || (f <= bestFee && r.seconds + 60 < best.seconds)) {
      best = r;
      bestFee = f;
    }
  }
  return best;
}