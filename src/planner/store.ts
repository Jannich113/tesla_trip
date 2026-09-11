import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { geo } from "@/lib/places";
import { type LegMode, type PlanStop } from "./engine";

export type SavedPlan = {
  id: string;
  name: string;
  stops: PlanStop[];
  modes: LegMode[];
  detours: number[];
  savedAt: string;
};

function homeStop(): PlanStop {
  const g = geo("Home") ?? { lat: 37.3852, lng: -122.1141, short: "Home" };
  return { id: "home", name: "Home", lat: g.lat, lng: g.lng };
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

type PlanState = {
  name: string;
  stops: PlanStop[];
  modes: LegMode[];
  detours: number[];
  saved: SavedPlan[];
  seq: number;
};

type PlanStore = PlanState & {
  setName: (name: string) => void;
  addStop: (stop: Omit<PlanStop, "id"> & { id?: string }) => void;
  removeStop: (id: string) => void;
  moveStop: (id: string, dir: -1 | 1) => void;
  setLegMode: (index: number, mode: LegMode) => void;
  setLegDetour: (index: number, km: number) => void;
  insertStopAt: (index: number, stop: Omit<PlanStop, "id"> & { id?: string }) => void;
  savePlan: () => SavedPlan | null;
  loadPlan: (id: string) => void;
  deleteSaved: (id: string) => void;
  reset: () => void;
};

const empty = (): PlanState => ({
  name: "",
  stops: [homeStop()],
  modes: [],
  detours: [],
  saved: [],
  seq: 0,
});

export const usePlanStore = create<PlanStore>()(
  persist(
    (set, get) => ({
      ...empty(),

      setName: (name) => set({ name }),

      addStop: (input) => {
        const stop: PlanStop = {
          id: input.id ?? uid("s"),
          name: input.name,
          lat: input.lat,
          lng: input.lng,
        };
        set({
          stops: [...get().stops, stop],
          modes: [...get().modes, "standard"],
          detours: [...get().detours, 10],
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
        const at = Math.max(1, Math.min(index, stops.length));
        stops.splice(at, 0, stop);
        modes.splice(at - 1, 0, "standard");
        detours.splice(at - 1, 0, 10);
        set({ stops, modes, detours });
      },

      removeStop: (id) => {
        const idx = get().stops.findIndex((s) => s.id === id);
        if (idx <= 0) return;
        set({
          stops: get().stops.filter((s) => s.id !== id),
          modes: get().modes.filter((_, i) => i !== idx - 1),
          detours: get().detours.filter((_, i) => i !== idx - 1),
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
        const modes = [...get().modes];
        const detours = [...get().detours];
        const a = idx - 1;
        const b = next - 1;
        if (a >= 0 && b >= 0 && a < modes.length && b < modes.length) {
          [modes[a], modes[b]] = [modes[b], modes[a]];
          [detours[a], detours[b]] = [detours[b], detours[a]];
        }
        set({ stops, modes, detours });
      },

      setLegMode: (index, mode) => {
        const modes = get().modes.length
          ? [...get().modes]
          : get().stops.slice(1).map(() => "standard" as LegMode);
        modes[index] = mode;
        set({ modes });
      },

      setLegDetour: (index, km) => {
        const detours = get().detours.length
          ? [...get().detours]
          : get().stops.slice(1).map(() => 10);
        detours[index] = km;
        set({ detours });
      },

      savePlan: () => {
        const { name, stops, modes, detours, saved, seq } = get();
        if (stops.length < 2) return null;
        const label = name.trim() || stops.map((s) => s.name).join(" → ");
        const plan: SavedPlan = {
          id: `plan-${seq + 1}`,
          name: label,
          stops,
          modes,
          detours,
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
          modes: plan.modes,
          detours: plan.detours,
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
        detours: s.detours,
        saved: s.saved,
        seq: s.seq,
      }),
    },
  ),
);
