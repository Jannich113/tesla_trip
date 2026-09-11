import type { LegMode } from "./modes";

export type DriveCandidate = {
  miles: number;
  seconds: number;
  path: [number, number][];
  source: string;
  tollKr?: number;
};

/** Eco may add at most this much vs the quickest road. */
export const ECO_EXTRA_SEC = 4 * 3600;

export function pickRouted<T extends DriveCandidate>(mode: LegMode, routes: T[]): T | null {
  const list = routes.filter((r) => r.path.length >= 3 && r.miles > 0);
  if (!list.length) return null;
  const quickest = list.reduce((best, r) => (r.seconds < best.seconds ? r : best));
  if (mode === "eco") {
    const cap = quickest.seconds + ECO_EXTRA_SEC;
    const pool = list.filter((r) => r.seconds <= cap);
    const use = pool.length ? pool : [quickest];
    return use.reduce((best, r) => {
      const rt = r.tollKr ?? 0;
      const bt = best.tollKr ?? 0;
      if (rt !== bt) return rt < bt ? r : best;
      return r.seconds < best.seconds ? r : best;
    });
  }
  return list.reduce((best, r) => (r.seconds < best.seconds ? r : best));
}
