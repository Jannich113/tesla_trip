import { CHEAP_AVOID_FRAC, ecoPaceOk, ecoPaceScore, SLOW_TIME_FACTOR, type CheapAvoid, type LegMode } from "./modes.ts";
import { avoidableFeeKr, estimateTolls } from "./tolls.ts";

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

/** Prefer 80–100 km/t roads. A 50–60 km/t crawl is never eco — fall back to Fastest. */
export function pickEcoRoute<T extends DriveCandidate>(fast: T | null, cands: T[]): T | null {
  const ok = (r: T | null): r is T => Boolean(r && r.path.length >= 3 && r.miles > 0 && r.seconds > 0);
  const all = [fast, ...cands].filter(ok);
  if (!all.length) return null;
  const paced = all.filter((r) => ecoPaceOk(r.miles, r.seconds));
  const pool = paced.length ? paced : fast && ok(fast) ? [fast] : [all.reduce((b, r) =>
    ecoPaceScore(r.miles, r.seconds) < ecoPaceScore(b.miles, b.seconds) ? r : b,
  )];
  const cap = fast && fast.seconds > 0 ? fast.seconds * SLOW_TIME_FACTOR : Infinity;
  const under = pool.filter((r) => r.seconds <= cap);
  const use = under.length ? under : pool;
  return use.reduce((best, r) => {
    const bs = ecoPaceScore(best.miles, best.seconds);
    const rs = ecoPaceScore(r.miles, r.seconds);
    if (Math.abs(rs - bs) > 3) return rs < bs ? r : best;
    const bt = best.tollKr ?? 0;
    const rt = r.tollKr ?? 0;
    if (rt !== bt) return rt < bt ? r : best;
    return r.seconds < best.seconds ? r : best;
  });
}

/**
 * Cheapest-only: skip gates/road fees when extra time stays within CHEAP_AVOID_FRAC of Fastest.
 * Eco uses pickEcoRoute; Fastest uses pickFastestRoute — never pass cheapAvoid into those.
 */
export function pickCheapAvoidRoute<T extends DriveCandidate>(
  fast: T | null,
  cands: T[],
  avoid: CheapAvoid,
  frac = CHEAP_AVOID_FRAC,
): T | null {
  const a = { tolls: Boolean(avoid.tolls), roadFees: Boolean(avoid.roadFees) };
  if (!a.tolls && !a.roadFees) return fast ?? pickRouted("fastest", cands);
  const fee = (r: T) => avoidableFeeKr(r.path, r.miles, Boolean(r.hasToll), a);
  const bill = (r: T) => estimateTolls(r.path, r.miles, Boolean(r.hasToll), "fastest").kr;
  if (!fast || fast.seconds <= 0 || fast.path.length < 3) {
    const ok = cands.filter((r) => r.path.length >= 3 && r.miles > 0);
    return ok.sort((x, y) => fee(x) - fee(y) || x.seconds - y.seconds)[0] ?? null;
  }
  const cap = fast.seconds * (1 + frac);
  const fastBill = bill(fast);
  let best = fast;
  let bestFee = fee(fast);
  for (const r of cands) {
    if (r.path.length < 3 || r.seconds <= 0 || r.seconds > cap) continue;
    if (r.seconds + 30 < fast.seconds) continue;
    if (bill(r) > fastBill + 1) continue;
    const f = fee(r);
    if (f < bestFee - 15) {
      best = r;
      bestFee = f;
    }
  }
  return best;
}
