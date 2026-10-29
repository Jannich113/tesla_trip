import type { PricedCharge, PricedLeg } from "./engine.ts";

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
      /** The user leg this charge belongs to (for adding or removing an optional charge). */
      userIndex: number;
      lat: number | null;
      lng: number | null;
    }
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
  for (const leg of legs) {
    const status = statusOf(leg);
    if (status && leg.charge) {
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
