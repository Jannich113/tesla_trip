import type { LegMode } from "./modes";

export type DriveCandidate = {
  miles: number;
  seconds: number;
  path: [number, number][];
  source: string;
  tollKr?: number;
};

const TIME_CAP: Record<string, number> = { eco: 1.45, cheapest: 1.15, fastest: 1.08 };

/** Never pick a 34 h goat path just because it has no tolls. */
export function pickRouted<T extends DriveCandidate>(mode: LegMode, routes: T[]): T | null {
  const list = routes.filter((r) => r.path.length >= 3 && r.miles > 0);
  if (!list.length) return null;
  const quickest = list.reduce((best, r) => (r.seconds < best.seconds ? r : best));
  const cap = quickest.seconds * (TIME_CAP[mode] ?? 1.2);
  const pool = list.filter((r) => r.seconds <= cap);
  const use = pool.length ? pool : [quickest];
  if (mode === "eco") {
    const valhalla = use.find((r) => r.source === "valhalla");
    if (valhalla) return valhalla;
    return use.reduce((best, r) => {
      const rt = r.tollKr ?? 0;
      const bt = best.tollKr ?? 0;
      if (rt !== bt) return rt < bt ? r : best;
      return r.seconds < best.seconds ? r : best;
    });
  }
  return use.reduce((best, r) => (r.seconds < best.seconds ? r : best));
}
