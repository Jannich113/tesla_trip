import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { geo } from "@/lib/places";
import { primeRouteCache, canonRouteKey, type LegMode, type LegWhen, type PlanStop, type RoutedLeg } from "./engine";
import { DEFAULT_DETOUR_KM, DEFAULT_WAIT_MIN, kwhPerMiFrom100km, normalizeMode, type SpeedEff } from "./modes";
import { simplifyPath } from "./polyline";
import { cacheInvalidate } from "./cache";

export type WhenKind = "depart" | "arrive";

export type SavedPlan = {
  id: string;
  name: string;
  stops: PlanStop[];
  modes: LegMode[];
  cheapAvoidFees?: boolean;
  cheapAvoidMotorways?: boolean;
  cheapAvoidTolls?: boolean;
  cheapAvoidRoadFees?: boolean;
  detours: number[];
  waits: number[];
  whenKind: WhenKind;
  when: string;
  legWhen: LegWhen[];
  whPerMi: number | null;
  speedEff: SpeedEff | null;
  savedAt: string;
  startAt?: string;
  min?: number;
  kr?: number;
  mi?: number;
  routes?: Record<string, RoutedLeg>;
};

export type PlanSummary = {
  startAt?: string;
  min?: number;
  kr?: number;
  mi?: number;
};

function slimRoutes(routes: Record<string, RoutedLeg> | undefined) {
  if (!routes) return routes;
  const out: Record<string, RoutedLeg> = {};
  const entries = Object.entries(routes).filter(
    ([, route]) => Boolean(route?.path?.length && route.source !== "air" && route.path.length >= 3),
  );
  const corridors = entries.filter(([key]) => /\|(eco|fastest|cheapest)$/.test(canonRouteKey(key)));
  const rest = entries.filter(([key]) => !corridors.some(([k]) => k === key)).slice(-16);
  for (const [key, route] of [...corridors, ...rest]) {
    const slim = { ...route, path: simplifyPath(route.path, 48) };
    out[key] = slim;
    out[canonRouteKey(key)] = slim;
  }
  return out;
}

function homeStop(): PlanStop {
  const g = geo("Home") ?? { lat: 37.3852, lng: -122.1141, short: "Home" };
  return { id: "home", name: "Home", lat: g.lat, lng: g.lng };
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function autoWhen(): LegWhen {
  return { kind: "auto", hhmm: "" };
}

type PlanState = {
  name: string;
  stops: PlanStop[];
  modes: LegMode[];
  cheapAvoidMotorways: boolean;
  cheapAvoidTolls: boolean;
  cheapAvoidRoadFees: boolean;
  detours: number[];
  waits: number[];
  whenKind: WhenKind;
  when: string;
  legWhen: LegWhen[];
  whPerMi: number | null;
  speedEff: SpeedEff | null;
  networkAbo: Record<string, boolean>;
  routeCache: Record<string, RoutedLeg>;
  saved: SavedPlan[];
  seq: number;
};

type PlanStore = PlanState & {
  setName: (name: string) => void;
  addStop: (stop: Omit<PlanStop, "id"> & { id?: string }) => void;
  removeStop: (id: string) => void;
  moveStop: (id: string, dir: -1 | 1) => void;
  setLegMode: (index: number, mode: LegMode) => void;
  setAllModes: (mode: LegMode) => void;
  setCheapAvoid: (patch: { motorways?: boolean; tolls?: boolean; roadFees?: boolean }) => void;
  setLegDetour: (index: number, km: number) => void;
  setLegWait: (index: number, min: number) => void;
  setWhenKind: (kind: WhenKind) => void;
  setWhen: (hhmm: string) => void;
  setLegWhen: (index: number, next: LegWhen) => void;
  setWhPerMi: (n: number | null) => void;
  setSpeedEff: (next: SpeedEff | null) => void;
  setNetworkAbo: (id: string, on: boolean) => void;
  insertStopAt: (index: number, stop: Omit<PlanStop, "id"> & { id?: string }) => void;
  setRouteCache: (patch: Record<string, RoutedLeg>) => void;
  savePlan: (label?: string, summary?: PlanSummary) => SavedPlan | null;
  loadPlan: (id: string) => void;
  deleteSaved: (id: string) => void;
  reset: () => void;
};

function readDraft(): Partial<PlanState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem("juniper-planner-draft");
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { state?: PlanState };
    const s = parsed.state ?? (parsed as PlanState);
    if (!s || typeof s !== "object") return {};
    const routeCache = slimRoutes(s.routeCache) ?? {};
    primeRouteCache(routeCache);
    return {
      name: s.name,
      stops: Array.isArray(s.stops) && s.stops.length ? s.stops : undefined,
      modes: s.modes,
      cheapAvoidMotorways: s.cheapAvoidMotorways,
      cheapAvoidTolls: s.cheapAvoidTolls,
      cheapAvoidRoadFees: s.cheapAvoidRoadFees,
      detours: s.detours,
      waits: s.waits,
      whenKind: s.whenKind,
      when: s.when,
      legWhen: s.legWhen,
      whPerMi: s.whPerMi,
      speedEff: s.speedEff,
      networkAbo: s.networkAbo,
      routeCache,
      saved: s.saved,
      seq: s.seq,
    };
  } catch {
    return {};
  }
}

const empty = (): PlanState => ({
  name: "",
  stops: [homeStop()],
  modes: [],
  cheapAvoidMotorways: false,
  cheapAvoidTolls: false,
  cheapAvoidRoadFees: false,
  detours: [],
  waits: [],
  whenKind: "depart",
  when: "",
  legWhen: [],
  whPerMi: null,
  speedEff: null,
  networkAbo: { tesla: true },
  routeCache: {},
  saved: [],
  seq: 0,
});

const boot = (): PlanState => {
  const seed = readDraft();
  return { ...empty(), ...seed, stops: seed.stops?.length ? seed.stops : empty().stops };
};

export const usePlanStore = create<PlanStore>()(
  persist(
    (set, get) => ({
      ...boot(),

      setName: (name) => set({ name }),
      setWhenKind: (whenKind) => set({ whenKind }),
      setWhen: (when) => set({ when }),
      setWhPerMi: (whPerMi) => set({ whPerMi }),
      setSpeedEff: (speedEff) => set({ speedEff, whPerMi: speedEff ? kwhPerMiFrom100km(speedEff[80]) * 1000 : null }),
      setNetworkAbo: (id, on) =>
        set({ networkAbo: { ...get().networkAbo, [id]: on } }),

      setRouteCache: (patch) => {
        const clean: Record<string, RoutedLeg> = {};
        for (const [key, route] of Object.entries(patch)) {
          if (!route || route.source === "air" || (route.path?.length ?? 0) < 3) continue;
          clean[key] = route;
          clean[canonRouteKey(key)] = route;
        }
        if (!Object.keys(clean).length) return;
        const routeCache = { ...get().routeCache, ...clean };
        primeRouteCache(clean);
        set({ routeCache });
      },

      addStop: (input) => {
        const stop: PlanStop = {
          id: input.id ?? uid("s"),
          name: input.name,
          lat: input.lat,
          lng: input.lng,
        };
        set({
          stops: [...get().stops, stop],
          modes: [...get().modes, "fastest"],
          detours: [...get().detours, DEFAULT_DETOUR_KM],
          waits: [...get().waits, DEFAULT_WAIT_MIN],
          legWhen: [...get().legWhen, autoWhen()],
        });
      },

      insertStopAt: (index, input) => {
        const stop: PlanStop = {
          id: input.id ?? uid("s"),
          name: input.name,
          lat: input.lat,
          lng: input.lng,
        };
        const stops = [...get().stops];
        const modes = [...get().modes];
        const detours = [...get().detours];
        const waits = [...get().waits];
        const legWhen = [...get().legWhen];
        const at = Math.max(1, Math.min(index, stops.length));
        stops.splice(at, 0, stop);
        modes.splice(at - 1, 0, "fastest");
        detours.splice(at - 1, 0, DEFAULT_DETOUR_KM);
        waits.splice(at - 1, 0, DEFAULT_WAIT_MIN);
        legWhen.splice(at - 1, 0, autoWhen());
        set({ stops, modes, detours, waits, legWhen });
      },

      removeStop: (id) => {
        const idx = get().stops.findIndex((s) => s.id === id);
        if (idx < 0) return;
        const stops = get().stops.filter((s) => s.id !== id);
        const dropLeg = idx === 0 ? 0 : idx - 1;
        set({
          stops,
          modes: get().modes.filter((_, i) => i !== dropLeg),
          detours: get().detours.filter((_, i) => i !== dropLeg),
          waits: get().waits.filter((_, i) => i !== dropLeg),
          legWhen: get().legWhen.filter((_, i) => i !== dropLeg),
        });
      },

      moveStop: (id, dir) => {
        const stops = [...get().stops];
        const idx = stops.findIndex((s) => s.id === id);
        if (idx <= 0) return;
        const next = idx + dir;
        if (next <= 0 || next >= stops.length) return;
        const [moved] = stops.splice(idx, 1);
        stops.splice(next, 0, moved);
        const swap = <T,>(arr: T[]) => {
          const copy = [...arr];
          const a = idx - 1;
          const b = next - 1;
          if (a >= 0 && b >= 0 && a < copy.length && b < copy.length) {
            [copy[a], copy[b]] = [copy[b], copy[a]];
          }
          return copy;
        };
        set({
          stops,
          modes: swap(get().modes),
          detours: swap(get().detours),
          waits: swap(get().waits),
          legWhen: swap(get().legWhen),
        });
      },

      setLegMode: (index, mode) => {
        const modes = get().modes.length
          ? [...get().modes]
          : get().stops.slice(1).map(() => "fastest" as LegMode);
        modes[index] = normalizeMode(mode);
        set({ modes });
      },

      setAllModes: (mode) => {
        set({ modes: get().stops.slice(1).map(() => normalizeMode(mode)) });
      },

      setCheapAvoid: (patch) =>
        set({
          cheapAvoidMotorways: patch.motorways ?? get().cheapAvoidMotorways,
          cheapAvoidTolls: patch.tolls ?? get().cheapAvoidTolls,
          cheapAvoidRoadFees: patch.roadFees ?? get().cheapAvoidRoadFees,
        }),

      setLegDetour: (index, km) => {
        const detours = get().detours.length
          ? [...get().detours]
          : get().stops.slice(1).map(() => DEFAULT_DETOUR_KM);
        detours[index] = km;
        set({ detours });
      },

      setLegWait: (index, min) => {
        const waits = get().waits.length
          ? [...get().waits]
          : get().stops.slice(1).map(() => DEFAULT_WAIT_MIN);
        waits[index] = min;
        set({ waits });
      },

      setLegWhen: (index, next) => {
        const legWhen = get().legWhen.length
          ? [...get().legWhen]
          : get().stops.slice(1).map(() => autoWhen());
        legWhen[index] = next;
        set({ legWhen });
      },

      savePlan: (given, summary) => {
        const { name, stops, modes, cheapAvoidMotorways, cheapAvoidTolls, cheapAvoidRoadFees, detours, waits, whenKind, when, legWhen, whPerMi, speedEff, saved, seq } = get();
        if (stops.length < 2) return null;
        const label = (given ?? name).trim();
        if (!label) return null;
        const plan: SavedPlan = {
          id: `plan-${seq + 1}`,
          name: label,
          stops,
          modes,
          cheapAvoidMotorways,
          cheapAvoidTolls,
          cheapAvoidRoadFees,
          detours,
          waits,
          whenKind,
          when,
          legWhen,
          whPerMi,
          speedEff,
          savedAt: new Date().toISOString(),
          startAt: summary?.startAt || when || undefined,
          min: summary?.min,
          kr: summary?.kr,
          mi: summary?.mi,
          routes: get().routeCache,
        };
        set({
          seq: seq + 1,
          name: label,
          saved: [plan, ...saved.filter((p) => p.name !== label)],
        });
        return plan;
      },

      loadPlan: (id) => {
        const plan = get().saved.find((p) => p.id === id);
        if (!plan) return;
        set({
          name: plan.name,
          stops: plan.stops,
          modes: (plan.modes ?? []).map(normalizeMode),
          cheapAvoidMotorways: plan.cheapAvoidMotorways ?? Boolean(plan.cheapAvoidFees),
          cheapAvoidTolls: plan.cheapAvoidTolls ?? Boolean(plan.cheapAvoidFees),
          cheapAvoidRoadFees: plan.cheapAvoidRoadFees ?? Boolean(plan.cheapAvoidFees),
          detours: plan.detours,
          waits: plan.waits ?? plan.stops.slice(1).map(() => DEFAULT_WAIT_MIN),
          whenKind: plan.whenKind ?? "depart",
          when: plan.when ?? "",
          legWhen: plan.legWhen ?? plan.stops.slice(1).map(() => autoWhen()),
          whPerMi: plan.whPerMi ?? null,
          speedEff: plan.speedEff ?? null,
          routeCache: { ...get().routeCache, ...(plan.routes ?? {}) },
        });
        if (plan.routes) primeRouteCache(plan.routes);
      },

      deleteSaved: (id) => set({ saved: get().saved.filter((p) => p.id !== id) }),

      reset: () => {
        const saved = get().saved;
        const seq = get().seq;
        cacheInvalidate("chargers");
        set({ ...empty(), saved, seq });
      },
    }),
    {
      name: "juniper-planner-draft",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      migrate: (persisted, version) => {
        const p = persisted as SavedPlan & PlanState & { cheapAvoidFees?: boolean };
        if (version < 2) {
          const old = Boolean(p.cheapAvoidFees);
          p.cheapAvoidMotorways = p.cheapAvoidMotorways ?? old;
          p.cheapAvoidTolls = p.cheapAvoidTolls ?? old;
          p.cheapAvoidRoadFees = p.cheapAvoidRoadFees ?? old;
        }
        return p;
      },
      partialize: (s) => ({
        name: s.name,
        stops: s.stops,
        modes: s.modes,
        cheapAvoidMotorways: s.cheapAvoidMotorways,
        cheapAvoidTolls: s.cheapAvoidTolls,
        cheapAvoidRoadFees: s.cheapAvoidRoadFees,
        detours: s.detours,
        waits: s.waits,
        whenKind: s.whenKind,
        when: s.when,
        legWhen: s.legWhen,
        whPerMi: s.whPerMi,
        speedEff: s.speedEff,
        networkAbo: s.networkAbo,
        routeCache: slimRoutes(s.routeCache) ?? {},
        saved: s.saved.map((plan) => ({ ...plan, routes: slimRoutes(plan.routes) })),
        seq: s.seq,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.routeCache = slimRoutes(state.routeCache) ?? {};
        primeRouteCache(state.routeCache);
        for (const plan of state.saved ?? []) {
          if (plan.routes) {
            plan.routes = slimRoutes(plan.routes);
            if (plan.routes) primeRouteCache(plan.routes);
          }
        }
      },
    },
  ),
);

if (typeof window !== "undefined") {
  void usePlanStore.persist.rehydrate();
}
