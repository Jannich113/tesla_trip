import type { PricedCharge, PricedLeg } from "./engine.ts";
import type { FerryInfo } from "./ferries.ts";

/** Why a charge is in the plan. */
export type ChargeStatus =
  /** The battery would run too low without it. */
  | "required"
  /** Not needed, but cheap here; the user added it. */
  | "optional-added"
  /** Not needed, but cheap here; offered, not in the plan yet. */
  | "optional"
  /** In the plan because the user set a charge-to level. */
  | "planned";

export type ChainEntry =
  | { type: "stop"; name: string }
  | {
      type: "charge";
      name: string;
      status: ChargeStatus;
      kwh: number;
      kr: number;
      rateKr: number;
      network: string | null;
      /** No charger is known here; kWh and price are estimates. */
      placeholder: boolean;
      /** Charge level when leaving, shown only when it goes above the usual 80% (#69). */
      toSoc: number | null;
      /** The user leg this charge belongs to (for adding or removing an optional charge). */
      userIndex: number;
      lat: number | null;
      lng: number | null;
    }
  /** A ferry crossing (#71): no driving, check-in plus crossing time. */
  | { type: "ferry"; name: string; ferry: FerryInfo }
  /** The route goes through a charger without charging. Should not happen; shown so it is visible if it does. */
  | { type: "pass"; name: string };

const isVia = (id: string) => id.startsWith("via-");

function statusOf(leg: PricedLeg): ChargeStatus | null {
  if (!leg.charge) return null;
  if (leg.accepted) {
    if (leg.needed || leg.advice === "required") return "required";
    if (leg.suggested) return "optional-added";
    return "planned";
  }
  return leg.suggested ? "optional" : null;
}

/**
 * The picked mode as a list: stops, then each charge with why it is there, its network,
 * and its price. `networkOf` names the charge's network ("Tesla ad-hoc", "Clever"…).
 */
export function chargeChain(legs: PricedLeg[], networkOf: (charge: PricedCharge) => string | null): ChainEntry[] {
  if (!legs.length) return [];
  const out: ChainEntry[] = [{ type: "stop", name: legs[0].from.name }];
  for (const [i, leg] of legs.entries()) {
    if (leg.ferry) {
      out.push({ type: "ferry", name: `${leg.from.name} – ${leg.to.name}`, ferry: leg.ferry });
      out.push({ type: "stop", name: leg.to.name });
      continue;
    }
    const status = statusOf(leg);
    // An offered charge at the very charger where the next leg charges anyway is noise.
    const next = legs[i + 1];
    const repeatsNext =
      status === "optional" && next?.accepted && next.charge?.locationId === leg.charge?.locationId;
    if (status && leg.charge && !repeatsNext) {
      const c = leg.charge;
      const atVia = isVia(leg.from.id);
      const entry: ChainEntry = {
        type: "charge",
        name: c.placeholder ? "No known charger" : c.name || leg.from.name,
        status,
        kwh: c.kwh,
        kr: c.kr,
        rateKr: c.rateKr,
        network: c.placeholder ? null : networkOf(c),
        placeholder: Boolean(c.placeholder),
        toSoc: leg.startSoc > 80.5 ? Math.round(leg.startSoc) : null,
        userIndex: leg.userIndex,
        lat: atVia ? leg.from.lat : null,
        lng: atVia ? leg.from.lng : null,
      };
      const last = out[out.length - 1];
      // A via was pushed as "pass" when its leg arrived; the charge on the next leg is what happens there.
      if (atVia && last?.type === "pass") out[out.length - 1] = entry;
      else out.push(entry);
    }
    out.push(isVia(leg.to.id) ? { type: "pass", name: leg.to.name } : { type: "stop", name: leg.to.name });
  }
  return out;
}
