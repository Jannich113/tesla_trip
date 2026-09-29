import { haversineM } from "./insert.ts";
import { chargeSearchKm, stallKw, type LegMode } from "./modes.ts";
import { networkById, rateForNetwork } from "./networks.ts";

export type ChargerPoint = {
  id: string;
  lat: number;
  lng: number;
  kind?: string;
};

/** Meters. Same band as charge search: detour for eco/fastest, cheap-stall cap for cheapest. */
export function chargePickRadiusM(mode: LegMode, detourKm: number) {
  return chargeSearchKm(mode, detourKm) * 1000;
}

/** Stalls inside a circle around the stop. Home connectors are not route chargers. */
export function chargersWithinRadius<T extends ChargerPoint>(
  locations: T[],
  origin: { lat: number; lng: number },
  radiusM: number,
) {
  const seen = new Set<string>();
  const out: { loc: T; distM: number }[] = [];
  for (const loc of locations) {
    if (loc.kind === "home") continue;
    if (!loc.id || seen.has(loc.id)) continue;
    const distM = haversineM(origin, loc);
    if (distM > radiusM) continue;
    seen.add(loc.id);
    out.push({ loc, distM });
  }
  out.sort((a, b) => a.distM - b.distM || a.loc.id.localeCompare(b.loc.id));
  return out;
}

export type ChargerMark = {
  network: string;
  short: string;
  kw: number;
  /** kr/kWh when the network or stall rate is known. */
  priceKr: number | null;
};

export function chargerMark(
  loc: { kind?: string; networkId?: string | null; usdPerKwh?: number },
  memberships: Record<string, boolean>,
  acKw: number,
): ChargerMark {
  const kind = loc.kind === "home" || loc.kind === "supercharger" || loc.kind === "custom" ? loc.kind : "custom";
  const netId = loc.networkId || (kind === "supercharger" ? "tesla" : null);
  const network = netId ? (networkById(netId)?.name ?? netId) : "DC";
  const short = network.split(/\s+/)[0] || network;
  const kw = stallKw(kind, acKw);
  const rate = netId ? rateForNetwork(netId, Boolean(memberships[netId])) : null;
  const usd = loc.usdPerKwh ?? 0;
  // Matches planner DKK_PER_USD. Kept local so this module stays importable from node:test.
  const priceKr = rate != null ? rate : usd > 0 ? usd * 6.85 : null;
  return { network, short, kw, priceKr };
}
