import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { geo } from "@/lib/places";
import { type LegMode, type LegWhen, type PlanStop } from "./engine";
import { DEFAULT_DETOUR_KM, DEFAULT_WAIT_MIN, normalizeMode, type SpeedEff } from "./modes";

export type WhenKind = "depart" | "arrive";

export type SavedPlan = {
  id: string;
  name: string;
  stops: PlanStop[];
  modes: LegMode[];
  cheapAvoidFees?: boolean;
  detours: number[];
  waits: number[];
  whenKind: WhenKind;
  when: string;
  legWhen: LegWhen[];
  whPerMi: number | null;
  speedEff: SpeedEff | null;
  savedAt: string;
};

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
  cheapAvoidFees: boolean;
  detours: number[];
  waits: number[];
  whenKind: WhenKind;
  when: string;
  legWhen: LegWhen[];
  whPerMi: number | null;
  speedEff: SpeedEff | null;
  networkAbo: Record<string, boolean>;
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
  setCheapAvoidFees: (on: boolean) => void;
  setLegDetour: (index: number, km: number) => void;
  setLegWait: (index: number, min: number) => void;
  setWhenKind: (kind: WhenKind) => void;
  setWhen: (hhmm: string) => void;
  setLegWhen: (index: number, next: LegWhen) => void;
  setWhPerMi: (n: number | null) => void;
  setSpeedEff: (next: SpeedEff | null) => void;
  setNetworkAbo: (id: string, on: boolean) => void;
  insertStopAt: (index: number, stop: Omit<PlanStop, "id"> & { id?: string }) => void;
  savePlan: (label?: string) => SavedPlan | null;
  loadPlan: (id: string) => void;
  deleteSaved: (id: string) => void;
  reset: () => void;
};

const empty = (): PlanState => ({
  name: "",
  stops: [homeStop()],
  modes: [],
  cheapAvoidFees: false,
  detours: [],
  waits: [],
  whenKind: "depart",
  when: "",
  legWhen: [],
  whPerMi: null,
  speedEff: null,
  networkAbo: { tesla: true },
  saved: [],
  seq: 0,
});

export const usePlanStore = create<PlanStore>()(
  persist(
    (set, get) => ({
      ...empty(),

      setName: (name) => set({ name }),
      setWhenKind: (whenKind) => set({ whenKind }),
      setWhen: (when) => set({ when }),
      setWhPerMi: (whPerMi) => set({ whPerMi }),
      setSpeedEff: (speedEff) => set({ speedEff, whPerMi: speedEff ? speedEff[80] : null }),
      setNetworkAbo: (id, on) =>
        set({ networkAbo: { ...get().networkAbo, [id]: on } }),

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

      setCheapAvoidFees: (cheapAvoidFees) => set({ cheapAvoidFees }),

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

      savePlan: (given) => {
        const { name, stops, modes, cheapAvoidFees, detours, waits, whenKind, when, legWhen, whPerMi, speedEff, saved, seq } = get();
        if (stops.length < 2) return null;
        const label = (given ?? name).trim();
        if (!label) return null;
        const plan: SavedPlan = {
          id: `plan-${seq + 1}`,
          name: label,
          stops,
          modes,
          cheapAvoidFees,
          detours,
          waits,
          whenKind,
          when,
          legWhen,
          whPerMi,
          speedEff,
          savedAt: new Date().toISOString(),
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
          cheapAvoidFees: Boolean(plan.cheapAvoidFees),
          detours: plan.detours,
          waits: plan.waits ?? plan.stops.slice(1).map(() => DEFAULT_WAIT_MIN),
          whenKind: plan.whenKind ?? "depart",
          when: plan.when ?? "",
          legWhen: plan.legWhen ?? plan.stops.slice(1).map(() => autoWhen()),
          whPerMi: plan.whPerMi ?? null,
          speedEff: plan.speedEff ?? null,
        });
      },

      deleteSaved: (id) => set({ saved: get().saved.filter((p) => p.id !== id) }),

      reset: () => {
        const saved = get().saved;
        const seq = get().seq;
        set({ ...empty(), saved, seq });
      },
    }),
    {
      name: "juniper-planner-draft",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({
        name: s.name,
        stops: s.stops,
        modes: s.modes,
        cheapAvoidFees: s.cheapAvoidFees,
        detours: s.detours,
        waits: s.waits,
        whenKind: s.whenKind,
        when: s.when,
        legWhen: s.legWhen,
        whPerMi: s.whPerMi,
        speedEff: s.speedEff,
        networkAbo: s.networkAbo,
        saved: s.saved,
        seq: s.seq,
      }),
    },
  ),
);
