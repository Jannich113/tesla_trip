export const LEG_MODES = ["eco", "fastest", "cheapest"] as const;
export type LegMode = (typeof LEG_MODES)[number];

export function normalizeMode(mode: string | null | undefined): LegMode {
  if (mode === "eco" || mode === "cheapest" || mode === "fastest") return mode;
  return "fastest";
}

export function stallKw(kind: "home" | "supercharger" | "custom", acKw: number) {
  if (kind === "home") return Math.max(1, acKw);
  if (kind === "supercharger") return 150;
  return 75;
}

export const DETOUR_KM = [8, 12, 18, 30] as const;
export type DetourKm = (typeof DETOUR_KM)[number];
export const DEFAULT_DETOUR_KM = 12;

export const WAIT_MIN = [0, 30, 60, 120, 240] as const;
export type WaitMin = (typeof WAIT_MIN)[number];
export const DEFAULT_WAIT_MIN = 120;

export type AutoCosting = {
  shortest: boolean;
  use_highways: number;
  use_tolls: number;
  use_ferry: number;
  use_tracks?: number;
  use_living_streets?: number;
  top_speed?: number;
};

export function modeLabel(mode: LegMode) {
  if (mode === "eco") return "Eco";
  if (mode === "cheapest") return "Cheapest";
  return "Fastest";
}

/** Do not redefine these.
 *  eco = 80–100 km/t roads; skip motorways and tolls. 50–60 km/t crawls are rejected.
 *  fastest = earliest arrival; motorways and tolls are fine
 *  cheapest = lowest charging cost; optional avoid motorways / toll gates / road fees
 */
export function modeHint(mode: LegMode) {
  if (mode === "eco") return "80–100 km/t roads. Skips motorways and tolls. A 50–60 km/t crawl is rejected.";
  if (mode === "cheapest") return "Lowest charging cost. Max 15 km extra per leg; extra miles are subtracted from the save.";
  return "Motorways and tolls for earliest arrival.";
}

export function modeColor(mode: LegMode) {
  if (mode === "eco") return "#1ecf8a";
  if (mode === "cheapest") return "#e6b84d";
  return "#6ea8ff";
}

export const MODE_FOCUSES = ["distance", "pris", "time"] as const;
export type ModeFocus = (typeof MODE_FOCUSES)[number];

export function defaultFocus(mode: LegMode): ModeFocus {
  if (mode === "cheapest") return "pris";
  if (mode === "fastest") return "time";
  return "distance";
}

export function normalizeFocus(focus: string | null | undefined, mode?: LegMode): ModeFocus {
  if (focus === "kwh") return "pris";
  if (focus === "distance" || focus === "pris" || focus === "time") return focus;
  return defaultFocus(mode ?? "fastest");
}

export const DEFAULT_MODE_FOCUS: Record<LegMode, ModeFocus> = {
  eco: "distance",
  fastest: "time",
  cheapest: "pris",
};

export type CheapAvoid = {
  motorways?: boolean;
  tolls?: boolean;
  roadFees?: boolean;
};

export function asCheapAvoid(raw: boolean | CheapAvoid | null | undefined): Required<CheapAvoid> {
  if (raw === true) return { motorways: true, tolls: true, roadFees: true };
  if (!raw) return { motorways: false, tolls: false, roadFees: false };
  return {
    motorways: Boolean(raw.motorways),
    tolls: Boolean(raw.tolls),
    roadFees: Boolean(raw.roadFees),
  };
}

/** No cheap-avoid flags — Eco/Fastest corridors and shared planArgs baseline. */
export const NO_CHEAP_AVOID: Required<CheapAvoid> = {
  motorways: false,
  tolls: false,
  roadFees: false,
};

/** Cheap avoid toggles apply only to Cheapest; Eco/Fastest always get none. */
export function avoidForMode(mode: LegMode, cheapAvoid: boolean | CheapAvoid = false): Required<CheapAvoid> {
  if (mode !== "cheapest") return { ...NO_CHEAP_AVOID };
  return asCheapAvoid(cheapAvoid);
}

/** Eco: own corridor. Cheapest: fastest unless Avoid motorways (eco) or avoid gates/fees (own no-toll try). */
export function pathMode(mode: LegMode, avoid: boolean | CheapAvoid = false): LegMode {
  if (mode === "eco") return "eco";
  if (mode === "cheapest") {
    const a = asCheapAvoid(avoid);
    if (a.motorways) return "eco";
    if (a.tolls || a.roadFees) return "cheapest";
  }
  return "fastest";
}

/** Extra drive time cheapest may spend vs Fastest to skip a gate or road fee. */
export const CHEAP_AVOID_FRAC = 0.15;
