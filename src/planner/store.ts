import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useTripStore } from "@/store/trip-store";
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

export type OptionSnap = {
  mi: number;
  kr: number;
  driveMin: number;
  charges: number;
  tollKr: number;
  kmh: number;
};

export type LastOptions = {
  key: string;
  rows: Partial<Record<LegMode, OptionSnap>>;
};

export type PlanSummary = {
  startAt?: string;
  min?: number;
  kr?: number;
  mi?: number;
};

function slimRoutes(routes: Record<string, RoutedLeg> | undefined) {
  if (!routes) return routes;
  const byMode = new Map<string, { key: string; route: RoutedLeg; miles: number }[]>();
  for (const [key, route] of Object.entries(routes)) {
    if (!route?.path?.length || route.source === "air" || route.path.length < 3) continue;
    const canon = canonRouteKey(key);
    const mode = canon.split("|")[2] ?? "";
    if (mode !== "eco" && mode !== "fastest" && mode !== "cheapest") continue;
    const list = byMode.get(mode) ?? [];
    list.push({ key: canon, route, miles: route.miles });
    byMode.set(mode, list);
  }
  const out: Record<string, RoutedLeg> = {};
  for (const list of byMode.values()) {
    list.sort((a, b) => b.miles - a.miles);
    for (const row of list.slice(0, 2)) {
      out[row.key] = { ...row.route, path: simplifyPath(row.route.path, 40) };
    }
  }
  return out;
}

function safeStorage(): {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { name: string; value: string } | null = null;
  const write = (name: string, value: string) => {
    if (typeof localStorage === "undefined") return;
    let payload = value;
    try {
      const parsed = JSON.parse(value) as { state?: PlanState; version?: number };
      if (parsed.state && deferRoutes && emptyRoutes(parsed.state.routeCache)) {
        const prev = localStorage.getItem(name);
        if (prev) {
          const old = JSON.parse(prev) as { state?: PlanState };
          const kept = old.state?.routeCache;
          if (kept && Object.keys(kept).length) {
            parsed.state.routeCache = kept;
            if (Array.isArray(parsed.state.saved) && Array.isArray(old.state?.saved)) {
              const byId = new Map(old.state.saved.map((plan) => [plan.id, plan.routes]));
              parsed.state.saved = parsed.state.saved.map((plan) =>
                plan.routes ? plan : { ...plan, routes: byId.get(plan.id) },
              );
            }
            payload = JSON.stringify(parsed);
          }
        }
      }
      if (parsed.state) {
        localStorage.setItem(SHELL_KEY, JSON.stringify({ v: 3, state: toShell(parsed.state) }));
      }
    } catch {
      /* shell is best-effort; the draft write below still runs */
    }
    try {
      localStorage.setItem(name, payload);
    } catch {
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("juniper-cache:")) localStorage.removeItem(k);
        }
        localStorage.setItem(name, payload);
      } catch {
        try {
          const parsed = JSON.parse(payload) as { state?: { saved?: unknown[]; routeCache?: unknown } };
          if (parsed.state) {
            parsed.state.saved = [];
            parsed.state.routeCache = {};
            localStorage.setItem(name, JSON.stringify(parsed));
          }
        } catch {
          try {
            localStorage.removeItem(name);
          } catch {
            /* ignore */
          }
        }
      }
    }
  };
  return {
    getItem: (name) => {
      if (typeof localStorage === "undefined") return null;
      try {
        return localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        const job = pending;
        pending = null;
        if (job) write(job.name, job.value);
      }, 450);
    },
    removeItem: (name) => {
      if (typeof localStorage === "undefined") return;
      try {
        localStorage.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}

function lonelyHome(stops?: PlanStop[] | null) {
  return !!stops && stops.length === 1 && (stops[0].id === "home" || stops[0].name === "Home");
}

const SHELL_KEY = "juniper-planner-shell";
const DRAFT_KEY = "juniper-planner-draft";

/** Route geometry stays off the first paint. Preserves corridors if a shell write lands first. */
let deferRoutes = true;
let shellApplied = false;
let appliedStopIds = "";
let routeStash: Record<string, RoutedLeg> | undefined;
let savedRouteStash: Map<string, Record<string, RoutedLeg> | undefined> | undefined;
/** loadPlan before first shell paint — re-applied after applyDraftShell. */
let pendingLoadId: string | null = null;

function emptyRoutes(routes?: Record<string, RoutedLeg> | null) {
  return !routes || !Object.keys(routes).length;
}

function withoutLonelyHome<T extends Partial<PlanState>>(s: T): T {
  if (!lonelyHome(s.stops)) return s;
  return {
    ...s,
    stops: [] as PlanStop[],
    modes: [] as LegMode[],
    detours: [] as number[],
    waits: [] as number[],
    legWhen: [] as LegWhen[],
    lastOptions: null,
    routeCache: {},
    name: !s.name || s.name === "Home" ? "" : s.name,
  };
}

function migrateDraft(persisted: Partial<PlanState> & { cheapAvoidFees?: boolean }, version: number) {
  const p = persisted;
  if (version < 2) {
    const old = Boolean(p.cheapAvoidFees);
    p.cheapAvoidMotorways = p.cheapAvoidMotorways ?? old;
    p.cheapAvoidTolls = p.cheapAvoidTolls ?? old;
    p.cheapAvoidRoadFees = p.cheapAvoidRoadFees ?? old;
  }
  if (version < 3 && lonelyHome(p.stops)) {
    p.stops = [];
    p.modes = [];
    p.detours = [];
    p.waits = [];
    p.legWhen = [];
    p.lastOptions = null;
    p.routeCache = {};
    if (!p.name || p.name === "Home") p.name = "";
  }
  return withoutLonelyHome(p);
}

function toShell(s: Partial<PlanState>): Partial<PlanState> {
  const cleaned = withoutLonelyHome(s);
  const saved = Array.isArray(cleaned.saved)
    ? cleaned.saved.slice(-8).map((plan) => {
        const { routes: _routes, ...rest } = plan;
        return rest;
      })
    : [];
  return {
    name: cleaned.name ?? "",
    stops: Array.isArray(cleaned.stops) ? cleaned.stops : [],
    modes: cleaned.modes ?? [],
    cheapAvoidMotorways: Boolean(cleaned.cheapAvoidMotorways),
    cheapAvoidTolls: Boolean(cleaned.cheapAvoidTolls),
    cheapAvoidRoadFees: Boolean(cleaned.cheapAvoidRoadFees),
    detours: cleaned.detours ?? [],
    waits: cleaned.waits ?? [],
    whenKind: cleaned.whenKind ?? "depart",
    when: cleaned.when ?? "",
    legWhen: cleaned.legWhen ?? [],
    whPerMi: cleaned.whPerMi ?? null,
    speedEff: cleaned.speedEff ?? null,
    networkAbo: cleaned.networkAbo ?? { tesla: true },
    preferredNetwork:
      typeof cleaned.preferredNetwork === "string" || cleaned.preferredNetwork === null
        ? cleaned.preferredNetwork
        : null,
    lastOptions: cleaned.lastOptions ?? null,
    saved,
    seq: cleaned.seq ?? 0,
  };
}

function rememberRoutes(s: Partial<PlanState> | undefined) {
  if (!s) return;
  if (!routeStash && s.routeCache && Object.keys(s.routeCache).length) routeStash = s.routeCache;
  if (!savedRouteStash && Array.isArray(s.saved)) {
    savedRouteStash = new Map(s.saved.map((plan) => [plan.id, plan.routes]));
  }
}

function readFullDraft(): Partial<PlanState> | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(DRAFT_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { state?: Partial<PlanState> & { cheapAvoidFees?: boolean }; version?: number };
  const version = typeof parsed.version === "number" ? parsed.version : 0;
  const state = parsed.state ?? (parsed as Partial<PlanState> & { cheapAvoidFees?: boolean });
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return migrateDraft(state, version);
}

function loadShell(): Partial<PlanState> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(SHELL_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { v?: number; state?: Partial<PlanState> };
      if (parsed?.v === 3 && parsed.state && typeof parsed.state === "object") {
        return toShell(parsed.state);
      }
    }
  } catch {
    /* fall through to the full draft */
  }
  try {
    const full = readFullDraft();
    if (!full) return null;
    rememberRoutes(full);
    const shell = toShell(full);
    try {
      localStorage.setItem(SHELL_KEY, JSON.stringify({ v: 3, state: shell }));
    } catch {
      /* ignore */
    }
    return shell;
  } catch {
    return null;
  }
}

/** Stops, modes, avoid toggles, and last option snapshots. No route geometry. */
export function applyDraftShell() {
  if (shellApplied || typeof window === "undefined") return;
  shellApplied = true;
  const shell = loadShell();
  if (shell) {
    appliedStopIds = (shell.stops ?? []).map((s) => s.id).join("|");
    const cur = usePlanStore.getState();
    usePlanStore.setState({ ...shell, routeCache: cur.routeCache });
  }
  if (pendingLoadId) {
    const id = pendingLoadId;
    pendingLoadId = null;
    usePlanStore.getState().loadPlan(id);
  }
}

/** Slim and prime stored corridors after the shell has painted. */
export function paintDraftRoutes() {
  if (!deferRoutes || typeof window === "undefined") return;
  deferRoutes = false;
  if (!routeStash && !savedRouteStash) {
    try {
      rememberRoutes(readFullDraft() ?? undefined);
    } catch {
      /* ignore */
    }
  }
  const slim = slimRoutes(routeStash) ?? {};
  routeStash = undefined;
  primeRouteCache(slim);
  const cur = usePlanStore.getState();
  const saved = cur.saved.map((plan) => {
    const raw = savedRouteStash?.get(plan.id);
    if (!raw) return plan;
    const routes = slimRoutes(raw);
    if (routes) primeRouteCache(routes);
    return { ...plan, routes };
  });
  savedRouteStash = undefined;
  const curIds = cur.stops.map((s) => s.id).join("|");
  const fromSaved = saved.find((plan) => plan.stops.map((s) => s.id).join("|") === curIds)?.routes;
  const routeCache =
    curIds === appliedStopIds
      ? { ...slim, ...(fromSaved ?? {}), ...cur.routeCache }
      : { ...(fromSaved ?? {}), ...cur.routeCache };
  usePlanStore.setState({ routeCache, saved });
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
  /** Bias Eco/Fastest/Cheapest toward this network when close enough. */
  preferredNetwork: string | null;
  routeCache: Record<string, RoutedLeg>;
  lastOptions: LastOptions | null;
  saved: SavedPlan[];
  seq: number;
};

type PlanStore = PlanState & {
  setName: (name: string) => void;
  addStop: (stop: Omit<PlanStop, "id"> & { id?: string }) => void;
  replaceStop: (id: string, next: Pick<PlanStop, "name" | "lat" | "lng">) => void;
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
  setPreferredNetwork: (id: string | null) => void;
  insertStopAt: (index: number, stop: Omit<PlanStop, "id"> & { id?: string }) => void;
  setRouteCache: (patch: Record<string, RoutedLeg>) => void;
  setLastOptions: (next: LastOptions | null) => void;
  savePlan: (label?: string, summary?: PlanSummary) => SavedPlan | null;
  loadPlan: (id: string) => void;
  deleteSaved: (id: string) => void;
  reset: () => void;
};

const empty = (): PlanState => ({
  name: "",
  stops: [],
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
  preferredNetwork: null,
  routeCache: {},
  lastOptions: null,
  saved: [],
  seq: 0,
});

const boot = (): PlanState => empty();

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
      setPreferredNetwork: (preferredNetwork) => set({ preferredNetwork }),

      setLastOptions: (lastOptions) => set({ lastOptions }),

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

      replaceStop: (id, next) => {
        const stops = get().stops.map((s) =>
          s.id === id ? { ...s, name: next.name, lat: next.lat, lng: next.lng } : s,
        );
        set({ stops });
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
          // Caller passes leave→arrive once (planTripMin). Keep finite non-negative.
          min: summary?.min != null && Number.isFinite(summary.min) ? Math.max(0, summary.min) : undefined,
          kr: summary?.kr != null && Number.isFinite(summary.kr) ? summary.kr : undefined,
          mi: summary?.mi != null && Number.isFinite(summary.mi) ? summary.mi : undefined,
          routes: get().routeCache,
        };
        set({
          seq: seq + 1,
          name: label,
          saved: [plan, ...saved.filter((p) => p.name !== label)],
        });
        // Mirror into Trips as planned (not driven) so it shows under Trips.
        useTripStore.getState().addPlanned({
          id: plan.id,
          name: plan.name,
          from: stops[0]?.name ?? "",
          to: stops[stops.length - 1]?.name ?? "",
          stopCount: stops.length,
          startAt: plan.startAt,
          min: plan.min,
          mi: plan.mi,
          kr: plan.kr,
          savedAt: plan.savedAt,
        });
        return plan;
      },

      loadPlan: (id) => {
        if (!shellApplied) pendingLoadId = id;
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

      deleteSaved: (id) => {
        set({ saved: get().saved.filter((p) => p.id !== id) });
        useTripStore.getState().removePlanned(id);
      },

      reset: () => {
        const saved = get().saved;
        const seq = get().seq;
        deferRoutes = false;
        routeStash = undefined;
        savedRouteStash = undefined;
        cacheInvalidate("chargers");
        set({ ...empty(), saved, seq });
      },
    }),
    {
      name: "juniper-planner-draft",
      version: 3,
      storage: createJSONStorage(() => safeStorage()),
      skipHydration: true,
      migrate: (persisted, version) => migrateDraft(persisted as PlanState & { cheapAvoidFees?: boolean }, version),
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
        preferredNetwork: s.preferredNetwork,
        routeCache: slimRoutes(s.routeCache) ?? {},
        lastOptions: s.lastOptions,
        saved: s.saved.slice(-8).map((plan) => ({
          ...plan,
          routes: slimRoutes(plan.routes),
        })),
        seq: s.seq,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (lonelyHome(state.stops)) {
          state.stops = [];
          state.modes = [];
          state.detours = [];
          state.waits = [];
          state.legWhen = [];
          state.lastOptions = null;
          state.routeCache = {};
          if (!state.name || state.name === "Home") state.name = "";
        }
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

