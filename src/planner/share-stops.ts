/**
 * The stops to send to Google or Apple Maps: the plan's own stops plus every charging stop,
 * in driving order. Points the planner only uses internally are left out: a split point
 * where nothing happens, ferry ports (the map app finds the ferry itself) and estimates
 * where no charger is known.
 */

type Point = { id: string; name: string; lat: number; lng: number };

export type ShareLeg = {
  from: Point;
  to: Point;
  accepted: boolean;
  charge: { locationId: string; name: string; placeholder?: boolean } | null;
};

export type ShareStop = { name: string; lat: number; lng: number; charge: boolean };

/** Google Maps directions links take at most this many stops between start and end. */
export const GOOGLE_MAX_WAYPOINTS = 9;

const internal = (id: string) => id.startsWith("via-") || id.startsWith("ferry-");

/** Two points closer than ~60 m are one stop (a charger at the stop the user typed). */
function same(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  return Math.abs(a.lat - b.lat) < 0.0006 && Math.abs(a.lng - b.lng) * Math.cos((a.lat * Math.PI) / 180) < 0.0006;
}

export function shareStops(
  legs: ShareLeg[],
  chargerAt: (locationId: string) => { lat: number; lng: number } | null | undefined,
): ShareStop[] {
  const out: ShareStop[] = [];
  const push = (s: ShareStop) => {
    const last = out[out.length - 1];
    if (last && same(last, s)) {
      // The user's stop is the charger: keep the stop's name, mark it as a charge.
      if (s.charge) last.charge = true;
      return;
    }
    out.push(s);
  };
  for (const [i, leg] of legs.entries()) {
    if (i === 0) push({ name: leg.from.name, lat: leg.from.lat, lng: leg.from.lng, charge: false });
    if (leg.accepted && leg.charge && !leg.charge.placeholder) {
      const at = chargerAt(leg.charge.locationId) ?? (leg.from.id.startsWith("via-") ? leg.from : null);
      if (at) push({ name: leg.charge.name, lat: at.lat, lng: at.lng, charge: true });
    }
    if (!internal(leg.to.id)) push({ name: leg.to.name, lat: leg.to.lat, lng: leg.to.lng, charge: false });
  }
  return out;
}

/**
 * Stops for a Google link: start, end and at most GOOGLE_MAX_WAYPOINTS between. The user's
 * own stops always stay; charging stops beyond the limit are dropped from the end.
 */
export function forGoogle(stops: ShareStop[]): { stops: ShareStop[]; dropped: number } {
  if (stops.length <= GOOGLE_MAX_WAYPOINTS + 2) return { stops, dropped: 0 };
  const middle = stops.slice(1, -1);
  const own = middle.filter((s) => !s.charge).length;
  let chargesLeft = Math.max(0, GOOGLE_MAX_WAYPOINTS - own);
  const kept = middle.filter((s) => !s.charge || chargesLeft-- > 0).slice(0, GOOGLE_MAX_WAYPOINTS);
  return { stops: [stops[0], ...kept, stops[stops.length - 1]], dropped: middle.length - kept.length };
}
