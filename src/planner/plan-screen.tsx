import { useEffect, useMemo, useState, useDeferredValue, useRef, lazy, Suspense, memo, startTransition } from "react";
import { ChevronDown, ChevronUp, Navigation, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { MapMarker, MapRoute } from "@/components/bay-map";
import { searchAddress, type AddressHit } from "./search";
import {
  DETOUR_KM,
  WAIT_MIN,
  DEFAULT_DETOUR_KM,
  DEFAULT_WAIT_MIN,
  LEG_MODES,
  type LegMode,
  type LegWhen,
  type PlanStop,
  type PricedCharge,
  type PricedLeg,
  type RoutedLeg,
  addMinutesDateTime,
  applyLiveRoutes,
  asDateTime,
  chargeSearchKm,
  DKK_PER_USD,
  dkNowDateTime,
  detourSavings,
  epaWhPerMi,
  fetchRoute,
  corridorKey,
  lookupCachedRoute,
  formatDateTime,
  formatDetour,
  formatWaitCap,
  interpolateWhPerMi,
  normalizeSpeedEff,
  avgSpeedKmh,
  minutesBetweenDateTime,
  minutesToHm,
  modeColor,
  modeHint,
  modeLabel,
  pathMode,
  avoidForMode,
  NO_CHEAP_AVOID,
  planTotals,
  pricePlan,
  remainingHours,
  routeAb,
  timePenalized,
  SPEED_KMH,
  splitDateTime,
} from "./engine";
import { usePlanStore, type OptionSnap } from "./store";
import { withRetry } from "./retry";
import { formatKrPerKwh, formatKrValue, type HourPrice } from "@/lib/elpris";
import { applyTillægToHours, providerById } from "@/lib/el-providers";
import { PLACES } from "@/lib/places";
import { cn } from "@/lib/utils";
import { formatDistance, formatEfficiency, formatNumber, type Units } from "@/lib/vehicle";
import { HOME_USD_PER_KWH } from "@/lib/history";
import { type ChargeLocation } from "@/lib/charge-locations";
import { useChargeStore } from "@/store/charge-store";
import { useElprisStore } from "@/store/elpris-store";
import { NETWORK_NATIVE, scaleCatalogKr, type FxTable } from "./charge-fx";
import { countryProfile } from "./country-profiles";
import { minDistToPathM, spreadAlongPath } from "./insert";
import { simplifyPath } from "./polyline";
import { useRouteChargers } from "./use-route-chargers";
import { useChargePrices } from "./use-charge-prices";
import { useLiveElpris } from "./use-live-elpris";
import { EU_BLOCS, EU_NETWORKS, EU_REGIONS, type EuRegion, regionalExtra, regionalOwn, regionalRoam, roamExtra, roamRate } from "./networks";
import { useVehicleProfile } from "@/hooks/use-vehicle-profile";
import { useVehicleStore } from "@/store/vehicle-store";

function offsetPath(path: [number, number][], meters: number): [number, number][] {
  if (path.length < 2 || meters === 0) return path;
  const deg = meters / 111_320;
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const dLat = b[0] - a[0];
    const dLng = b[1] - a[1];
    const len = Math.hypot(dLat, dLng) || 1;
    return [p[0] + (-dLng / len) * deg, p[1] + (dLat / len) * deg];
  });
}

const ROUTE_OFFSET_M: Record<LegMode, number> = {
  eco: -280,
  fastest: 0,
  cheapest: 280,
};

const CHARGE_OFFSET: Record<LegMode, [number, number]> = {
  eco: [-0.0016, -0.0009],
  fastest: [0, 0],
  cheapest: [0.0016, 0.0009],
};

function WhenFields({
  kind,
  at,
  onKind,
  onAt,
  allowAuto,
}: {
  kind: "auto" | "depart" | "arrive";
  at: string;
  onKind: (k: "auto" | "depart" | "arrive") => void;
  onAt: (dt: string) => void;
  allowAuto?: boolean;
}) {
  const day = at.slice(0, 10);
  const hm = at.slice(11, 16);
  const keys = allowAuto ? (["auto", "depart", "arrive"] as const) : (["depart"] as const);
  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex rounded-full bg-surface-2 p-0.5">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onKind(k)}
            className={cn(
              "h-8 flex-1 rounded-full text-[11px] font-medium",
              kind === k ? "bg-foreground text-background" : "text-muted",
            )}
          >
            {k === "auto" ? "Auto" : k === "depart" ? "Leave" : "Arrive"}
          </button>
        ))}
      </div>
      {kind !== "auto" ? (
        <div className="grid grid-cols-2 gap-1.5">
          <input
            type="date"
            value={day}
            onChange={(e) => onAt(`${e.target.value}T${hm || "00:00"}`)}
            className="h-9 rounded-xl bg-surface-2 px-2 text-xs tabular-nums text-foreground outline-none"
          />
          <input
            type="time"
            value={hm}
            onChange={(e) => onAt(`${day || "2026-01-01"}T${e.target.value}`)}
            className="h-9 rounded-xl bg-surface-2 px-2 text-xs tabular-nums text-foreground outline-none"
          />
        </div>
      ) : null}
    </div>
  );
}

function CheapAvoidToggles({ className }: { className?: string }) {
  const motorways = usePlanStore((s) => s.cheapAvoidMotorways);
  const tolls = usePlanStore((s) => s.cheapAvoidTolls);
  const roadFees = usePlanStore((s) => s.cheapAvoidRoadFees);
  const setCheapAvoid = usePlanStore((s) => s.setCheapAvoid);
  const rows = [
    { on: motorways, label: "Avoid motorways", set: (v: boolean) => setCheapAvoid({ motorways: v }) },
    { on: tolls, label: "Avoid toll gates", set: (v: boolean) => setCheapAvoid({ tolls: v }) },
    { on: roadFees, label: "Avoid road fees", set: (v: boolean) => setCheapAvoid({ roadFees: v }) },
  ] as const;
  return (
    <div className={cn("space-y-2", className)}>
      {rows.map((row) => (
        <label key={row.label} className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={row.on}
            onChange={(e) => row.set(e.target.checked)}
            className="size-4 accent-foreground"
          />
          {row.label}
        </label>
      ))}
    </div>
  );
}

function locationsForRoutes(all: ChargeLocation[], routes: RoutedLeg[], maxM = 22_000) {
  const paths = routes.map((r) => r.path).filter((p) => p.length >= 2);
  if (!paths.length) return all.filter((l) => l.kind === "home");
  const near = new Map<string, ChargeLocation>();
  for (const l of all) {
    if (l.kind === "home") {
      near.set(l.id, l);
      continue;
    }
    if (paths.some((p) => minDistToPathM(l.lat, l.lng, p) < maxM)) near.set(l.id, l);
  }
  return [...near.values()];
}

/** Deduped corridors for charger search. Caller chooses which path modes. */
function collectSearchRoutes(modes: LegMode[], routesFor: (mode: LegMode) => RoutedLeg[]): RoutedLeg[] {
  const all: RoutedLeg[] = [];
  const seen = new Set<string>();
  for (const mode of modes) {
    for (const r of routesFor(mode)) {
      const a = r.path[0];
      const b = r.path.at(-1);
      if (!a || !b) continue;
      const k = `${mode}-${a.join()}-${b.join()}-${r.miles.toFixed(0)}-${r.source}`;
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(r);
    }
  }
  return all;
}

/** Build the stall pool along the given corridors only (Eco/Fastest stay put when Cheapest avoid toggles). */
function buildPlanLocations(
  live: boolean,
  locationsStored: ChargeLocation[],
  routeChargers: ChargeLocation[],
  searchRoutes: RoutedLeg[],
): ChargeLocation[] {
  if (!live) return locationsStored.filter((l) => l.kind === "home").slice(0, 4);
  const paths = searchRoutes.map((r) => r.path).filter((p) => p.length >= 2);
  const europe = paths.some((p) => p.some(([lat, lng]) => lat > 34 && lng > -12 && lng < 42));
  const keep = locationsStored.filter((l) => {
    if (europe && l.preset && l.lng < -20) return false;
    if (l.kind === "home" || !l.preset) return true;
    return paths.some((p) => minDistToPathM(l.lat, l.lng, p) < 80_000);
  });
  const byId = new Map(keep.map((l) => [l.id, l]));
  for (const c of routeChargers) byId.set(c.id, c);
  const all = [...byId.values()];
  if (!paths.length) return all;
  const picked = new Map<string, ChargeLocation>();
  for (const p of paths) {
    for (const l of spreadAlongPath(all, p, 28, 55_000)) picked.set(l.id, l);
    const ranked = all
      .map((l) => ({ l, d: minDistToPathM(l.lat, l.lng, p) }))
      .filter((s) => s.d < 50_000)
      .sort((a, b) => a.l.usdPerKwh - b.l.usdPerKwh)
      .slice(0, 12);
    for (const s of ranked) picked.set(s.l.id, s.l);
  }
  return [...picked.values()];
}

function routeKey(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: LegMode,
) {
  return corridorKey(from, to, mode);
}

function stopsKey(stops: { name: string; lat: number; lng: number }[]) {
  return stops.map((s) => `${s.name}:${s.lat.toFixed(2)},${s.lng.toFixed(2)}`).join("|");
}

function snapTotals(snap: OptionSnap) {
  return {
    mi: snap.mi,
    kwh: 0,
    kr: snap.kr,
    tollKr: snap.tollKr,
    min: snap.driveMin,
    driveMin: snap.driveMin,
    chargeMin: 0,
    waitMin: 0,
    chargeKwh: 0,
    requiredKwh: 0,
    charges: snap.charges,
  };
}

function sameLastOptions(
  prev: { key: string; rows: Partial<Record<LegMode, OptionSnap>> } | null,
  next: { key: string; rows: Partial<Record<LegMode, OptionSnap>> },
) {
  if (!prev || prev.key !== next.key) return false;
  for (const mode of LEG_MODES) {
    const a = prev.rows[mode];
    const b = next.rows[mode];
    if (!a && !b) continue;
    if (!a || !b) return false;
    if (a.mi !== b.mi || a.kr !== b.kr || a.driveMin !== b.driveMin || a.charges !== b.charges || a.tollKr !== b.tollKr) {
      return false;
    }
  }
  return true;
}

function modeStopChain(legs: PricedLeg[]) {
  if (!legs.length) return [] as { name: string; via: boolean }[];
  const out = [{ name: legs[0].from.name, via: false }];
  for (const leg of legs) out.push({ name: leg.to.name, via: Boolean(leg.via) });
  return out;
}

function modeStopSummary(legs: PricedLeg[]) {
  const chain = modeStopChain(legs);
  if (!chain.length) return "";
  const start = chain[0]?.name;
  const end = chain.at(-1)?.name;
  const vias = chain.filter((s) => s.via).length;
  if (chain.length <= 2) return chain.map((s) => s.name).join(" → ");
  if (vias) return `${start} → ${vias} via → ${end}`;
  return `${start} → ${chain.length - 2} stops → ${end}`;
}

type OptionRowView = {
  mode: LegMode;
  totals: ReturnType<typeof snapTotals> | null;
  kmh: number;
  kwhPerMi: number;
  legs: PricedLeg[];
};

const OptionList = memo(function OptionList({
  rows,
  mixed,
  active,
  routing,
  units,
  cheapAvoid,
  onPick,
}: {
  rows: OptionRowView[];
  mixed: boolean;
  active: LegMode;
  routing: boolean;
  units: Units;
  cheapAvoid: { motorways: boolean; tolls: boolean; roadFees: boolean };
  onPick: (mode: LegMode) => void;
}) {
  const fastest = rows.find((r) => r.mode === "fastest")?.totals;
  return (
    <ul className="mt-2 divide-y divide-border rounded-xl bg-surface-2">
      {rows.map((row) => {
        const on = !mixed && active === row.mode;
        const t = row.totals;
        const save = t && fastest && row.mode !== "fastest" ? detourSavings(fastest, t) : null;
        const slow = Boolean(t && fastest && row.mode === "eco" && timePenalized(fastest.driveMin, t.driveMin));
        const chain = modeStopChain(row.legs);
        const open = on && chain.length > 0;
        return (
          <li key={row.mode}>
            <div className={cn("px-3 py-3", on && "bg-background/40")}>
              <button
                type="button"
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  onPick(row.mode);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  onPick(row.mode);
                }}
                className="flex w-full items-start gap-3 text-left"
              >
                <span
                  className="mt-1.5 size-2.5 shrink-0 rounded-full"
                  style={{ background: modeColor(row.mode) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">{modeLabel(row.mode)}</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-sm tabular-nums">{t ? `${formatKrValue(t.kr, 0)} kr` : "—"}</span>
                      {chain.length ? (
                        <ChevronDown className={cn("size-4 text-muted transition", open && "rotate-180")} />
                      ) : null}
                    </span>
                  </span>
                  {t ? (
                    <>
                      <span className="mt-0.5 block text-xs text-muted">
                        {formatDistance(t.mi, units, t.mi >= 100 ? 0 : 1)}
                        <span className="text-subtle"> · </span>
                        {minutesToHm(t.driveMin)} drive
                        <span className="text-subtle"> · </span>
                        avg {formatNumber(row.kmh, 0)} km/t
                        {slow ? " · 2× slower" : ""}
                        {row.mode === "cheapest"
                          ? (() => {
                              const bits = [
                                cheapAvoid.motorways && "no motorways",
                                cheapAvoid.tolls && t.tollKr < 1 && "no toll gates",
                                cheapAvoid.roadFees && "no road fees",
                              ].filter(Boolean);
                              return bits.length ? ` · ${bits.join(" · ")}` : " · cheapest stalls";
                            })()
                          : ""}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted">
                        {t.charges > 0
                          ? `${t.charges} ${t.charges === 1 ? "charge" : "charges"} · ${formatKrValue(Math.max(0, t.kr - t.tollKr), 0)} kr`
                          : "no charge"}
                        {t.tollKr >= 1 ? ` · toll ${formatKrValue(t.tollKr, 0)} kr` : " · no toll"}
                        {save && save.significant
                          ? ` · saves ${formatKrValue(save.net, 0)} kr${save.extraMin >= 1 ? ` for +${minutesToHm(save.extraMin)}` : ""}`
                          : save && save.net <= -1
                            ? ` · ${formatKrValue(-save.net, 0)} kr more`
                            : ""}
                        {row.mode === "cheapest" || t.waitMin > 0
                          ? ` · ${t.waitMin > 0 ? minutesToHm(t.waitMin) : "no"} wait`
                          : ""}
                      </span>
                      {!open && chain.length ? (
                        <span className="mt-1 block truncate text-xs text-subtle">{modeStopSummary(row.legs)}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="mt-0.5 block text-xs text-subtle">{routing ? "Routing…" : "Add a stop"}</span>
                  )}
                </span>
              </button>
              {open ? (
                <ol className="mt-2 space-y-1 pl-5">
                  {chain.map((s, i) => (
                    <li key={`${row.mode}-${i}`} className="flex items-center gap-2 text-xs text-muted">
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-background text-[10px] tabular-nums">
                        {i + 1}
                      </span>
                      <span className="truncate">
                        {s.via ? (
                          <span className="mr-1 text-[10px] font-medium uppercase tracking-wide text-amber-300">
                            via
                          </span>
                        ) : null}
                        {s.name}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {row.mode === "cheapest" ? <CheapAvoidToggles className="mt-2 pl-5" /> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
});

const BayMap = lazy(() => import("@/components/bay-map").then((m) => ({ default: m.BayMap })));

export function PlanScreen() {
  const units = useVehicleStore((s) => s.units);
  const vehicleSoc = useVehicleStore((s) => Math.round(s.soc));
  const [socOverride, setSocOverride] = useState<number | null>(null);
  const soc = socOverride ?? vehicleSoc;
  const shareLocation = useVehicleStore((s) => s.shareLocation);
  const { profile } = useVehicleProfile();
  const locationsStored = useChargeStore((s) => s.locations);
  const area = useElprisStore((s) => s.area);
  const providerId = useElprisStore((s) => s.providerId);
  const provider = useMemo(() => providerById(providerId), [providerId]);

  const name = usePlanStore((s) => s.name);
  const stops = usePlanStore((s) => s.stops);
  const modes = usePlanStore((s) => s.modes);
  const detours = usePlanStore((s) => s.detours);
  const waits = usePlanStore((s) => s.waits);
  const saved = usePlanStore((s) => s.saved);
  const setName = usePlanStore((s) => s.setName);
  const addStopToStore = usePlanStore((s) => s.addStop);
  const insertStopAt = usePlanStore((s) => s.insertStopAt);
  const removeStop = usePlanStore((s) => s.removeStop);
  const moveStop = usePlanStore((s) => s.moveStop);
  const setLegMode = usePlanStore((s) => s.setLegMode);
  const setLegDetour = usePlanStore((s) => s.setLegDetour);
  const setLegWait = usePlanStore((s) => s.setLegWait);
  const setAllModes = usePlanStore((s) => s.setAllModes);
  const cheapAvoidMotorways = usePlanStore((s) => s.cheapAvoidMotorways);
  const cheapAvoidTolls = usePlanStore((s) => s.cheapAvoidTolls);
  const cheapAvoidRoadFees = usePlanStore((s) => s.cheapAvoidRoadFees);
  const cheapAvoid = useMemo(
    () => ({ motorways: cheapAvoidMotorways, tolls: cheapAvoidTolls, roadFees: cheapAvoidRoadFees }),
    [cheapAvoidMotorways, cheapAvoidTolls, cheapAvoidRoadFees],
  );
  const pathModes = useMemo<LegMode[]>(() => ["eco", "fastest", "cheapest"], []);
  const whenKind = usePlanStore((s) => s.whenKind);
  const when = usePlanStore((s) => s.when);
  const legWhen = usePlanStore((s) => s.legWhen);
  const whPerMiOverride = usePlanStore((s) => s.whPerMi);
  const speedEffOverride = usePlanStore((s) => s.speedEff);
  const setWhenKind = usePlanStore((s) => s.setWhenKind);
  const setWhen = usePlanStore((s) => s.setWhen);
  const setLegWhen = usePlanStore((s) => s.setLegWhen);
  const setSpeedEff = usePlanStore((s) => s.setSpeedEff);
  const networkAbo = usePlanStore((s) => s.networkAbo);
  const setNetworkAbo = usePlanStore((s) => s.setNetworkAbo);
  const savePlan = usePlanStore((s) => s.savePlan);
  const loadPlan = usePlanStore((s) => s.loadPlan);
  const deleteSaved = usePlanStore((s) => s.deleteSaved);
  const reset = usePlanStore((s) => s.reset);
  const routeMap = usePlanStore((s) => s.routeCache);
  const setRouteCache = usePlanStore((s) => s.setRouteCache);
  const lastOptions = usePlanStore((s) => s.lastOptions);
  const setLastOptions = usePlanStore((s) => s.setLastOptions);

  const [live, setLive] = useState(false);
  const [routing, setRouting] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [addKind, setAddKind] = useState<"auto" | "depart" | "arrive">("depart");
  const [addAt, setAddAt] = useState("");
  const [editWhen, setEditWhen] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [prefer, setPrefer] = useState<Record<number, string>>({});
  const [acceptCharge, setAcceptCharge] = useState<Record<number, boolean>>({});
  const [chargeToSoc, setChargeToSoc] = useState<Record<number, number>>({});
  const [backupLoc, setBackupLoc] = useState<Record<number, string>>({});
  const [openStops, setOpenStops] = useState<Record<string, boolean>>({});
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const [abA, setAbA] = useState<LegMode>("fastest");
  const [abB, setAbB] = useState<LegMode>("cheapest");
  const [naming, setNaming] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [pane, setPane] = useState<"plan" | "advanced" | "members">("plan");
  const { data: elpris } = useLiveElpris(area);

  useEffect(() => {
    const kick = () => setLive(true);
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(kick, { timeout: 250 });
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(kick, 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchAddress(q).then(setHits);
    }, 280);
    return () => window.clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setAddKind(stops.length === 0 ? "depart" : "auto");
  }, [stops.length]);

  useEffect(() => {
    if (!live) return;
    if (stops.length < 2) return;
    let cancelled = false;
    const order: LegMode[] = ["fastest", "eco", "cheapest"];
    void (async () => {
      for (const mode of order) {
        if (cancelled) return;
        const jobs: { from: (typeof stops)[number]; to: (typeof stops)[number]; mode: LegMode; key: string }[] = [];
        for (let i = 0; i < stops.length - 1; i++) {
          const from = stops[i];
          const to = stops[i + 1];
          const key = routeKey(from, to, mode);
          const hit = routeMap[key] ?? lookupCachedRoute(from, to, mode);
          if (hit && hit.source !== "air" && hit.path.length >= 3) {
            if (!routeMap[key]) jobs.push({ from, to, mode, key });
            continue;
          }
          jobs.push({ from, to, mode, key });
        }
        const needNet = jobs.filter((job) => {
          const hit = routeMap[job.key] ?? lookupCachedRoute(job.from, job.to, job.mode);
          return !hit || hit.source === "air" || hit.path.length < 3;
        });
        if (mode === "fastest" && needNet.length) setRouting(true);
        else if (mode === "fastest") setRouting(false);
        const patch: Record<string, RoutedLeg> = {};
        for (const job of jobs) {
          const cached = routeMap[job.key] ?? lookupCachedRoute(job.from, job.to, job.mode);
          if (cached && cached.source !== "air" && cached.path.length >= 3) {
            if (!routeMap[job.key]) patch[job.key] = cached;
            continue;
          }
          if (cancelled) return;
          const route = await fetchRoute(job.from, job.to, job.mode);
          if (cancelled || route.source === "air" || route.path.length < 3) continue;
          patch[job.key] = route;
        }
        if (!cancelled && Object.keys(patch).length) {
          startTransition(() => setRouteCache(patch));
        }
        if (mode === "fastest" && !cancelled) startTransition(() => setRouting(false));
        if (mode !== "cheapest") await new Promise((r) => window.setTimeout(r, 40));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [live, stops, setRouteCache]);

  useEffect(() => {
    setPrefer({});
    setAcceptCharge({});
    setChargeToSoc({});
    setBackupLoc({});
  }, [stops, detours]);

  const carWhPerMi = epaWhPerMi(profile.usableKwh, profile.epaRangeMi);
  const speedEff = normalizeSpeedEff(
    speedEffOverride,
    whPerMiOverride && whPerMiOverride > 0 ? whPerMiOverride : carWhPerMi,
  );
  const clock = useMemo(() => asDateTime(when || dkNowDateTime()), [when]);

  const hours = useMemo(() => {
    if (!elpris) return [];
    return remainingHours(
      applyTillægToHours(elpris.today, provider.tillægOre),
      applyTillægToHours(elpris.tomorrow, provider.tillægOre),
      elpris.current?.hour ?? null,
      addMinutesDateTime(clock, 3 * 24 * 60),
    );
  }, [elpris, provider.tillægOre, clock]);

  const acKr = hours[0]?.krPerKwh ?? HOME_USD_PER_KWH * DKK_PER_USD;

  function routesFor(mode: LegMode): RoutedLeg[] {
    if (stops.length < 2) return [];
    const list: RoutedLeg[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const hit = routeMap[routeKey(stops[i], stops[i + 1], mode)];
      if (!hit || hit.source === "air" || hit.path.length < 3) return [];
      list.push(hit);
    }
    return list;
  }

  const activeModes = (modes.length ? modes : stops.slice(1).map(() => "fastest" as LegMode)).map((m) =>
    m === "eco" || m === "cheapest" || m === "fastest" ? m : ("fastest" as LegMode),
  );
  const mixed = activeModes.some((m) => m !== activeModes[0]);
  const mapMode: LegMode = activeModes[0] ?? "fastest";
  const selectedRoutes = mixed
    ? stops
        .slice(0, -1)
        .map((_, i) => {
          const m = activeModes[i] ?? "fastest";
          return routeMap[routeKey(stops[i], stops[i + 1], pathMode(m, avoidForMode(m, cheapAvoid)))];
        })
        .filter((r): r is RoutedLeg => Boolean(r))
    : routesFor(pathMode(activeModes[0] ?? "fastest", avoidForMode(activeModes[0] ?? "fastest", cheapAvoid)));

  // Eco + Fastest corridors never depend on cheapAvoid — keeps their chargers/totals still.
  const stableSearchRoutes = useMemo(
    () => collectSearchRoutes(["eco", "fastest"], routesFor),
    [routeMap, stops],
  );
  const cheapPathM = pathMode("cheapest", cheapAvoid);
  const cheapSearchRoutes = useMemo(() => {
    // Only when Cheapest has its own corridor (toll/fee avoid), not when sharing eco/fastest.
    if (cheapPathM === "eco" || cheapPathM === "fastest") return [] as RoutedLeg[];
    return collectSearchRoutes(["cheapest"], routesFor);
  }, [routeMap, stops, cheapPathM]);
  const searchRoutes = useMemo(
    () => [...stableSearchRoutes, ...cheapSearchRoutes],
    [stableSearchRoutes, cheapSearchRoutes],
  );

  const chargeRadiusKm = Math.max(
    DEFAULT_DETOUR_KM,
    ...stops.slice(1).flatMap((_, i) =>
      (["eco", "fastest", "cheapest"] as LegMode[]).map((m) =>
        chargeSearchKm(m, detours[i] ?? DEFAULT_DETOUR_KM),
      ),
    ),
  );
  const { chargers: stableChargers, loading: stableChargersLoading } = useRouteChargers(
    live ? stableSearchRoutes : [],
    chargeRadiusKm,
  );
  const { chargers: cheapChargers, loading: cheapChargersLoading } = useRouteChargers(
    live ? cheapSearchRoutes : [],
    chargeRadiusKm,
  );
  const routeChargers = useMemo(() => {
    const byId = new Map(stableChargers.map((c) => [c.id, c]));
    for (const c of cheapChargers) byId.set(c.id, c);
    return [...byId.values()];
  }, [stableChargers, cheapChargers]);
  const chargersLoading = stableChargersLoading || cheapChargersLoading;

  const stableLocations = useMemo(
    () => buildPlanLocations(live, locationsStored, stableChargers, stableSearchRoutes),
    [live, locationsStored, stableChargers, stableSearchRoutes],
  );
  const locations = useMemo(
    () => buildPlanLocations(live, locationsStored, routeChargers, searchRoutes),
    [live, locationsStored, routeChargers, searchRoutes],
  );

  const driveMinGuess = selectedRoutes.reduce((n, r) => n + r.seconds / 60, 0);
  const departHhmm =
    whenKind === "arrive" ? addMinutesDateTime(clock, -driveMinGuess) : clock;

  const planArgs = {
    stops,
    detours: detours.length ? detours : stops.slice(1).map(() => DEFAULT_DETOUR_KM),
    waitCapMin: waits.length ? waits : stops.slice(1).map(() => DEFAULT_WAIT_MIN),
    soc,
    usableKwh: profile.usableKwh,
    locations,
    hours,
    acKw: profile.acKw,
    acKr,
    speedEff,
    departHhmm,
    arriveHhmm: whenKind === "arrive" ? clock : undefined,
    legWhen,
    acceptCharge: stops.slice(1).map((_, i) => Boolean(acceptCharge[i])),
    chargeToSoc: stops.slice(1).map((_, i) => chargeToSoc[i] ?? null),
    backupIds: stops.slice(1).map((_, i) => backupLoc[i] ?? null),
    preferIds: stops.slice(1).map((_, i) => prefer[i] ?? null),
    memberships: networkAbo,
    focuses: activeModes.map((m) => (m === "cheapest" ? "pris" : m === "eco" ? "distance" : "time")),
    // Never share Cheapest avoid with Eco/Fastest via the common planArgs bag.
    avoid: NO_CHEAP_AVOID,
  };

  const corridorStamp = useMemo(() => {
    if (stops.length < 2) return "";
    let stamp = "";
    for (let i = 0; i < stops.length - 1; i++) {
      for (const mode of pathModes) {
        const hit = routeMap[routeKey(stops[i], stops[i + 1], mode)];
        stamp += hit && hit.source !== "air" ? `${mode}:${hit.miles.toFixed(1)}:${hit.seconds}|` : `${mode}:-|`;
      }
    }
    return stamp;
  }, [stops, pathModes, routeMap]);

  const deferredMap = useDeferredValue(routeMap);

  const pricedMemo = useRef(new Map<string, PricedLeg[]>());

  const pricedRows = useMemo(() => {
    if (!live) {
      return LEG_MODES.map((mode) => ({
        mode,
        priced: [] as PricedLeg[],
        avoid: avoidForMode(mode, cheapAvoid),
      }));
    }
    return LEG_MODES.map((mode) => {
      const avoid = avoidForMode(mode, cheapAvoid);
      const optionRoutes = routesFor(pathMode(mode, avoid));
      if (optionRoutes.length !== Math.max(0, stops.length - 1) || stops.length < 2) {
        return { mode, priced: [] as PricedLeg[], avoid };
      }
      // Eco/Fastest price from stable corridors only — Cheapest avoid must not change their stall pool.
      const locPool = mode === "cheapest" ? locations : stableLocations;
      const cacheKey = `${mode}|${corridorStamp}|${soc}|${locPool.length}|${hours.length}|${avoid.motorways}|${avoid.tolls}|${avoid.roadFees}`;
      const cached = pricedMemo.current.get(cacheKey);
      if (cached) return { mode, avoid, priced: cached };
      const priced = pricePlan({
        ...planArgs,
        modes: stops.slice(1).map(() => mode),
        focuses: stops.slice(1).map(() => (mode === "cheapest" ? "pris" : mode === "eco" ? "distance" : "time")),
        detours: planArgs.detours.map((d) => (mode === "cheapest" ? 15 : d)),
        routes: optionRoutes,
        locations: locationsForRoutes(locPool, optionRoutes),
        avoid,
      });
      pricedMemo.current.set(cacheKey, priced);
      if (pricedMemo.current.size > 12) {
        const first = pricedMemo.current.keys().next().value;
        if (first) pricedMemo.current.delete(first);
      }
      return { mode, avoid, priced };
    });
  }, [live, corridorStamp, stops, detours, waits, soc, profile.usableKwh, profile.acKw, locations, stableLocations, hours, acKr, speedEff, departHhmm, legWhen, acceptCharge, chargeToSoc, backupLoc, prefer, networkAbo, cheapAvoid]);

  const optionRows = useMemo(() => {
    const rows = pricedRows.map(({ mode, priced, avoid }) => {
      const legs = applyLiveRoutes(
        priced,
        (from, to, m) => {
          const pathM = pathMode(m, avoidForMode(m, cheapAvoid));
          return deferredMap[routeKey(from, to, pathM)] ?? deferredMap[routeKey(from, to, m)];
        },
        speedEff,
        avoid,
      );
      const miles = legs.reduce((n, l) => n + l.route.miles, 0);
      const seconds = legs.reduce((n, l) => n + l.route.seconds, 0);
      const kmh = avgSpeedKmh(miles, seconds);
      const liveTotals = legs.length ? planTotals(legs) : null;
      const snap =
        !liveTotals && lastOptions?.key === stopsKey(stops) ? lastOptions.rows[mode] : undefined;
      return {
        mode,
        totals: liveTotals ?? (snap ? snapTotals(snap) : null),
        kmh: liveTotals ? kmh : (snap?.kmh ?? kmh),
        kwhPerMi: interpolateWhPerMi(speedEff, liveTotals ? kmh : (snap?.kmh ?? kmh)) / 1000,
        legs,
      };
    });
    const fast = rows.find((r) => r.mode === "fastest")?.totals;
    return rows.map((row) => {
      if (row.mode !== "cheapest" || !row.totals || !fast) return row;
      if (!row.legs.length) return row;
      if (row.totals.driveMin >= fast.driveMin - 0.4) return row;
      const driveMin = fast.driveMin;
      const seconds = driveMin * 60;
      return {
        ...row,
        totals: { ...row.totals, driveMin },
        kmh: avgSpeedKmh(row.totals.mi, seconds),
      };
    });
  }, [pricedRows, deferredMap, speedEff, cheapAvoid, stops]);

  useEffect(() => {
    if (!live) return;
    const key = stopsKey(stops);
    const rows: NonNullable<typeof lastOptions>["rows"] = {};
    for (const row of optionRows) {
      if (!row.totals || !row.legs.length) continue;
      rows[row.mode] = {
        mi: row.totals.mi,
        kr: row.totals.kr,
        driveMin: row.totals.driveMin,
        charges: row.totals.charges,
        tollKr: row.totals.tollKr,
        kmh: row.kmh,
      };
    }
    if (!Object.keys(rows).length) return;
    const next = { key, rows };
    if (sameLastOptions(lastOptions, next)) return;
    setLastOptions(next);
  }, [live, optionRows, stops, lastOptions, setLastOptions]);

  const legs: PricedLeg[] = useMemo(() => {
    if (!mixed) {
      const row = optionRows.find((r) => r.mode === (activeModes[0] ?? "fastest"));
      return row?.legs ?? [];
    }
    if (stops.length < 2 || selectedRoutes.length !== stops.length - 1) return [];
    return pricePlan({
      ...planArgs,
      modes: activeModes,
      routes: selectedRoutes,
    });
  }, [mixed, optionRows, activeModes, stops, selectedRoutes]);

  const viewLegs = useMemo(() => {
    return legs.map((leg, i) => {
      const id = prefer[i];
      if (!id || !leg.charge || !leg.backup || id !== leg.backup.locationId) return leg;
      const billed = leg.accepted;
      return { ...leg, charge: leg.backup, backup: leg.charge, kr: billed ? leg.backup.kr : 0 };
    });
  }, [legs, prefer]);

  const timeline = useMemo(() => {
    if (!viewLegs.length) {
      return stops.map((stop, index) => ({
        stop,
        inbound: null as (typeof viewLegs)[number] | null,
        outbound: null as (typeof viewLegs)[number] | null,
        via: false,
        index,
      }));
    }
    const rows = [
      {
        stop: viewLegs[0].from,
        inbound: null as (typeof viewLegs)[number] | null,
        outbound: viewLegs[0],
        via: false,
        index: 0,
      },
    ];
    viewLegs.forEach((leg, i) => {
      rows.push({
        stop: leg.to,
        inbound: leg,
        outbound: viewLegs[i + 1] ?? null,
        via: leg.via,
        index: i + 1,
      });
    });
    return rows;
  }, [viewLegs, stops]);

  const totals = useMemo(() => planTotals(viewLegs), [viewLegs]);

  useEffect(() => {
    if (stops.length < 2) return;
    let arriveAt = "";
    for (let i = 0; i < stops.length - 1; i++) {
      const w = legWhen[i];
      if (w?.kind === "arrive" && (w.at || w.hhmm)) arriveAt = asDateTime(w.at || w.hhmm);
    }
    if (!arriveAt) return;
    if (Math.abs(minutesBetweenDateTime(clock, arriveAt)) < 1) return;
    const drive = totals.driveMin > 0 ? totals.driveMin : driveMinGuess;
    if (!(drive > 0)) return;
    const leave = addMinutesDateTime(arriveAt, -drive);
    if (whenKind === "depart" && Math.abs(minutesBetweenDateTime(clock, leave)) < 1) return;
    setWhenKind("depart");
    setWhen(leave);
  }, [legWhen, stops.length, totals.driveMin, driveMinGuess, clock, whenKind, setWhen, setWhenKind]);

  const hopKey = optionRows
    .map((row) =>
      row.legs
        .map(
          (l) =>
            `${row.mode}:${l.from.lat.toFixed(3)},${l.from.lng.toFixed(3)}>${l.to.lat.toFixed(3)},${l.to.lng.toFixed(3)}`,
        )
        .join(";"),
    )
    .join("|");

  useEffect(() => {
    if (!hopKey) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const jobs: { from: PlanStop; to: PlanStop; mode: LegMode; key: string }[] = [];
      const seen = new Set<string>();
      for (const row of optionRows) {
        const m = pathMode(row.mode, avoidForMode(row.mode, cheapAvoid));
        for (const leg of row.legs) {
          const key = routeKey(leg.from, leg.to, m);
          if (seen.has(key)) continue;
          seen.add(key);
          const hit = routeMap[key] ?? routeMap[routeKey(leg.from, leg.to, row.mode)];
          if (hit && hit.source !== "air" && hit.path.length >= 3) continue;
          if (!leg.via && leg.route.path.length >= 8 && leg.route.miles > 80) continue;
          jobs.push({ from: leg.from, to: leg.to, mode: m, key });
          if (jobs.length >= 6) break;
        }
        if (jobs.length >= 6) break;
      }
      if (!jobs.length || cancelled) return;
      void (async () => {
        const patch: Record<string, RoutedLeg> = {};
        for (let i = 0; i < jobs.length; i += 2) {
          if (cancelled) return;
          await Promise.all(
            jobs.slice(i, i + 2).map(async (job) => {
              const route = await fetchRoute(job.from, job.to, job.mode);
              if (cancelled || route.source === "air" || route.path.length < 3) return;
              patch[job.key] = route;
            }),
          );
        }
        if (!cancelled && Object.keys(patch).length) setRouteCache(patch);
      })();
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hopKey, cheapAvoid]);

  function addStop(hit: AddressHit) {
    const idx = stops.length;
    const at = asDateTime(addAt || clock);
    addStopToStore({ name: hit.label.split(",")[0] || hit.label, lat: hit.lat, lng: hit.lng });
    if (idx === 0) {
      setWhenKind("depart");
      setWhen(at);
      setAddKind("auto");
    } else if (addKind !== "auto") {
      setLegWhen(idx - 1, { kind: addKind, hhmm: at, at });
    }
    setQuery("");
    setHits([]);
    if (addKind !== "auto") setAddAt(at);
    setSelected(`leg-${Math.max(0, idx - 1)}`);
  }

  function insertCharge(legIndex: number, spot: PricedCharge) {
    const loc = locations.find((x) => x.id === spot.locationId);
    if (!loc) return;
    insertStopAt(legIndex + 1, {
      name: loc.short || loc.name,
      lat: loc.lat,
      lng: loc.lng,
    });
    toast(`Added ${loc.short || loc.name} as a stop`);
  }

  function openLegStop(legIndex: number) {
    const dest = stops[legIndex + 1];
    if (dest) setOpenStops((cur) => ({ ...cur, [dest.id]: true }));
  }

  function onMapSelect(id: string) {
    setSelected(id);
    const chg = /^chg-(?:(eco|fastest|cheapest)-)?(\d+)-(.+)$/.exec(id);
    if (chg) {
      const mode = (chg[1] as LegMode | undefined) ?? null;
      const i = Number(chg[2]);
      const locId = chg[3];
      if (mode) setAllModes(mode);
      const source = mode ? optionRows.find((r) => r.mode === mode)?.legs ?? [] : viewLegs;
      const leg = source[i];
      if (!leg) return;
      if (leg.backup?.locationId === locId) {
        setPrefer((cur) => ({ ...cur, [i]: locId }));
        toast("Backup charger selected");
        openLegStop(i);
      } else if (leg.charge?.locationId === locId) {
        setPrefer((cur) => {
          const next = { ...cur };
          delete next[i];
          return next;
        });
      }
      openLegStop(i);
      return;
    }
    const opt = /^opt-(eco|fastest|cheapest)-(\d+)$/.exec(id);
    if (opt) {
      const mode = opt[1] as LegMode;
      const i = Number(opt[2]);
      setLegMode(i, mode);
      setSelected(`leg-${i}`);
      openLegStop(i);
    }
  }

  const selectedIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selected) return [] as string[];
    ids.add(selected);
    const legHit =
      /^leg-(\d+)$/.exec(selected) ??
      /^chg-(?:eco|fastest|cheapest)-(\d+)-/.exec(selected) ??
      /^chg-(\d+)-/.exec(selected);
    if (legHit) {
      const i = Number(legHit[1]);
      ids.add(`leg-${i}`);
      for (const mode of LEG_MODES) ids.add(`opt-${mode}-${i}`);
      const leg = viewLegs[i];
      if (leg?.charge) ids.add(`chg-${i}-${leg.charge.locationId}`);
      if (leg?.backup) ids.add(`chg-${i}-${leg.backup.locationId}`);
      for (const mode of LEG_MODES) {
        const mleg = optionRows.find((r) => r.mode === mode)?.legs[i];
        if (mleg?.charge) ids.add(`chg-${mode}-${i}-${mleg.charge.locationId}`);
      }
      if (stops[i]) ids.add(stops[i].id);
      if (stops[i + 1]) ids.add(stops[i + 1].id);
    }
    const stopIdx = stops.findIndex((s) => s.id === selected);
    if (stopIdx > 0) {
      ids.add(`leg-${stopIdx - 1}`);
      const leg = viewLegs[stopIdx - 1];
      if (leg?.charge) ids.add(`chg-${stopIdx - 1}-${leg.charge.locationId}`);
      if (leg?.backup) ids.add(`chg-${stopIdx - 1}-${leg.backup.locationId}`);
    }
    return [...ids];
  }, [selected, viewLegs, stops, optionRows]);

  function routePoints() {
    if (viewLegs.length) {
      const pts = [viewLegs[0].from, ...viewLegs.map((leg) => leg.to)];
      return pts.filter((p, i) => i === 0 || p.lat !== pts[i - 1].lat || p.lng !== pts[i - 1].lng);
    }
    return stops;
  }

  function onSave() {
    if (stops.length < 2) {
      toast("Add a destination first");
      return;
    }
    const fallback = name.trim() || tripTitle(stops);
    setSaveLabel(fallback);
    setNaming(true);
  }

  function commitSave() {
    const label = saveLabel.trim();
    if (!label) {
      toast("Name this trip");
      return;
    }
    setName(label);
    const plan = savePlan(label, {
      startAt: viewLegs[0]?.departAt || departHhmm || clock,
      min: totals.min,
      kr: totals.kr,
      mi: totals.mi,
    });
    if (!plan) {
      toast("Add a destination first");
      return;
    }
    setNaming(false);
    toast(`Saved ${plan.name}`);
  }

  async function exportToTesla(planStops: { name: string; lat: number; lng: number }[], title: string) {
    const pts = planStops.filter(
      (s) =>
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lng) &&
        Math.abs(s.lat) <= 90 &&
        Math.abs(s.lng) <= 180,
    );
    const fail = (message: string) => {
      toast.error(message, {
        action: {
          label: "Retry",
          onClick: () => {
            void exportToTesla(planStops, title);
          },
        },
      });
    };

    if (!pts.length) {
      fail("No valid coordinates to send");
      return;
    }
    let url = "";
    try {
      url = pts.length === 1 ? teslaDestUrl(pts[0]) : mapsDirUrl(pts);
    } catch (err) {
      fail(err instanceof Error ? err.message : "Could not build a Tesla nav link");
      return;
    }
    if (!url) {
      fail("Could not build a Tesla nav link");
      return;
    }

    const fallback = async (reason?: string) => {
      let opened = false;
      try {
        const win = window.open(url, "_blank", "noopener,noreferrer");
        opened = Boolean(win);
      } catch {
        opened = false;
      }
      if (opened) {
        toast("Open in Tesla app, or share the map to the car");
        return;
      }
      try {
        if (navigator.clipboard?.writeText) {
          await withRetry(() => navigator.clipboard.writeText(url), { delaysMs: [0, 120] });
          fail(reason ? `${reason}. Link copied.` : "Popup blocked. Tesla link copied.");
          return;
        }
      } catch {
        /* clipboard blocked too */
      }
      fail(reason ? `${reason}. Copy this link: ${url}` : `Could not open Tesla nav. ${url}`);
    };

    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: title || "Tesla trip", text: title, url });
        return;
      } catch (err) {
        if (isShareCancel(err)) return;
        await fallback(shareErrorMessage(err));
        return;
      }
    }

    await fallback();
  }

  const mapRoutes: MapRoute[] = useMemo(() => {
    const out: MapRoute[] = [];
    if (stops.length < 2) return out;
    const draw = showAllRoutes ? LEG_MODES : [mapMode];
    for (const mode of draw) {
      const row = optionRows.find((r) => r.mode === mode);
      const pieces: [number, number][][] = [];
      if (row?.legs.length) {
        for (const leg of row.legs) {
          const live =
            routeMap[routeKey(leg.from, leg.to, pathMode(mode, avoidForMode(mode, cheapAvoid)))] ??
            routeMap[routeKey(leg.from, leg.to, mode)];
          const path =
            live && live.source !== "air" && live.path.length >= 3 ? live.path : leg.route.path;
          if (path.length >= 2) pieces.push(path);
        }
      }
      if (!pieces.length) {
        const hit =
          routeMap[routeKey(stops[0], stops[stops.length - 1], pathMode(mode, avoidForMode(mode, cheapAvoid)))] ??
          routeMap[routeKey(stops[0], stops[stops.length - 1], mode)] ??
          (stops.length >= 2
            ? routeMap[routeKey(stops[0], stops[1], pathMode(mode, avoidForMode(mode, cheapAvoid)))]
            : undefined);
        if (hit?.path.length) pieces.push(hit.path);
        else {
          pieces.push(stops.map((s) => [s.lat, s.lng] as [number, number]));
        }
      }
      const joined: [number, number][] = [];
      for (const piece of pieces) {
        for (const pt of piece) {
          const last = joined[joined.length - 1];
          if (last && Math.abs(last[0] - pt[0]) < 1e-5 && Math.abs(last[1] - pt[1]) < 1e-5) continue;
          joined.push(pt);
        }
      }
      const raw = joined.length >= 2 ? simplifyPath(joined, 96) : joined;
      const start = raw[0] ?? [stops[0].lat, stops[0].lng];
      const end = raw.at(-1) ?? [stops[stops.length - 1].lat, stops[stops.length - 1].lng];
      out.push({
        id: `opt-${mode}-0`,
        from: start,
        to: end,
        weight: showAllRoutes && mode !== mapMode ? 2.4 : 3.6,
        path: offsetPath(raw, showAllRoutes ? ROUTE_OFFSET_M[mode] : 0),
        color: modeColor(mode),
      });
    }
    return out;
  }, [stops, routeMap, cheapAvoid, mapMode, showAllRoutes, optionRows]);

  const mapMarkers: MapMarker[] = useMemo(() => {
    const row = optionRows.find((r) => r.mode === mapMode);
    const seq: { id: string; lat: number; lng: number; label: string; via: boolean }[] = [];
    if (row?.legs.length) {
      const first = row.legs[0].from;
      seq.push({ id: first.id, lat: first.lat, lng: first.lng, label: first.name, via: false });
      for (const [i, leg] of row.legs.entries()) {
        const spot = leg.charge;
        const loc = spot ? locations.find((x) => x.id === spot.locationId) : undefined;
        seq.push({
          id: leg.to.id,
          lat: loc?.lat ?? leg.to.lat,
          lng: loc?.lng ?? leg.to.lng,
          label: spot?.name ?? leg.to.name,
          via: Boolean(leg.via),
        });
      }
    } else {
      for (const s of stops) seq.push({ id: s.id, lat: s.lat, lng: s.lng, label: s.name, via: false });
    }
    const extra: MapMarker[] = [];
    if (showAllRoutes) {
      for (const other of optionRows) {
        if (other.mode === mapMode) continue;
        const [dLat, dLng] = CHARGE_OFFSET[other.mode];
        for (const [i, leg] of other.legs.entries()) {
          if (!leg.via && !leg.charge) continue;
          extra.push({
            id: `chg-${other.mode}-${i}-${leg.charge?.locationId ?? leg.to.id}`,
            lat: leg.to.lat + dLat,
            lng: leg.to.lng + dLng,
            label: `${modeLabel(other.mode)} · ${leg.charge?.name ?? leg.to.name}`,
            kind: "charger",
            badge: other.mode === "eco" ? "E" : other.mode === "cheapest" ? "$" : "F",
            color: modeColor(other.mode),
          });
        }
      }
    }
    return [
      ...seq.map((s, i) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        label: `${i + 1}. ${s.label}`,
        kind: (s.via ? "charger" : s.id === "home" || s.label === "Home" ? "home" : "place") as MapMarker["kind"],
        badge: String(i + 1),
        color: s.via ? modeColor(mapMode) : undefined,
      })),
      ...extra,
    ];
  }, [optionRows, locations, stops, mapMode, showAllRoutes]);

  const [idleMap, setIdleMap] = useState({ routes: [] as MapRoute[], markers: [] as MapMarker[] });
  useEffect(() => {
    if (routing) return;
    // Defer corridor props until idle so BayMap does not paint heavy polylines
    // during the same turn as shell / stop taps.
    const apply = () => setIdleMap({ routes: mapRoutes, markers: mapMarkers });
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(apply, { timeout: 400 });
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(apply, 160);
    return () => window.clearTimeout(t);
  }, [routing, mapRoutes, mapMarkers]);

  return (
    <div className="space-y-5 px-4 pb-6 [touch-action:manipulation]">
      <div className="flex rounded-full bg-surface-2 p-1">
        {(["plan", "advanced", "members"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setPane(id)}
            className={cn(
              "h-9 flex-1 rounded-full text-xs font-medium",
              pane === id ? "bg-foreground text-background" : "text-muted",
            )}
          >
            {id === "plan" ? "Plan" : id === "advanced" ? "Advanced" : "Memberships"}
          </button>
        ))}
      </div>

      {pane === "members" ? (
        <NetworksPanel abo={networkAbo} onToggle={setNetworkAbo} />
      ) : (
      <>
      {pane === "advanced" ? (
        <div className="space-y-4">
          <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Start battery</p>
            <label className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
              <span className="text-xs text-muted">{profile.usableKwh} kWh usable</span>
              <span className="flex items-center gap-1 text-sm">
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={soc}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    setSocOverride(Math.max(5, Math.min(100, Math.round(n))));
                  }}
                  className="h-10 w-14 rounded-md bg-background text-center text-sm tabular-nums outline-none"
                />
                %
              </span>
            </label>
            {socOverride != null ? (
              <button
                type="button"
                onClick={() => setSocOverride(null)}
                className="mt-2 text-[11px] text-muted underline"
              >
                Use vehicle {vehicleSoc}%
              </button>
            ) : (
              <p className="mt-2 text-[11px] text-subtle">From the car. Override only for this plan.</p>
            )}
            <p className="mt-4 text-[11px] font-medium uppercase tracking-wide text-muted">Charge search</p>
            <div className="mt-1 flex gap-1">
              {DETOUR_KM.map((km) => {
                const on = detours.length > 0 && detours.every((d) => d === km);
                return (
                  <button
                    key={km}
                    type="button"
                    onClick={() => {
                      stops.slice(1).forEach((_, i) => setLegDetour(i, km));
                    }}
                    className={cn(
                      "h-9 flex-1 rounded-full text-[11px] font-medium",
                      on ? "bg-foreground text-background" : "bg-surface-2 text-muted",
                    )}
                  >
                    {formatDetour(km, units)}
                  </button>
                );
              })}
            </div>
          </section>
          <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">kWh / 100 km at speed</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {SPEED_KMH.map((kmh) => (
                <label key={kmh} className="text-center text-[11px] text-muted">
                  {kmh}
                  <span className="text-subtle"> km/t</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={8}
                    max={30}
                    step={0.1}
                    value={speedEff[kmh].toFixed(1)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n) || n <= 0) return;
                      setSpeedEff({ ...speedEff, [kmh]: n });
                    }}
                    className="mt-1 h-11 w-full rounded-xl bg-surface-2 px-2 text-center text-sm tabular-nums text-foreground outline-none"
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-subtle">
              kWh/mi = (kWh/100 km) × 0.0161 · EPA {formatEfficiency(carWhPerMi, units)}
              {speedEffOverride ? (
                <>
                  {" · "}
                  <button type="button" className="text-muted underline" onClick={() => setSpeedEff(null)}>
                    Reset
                  </button>
                </>
              ) : null}
            </p>
          </section>
        </div>
      ) : null}

      {pane === "plan" ? (
      <>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={stops.length >= 2 ? tripTitle(stops) : "Name this plan"}
          className="w-full bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-subtle"
        />
        <p className="mt-2 text-xs text-muted">
          {profile.usableKwh} kWh usable · {formatNumber(soc, 0)}% now
        </p>

        <ol className="relative mt-4">
          {stops.map((stop, i) => {
            const w =
              i === 0
                ? { kind: "depart" as const, at: clock, note: true }
                : {
                    kind: (legWhen[i - 1]?.kind ?? "auto") as "auto" | "depart" | "arrive",
                    at: asDateTime(legWhen[i - 1]?.at || legWhen[i - 1]?.hhmm || ""),
                    note: Boolean(legWhen[i - 1]?.kind && legWhen[i - 1]?.kind !== "auto"),
                  };
            return (
              <li key={stop.id} className="relative flex items-start gap-3 py-1.5">
                <span className="absolute bottom-0 left-[13px] top-8 w-px bg-border" aria-hidden />
                <span className="relative z-[1] mt-2 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs tabular-nums text-muted">
                  {i + 1}
                </span>
                <div className="relative z-[1] min-w-0 flex-1">
                  <div className="flex h-11 items-center gap-2 rounded-full bg-surface-2 px-3">
                    <p className="min-w-0 truncate text-sm">{stop.name}</p>
                    {w.note && w.at ? (
                      <button
                        type="button"
                        onClick={() => setEditWhen(editWhen === stop.id ? null : stop.id)}
                        className="ml-auto shrink-0 text-xs tabular-nums text-muted"
                        aria-expanded={editWhen === stop.id}
                        aria-label={`Edit ${w.kind === "arrive" ? "arrive" : "leave"} time for ${stop.name}`}
                      >
                        {w.kind === "arrive" ? "Arrive" : "Leave"} {formatDateTime(w.at)}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setEditWhen(editWhen === stop.id ? null : stop.id)}
                        className="ml-auto shrink-0 text-xs text-subtle"
                        aria-expanded={editWhen === stop.id}
                      >
                        Set time
                      </button>
                    )}
                  </div>
                  {editWhen === stop.id ? (
                    <WhenFields
                      kind={i === 0 ? "depart" : w.kind}
                      at={asDateTime(w.at || clock)}
                      allowAuto={i > 0}
                      onKind={(k) => {
                        if (i === 0) {
                          setWhenKind("depart");
                          return;
                        }
                        const at = asDateTime(w.at || clock);
                        setLegWhen(i - 1, { kind: k, hhmm: k === "auto" ? "" : at, at: k === "auto" ? "" : at });
                      }}
                      onAt={(dt) => {
                        if (i === 0) {
                          setWhenKind("depart");
                          setWhen(dt);
                          return;
                        }
                        const kind = w.kind === "auto" ? "arrive" : w.kind;
                        setLegWhen(i - 1, { kind, hhmm: dt, at: dt });
                      }}
                    />
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => removeStop(stop.id)}
                  className="relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full text-muted"
                  aria-label={`Remove ${stop.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
          <li className="relative flex items-start gap-3 py-2">
            <span className="relative z-[1] mt-2 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted">
              <Plus className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={stops.length === 0 ? "Add a start" : stops.length === 1 ? "Add a destination" : "Add a stop"}
                className="h-11 w-full rounded-xl bg-surface-2 px-3 text-sm outline-none placeholder:text-subtle"
              />
              <WhenFields
                kind={stops.length === 0 ? "depart" : addKind}
                at={asDateTime(addAt || clock)}
                allowAuto={stops.length > 0}
                onKind={setAddKind}
                onAt={setAddAt}
              />
              {hits.length ? (
                <ul className="mt-1 overflow-hidden rounded-xl bg-surface-2">
                  {hits.map((hit) => (
                    <li key={`${hit.lat},${hit.lng}`} className="border-t border-border first:border-0">
                      <button
                        type="button"
                        onClick={() => addStop(hit)}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm"
                      >
                        <span className="truncate">{hit.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </li>
        </ol>

        <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-muted">Route options</p>
        <p className="mt-1 text-[11px] text-subtle">
          Eco uses 80–100 km/t roads (not 50–60). Fastest takes motorways. Cheapest hunts the lowest kWh.
        </p>
        <OptionList
          rows={optionRows}
          mixed={mixed}
          active={activeModes[0] ?? "fastest"}
          routing={routing}
          units={units}
          cheapAvoid={cheapAvoid}
          onPick={setAllModes}
        />

        <p className="mt-4 text-xs font-medium text-muted">
          {stops.length === 0
            ? "Add a start"
            : stops.length < 2
            ? "Add a destination"
            : routing
              ? "Routing…"
              : mixed
                ? "Mixed legs"
                : `${modeLabel(activeModes[0] ?? "fastest")} · ${viewLegs.length} ${viewLegs.length === 1 ? "leg" : "legs"}`}
        </p>
        <p className="mt-2 text-4xl font-medium tracking-tight tabular-nums">
          {formatDistance(totals.mi, units, totals.mi >= 100 ? 0 : 1)}
        </p>
        <p className="mt-2 text-sm text-muted">
          {formatNumber(totals.kwh, 1)} kWh drive
          <span className="text-subtle"> · </span>
          {totals.chargeKwh > 0 ? `${formatNumber(totals.chargeKwh, 1)} kWh charge` : `${formatNumber(soc, 0)}% start`}
          <span className="text-subtle"> · </span>
          {minutesToHm(totals.driveMin)} drive
          {totals.min - totals.driveMin >= 5 ? (
            <>
              <span className="text-subtle"> · </span>
              {minutesToHm(totals.min)} total
            </>
          ) : null}
        </p>
        <p className="mt-3 text-2xl font-medium tabular-nums">
          {formatKrValue(totals.kr, 2)} <span className="text-base text-muted">kr</span>
        </p>
        <p className="mt-1 text-xs text-subtle">
          {totals.tollKr > 0
            ? `Toll ${formatKrValue(totals.tollKr, 0)} kr${viewLegs.find((l) => l.tollLabel)?.tollLabel ? ` · ${[...new Set(viewLegs.map((l) => l.tollLabel).filter(Boolean))].join(" · ")}` : ""} · `
            : ""}
          {chargersLoading ? "Finding chargers along route · " : routeChargers.length ? `${routeChargers.length} chargers on corridor · ` : ""}
          {whenKind === "arrive" ? `Arrive ${formatDateTime(clock)}` : `Leave ${formatDateTime(departHhmm)}`}
          {viewLegs[0] ? ` · first window ${formatDateTime(viewLegs[0].departAt)}` : ""}
          {totals.requiredKwh > 0 ? ` · ${formatNumber(totals.requiredKwh, 1)} kWh required` : ""}
        </p>
        <div className="mt-4 flex gap-2">
          {naming ? (
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <input
                autoFocus
                value={saveLabel}
                onChange={(e) => setSaveLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitSave();
                  if (e.key === "Escape") setNaming(false);
                }}
                placeholder="Name this trip"
                className="h-11 w-full rounded-xl bg-surface-2 px-3 text-sm outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={commitSave}
                  className="h-11 flex-1 rounded-full bg-foreground text-sm font-medium text-background"
                >
                  Save trip
                </button>
                <button
                  type="button"
                  onClick={() => setNaming(false)}
                  className="h-11 rounded-full bg-surface-2 px-4 text-sm font-medium text-muted"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={onSave}
                className="h-11 flex-1 rounded-full bg-foreground text-sm font-medium text-background"
              >
                Save plan
              </button>
              <button
                type="button"
                onClick={() => void exportToTesla(routePoints(), name.trim() || "Tesla trip")}
                className="flex h-11 items-center gap-1.5 rounded-full bg-surface-2 px-4 text-sm font-medium text-muted"
              >
                <Navigation className="size-4" />
                Tesla
              </button>
              <button
                type="button"
                onClick={() => reset()}
                className="h-11 rounded-full bg-surface-2 px-4 text-sm font-medium text-muted"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </section>

      {saved.length ? (
        <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <p className="text-sm font-medium">Saved</p>
          <p className="mt-0.5 text-xs text-subtle">Tap to load · Tesla sends the route to nav</p>
          <ul className="mt-2">
            {saved.map((plan) => (
              <li key={plan.id} className="flex items-center gap-2 border-b border-border py-3 last:border-0">
                <button
                  type="button"
                  onClick={() => {
                    loadPlan(plan.id);
                    toast(`Loaded ${plan.name}`);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm">{plan.name}</p>
                  <p className="text-xs text-muted">
                    {plan.startAt || plan.when
                      ? `Start ${formatPlanDate(plan.startAt || plan.when)}`
                      : `${plan.stops.length} stops`}
                  </p>
                  <p className="text-xs text-muted">
                    {plan.min != null && Number.isFinite(plan.min) ? minutesToHm(plan.min) : "—"}
                    <span className="text-subtle"> · </span>
                    {plan.kr != null && Number.isFinite(plan.kr) ? `${formatKrValue(plan.kr, 0)} kr` : "—"}
                  </p>
                  <p className="truncate text-[11px] text-subtle">
                    {plan.stops.map((s) => s.name).join(" → ")}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void exportToTesla(plan.stops, plan.name)}
                  className="flex h-9 items-center gap-1 rounded-full bg-surface-2 px-3 text-[11px] font-medium text-muted"
                  aria-label={`Send ${plan.name} to Tesla nav`}
                >
                  <Navigation className="size-3.5" />
                  Tesla
                </button>
                <button
                  type="button"
                  onClick={() => deleteSaved(plan.id)}
                  className="flex size-9 items-center justify-center rounded-full text-muted"
                  aria-label={`Delete ${plan.name}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              setShowAllRoutes(false);
            }}
            onClick={() => setShowAllRoutes(false)}
            className={cn(
              "h-8 rounded-full px-3 text-[11px] font-medium",
              !showAllRoutes ? "text-background" : "bg-surface-2 text-muted",
            )}
            style={!showAllRoutes ? { background: modeColor(mapMode) } : undefined}
          >
            {modeLabel(mapMode)}
          </button>
          <button
            type="button"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              setShowAllRoutes(true);
            }}
            onClick={() => setShowAllRoutes(true)}
            className={cn(
              "h-8 rounded-full px-3 text-[11px] font-medium",
              showAllRoutes ? "bg-foreground text-background" : "bg-surface-2 text-muted",
            )}
          >
            All 3
          </button>
        </div>
        <Suspense fallback={<div className="h-52 rounded-xl bg-surface shadow-[var(--shadow-border)]" />}>
          {live ? (
            <BayMap
              markers={idleMap.markers}
              routes={idleMap.routes}
              selectedId={selected}
              selectedIds={selectedIds}
              onSelect={onMapSelect}
              caption={
                routing
                  ? "Routing…"
                  : showAllRoutes
                    ? "All modes · tap a leg or charger"
                    : `${modeLabel(mapMode)} · full route`
              }
              hidden={!shareLocation}
            />
          ) : (
            <div className="h-52 rounded-xl bg-surface shadow-[var(--shadow-border)]" />
          )}
        </Suspense>
      </div>

      </>
      ) : pane === "advanced" ? (
      <>
      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">Compare modes</p>
        {(() => {
          const rowA = optionRows.find((r) => r.mode === abA);
          const rowB = optionRows.find((r) => r.mode === abB);
          const ta = rowA?.totals;
          const tb = rowB?.totals;
          const ab = ta && tb && abA !== abB ? routeAb(ta, tb) : null;
          const cell = (side: "a" | "b", win: "a" | "b" | "tie", text: string) => (
            <span className={cn("tabular-nums", win === side && "font-medium text-foreground")}>{text}</span>
          );
          return (
            <div className="mt-3 rounded-xl bg-surface-2 px-3 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">A/B</p>
              <div className="mt-2 flex items-center gap-2">
                <select
                  value={abA}
                  onChange={(e) => setAbA(e.target.value as LegMode)}
                  className="h-9 flex-1 rounded-xl bg-background px-2 text-sm text-foreground outline-none"
                >
                  {LEG_MODES.map((m) => (
                    <option key={`a-${m}`} value={m}>
                      A · {modeLabel(m)}
                    </option>
                  ))}
                </select>
                <select
                  value={abB}
                  onChange={(e) => setAbB(e.target.value as LegMode)}
                  className="h-9 flex-1 rounded-xl bg-background px-2 text-sm text-foreground outline-none"
                >
                  {LEG_MODES.map((m) => (
                    <option key={`b-${m}`} value={m}>
                      B · {modeLabel(m)}
                    </option>
                  ))}
                </select>
              </div>
              {ab && ta && tb ? (
                <>
                  <div className="mt-3 grid grid-cols-[4.5rem_1fr_1fr] gap-y-1 text-xs text-muted">
                    <span />
                    <span className="text-foreground">{modeLabel(abA)}</span>
                    <span className="text-foreground">{modeLabel(abB)}</span>
                    <span>Drive</span>
                    {cell("a", ab.time, minutesToHm(ta.driveMin))}
                    {cell("b", ab.time, minutesToHm(tb.driveMin))}
                    <span>Charge</span>
                    {cell("a", ab.cost, `${formatKrValue(Math.max(0, ta.kr - ta.tollKr), 0)} kr`)}
                    {cell("b", ab.cost, `${formatKrValue(Math.max(0, tb.kr - tb.tollKr), 0)} kr`)}
                    <span>Toll</span>
                    <span className="tabular-nums">{formatKrValue(ta.tollKr, 0)} kr</span>
                    <span className="tabular-nums">{formatKrValue(tb.tollKr, 0)} kr</span>
                    <span>Total</span>
                    {cell("a", ab.cost, `${formatKrValue(ta.kr, 0)} kr`)}
                    {cell("b", ab.cost, `${formatKrValue(tb.kr, 0)} kr`)}
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {ab.overall === "tie"
                      ? "Tie — pick either."
                      : `${ab.overall === "a" ? modeLabel(abA) : modeLabel(abB)} wins${
                          ab.bSlow
                            ? " · B is 2× slower"
                            : ab.aSlow
                              ? " · A is 2× slower"
                              : ab.save.significant && ab.overall === "b"
                                ? ` · saves ${formatKrValue(ab.save.net, 0)} kr`
                                : ab.overall === "a"
                                  ? " · faster"
                                  : ""
                        }.`}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAllModes(abA)}
                      className="h-9 flex-1 rounded-xl bg-background text-xs font-medium text-foreground"
                    >
                      Use A
                    </button>
                    <button
                      type="button"
                      onClick={() => setAllModes(abB)}
                      className="h-9 flex-1 rounded-xl bg-background text-xs font-medium text-foreground"
                    >
                      Use B
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-2 text-xs text-subtle">Pick two different modes after routing.</p>
              )}
            </div>
          );
        })()}

      </section>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">Stops</p>
          <div className="ml-auto flex gap-1">
            {LEG_MODES.map((mode) => {
              const on = !mixed && activeModes[0] === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.preventDefault();
                    setAllModes(mode);
                  }}
                  onClick={(e) => {
                    e.preventDefault();
                    setAllModes(mode);
                  }}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-[11px] font-medium",
                    on ? "text-background" : "bg-surface-2 text-muted",
                  )}
                  style={on ? { background: modeColor(mode) } : undefined}
                >
                  {modeLabel(mode)}
                </button>
              );
            })}
          </div>
        </div>
        <ol className="mt-2">
          {timeline.map(({ stop, inbound, outbound, via, index: i }) => {
            const userI = outbound?.userIndex ?? inbound?.userIndex ?? Math.max(0, i - 1);
            const leg = inbound;
            const chargedLeg = outbound ?? inbound;
            const open = Boolean(openStops[stop.id]);
            const selectedHere =
              selected === stop.id ||
              selected === `leg-${userI}` ||
              Boolean(selected?.startsWith(`chg-${userI}-`));
            const leftPct = inbound ? inbound.arriveSoc : soc;
            const chargeTo =
              chargeToSoc[userI] ??
              (chargedLeg?.charge
                ? chargedLeg.accepted
                  ? chargedLeg.startSoc
                  : chargedLeg.autoStartSoc
                : inbound || outbound
                  ? leftPct
                  : null);
            const extraKr = chargedLeg?.accepted ? chargedLeg.extraKr : 0;
            const chargeRequired = Boolean(chargedLeg?.needed);
            const inStore = stops.some((s) => s.id === stop.id);
            return (
              <li
                key={stop.id}
                className={cn(
                  "border-b border-border py-3 last:border-0",
                  selectedHere && "rounded-xl bg-surface-2/80 px-2",
                )}
              >
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      setSelected(inbound ? `leg-${userI}` : stop.id);
                      if (inbound || outbound) setOpenStops((cur) => ({ ...cur, [stop.id]: !cur[stop.id] }));
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                    }}
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs tabular-nums text-muted">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">
                        {via ? <span className="mr-1 text-[11px] font-medium uppercase tracking-wide text-amber-300">via</span> : null}
                        {stop.name}
                      </p>
                      <p className="text-xs text-muted">
                        <span className="tabular-nums">
                          {formatNumber(leftPct, 0)}%{i === 0 ? " now" : " left"}
                        </span>
                        {chargedLeg?.charge ? (
                          <span
                            className={cn(
                              "tabular-nums",
                              chargeRequired ? "font-medium text-amber-300" : "font-medium text-emerald-400",
                            )}
                          >
                            {chargeRequired ? " · required" : chargedLeg.accepted ? " · accepted" : " · recommended"}
                            {!chargeRequired && extraKr >= 0.5
                              ? ` · +${formatKrValue(extraKr, 0)} kr extra`
                              : ""}
                          </span>
                        ) : null}
                      </p>
                      {inbound && !open ? (
                        chargedLeg?.charge ? (
                          <p className="truncate text-[11px]" style={{ color: modeColor(chargedLeg.mode) }}>
                            {via ? "via " : ""}
                            {chargedLeg.charge.name}
                            {` · ${formatNumber(chargedLeg.charge.kwh, 0)} kWh · ${formatKrValue(chargedLeg.charge.kr, 0)} kr`}
                          </p>
                        ) : (
                          <p className="truncate text-[11px] text-subtle">no charge</p>
                        )
                      ) : null}
                    </div>
                    {inbound || outbound ? (
                      <ChevronDown className={cn("size-4 shrink-0 text-muted transition", open && "rotate-180")} />
                    ) : null}
                  </button>
                  {chargeTo != null ? (
                    <label
                      className={cn(
                        "flex h-8 shrink-0 items-center gap-0.5 rounded-full px-2 text-[11px] font-medium",
                        chargeRequired ? "bg-amber-400/15 text-amber-200" : "bg-emerald-400/15 text-emerald-300",
                      )}
                    >
                      to
                      <input
                        type="number"
                        min={1}
                        max={80}
                        value={Math.round(chargeTo)}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          const v = Math.max(5, Math.min(80, Math.round(n)));
                          setChargeToSoc((cur) => ({ ...cur, [userI]: v }));
                          setAcceptCharge((cur) => ({ ...cur, [userI]: true }));
                        }}
                        className="h-6 w-10 bg-transparent text-center text-xs tabular-nums text-foreground outline-none"
                      />
                      %
                    </label>
                  ) : null}
                  {chargeTo != null && chargedLeg?.charge && !chargeRequired ? (
                    <button
                      type="button"
                      onClick={() => setAcceptCharge((cur) => ({ ...cur, [userI]: !cur[userI] }))}
                      className={cn(
                        "h-8 shrink-0 rounded-full px-3 text-[11px] font-medium",
                        chargedLeg?.accepted
                          ? "bg-emerald-400 text-background"
                          : "bg-emerald-400/15 text-emerald-300",
                      )}
                    >
                      {chargedLeg?.accepted ? "Accepted" : "Accept"}
                    </button>
                  ) : null}
                  {inStore ? (
                    <button
                      type="button"
                      onClick={() => removeStop(stop.id)}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted"
                      aria-label={`Remove ${stop.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </div>
                {(inbound || outbound) ? (
                  <div className="mt-2 pl-10">
                    {inbound && !via ? (
                    <div className="flex rounded-full bg-surface-2 p-1">
                      {LEG_MODES.map((mode) => {
                        const on = (modes[userI] ?? "fastest") === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setLegMode(userI, mode)}
                            className={cn(
                              "h-8 flex-1 rounded-full text-[10px] font-medium",
                              on ? "bg-foreground text-background" : "text-muted",
                            )}
                          >
                            {modeLabel(mode)}
                          </button>
                        );
                      })}
                    </div>
                    ) : null}
                    {open ? (
                      <div className="mt-3">
                    <p className="text-[11px] text-subtle">
                      {modeHint((modes[userI] ?? "fastest") as LegMode)}
                    </p>
                    <div className="mt-3 flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveStop(stop.id, -1)}
                        disabled={stops.findIndex((s) => s.id === stop.id) <= 0}
                        className="flex h-8 flex-1 items-center justify-center rounded-full bg-surface-2 text-muted disabled:opacity-30"
                        aria-label={`Move ${stop.name} up`}
                      >
                        <ChevronUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStop(stop.id, 1)}
                        disabled={(() => {
                          const idx = stops.findIndex((s) => s.id === stop.id);
                          return idx < 0 || idx >= stops.length - 1;
                        })()}
                        className="flex h-8 flex-1 items-center justify-center rounded-full bg-surface-2 text-muted disabled:opacity-30"
                        aria-label={`Move ${stop.name} down`}
                      >
                        <ChevronDown className="size-4" />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="flex rounded-full bg-surface-2 p-1">
                        {(["auto", "depart", "arrive"] as const).map((kind) => {
                          const on = (legWhen[userI]?.kind ?? "auto") === kind;
                          return (
                            <button
                              key={kind}
                              type="button"
                              onClick={() =>
                                setLegWhen(userI, {
                                  kind,
                                  hhmm: kind === "auto" ? "" : asDateTime(legWhen[userI]?.at || legWhen[userI]?.hhmm || leg?.departAt || clock),
                                  at: kind === "auto" ? "" : asDateTime(legWhen[userI]?.at || legWhen[userI]?.hhmm || leg?.departAt || clock),
                                })
                              }
                              className={cn(
                                "h-8 flex-1 rounded-full text-[10px] font-medium",
                                on ? "bg-foreground text-background" : "text-muted",
                              )}
                            >
                              {kind === "auto" ? "Auto" : kind === "depart" ? "Leave" : "Arrive"}
                            </button>
                          );
                        })}
                      </div>
                      {(legWhen[userI]?.kind ?? "auto") !== "auto" ? (
                        <input
                          type="datetime-local"
                          value={asDateTime(legWhen[userI]?.at || legWhen[userI]?.hhmm || leg?.departAt || clock)}
                          onChange={(e) =>
                            setLegWhen(userI, {
                              kind: legWhen[userI]?.kind === "arrive" ? "arrive" : "depart",
                              hhmm: e.target.value,
                              at: e.target.value,
                            })
                          }
                          className="h-8 rounded-full bg-surface-2 px-3 text-xs text-foreground outline-none"
                        />
                      ) : (
                        <p className="flex h-8 items-center text-[11px] tabular-nums text-subtle">
                          {leg ? `${formatDateTime(leg.departAt)} → ${formatDateTime(leg.arriveAt)}` : "Follows previous"}
                        </p>
                      )}
                    </div>
                    <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">
                      Charge search
                    </p>
                    <div className="mt-1 flex gap-1">
                      {DETOUR_KM.map((km) => {
                        const on = (detours[userI] ?? DEFAULT_DETOUR_KM) === km;
                        return (
                          <button
                            key={km}
                            type="button"
                            onClick={() => setLegDetour(userI, km)}
                            className={cn(
                              "h-8 flex-1 rounded-full text-[11px] font-medium",
                              on ? "bg-foreground text-background" : "bg-surface-2 text-muted",
                            )}
                          >
                            {formatDetour(km, units)}
                          </button>
                        );
                      })}
                    </div>
                    {(modes[userI] ?? "fastest") === "cheapest" ? (
                      <>
                        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">
                          Max wait for cheap price
                        </p>
                        <div className="mt-1 flex gap-1">
                          {WAIT_MIN.map((min) => {
                            const on = (waits[userI] ?? DEFAULT_WAIT_MIN) === min;
                            return (
                              <button
                                key={min}
                                type="button"
                                onClick={() => setLegWait(userI, min)}
                                className={cn(
                                  "h-8 flex-1 rounded-full text-[11px] font-medium",
                                  on ? "bg-foreground text-background" : "bg-surface-2 text-muted",
                                )}
                              >
                                {formatWaitCap(min)}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : null}
                    {chargedLeg?.charge ? (
                      <div className="mt-3 space-y-2">
                        <ChargeChoice
                          title={
                            chargedLeg.advice === "required"
                              ? "Charge required"
                              : chargedLeg.advice === "suggested"
                                ? "Suggested · good price"
                                : "Charge here"
                          }
                          spot={chargedLeg.charge}
                          active
                          required={chargedLeg.needed}
                          suggested={chargedLeg.suggested}
                        />
                        <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
                          <span className="text-xs text-muted">Charge to</span>
                          <span className="flex items-center gap-1 text-sm">
                            <input
                              type="number"
                              min={1}
                              max={80}
                              value={Math.round(
                                chargeToSoc[userI] ??
                                  (chargedLeg.accepted ? chargedLeg.startSoc : chargedLeg.autoStartSoc),
                              )}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                const v = Math.max(5, Math.min(80, Math.round(n)));
                                setChargeToSoc((cur) => ({ ...cur, [userI]: v }));
                                setAcceptCharge((cur) => ({ ...cur, [userI]: true }));
                              }}
                              className="h-8 w-14 rounded-md bg-background text-center text-sm tabular-nums outline-none"
                            />
                            %
                          </span>
                        </label>
                        {chargedLeg.accepted && Math.abs(chargedLeg.extraKr) >= 0.5 ? (
                          <p
                            className={cn(
                              "text-[11px] font-medium",
                              chargedLeg.extraKr > 0 ? "text-amber-300" : "text-emerald-300",
                            )}
                          >
                            {chargedLeg.extraKr > 0 ? "+" : ""}
                            {formatKrValue(chargedLeg.extraKr, 0)} kr extra vs auto {formatNumber(chargedLeg.autoStartSoc, 0)}%
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => insertCharge(userI, chargedLeg.charge!)}
                          className="h-9 w-full rounded-full bg-surface-2 text-xs font-medium text-muted"
                        >
                          Add charger as stop
                        </button>
                        {chargedLeg.needed ? (
                          <p className="rounded-lg bg-amber-400/15 px-3 py-1.5 text-[11px] font-medium text-amber-200">
                            Charge required here to finish this leg
                          </p>
                        ) : chargedLeg.suggested ? (
                          <p className="rounded-lg bg-emerald-400/15 px-3 py-1.5 text-[11px] font-medium text-emerald-300">
                            Optional · good price, battery low enough
                          </p>
                        ) : null}
                        {chargedLeg.suggested && !chargedLeg.needed ? (
                          <button
                            type="button"
                            onClick={() =>
                              setAcceptCharge((cur) => ({ ...cur, [userI]: !cur[userI] }))
                            }
                            className={cn(
                              "h-9 w-full rounded-full text-xs font-medium",
                              chargedLeg.accepted
                                ? "bg-emerald-400 text-background"
                                : "bg-emerald-400/15 text-emerald-300",
                            )}
                          >
                            {chargedLeg.accepted ? "Accepted · SOC includes this charge" : "Accept recommended charge"}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <label className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
                        <span className="text-xs text-muted">Charge to</span>
                        <span className="flex items-center gap-1 text-sm">
                          <input
                            type="number"
                            min={1}
                            max={80}
                            value={Math.round(chargeToSoc[userI] ?? leftPct)}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              const v = Math.max(5, Math.min(80, Math.round(n)));
                              setChargeToSoc((cur) => ({ ...cur, [userI]: v }));
                              setAcceptCharge((cur) => ({ ...cur, [userI]: true }));
                            }}
                            className="h-8 w-14 rounded-md bg-background text-center text-sm tabular-nums outline-none"
                          />
                          %
                        </span>
                      </label>
                    )}
                    <div className="mt-3">
                        <BackupPicks
                          options={chargedLeg?.chargeOptions ?? []}
                          primaryId={chargedLeg?.charge?.locationId}
                          selectedId={prefer[userI] ?? backupLoc[userI]}
                          onPick={(id) => {
                            setPrefer((cur) => {
                              const next = { ...cur };
                              if (!id) delete next[userI];
                              else next[userI] = id;
                              return next;
                            });
                            setBackupLoc((cur) => {
                              const next = { ...cur };
                              if (!id) delete next[userI];
                              else next[userI] = id;
                              return next;
                            });
                          }}
                        />
                    </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="mt-3">
          <label className="text-xs text-muted">
            Add stop
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Address or place"
              className="mt-1 h-11 w-full rounded-md bg-surface-2 px-3 text-sm outline-none"
            />
          </label>
          {hits.length ? (
            <ul className="mt-2 divide-y divide-border rounded-xl bg-surface-2">
              {hits.map((hit) => (
                <li key={`${hit.lat},${hit.lng}`}>
                  <button
                    type="button"
                    onClick={() => addStop(hit)}
                    className="flex w-full items-center gap-3 px-3 py-3 text-left"
                  >
                    <Plus className="size-4 shrink-0 text-muted" />
                    <span className="truncate text-sm">{hit.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {Object.entries(PLACES)
                .filter(([name]) => {
                  if (name.includes("Supercharger") || name.includes("Wall")) return false;
                  if (name === "Home" && stops.some((s) => s.id === "home" || s.name === "Home")) return false;
                  return true;
                })
                .slice(0, 8)
                .map(([name, g]) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => {
                        if (name === "Home") {
                          addStopToStore({ id: "home", name: "Home", lat: g.lat, lng: g.lng });
                          return;
                        }
                        addStop({ label: name, lat: g.lat, lng: g.lng });
                      }}
                      className="h-9 rounded-full bg-surface-2 px-3 text-xs font-medium text-muted"
                    >
                      {g.short}
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>
      </>
      ) : null}
      </>
      )}
    </div>
  );
}

function scaleKr(networkId: string, kr: number | null, fx: FxTable | null) {
  if (kr == null || !fx) return kr;
  const native = NETWORK_NATIVE[networkId];
  if (!native) return kr;
  return scaleCatalogKr(kr, native.ccy, fx);
}

const ABO_GROUPS: { id: string; label: string; hint: string; ids: string[] }[] = [
  { id: "car", label: "Car", hint: "Owner rate on Superchargers", ids: ["tesla"] },
  { id: "highway", label: "Highway HPC", hint: "IONITY, Fastned, Electra, Allego", ids: ["ionity", "fastned", "electra", "allego"] },
  { id: "nordic", label: "Nordics", hint: "DK · NO · SE memberships", ids: ["clever", "eon", "spirii", "mer", "recharge", "kople", "eviny", "circlek", "unox"] },
  { id: "card", label: "Cards & roam", hint: "eMSP that bills other CPOs", ids: ["shell", "enbw", "aral", "total"] },
];

function NetworksPanel({
  abo,
  onToggle,
}: {
  abo: Record<string, boolean>;
  onToggle: (id: string, on: boolean) => void;
}) {
  const [region, setRegion] = useState<EuRegion>("DK");
  const [openGroup, setOpenGroup] = useState<Record<string, boolean>>({ car: true, highway: true, nordic: true });
  const [openNet, setOpenNet] = useState<string | null>(null);
  const [showRoam, setShowRoam] = useState(false);
  const prices = useChargePrices();
  const networks = prices.data?.networks ?? EU_NETWORKS;
  const fx = prices.data?.fx ?? null;
  const profile = countryProfile(region);
  const blocId = EU_REGIONS.find((r) => r.id === region)?.bloc ?? "nordic";
  const bloc = EU_BLOCS.find((b) => b.id === blocId) ?? EU_BLOCS[0];
  const byId = new Map(networks.map((n) => [n.id, n]));
  const groupedIds = new Set(ABO_GROUPS.flatMap((g) => g.ids));
  const groups = [
    ...ABO_GROUPS,
    {
      id: "other",
      label: "Other",
      hint: "",
      ids: networks.map((n) => n.id).filter((id) => !groupedIds.has(id)),
    },
  ].filter((g) => g.ids.some((id) => byId.has(id)));
  const active = networks.filter((n) => abo[n.id]);
  const rows = [...networks]
    .map((n) => {
      const on = Boolean(abo[n.id]);
      return {
        n,
        on,
        own: scaleKr(n.id, regionalOwn(n, region, on), fx),
        roam: scaleKr(n.id, regionalRoam(n, region, on), fx),
        extra: scaleKr(n.id, regionalExtra(n, region, on), fx),
      };
    })
    .filter((r) => r.own != null || r.roam != null)
    .sort((a, b) => {
      const ae = a.extra;
      const be = b.extra;
      if (ae == null && be == null) return a.n.name.localeCompare(b.n.name);
      if (ae == null) return 1;
      if (be == null) return -1;
      return be - ae;
    });

  return (
    <section className="space-y-3">
      <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Memberships</p>
        <p className="mt-1 text-sm text-muted">
          {active.length
            ? active.map((n) => n.aboName).join(" · ")
            : "None on — trip uses ad-hoc kWh"}
        </p>
        <p className="mt-1 text-[11px] text-subtle">Monthly fees stay out of the route total.</p>
      </div>

      {groups.map((group) => {
        const open = openGroup[group.id] ?? false;
        const onCount = group.ids.filter((id) => abo[id]).length;
        return (
          <div key={group.id} className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
            <button
              type="button"
              onClick={() => setOpenGroup((s) => ({ ...s, [group.id]: !open }))}
              className="flex w-full items-center justify-between px-4 py-3 text-left"
            >
              <span>
                <span className="text-sm font-medium">{group.label}</span>
                {onCount ? (
                  <span className="ml-2 text-[11px] text-emerald-400">{onCount} on</span>
                ) : (
                  <span className="ml-2 text-[11px] text-subtle">{group.hint}</span>
                )}
              </span>
              {open ? <ChevronUp className="size-4 text-muted" /> : <ChevronDown className="size-4 text-muted" />}
            </button>
            {open ? (
              <ul className="border-t border-border">
                {group.ids.map((id) => {
                  const n = byId.get(id);
                  if (!n) return null;
                  const on = Boolean(abo[n.id]);
                  const rate = on ? n.aboKr : n.spotKr;
                  const roam = roamRate(n, on);
                  const extra = roamExtra(n, on);
                  const details = openNet === n.id;
                  return (
                    <li key={n.id} className="border-t border-border first:border-0">
                      <div className="flex items-center gap-3 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setOpenNet(details ? null : n.id)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <p className="text-sm">{n.name}</p>
                          <p className="text-[11px] tabular-nums text-muted">
                            {n.unlimited && on ? "0 kr/kWh" : formatKrPerKwh(rate, 2)}
                            {n.aboMonthlyKr > 0 ? ` · ${formatKrValue(n.aboMonthlyKr, 0)} kr/md` : ""}
                            {on ? ` · ${n.aboName}` : " · ad-hoc"}
                          </p>
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          onClick={() => onToggle(n.id, !on)}
                          className={cn(
                            "h-8 shrink-0 rounded-full px-3 text-[11px] font-medium",
                            on ? "bg-emerald-400 text-background" : "bg-surface-2 text-muted",
                          )}
                        >
                          {on ? "Abo on" : "No abo"}
                        </button>
                      </div>
                      {details ? (
                        <div className="px-4 pb-3 text-[11px] text-subtle">
                          <p>
                            Spot {formatKrPerKwh(n.spotKr, 2)}
                            <span className="text-border"> · </span>
                            {n.aboName} {n.unlimited ? "unlimited" : formatKrPerKwh(n.aboKr, 2)}
                            {roam == null
                              ? " · no roam"
                              : ` · roam ${formatKrPerKwh(roam, 2)}${extra != null && extra !== 0 ? ` (${extra > 0 ? "+" : ""}${formatKrPerKwh(extra, 2)})` : ""}`}
                          </p>
                          <p className="mt-1">{n.region}</p>
                          <p className="mt-1">{n.roamNote}</p>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        );
      })}

      <div className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
        <button
          type="button"
          onClick={() => setShowRoam((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <span>
            <span className="text-sm font-medium">Roaming</span>
            <span className="ml-2 text-[11px] text-subtle">
              {region}
              {profile ? ` · ${profile.ccy}` : ""}
            </span>
          </span>
          {showRoam ? <ChevronUp className="size-4 text-muted" /> : <ChevronDown className="size-4 text-muted" />}
        </button>
        {showRoam ? (
          <div className="border-t border-border pb-2">
            {profile ? <p className="px-4 pt-3 text-[11px] text-subtle">{profile.note}</p> : null}
            <p className="px-4 pt-2 text-[11px] tabular-nums text-subtle">
              {prices.loading
                ? "Fetching FX…"
                : prices.error
                  ? prices.error
                  : prices.data
                    ? `EUR ${prices.data.fx.EUR.toFixed(3)} · NOK ${prices.data.fx.NOK.toFixed(3)} · ${prices.data.fxSource}`
                    : "Catalog rates"}
              <button type="button" onClick={() => prices.refresh()} className="ml-2 text-muted underline">
                {prices.refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </p>
            <div className="mt-2 flex flex-wrap gap-1 px-4">
              {EU_BLOCS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => {
                    if (!b.ids.includes(region)) setRegion(b.ids[0]);
                  }}
                  className={cn(
                    "h-8 rounded-full px-3 text-[11px] font-medium",
                    bloc.id === b.id ? "bg-foreground text-background" : "bg-surface-2 text-muted",
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1 px-4">
              {bloc.ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRegion(id)}
                  className={cn(
                    "h-8 rounded-full px-3 text-[11px] font-medium",
                    region === id ? "bg-foreground text-background" : "bg-surface-2 text-muted",
                  )}
                >
                  {id}
                </button>
              ))}
            </div>
            <table className="mt-2 w-full text-left text-xs">
              <thead className="text-[11px] uppercase tracking-wide text-subtle">
                <tr>
                  <th className="px-4 py-2 font-medium">Network</th>
                  <th className="px-2 py-2 font-medium">Own</th>
                  <th className="px-2 py-2 font-medium">Roam</th>
                  <th className="px-4 py-2 text-right font-medium">Extra</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ n, own, roam, extra }) => (
                  <tr key={n.id} className="border-t border-border">
                    <td className="px-4 py-2">{n.name}</td>
                    <td className="px-2 py-2 tabular-nums text-muted">
                      {own == null ? "—" : formatKrPerKwh(own, 2)}
                    </td>
                    <td className="px-2 py-2 tabular-nums text-muted">
                      {roam == null ? (own != null ? "own only" : "—") : formatKrPerKwh(roam, 2)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-right tabular-nums",
                        extra == null
                          ? "text-subtle"
                          : extra > 0.15
                            ? "text-amber-300"
                            : extra > 0
                              ? "text-muted"
                              : "text-emerald-400",
                      )}
                    >
                      {extra == null ? "—" : `${extra > 0 ? "+" : ""}${formatKrPerKwh(extra, 2)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function BackupPicks({
  options,
  primaryId,
  selectedId,
  onPick,
}: {
  options: PricedCharge[];
  primaryId?: string;
  selectedId?: string;
  onPick: (id: string) => void;
}) {
  const list = [...options]
    .sort((a, b) => a.distM - b.distM)
    .filter((o, i, arr) => arr.findIndex((x) => x.locationId === o.locationId) === i)
    .slice(0, 12);
  if (!list.length) return null;
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Nearby chargers</p>
      <ul className="mt-1 divide-y divide-border rounded-xl bg-surface-2">
        <li>
          <button
            type="button"
            onClick={() => onPick("")}
            className={cn("flex w-full items-center px-3 py-2 text-left text-xs", !selectedId && "bg-background/40")}
          >
            Auto
          </button>
        </li>
        {list.map((o) => {
          const on = selectedId === o.locationId || (!selectedId && o.locationId === primaryId);
          return (
            <li key={o.locationId}>
              <button
                type="button"
                onClick={() => onPick(o.locationId)}
                className={cn("flex w-full items-center gap-3 px-3 py-2 text-left", on && "bg-background/40")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{o.name}</span>
                  <span className="block text-[11px] text-subtle">
                    {formatKrPerKwh(o.rateKr, 2)}
                    {Number.isFinite(o.distM) ? ` · ${(o.distM / 1000).toFixed(1)} km` : ""}
                    {o.locationId === primaryId ? " · current" : ""}
                    {o.cheapest ? " · cheapest" : ""}
                    {o.nearest ? " · nearest" : ""}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums">{formatKrValue(o.kr, 0)} kr</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChargeChoice({
  title,
  spot,
  active,
  required = false,
  suggested = false,
}: {
  title: string;
  spot: PricedCharge;
  active: boolean;
  required?: boolean;
  suggested?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2",
        required
          ? "bg-amber-400/15 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.55)]"
          : suggested
            ? "bg-emerald-400/15 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.55)]"
            : active
              ? "bg-surface-2 shadow-[var(--shadow-border)]"
              : "bg-transparent",
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-[11px] font-medium uppercase tracking-wide",
            required ? "text-amber-200" : suggested ? "text-emerald-300" : "text-muted",
          )}
        >
          {title}
        </p>
        <p className="truncate text-sm">{spot.label}</p>
        <p className="text-xs text-subtle">
          {formatNumber(spot.kwh, 1)} kWh · {spot.windowLabel}
          {spot.cheapWindow ? " · cheapest" : ""}
          {spot.inBand ? "" : " · outside detour"}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm tabular-nums">{formatKrValue(spot.kr, 2)} kr</p>
        <p className="text-[11px] tabular-nums text-subtle">{formatKrPerKwh(spot.rateKr, 2)}</p>
      </div>
    </div>
  );
}

function mapsDirUrl(stops: { lat: number; lng: number }[]) {
  if (!stops.length) throw new Error("No stops to export");
  if (stops.length === 1) return teslaDestUrl(stops[0]);
  const path = stops
    .map((s) => {
      if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) throw new Error("A stop is missing coordinates");
      return `${s.lat},${s.lng}`;
    })
    .join("/");
  return `https://www.google.com/maps/dir/${path}`;
}

function teslaDestUrl(stop: { lat: number; lng: number }) {
  if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) {
    throw new Error("Destination is missing coordinates");
  }
  return `https://www.tesla.com/navigation?lat=${stop.lat}&lng=${stop.lng}`;
}

function tripTitle(stops: { name: string }[]) {
  const start = stops[0]?.name?.trim();
  const end = stops[stops.length - 1]?.name?.trim();
  if (start && end && start !== end) return `${start} → ${end}`;
  return start || end || "";
}

function formatPlanDate(value: string) {
  const { ymd, hhmm } = splitDateTime(value);
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y} ${hhmm}`;
}

function isShareCancel(err: unknown) {
  if (!(err instanceof Error)) return false;
  const name = "name" in err ? String((err as { name?: string }).name) : "";
  return name === "AbortError" || /cancel/i.test(err.message);
}

function shareErrorMessage(err: unknown) {
  if (err instanceof Error && err.message) return err.message;
  return "Could not share to Tesla nav";
}
