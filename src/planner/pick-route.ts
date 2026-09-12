import { SLOW_TIME_FACTOR, type LegMode } from "./modes.ts";

export type DriveCandidate = {
  miles: number;
  seconds: number;
  path: [number, number][];
  source: string;
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

/** Tesla/Google: skip motorways and tolls only when it stays under 2× Fastest. */
export function pickEcoRoute<T extends DriveCandidate>(fast: T | null, cands: T[]): T | null {
  const cap = fast && fast.seconds > 0 ? fast.seconds * SLOW_TIME_FACTOR : Infinity;
  const ok = cands.filter((r) => r.path.length >= 3 && r.miles > 0 && r.seconds > 0 && r.seconds <= cap);
  return pickRouted("eco", ok) ?? fast;
}