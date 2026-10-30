import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { TeslaModelId } from "@/lib/tesla-models";
import { SPEED_KMH, type SpeedEff } from "./modes";

/**
 * Car settings for planning: which version of the model, its charging speeds, the battery
 * limits the planner keeps to, and how the car is driven. Figures are typical published
 * values (EPA range, usable pack, peak DC), not measured per car; every one can be overridden.
 */

export type CarVariant = {
  id: string;
  label: string;
  usableKwh: number;
  epaRangeMi: number;
  /** Peak DC charging power. */
  peakDcKw: number;
  /** On-board AC charger. */
  acKw: number;
  /** The version the model profile describes; picked until the user chooses. */
  default?: boolean;
};

const v = (
  id: string,
  label: string,
  usableKwh: number,
  epaRangeMi: number,
  peakDcKw: number,
  isDefault = false,
): CarVariant => ({ id, label, usableKwh, epaRangeMi, peakDcKw, acKw: 11, ...(isDefault ? { default: true } : {}) });

export const CAR_VARIANTS: Record<TeslaModelId, CarVariant[]> = {
  juniper: [v("rwd", "RWD", 60, 320, 175), v("lr", "Long Range", 75, 327, 250, true), v("perf", "Performance", 75, 306, 250)],
  highland: [v("rwd", "RWD", 57.5, 272, 170), v("lr", "Long Range", 60, 341, 175, true), v("perf", "Performance", 75, 296, 250)],
  "model-y": [v("rwd", "RWD", 57.5, 260, 170), v("lr", "Long Range", 75, 320, 250, true), v("perf", "Performance", 75, 279, 250)],
  "model-3": [v("sr", "Standard Range", 50, 263, 170), v("lr", "Long Range", 60, 341, 175, true), v("perf", "Performance", 75, 315, 250)],
  "model-s": [v("lr", "Long Range", 95, 402, 250), v("plaid", "Plaid", 95, 359, 250, true)],
  "model-x": [v("lr", "Long Range", 95, 335, 250, true), v("plaid", "Plaid", 95, 326, 250)],
  cybertruck: [v("awd", "AWD", 123, 340, 325, true), v("beast", "Cyberbeast", 123, 301, 325)],
};

export function variantFor(modelId: TeslaModelId, variantId: string | null | undefined): CarVariant {
  const list = CAR_VARIANTS[modelId] ?? CAR_VARIANTS.juniper;
  return list.find((x) => x.id === variantId) ?? list.find((x) => x.default) ?? list[0];
}

/**
 * Average power over a 10–80% session is well below the car's peak: the curve tapers from
 * about 50%. 0.6 of peak matches what a 250 kW car averages on a V3 Supercharger (~150 kW).
 */
export const SESSION_SHARE_OF_PEAK = 0.6;

export function sessionDcKw(peakDcKw: number) {
  return Math.round(Math.max(20, peakDcKw) * SESSION_SHARE_OF_PEAK);
}

export type DriveStyle = "calm" | "normal" | "brisk";
export const DRIVE_STYLES: DriveStyle[] = ["calm", "normal", "brisk"];
export const DRIVE_STYLE_FACTOR: Record<DriveStyle, number> = { calm: 0.93, normal: 1, brisk: 1.1 };

export type Condition = "winter" | "roofBox" | "trailer" | "fullCar";
export const CONDITIONS: { id: Condition; label: string }[] = [
  { id: "winter", label: "Winter" },
  { id: "roofBox", label: "Roof box" },
  { id: "trailer", label: "Trailer" },
  { id: "fullCar", label: "Full car" },
];
/** Extra energy per km, as typical rules of thumb: cold battery and heating, drag, weight. */
export const CONDITION_FACTOR: Record<Condition, number> = { winter: 1.2, roofBox: 1.12, trailer: 1.35, fullCar: 1.04 };

export function drivingFactor(style: DriveStyle, conditions: Partial<Record<Condition, boolean>>) {
  let f = DRIVE_STYLE_FACTOR[style] ?? 1;
  for (const c of CONDITIONS) if (conditions[c.id]) f *= CONDITION_FACTOR[c.id];
  return f;
}

export function scaleSpeedEff(eff: SpeedEff, factor: number): SpeedEff {
  if (factor === 1) return eff;
  const out = { ...eff };
  for (const kmh of SPEED_KMH) out[kmh] = Math.round(eff[kmh] * factor * 10) / 10;
  return out;
}

export type BatteryLimits = {
  /** Never plan to arrive at a charger below this. */
  floorSoc: number;
  /** Charge to this, unless a long gap needs more. */
  targetSoc: number;
  /** Arrive at the last stop with at least this. */
  destSoc: number;
};

export const DEFAULT_LIMITS: BatteryLimits = { floorSoc: 10, targetSoc: 80, destSoc: 20 };

/** Keep the three limits sane together: floor 5–30, target 50–100, destination floor–90. */
export function clampLimits(l: Partial<BatteryLimits>): BatteryLimits {
  const floorSoc = Math.round(Math.min(30, Math.max(5, l.floorSoc ?? DEFAULT_LIMITS.floorSoc)));
  const targetSoc = Math.round(Math.min(100, Math.max(50, l.targetSoc ?? DEFAULT_LIMITS.targetSoc)));
  const destSoc = Math.round(Math.min(90, Math.max(floorSoc, l.destSoc ?? DEFAULT_LIMITS.destSoc)));
  return { floorSoc, targetSoc, destSoc };
}

export const DEFAULT_START_SOC = 80;

type CarSettingsState = {
  variantId: string | null;
  peakDcKw: number | null;
  acKw: number | null;
  startSoc: number;
  limits: BatteryLimits;
  style: DriveStyle;
  conditions: Partial<Record<Condition, boolean>>;
  setVariant: (id: string) => void;
  setPeakDcKw: (kw: number | null) => void;
  setAcKw: (kw: number | null) => void;
  setStartSoc: (soc: number) => void;
  setLimits: (patch: Partial<BatteryLimits>) => void;
  setStyle: (style: DriveStyle) => void;
  toggleCondition: (c: Condition) => void;
};

function safeStorage() {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Storage blocked: settings live for this visit only.
  }
  const mem = new Map<string, string>();
  return {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, val: string) => void mem.set(k, val),
    removeItem: (k: string) => void mem.delete(k),
  };
}

export const useCarSettings = create<CarSettingsState>()(
  persist(
    (set, get) => ({
      variantId: null,
      peakDcKw: null,
      acKw: null,
      startSoc: DEFAULT_START_SOC,
      limits: DEFAULT_LIMITS,
      style: "normal",
      conditions: {},
      // A new version brings its own figures; overrides were for the old one.
      setVariant: (id) => set({ variantId: id, peakDcKw: null, acKw: null }),
      setPeakDcKw: (peakDcKw) => set({ peakDcKw }),
      setAcKw: (acKw) => set({ acKw }),
      setStartSoc: (soc) => set({ startSoc: Math.round(Math.min(100, Math.max(5, soc))) }),
      setLimits: (patch) => set({ limits: clampLimits({ ...get().limits, ...patch }) }),
      setStyle: (style) => set({ style }),
      toggleCondition: (c) => set({ conditions: { ...get().conditions, [c]: !get().conditions[c] } }),
    }),
    {
      name: "tesla-trip-car",
      version: 1,
      storage: createJSONStorage(() => safeStorage()),
      partialize: (s) => ({
        variantId: s.variantId,
        peakDcKw: s.peakDcKw,
        acKw: s.acKw,
        startSoc: s.startSoc,
        limits: s.limits,
        style: s.style,
        conditions: s.conditions,
      }),
    },
  ),
);
