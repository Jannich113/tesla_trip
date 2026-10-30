import type { ChargeLocation } from "@/lib/charge-locations";
import type { LegMode, RoutedLeg } from "./engine";
import { minDistToPathM, spreadAlongPath, spreadBuckets } from "./insert";
import { pathLengthKm } from "./polyline";

/**
 * Which chargers the planner gets to choose from. Kept out of plan-screen.tsx so the
 * selection can be unit-tested and replayed against real routes.
 */

export function locationsForRoutes(
  all: ChargeLocation[],
  routes: RoutedLeg[],
  maxM = 22_000,
  preferredNetwork?: string | null,
) {
  const paths = routes.map((r) => r.path).filter((p) => p.length >= 2);
  if (!paths.length) return all.filter((l) => l.kind === "home");
  const near = new Map<string, ChargeLocation>();
  for (const l of all) {
    if (l.kind === "home") {
      near.set(l.id, l);
      continue;
    }
    const id = l.networkId || (l.kind === "supercharger" ? "tesla" : null);
    const limit = preferredNetwork && id === preferredNetwork ? Math.max(maxM, 45_000) : maxM;
    if (paths.some((p) => minDistToPathM(l.lat, l.lng, p) < limit)) near.set(l.id, l);
  }
  return [...near.values()];
}

/** Deduped corridors for charger search. Caller chooses which path modes. */
export function collectSearchRoutes(modes: LegMode[], routesFor: (mode: LegMode) => RoutedLeg[]): RoutedLeg[] {
  const all: RoutedLeg[] = [];
  const seen = new Set<string>();
  for (const mode of modes) {
    for (const r of routesFor(mode)) {
      const a = r.path[0];
      const b = r.path.at(-1);
      if (!a || !b) continue;
      const k = `${mode}-${a.join()}-${b.join()}-${r.miles.toFixed(0)}-${r.source}`;
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(r);
    }
  }
  return all;
}

/** Build the stall pool along the given corridors only (Eco/Fastest stay put when Cheapest avoid toggles). */
export function buildPlanLocations(
  live: boolean,
  locationsStored: ChargeLocation[],
  routeChargers: ChargeLocation[],
  searchRoutes: RoutedLeg[],
  preferredNetwork?: string | null,
): ChargeLocation[] {
  if (!live) return locationsStored.filter((l) => l.kind === "home").slice(0, 4);
  const paths = searchRoutes.map((r) => r.path).filter((p) => p.length >= 2);
  const europe = paths.some((p) => p.some(([lat, lng]) => lat > 34 && lng > -12 && lng < 42));
  const keep = locationsStored.filter((l) => {
    if (europe && l.preset && l.lng < -20) return false;
    if (l.kind === "home" || !l.preset) return true;
    return paths.some((p) => minDistToPathM(l.lat, l.lng, p) < 80_000);
  });
  const byId = new Map(keep.map((l) => [l.id, l]));
  for (const c of routeChargers) byId.set(c.id, c);
  const all = [...byId.values()];
  if (!paths.length) return all;
  const picked = new Map<string, ChargeLocation>();
  for (const p of paths) {
    for (const l of spreadAlongPath(all, p, spreadBuckets(pathLengthKm(p)), 55_000)) picked.set(l.id, l);
    const ranked = all
      .map((l) => ({ l, d: minDistToPathM(l.lat, l.lng, p) }))
      .filter((s) => s.d < 50_000)
      .sort((a, b) => a.l.usdPerKwh - b.l.usdPerKwh)
      .slice(0, 12);
    for (const s of ranked) picked.set(s.l.id, s.l);
    if (preferredNetwork) {
      for (const l of all) {
        const id = l.networkId || (l.kind === "supercharger" ? "tesla" : null);
        if (id !== preferredNetwork) continue;
        if (minDistToPathM(l.lat, l.lng, p) < 45_000) picked.set(l.id, l);
      }
    }
  }
  return [...picked.values()];
}
