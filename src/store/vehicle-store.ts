import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { todayKey, type DriveMode, type Units, VEHICLE } from "@/lib/vehicle";
import {
  DEFAULT_MODEL_ID,
  type TeslaModelId,
  isPaintForModel,
  isTeslaModelId,
  modelById,
} from "@/lib/tesla-models";

export type VehicleSnapshot = {
  soc: number;
  odometerMi: number;
  tripAMi: number;
  tripAWh: number;
  tripBMi: number;
  tripBWh: number;
  milesToday: number;
  todayDate: string;
  locked: boolean;
  climateOn: boolean;
  climateSetF: number;
  cabinTempF: number;
  chargeLimit: number;
  pluggedIn: boolean;
  mode: DriveMode;
  chargeKw: number;
  speedMph: number;
  sentryOn: boolean;
  lastSync: number;
  waking: boolean;
  units: Units;
  locationLabel: string;
  tirePsi: [number, number, number, number];
  maskVin: boolean;
  shareLocation: boolean;
  modelId: TeslaModelId;
  paintId: string;
};

type VehicleStore = VehicleSnapshot & {
  tick: () => void;
  wake: () => Promise<void>;
  setMode: (mode: DriveMode) => void;
  toggleLock: () => void;
  toggleClimate: () => void;
  toggleSentry: () => void;
  setChargeLimit: (n: number) => void;
  setClimateTemp: (n: number) => void;
  setUnits: (u: Units) => void;
  setMaskVin: (on: boolean) => void;
  setShareLocation: (on: boolean) => void;
  resetTripA: () => void;
  resetTripB: () => void;
  clearOwnerData: () => void;
  setModelId: (id: TeslaModelId) => void;
  setPaintId: (id: string) => void;
};

const DEFAULTS: VehicleSnapshot = {
  soc: 68.4,
  odometerMi: 15247.4,
  tripAMi: 36.4,
  tripAWh: 8700,
  tripBMi: 1284.6,
  tripBWh: 318_000,
  milesToday: 16.0,
  todayDate: todayKey(),
  locked: true,
  climateOn: false,
  climateSetF: 70,
  cabinTempF: 74,
  chargeLimit: 80,
  pluggedIn: true,
  mode: "parked",
  chargeKw: 0,
  speedMph: 0,
  sentryOn: true,
  lastSync: 0,
  waking: false,
  units: "mi",
  locationLabel: VEHICLE.home.label,
  tirePsi: [42, 42, 41, 42],
  maskVin: false,
  shareLocation: true,
  modelId: DEFAULT_MODEL_ID,
  paintId: modelById(DEFAULT_MODEL_ID).defaultPaintId,
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

type ChargeBridge = {
  beginCharge: (soc: number) => void;
  endCharge: (soc: number, where?: string) => void;
  siteLabel: () => string;
};

let charges: ChargeBridge | null = null;

/** Bound from charge-store so the shell can load without trip history. */
export function bindChargeBridge(api: ChargeBridge) {
  charges = api;
}

function chargeSiteLabel() {
  return charges?.siteLabel() ?? VEHICLE.home.label;
}

function driveWhPerMi(speedMph: number, climateOn: boolean) {
  return 208 + speedMph * 0.92 + (climateOn ? 22 : 0);
}

function homeChargeKw(soc: number, limit: number) {
  if (soc >= limit) return 0;
  if (soc > limit - 2) return 4.2;
  return VEHICLE.acKw;
}

export const useVehicleStore = create<VehicleStore>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,

      tick: () => {
        const s = get();
        const dtHr = 1 / 3600;
        const day = todayKey();
        const milesToday = s.todayDate === day ? s.milesToday : 0;

        if (s.mode === "driving") {
          const t = Date.now();
          const speed = 36 + 20 * (0.5 + 0.5 * Math.sin(t / 9000));
          const whMi = driveWhPerMi(speed, s.climateOn);
          const miles = speed * dtHr;
          const kwh = (whMi * miles) / 1000;
          const nextSoc = clamp(s.soc - (kwh / VEHICLE.usableKwh) * 100, 1, 100);
          const cabin = s.climateOn
            ? s.cabinTempF + (s.climateSetF - s.cabinTempF) * 0.08
            : s.cabinTempF;
          const stop = nextSoc <= 5;
          set({
            soc: nextSoc,
            odometerMi: s.odometerMi + miles,
            tripAMi: s.tripAMi + miles,
            tripAWh: s.tripAWh + whMi * miles,
            tripBMi: s.tripBMi + miles,
            tripBWh: s.tripBWh + whMi * miles,
            milesToday: milesToday + miles,
            todayDate: day,
            speedMph: stop ? 0 : speed,
            mode: stop ? "parked" : "driving",
            pluggedIn: false,
            locked: stop ? true : false,
            locationLabel: stop ? VEHICLE.home.label : "On the road",
            cabinTempF: cabin,
            chargeKw: 0,
            lastSync: Date.now(),
          });
          return;
        }

        if (s.mode === "charging") {
          const kw = homeChargeKw(s.soc, s.chargeLimit);
          if (kw <= 0) {
            charges?.endCharge(s.soc, chargeSiteLabel());
            set({
              mode: "parked",
              chargeKw: 0,
              pluggedIn: true,
              speedMph: 0,
              locationLabel: VEHICLE.home.label,
              lastSync: Date.now(),
              todayDate: day,
              milesToday,
            });
            return;
          }
          const kwh = kw * dtHr;
          const nextSoc = clamp(s.soc + (kwh / VEHICLE.usableKwh) * 100, 0, s.chargeLimit);
          const done = nextSoc >= s.chargeLimit - 0.05;
          const soc = done ? s.chargeLimit : nextSoc;
          if (done) charges?.endCharge(soc, chargeSiteLabel());
          set({
            soc,
            chargeKw: done ? 0 : kw,
            mode: done ? "parked" : "charging",
            pluggedIn: true,
            speedMph: 0,
            locationLabel: chargeSiteLabel(),
            lastSync: Date.now(),
            todayDate: day,
            milesToday,
          });
          return;
        }
      },

      wake: async () => {
        set({ waking: true });
        await new Promise((r) => setTimeout(r, 900));
        const jitter = (Math.random() - 0.5) * 0.08;
        set({
          waking: false,
          soc: clamp(get().soc + jitter, 1, 100),
          lastSync: Date.now(),
        });
      },

      setMode: (mode) => {
        const cur = get();
        if (cur.mode === "charging" && mode !== "charging") {
          charges?.endCharge(cur.soc, chargeSiteLabel());
        }
        if (mode === "driving") {
          set({
            mode,
            locked: false,
            pluggedIn: false,
            climateOn: true,
            chargeKw: 0,
            locationLabel: "On the road",
            lastSync: Date.now(),
          });
          return;
        }
        if (mode === "charging") {
          const s = get();
          if (s.soc >= s.chargeLimit) {
            set({
              mode: "parked",
              pluggedIn: true,
              chargeKw: 0,
              speedMph: 0,
              locked: true,
              locationLabel: VEHICLE.home.label,
              lastSync: Date.now(),
            });
            return;
          }
          charges?.beginCharge(s.soc);
          const at = chargeSiteLabel();
          set({
            mode,
            pluggedIn: true,
            locked: true,
            speedMph: 0,
            climateOn: false,
            locationLabel: at,
            lastSync: Date.now(),
          });
          return;
        }
        set({
          mode: "parked",
          speedMph: 0,
          chargeKw: 0,
          locked: true,
          locationLabel: VEHICLE.home.label,
          lastSync: Date.now(),
        });
      },

      toggleLock: () => set({ locked: !get().locked, lastSync: Date.now() }),
      toggleClimate: () => set({ climateOn: !get().climateOn, lastSync: Date.now() }),
      toggleSentry: () => set({ sentryOn: !get().sentryOn, lastSync: Date.now() }),
      setChargeLimit: (n) => set({ chargeLimit: clamp(Math.round(n), 50, 100) }),
      setClimateTemp: (n) => set({ climateSetF: clamp(Math.round(n), 60, 82) }),
      setUnits: (u) => set({ units: u }),
      setMaskVin: (on) => set({ maskVin: on }),
      setShareLocation: (on) => set({ shareLocation: on }),
      setModelId: (id) => {
        const next = isTeslaModelId(id) ? id : DEFAULT_MODEL_ID;
        const profile = modelById(next);
        const paintId = isPaintForModel(profile, get().paintId)
          ? get().paintId
          : profile.defaultPaintId;
        set({
          modelId: next,
          paintId,
          locationLabel: profile.home.label,
          lastSync: Date.now(),
        });
      },
      setPaintId: (id) => {
        const profile = modelById(get().modelId);
        const paintId = isPaintForModel(profile, id) ? id : profile.defaultPaintId;
        set({ paintId, lastSync: Date.now() });
      },
      resetTripA: () => set({ tripAMi: 0, tripAWh: 0 }),
      resetTripB: () => set({ tripBMi: 0, tripBWh: 0 }),
      clearOwnerData: () =>
        set({
          ...DEFAULTS,
          units: get().units,
          maskVin: get().maskVin,
          shareLocation: get().shareLocation,
          modelId: get().modelId,
          paintId: get().paintId,
          lastSync: Date.now(),
        }),
    }),
    {
      name: "juniper-telemetry",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({
        soc: s.soc,
        odometerMi: s.odometerMi,
        tripAMi: s.tripAMi,
        tripAWh: s.tripAWh,
        tripBMi: s.tripBMi,
        tripBWh: s.tripBWh,
        milesToday: s.milesToday,
        todayDate: s.todayDate,
        locked: s.locked,
        climateOn: s.climateOn,
        climateSetF: s.climateSetF,
        cabinTempF: s.cabinTempF,
        chargeLimit: s.chargeLimit,
        pluggedIn: s.pluggedIn,
        mode: s.mode === "driving" ? "parked" : s.mode,
        sentryOn: s.sentryOn,
        units: s.units,
        locationLabel: s.mode === "driving" ? VEHICLE.home.label : s.locationLabel,
        tirePsi: s.tirePsi,
        maskVin: s.maskVin,
        shareLocation: s.shareLocation,
        modelId: s.modelId,
        paintId: s.paintId,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.lastSync = Date.now();
        state.waking = false;
        state.speedMph = 0;
        if (!state.modelId || !isTeslaModelId(state.modelId)) {
          state.modelId = DEFAULT_MODEL_ID;
        }
        const profile = modelById(state.modelId);
        if (!state.paintId || !isPaintForModel(profile, state.paintId)) {
          state.paintId = profile.defaultPaintId;
        }
        if (state.mode === "driving") {
          state.mode = "parked";
          state.locationLabel = modelById(state.modelId).home.label;
          state.locked = true;
        }
      },
    },
  ),
);
