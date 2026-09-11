import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, MapPinned, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BayMap, type MapMarker, type MapRoute } from "@/components/bay-map";
import { searchAddress, type AddressHit } from "./search";
import {
  DETOUR_KM,
  LEG_MODES,
  type LegMode,
  type LegWhen,
  type PlanStop,
  type PricedCharge,
  type PricedLeg,
  type RoutedLeg,
  addMinutesDateTime,
  asDateTime,
  chargeSearchKm,
  cheapestHour,
  DKK_PER_USD,
  dkNowDateTime,
  defaultSpeedEff,
  epaWhPerMi,
  fetchRoute,
  formatDateTime,
  formatDetour,
  interpolateWhPerMi,
  avgSpeedKmh,
  minutesToHm,
  modeColor,
  modeHint,
  modeLabel,
  planTotals,
  pricePlan,
  remainingHours,
  SPEED_KMH,
} from "./engine";
import { usePlanStore } from "./store";
import { formatKrPerKwh, formatKrValue, type HourPrice } from "@/lib/elpris";
import { applyTillægToHours, providerById, withTillæg } from "@/lib/el-providers";
import { PLACES } from "@/lib/places";
import { cn } from "@/lib/utils";
import { formatDistance, formatEfficiency, formatNumber } from "@/lib/vehicle";
import { HOME_USD_PER_KWH } from "@/lib/history";
import { useChargeStore } from "@/store/charge-store";
import { useElprisStore } from "@/store/elpris-store";
import { NETWORK_NATIVE, scaleCatalogKr, type FxTable } from "./charge-fx";
import { countryProfile } from "./country-profiles";
import { minDistToPathM } from "./insert";
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
  eco: -480,
  standard: -160,
  fastest: 160,
  cheapest: 480,
};

function routeKey(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: LegMode,
) {
  const path = mode === "cheapest" ? "standard" : mode;
  return `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}|${path}`;
}

const PATH_MODES: LegMode[] = ["eco", "standard", "fastest"];

export function PlanScreen() {
  const units = useVehicleStore((s) => s.units);
  const soc = useVehicleStore((s) => s.soc);
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
  const saved = usePlanStore((s) => s.saved);
  const setName = usePlanStore((s) => s.setName);
  const addStopToStore = usePlanStore((s) => s.addStop);
  const insertStopAt = usePlanStore((s) => s.insertStopAt);
  const removeStop = usePlanStore((s) => s.removeStop);
  const moveStop = usePlanStore((s) => s.moveStop);
  const setLegMode = usePlanStore((s) => s.setLegMode);
  const setLegDetour = usePlanStore((s) => s.setLegDetour);
  const setAllModes = usePlanStore((s) => s.setAllModes);
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

  const [routeMap, setRouteMap] = useState<Record<string, RoutedLeg>>({});
  const [routing, setRouting] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [prefer, setPrefer] = useState<Record<number, string>>({});
  const [acceptCharge, setAcceptCharge] = useState<Record<number, boolean>>({});
  const [chargeToSoc, setChargeToSoc] = useState<Record<number, number>>({});
  const [backupLoc, setBackupLoc] = useState<Record<number, string>>({});
  const [showRoutes, setShowRoutes] = useState<Record<LegMode, boolean>>({
    eco: true,
    standard: true,
    fastest: true,
    cheapest: true,
  });
  const [openStops, setOpenStops] = useState<Record<string, boolean>>({});
  const [pane, setPane] = useState<"plan" | "advanced">("plan");
  const { data: elpris, error: elprisError, loading: elprisLoading } = useLiveElpris(area);

  useEffect(() => {
    void Promise.all([
      useVehicleStore.persist.rehydrate(),
      useChargeStore.persist.rehydrate(),
      usePlanStore.persist.rehydrate(),
    ]).catch(() => {
      /* localStorage may be unavailable */
    });
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
    if (stops.length < 2) {
      setRouteMap({});
      return;
    }
    let cancelled = false;
    setRouting(true);
    void (async () => {
      const next: Record<string, RoutedLeg> = {};
      const jobs: Promise<void>[] = [];
      for (let i = 0; i < stops.length - 1; i++) {
        for (const mode of PATH_MODES) {
          const from = stops[i];
          const to = stops[i + 1];
          const key = routeKey(from, to, mode);
          jobs.push(
            fetchRoute(from, to, mode).then((route) => {
              next[key] = route;
            }),
          );
        }
      }
      await Promise.all(jobs);
      if (!cancelled) {
        setRouteMap(next);
        setRouting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stops]);

  useEffect(() => {
    setPrefer({});
    setAcceptCharge({});
    setChargeToSoc({});
    setBackupLoc({});
  }, [stops, detours]);

  const carWhPerMi = epaWhPerMi(profile.usableKwh, profile.epaRangeMi);
  const speedEff = speedEffOverride ?? defaultSpeedEff(whPerMiOverride && whPerMiOverride > 0 ? whPerMiOverride : carWhPerMi);
  const clock = asDateTime(when || dkNowDateTime());

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
      if (!hit) return [];
      list.push(hit);
    }
    return list;
  }

  const activeModes = modes.length ? modes : stops.slice(1).map(() => "standard" as LegMode);
  const mixed = activeModes.some((m) => m !== activeModes[0]);
  const routes = routesFor(mixed ? "standard" : (activeModes[0] ?? "standard"));
  const selectedRoutes = mixed
    ? stops.slice(0, -1).map((_, i) => routeMap[routeKey(stops[i], stops[i + 1], activeModes[i] ?? "standard")]).filter((r): r is RoutedLeg => Boolean(r))
    : routes;

  const searchRoutes = useMemo(() => {
    const all: RoutedLeg[] = [];
    const seen = new Set<string>();
    for (const r of selectedRoutes) {
      const k = `${r.path[0]?.join()}-${r.path.at(-1)?.join()}-${r.miles.toFixed(1)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(r);
    }
    for (const mode of LEG_MODES) {
      for (const r of routesFor(mode)) {
        const k = `${r.path[0]?.join()}-${r.path.at(-1)?.join()}-${mode}`;
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(r);
      }
    }
    return all;
  }, [selectedRoutes, routeMap, stops]);

  const { chargers: routeChargers, loading: chargersLoading } = useRouteChargers(searchRoutes);

  const locations = useMemo(() => {
    const paths = searchRoutes.map((r) => r.path).filter((p) => p.length >= 2);
    const europe = paths.some((p) => p.some(([lat, lng]) => lat > 34 && lng > -12 && lng < 42));
    const keep = locationsStored.filter((l) => {
      if (l.id.startsWith("osm-")) return false;
      if (europe && l.preset && l.lng < -20) return false;
      if (l.kind === "home" || !l.preset) return true;
      return paths.some((p) => minDistToPathM(l.lat, l.lng, p) < 80_000);
    });
    const byId = new Map(keep.map((l) => [l.id, l]));
    for (const c of routeChargers) byId.set(c.id, c);
    return [...byId.values()];
  }, [locationsStored, routeChargers, searchRoutes]);

  const driveMinGuess = selectedRoutes.reduce((n, r) => n + r.seconds / 60, 0);
  const departHhmm =
    whenKind === "arrive" ? addMinutesDateTime(clock, -driveMinGuess) : clock;

  const planArgs = {
    stops,
    detours: detours.length ? detours : stops.slice(1).map(() => 10),
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
    memberships: networkAbo,
  };

  const legs: PricedLeg[] = useMemo(() => {
    if (stops.length < 2 || selectedRoutes.length !== stops.length - 1) return [];
    return pricePlan({
      ...planArgs,
      modes: activeModes,
      routes: selectedRoutes,
    });
  }, [stops, activeModes, detours, selectedRoutes, soc, profile.usableKwh, profile.acKw, locations, hours, acKr, speedEff, departHhmm, legWhen, acceptCharge, chargeToSoc, backupLoc, networkAbo]);

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

  const optionRows = useMemo(() => {
    return LEG_MODES.map((mode) => {
      const optionRoutes = routesFor(mode);
      if (optionRoutes.length !== Math.max(0, stops.length - 1) || stops.length < 2) {
        return { mode, totals: null as ReturnType<typeof planTotals> | null, kmh: 0, kwhPerMi: 0 };
      }
      const priced = pricePlan({
        ...planArgs,
        modes: stops.slice(1).map(() => mode),
        routes: optionRoutes,
      });
      const miles = optionRoutes.reduce((n, r) => n + r.miles, 0);
      const seconds = optionRoutes.reduce((n, r) => n + r.seconds, 0);
      const kmh = avgSpeedKmh(miles, seconds);
      return {
        mode,
        totals: planTotals(priced),
        kmh,
        kwhPerMi: interpolateWhPerMi(speedEff, kmh) / 1000,
      };
    });
  }, [routeMap, stops, detours, soc, profile.usableKwh, profile.acKw, locations, hours, acKr, speedEff, departHhmm, legWhen, acceptCharge, chargeToSoc, backupLoc, networkAbo]);

  function addStop(hit: AddressHit) {
    addStopToStore({ name: hit.label.split(",")[0] || hit.label, lat: hit.lat, lng: hit.lng });
    setQuery("");
    setHits([]);
    setSelected(`leg-${stops.length - 1}`);
  }

  function dropStop(lat: number, lng: number) {
    addStop({ label: "Pinned stop", lat, lng });
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
    const chg = /^chg-(\d+)-(.+)$/.exec(id);
    if (chg) {
      const i = Number(chg[1]);
      const locId = chg[2];
      const leg = viewLegs[i];
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
    const opt = /^opt-(eco|standard|fastest|cheapest)-(\d+)$/.exec(id);
    if (opt) {
      const mode = opt[1] as LegMode;
      const i = Number(opt[2]);
      setLegMode(i, mode);
      setSelected(`leg-${i}`);
      openLegStop(i);
    }
  }

  const selectedIds = (() => {
    const ids = new Set<string>();
    if (!selected) return [] as string[];
    ids.add(selected);
    const legHit = /^leg-(\d+)$/.exec(selected) ?? /^chg-(\d+)-/.exec(selected);
    if (legHit) {
      const i = Number(legHit[1]);
      ids.add(`leg-${i}`);
      for (const mode of LEG_MODES) ids.add(`opt-${mode}-${i}`);
      const leg = viewLegs[i];
      if (leg?.charge) ids.add(`chg-${i}-${leg.charge.locationId}`);
      if (leg?.backup) ids.add(`chg-${i}-${leg.backup.locationId}`);
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
  })();

  function onSave() {
    const plan = savePlan();
    if (!plan) {
      toast("Add a destination first");
      return;
    }
    toast(`Saved ${plan.name}`);
  }

  const mapRoutes: MapRoute[] = [];
  if (stops.length >= 2) {
    for (const mode of LEG_MODES) {
      if (!showRoutes[mode]) continue;
      for (let i = 0; i < stops.length - 1; i++) {
        const hit =
          routeMap[routeKey(stops[i], stops[i + 1], mode)] ??
          (mode === "cheapest" ? routeMap[routeKey(stops[i], stops[i + 1], "standard")] : undefined);
        if (!hit) continue;
        const raw =
          hit.path.length >= 2
            ? hit.path
            : ([[stops[i].lat, stops[i].lng], [stops[i + 1].lat, stops[i + 1].lng]] as [number, number][]);
        mapRoutes.push({
          id: `opt-${mode}-${i}`,
          from: [stops[i].lat, stops[i].lng],
          to: [stops[i + 1].lat, stops[i + 1].lng],
          weight: 3,
          path: offsetPath(raw, ROUTE_OFFSET_M[mode]),
          color: modeColor(mode),
        });
      }
    }
  }

  const chargerMarkers: MapMarker[] = [];
  for (const [i, leg] of viewLegs.entries()) {
    for (const spot of [leg.charge, leg.backup]) {
      if (!spot) continue;
      const loc = locations.find((x) => x.id === spot.locationId);
      if (!loc) continue;
      const isBackup = leg.backup?.locationId === spot.locationId && leg.charge?.locationId !== spot.locationId;
      const required = Boolean(!isBackup && leg.needed);
      const suggested = Boolean(!isBackup && !required && leg.suggested);
      chargerMarkers.push({
        id: `chg-${i}-${spot.locationId}`,
        lat: loc.lat,
        lng: loc.lng,
        label: required
          ? `Required · ${spot.name}`
          : suggested
            ? `Suggested · ${spot.name}`
            : isBackup
              ? `Backup · ${spot.name}`
              : spot.name,
        kind: "charger",
        badge: required ? "!" : suggested ? "+" : isBackup ? "B" : "C",
      });
    }
  }
  const billedIds = new Set(
    chargerMarkers.map((m) => m.id.replace(/^chg-\d+-/, "").replace(/^corridor-/, "")),
  );
  for (const loc of routeChargers) {
    if (billedIds.has(loc.id)) continue;
    const onPath = searchRoutes.some((r) => minDistToPathM(loc.lat, loc.lng, r.path) < 32_000);
    if (!onPath) continue;
    chargerMarkers.push({
      id: `corridor-${loc.id}`,
      lat: loc.lat,
      lng: loc.lng,
      label: loc.short || loc.name,
      kind: "charger",
      badge: (loc.networkId || loc.short || "C").slice(0, 1).toUpperCase(),
    });
  }
  const mapMarkers: MapMarker[] = [
    ...stops.map((s, i) => ({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      label: s.name,
      kind: (s.id === "home" || s.name === "Home" ? "home" : "place") as MapMarker["kind"],
      badge: String(i + 1),
    })),
    ...viewLegs
      .filter((leg) => leg.via)
      .map((leg) => ({
        id: leg.to.id,
        lat: leg.to.lat,
        lng: leg.to.lng,
        label: `via ${leg.to.name}`,
        kind: "charger" as MapMarker["kind"],
        badge: "⚡",
      })),
    ...chargerMarkers,
  ];

  const live = elpris?.current
    ? withTillæg(elpris.current.krPerKwh, provider.tillægOre)
    : null;
  const cheap = cheapestHour(hours);

  return (
    <div className="space-y-5 px-4 pb-6">
      <div className="flex items-start justify-between gap-3 px-1">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Plan</p>
          <p className="mt-1 text-xs text-subtle">
            {live != null ? (
              <>
                Live {formatKrPerKwh(live, 3)} · {area} · {provider.name}
              </>
            ) : elprisLoading ? (
              "Fetching live spot…"
            ) : elprisError ? (
              elprisError
            ) : (
              "No live price"
            )}
          </p>
          {cheap && live != null && cheap.krPerKwh < live - 0.001 ? (
            <p className="mt-0.5 text-xs text-accent">
              Cheapest {cheap.hour}:00 · {formatKrPerKwh(cheap.krPerKwh, 3)}
            </p>
          ) : null}
        </div>
        <MapPinned className="mt-1 size-4 text-muted" />
      </div>

      <div className="flex rounded-full bg-surface-2 p-1">
        {(["plan", "advanced"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setPane(id)}
            className={cn(
              "h-9 flex-1 rounded-full text-xs font-medium",
              pane === id ? "bg-foreground text-background" : "text-muted",
            )}
          >
            {id === "plan" ? "Plan" : "Advanced"}
          </button>
        ))}
      </div>

      {pane === "advanced" ? (
        <NetworksPanel abo={networkAbo} onToggle={setNetworkAbo} />
      ) : (
      <>

      <section className="rounded-xl bg-surface px-5 py-5 shadow-[var(--shadow-border)]">
        <label className="block text-xs text-muted">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekend coast / work run"
            className="mt-1 h-11 w-full rounded-md bg-surface-2 px-3 text-sm text-foreground outline-none"
          />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <label className="text-xs text-muted">
            {whenKind === "arrive" ? "Arrive by" : "Leave at"}
            <input
              type="datetime-local"
              value={clock}
              onChange={(e) => setWhen(e.target.value)}
              className="mt-1 h-11 w-full rounded-md bg-surface-2 px-3 text-sm text-foreground outline-none"
            />
          </label>
          <div>
            <p className="text-xs text-muted">Timing</p>
            <div className="mt-1 flex rounded-full bg-surface-2 p-1">
              {(["depart", "arrive"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setWhenKind(kind)}
                  className={cn(
                    "h-9 flex-1 rounded-full text-[11px] font-medium",
                    whenKind === kind ? "bg-foreground text-background" : "text-muted",
                  )}
                >
                  {kind === "depart" ? "Leave" : "Arrive"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">
          {profile.usableKwh} kWh usable · {formatNumber(soc, 0)}% now
        </p>
        <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">
          kWh/mi at speed
        </p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {SPEED_KMH.map((kmh) => (
            <label key={kmh} className="text-[11px] text-muted">
              {kmh} km/t
              <input
                type="number"
                inputMode="decimal"
                min={0.08}
                max={0.6}
                step={0.005}
                value={(speedEff[kmh] / 1000).toFixed(3)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n) || n <= 0) return;
                  setSpeedEff({ ...speedEff, [kmh]: n * 1000 });
                }}
                className="mt-1 h-11 w-full rounded-md bg-surface-2 px-2 text-center text-sm tabular-nums text-foreground outline-none"
              />
            </label>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-subtle">
          Interpolated from each leg’s average speed · car EPA {formatEfficiency(carWhPerMi, units)}
          {speedEffOverride ? (
            <>
              {" · "}
              <button type="button" className="text-muted underline" onClick={() => setSpeedEff(null)}>
                Reset
              </button>
            </>
          ) : null}
        </p>

        <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-muted">Route options</p>
        <p className="mt-1 text-[11px] text-subtle">
          Eco / fastest change the roads. Cheapest keeps the standard path and hunts cheaper power.
        </p>
        <ul className="mt-2 divide-y divide-border rounded-xl bg-surface-2">
          {optionRows.map((row) => {
            const on = !mixed && activeModes[0] === row.mode;
            const t = row.totals;
            const standard = optionRows.find((r) => r.mode === "standard")?.totals;
            const sameCorridor =
              Boolean(
                t &&
                  standard &&
                  row.mode !== "standard" &&
                  Math.abs(standard.mi - t.mi) < 0.8 &&
                  Math.abs(standard.driveMin - t.driveMin) < 2,
              );
            return (
              <li key={row.mode}>
                <button
                  type="button"
                  onClick={() => setAllModes(row.mode)}
                  className={cn("flex w-full items-start gap-3 px-3 py-3 text-left", on && "bg-background/40")}
                >
                  <span
                    className="mt-1.5 size-2.5 shrink-0 rounded-full"
                    style={{ background: modeColor(row.mode) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium">{modeLabel(row.mode)}</span>
                      <span className="text-sm tabular-nums">{t ? `${formatKrValue(t.kr, 0)} kr` : "—"}</span>
                    </span>
                    {t ? (
                      <>
                        <span className="mt-0.5 block text-xs text-muted">
                          {formatDistance(t.mi, units, t.mi >= 100 ? 0 : 1)}
                          <span className="text-subtle"> · </span>
                          {minutesToHm(t.driveMin)} drive
                          <span className="text-subtle"> · </span>
                          {formatNumber(row.kmh, 0)} km/t
                          {row.mode === "cheapest"
                            ? " · standard path"
                            : sameCorridor
                              ? " · same corridor"
                              : ""}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {t.charges > 0
                            ? `${t.charges} ${t.charges === 1 ? "charge" : "charges"}`
                            : "no charge"}
                          {row.mode === "cheapest" || t.waitMin > 0
                            ? ` · ${t.waitMin > 0 ? minutesToHm(t.waitMin) : "no"} wait`
                            : ""}
                        </span>
                      </>
                    ) : (
                      <span className="mt-0.5 block text-xs text-subtle">{routing ? "Routing…" : "Add a stop"}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-xs font-medium text-muted">
          {stops.length < 2
            ? "Add a destination"
            : routing
              ? "Routing…"
              : mixed
                ? "Mixed legs"
                : `${modeLabel(activeModes[0] ?? "standard")} · ${viewLegs.length} ${viewLegs.length === 1 ? "leg" : "legs"}`}
        </p>
        <p className="mt-2 text-4xl font-medium tracking-tight tabular-nums">
          {formatDistance(totals.mi, units, totals.mi >= 100 ? 0 : 1)}
        </p>
        <p className="mt-2 text-sm text-muted">
          {formatNumber(totals.kwh, 1)} kWh drive
          <span className="text-subtle"> · </span>
          {totals.chargeKwh > 0 ? `${formatNumber(totals.chargeKwh, 1)} kWh charge` : `${formatNumber(soc, 0)}% start`}
          <span className="text-subtle"> · </span>
          {minutesToHm(totals.min)}
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
        {hours.length ? (
          <HourRibbon hours={hours} currentHour={elpris?.current?.hour ?? null} cheapHour={cheap?.hour ?? null} />
        ) : null}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onSave}
            className="h-11 flex-1 rounded-full bg-foreground text-sm font-medium text-background"
          >
            Save plan
          </button>
          <button
            type="button"
            onClick={() => reset()}
            className="h-11 rounded-full bg-surface-2 px-4 text-sm font-medium text-muted"
          >
            Clear
          </button>
        </div>
      </section>

      {saved.length ? (
        <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <p className="text-sm font-medium">Saved</p>
          <ul className="mt-2">
            {saved.map((plan) => (
              <li key={plan.id} className="flex items-center gap-3 border-b border-border py-3 last:border-0">
                <button
                  type="button"
                  onClick={() => loadPlan(plan.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm">{plan.name}</p>
                  <p className="text-xs text-muted">
                    {plan.stops.length} stops · {plan.stops.map((s) => s.name).join(" → ")}
                  </p>
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
        <div className="flex flex-wrap gap-1">
          {LEG_MODES.map((mode) => {
            const on = showRoutes[mode];
            return (
              <button
                key={mode}
                type="button"
                onClick={() => setShowRoutes((cur) => ({ ...cur, [mode]: !cur[mode] }))}
                className={cn(
                  "h-8 rounded-full px-3 text-[11px] font-medium",
                  on ? "text-background" : "bg-surface-2 text-muted",
                )}
                style={on ? { background: modeColor(mode) } : undefined}
              >
                {modeLabel(mode)}
              </button>
            );
          })}
        </div>
        <BayMap
          markers={mapMarkers}
          routes={mapRoutes}
          selectedId={selected}
          selectedIds={selectedIds}
          onSelect={onMapSelect}
          onDrop={dropStop}
          dropping
          caption={routing ? "Routing…" : "Tap a leg or charger · tap map to add a stop"}
          hidden={!shareLocation}
        />
      </div>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">Stops</p>
        <ol className="mt-2">
          {timeline.map(({ stop, inbound, outbound, via, index: i }) => {
            const userI = outbound?.userIndex ?? inbound?.userIndex ?? Math.max(0, i - 1);
            const leg = inbound;
            const open = Boolean(openStops[stop.id]);
            const selectedHere =
              selected === stop.id ||
              selected === `leg-${userI}` ||
              Boolean(selected?.startsWith(`chg-${userI}-`));
            const leftPct = inbound ? inbound.arriveSoc : soc;
            const chargeLeg = outbound;
            const chargeTo =
              chargeLeg?.charge && (chargeLeg.needed || chargeLeg.suggested || (!via && chargeToSoc[userI] != null))
                ? chargeLeg.accepted
                  ? chargeLeg.startSoc
                  : chargeLeg.autoStartSoc
                : null;
            const extraKr = chargeLeg?.accepted ? chargeLeg.extraKr : 0;
            const chargeRequired = Boolean(chargeLeg?.needed);
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
                    onClick={() => {
                      setSelected(inbound ? `leg-${userI}` : stop.id);
                      if (inbound) setOpenStops((cur) => ({ ...cur, [stop.id]: !cur[stop.id] }));
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
                        {chargeTo != null ? (
                          <span
                            className={cn(
                              "tabular-nums",
                              chargeRequired ? "font-medium text-amber-300" : "font-medium text-emerald-400",
                            )}
                          >
                            {chargeRequired ? " · required" : chargeLeg?.accepted ? " · accepted" : " · recommended"}
                            {chargeLeg?.accepted && Math.abs(extraKr) >= 0.5
                              ? ` · ${extraKr > 0 ? "+" : ""}${formatKrValue(extraKr, 0)} kr`
                              : ""}
                          </span>
                        ) : null}
                      </p>
                      {!open && inbound?.backup ? (
                        <p className="truncate text-[11px] text-subtle">Backup · {inbound.backup.name}</p>
                      ) : !open && inbound?.charge ? (
                        <p className="truncate text-[11px] text-subtle">{inbound.charge.name}</p>
                      ) : !open && outbound?.backup ? (
                        <p className="truncate text-[11px] text-subtle">Backup · {outbound.backup.name}</p>
                      ) : !open && outbound?.charge ? (
                        <p className="truncate text-[11px] text-subtle">{outbound.charge.name}</p>
                      ) : null}
                    </div>
                    {inbound ? (
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
                        max={100}
                        value={Math.round(chargeTo)}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          const v = Math.max(1, Math.min(100, Math.round(n)));
                          setChargeToSoc((cur) => ({ ...cur, [userI]: v }));
                          setAcceptCharge((cur) => ({ ...cur, [userI]: true }));
                        }}
                        className="h-6 w-10 bg-transparent text-center text-xs tabular-nums text-foreground outline-none"
                      />
                      %
                    </label>
                  ) : null}
                  {chargeTo != null && !chargeRequired ? (
                    <button
                      type="button"
                      onClick={() => setAcceptCharge((cur) => ({ ...cur, [userI]: !cur[userI] }))}
                      className={cn(
                        "h-8 shrink-0 rounded-full px-3 text-[11px] font-medium",
                        chargeLeg?.accepted
                          ? "bg-emerald-400 text-background"
                          : "bg-emerald-400/15 text-emerald-300",
                      )}
                    >
                      {chargeLeg?.accepted ? "Accepted" : "Accept"}
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
                {inbound && !via ? (
                  <div className="mt-2 pl-10">
                    <div className="flex rounded-full bg-surface-2 p-1">
                      {LEG_MODES.map((mode) => {
                        const on = (modes[userI] ?? "standard") === mode;
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
                    {open ? (
                      <div className="mt-3">
                    <p className="text-[11px] text-subtle">
                      {modeHint((modes[userI] ?? "standard") as LegMode)}
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
                      {(modes[userI] ?? "standard") === "cheapest"
                        ? `Charge search · up to ${chargeSearchKm("cheapest", detours[userI] ?? 10)} km`
                        : "Max charge detour"}
                    </p>
                    <div className="mt-1 flex gap-1">
                      {DETOUR_KM.map((km) => {
                        const on = (detours[userI] ?? 10) === km;
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
                    {leg?.charge ? (
                      <div className="mt-3 space-y-2">
                        <ChargeChoice
                          title={
                            leg.advice === "required"
                              ? "Charge required"
                              : leg.advice === "suggested"
                                ? "Suggested · good price"
                                : "Charge here"
                          }
                          spot={leg.charge}
                          active
                          required={leg.needed}
                          suggested={leg.suggested}
                        />
                        <label className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2">
                          <span className="text-xs text-muted">Charge to</span>
                          <span className="flex items-center gap-1 text-sm">
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={Math.round(
                                chargeToSoc[userI] ?? (leg.accepted ? leg.startSoc : leg.autoStartSoc),
                              )}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                const v = Math.max(1, Math.min(100, Math.round(n)));
                                setChargeToSoc((cur) => ({ ...cur, [userI]: v }));
                                setAcceptCharge((cur) => ({ ...cur, [userI]: true }));
                              }}
                              className="h-8 w-14 rounded-md bg-background text-center text-sm tabular-nums outline-none"
                            />
                            %
                          </span>
                        </label>
                        {leg.accepted && Math.abs(leg.extraKr) >= 0.5 ? (
                          <p
                            className={cn(
                              "text-[11px] font-medium",
                              leg.extraKr > 0 ? "text-amber-300" : "text-emerald-300",
                            )}
                          >
                            {leg.extraKr > 0 ? "+" : ""}
                            {formatKrValue(leg.extraKr, 0)} kr vs {formatNumber(leg.autoStartSoc, 0)}% plan
                          </p>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => insertCharge(userI, leg.charge!)}
                          className="h-9 w-full rounded-full bg-surface-2 text-xs font-medium text-muted"
                        >
                          Add charger as stop
                        </button>
                        {leg.needed ? (
                          <p className="rounded-lg bg-amber-400/15 px-3 py-1.5 text-[11px] font-medium text-amber-200">
                            Charge required here to finish this leg
                          </p>
                        ) : leg.suggested ? (
                          <p className="rounded-lg bg-emerald-400/15 px-3 py-1.5 text-[11px] font-medium text-emerald-300">
                            Optional · good price, battery low enough
                          </p>
                        ) : null}
                        {leg.suggested && !leg.needed ? (
                          <button
                            type="button"
                            onClick={() =>
                              setAcceptCharge((cur) => ({ ...cur, [userI]: !cur[userI] }))
                            }
                            className={cn(
                              "h-9 w-full rounded-full text-xs font-medium",
                              leg.accepted
                                ? "bg-emerald-400 text-background"
                                : "bg-emerald-400/15 text-emerald-300",
                            )}
                          >
                            {leg.accepted ? "Accepted · SOC includes this charge" : "Accept recommended charge"}
                          </button>
                        ) : null}
                        {leg.backup ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPrefer((cur) => ({ ...cur, [userI]: leg.backup!.locationId }))
                            }
                            className="block w-full text-left"
                          >
                            <ChargeChoice
                              title={backupLoc[userI] ? "Backup · manual" : "Backup"}
                              spot={leg.backup}
                              active={false}
                            />
                          </button>
                        ) : (
                          <p className="text-[11px] text-subtle">No backup in this detour</p>
                        )}
                        <BackupPicks
                          options={leg.chargeOptions}
                          primaryId={leg.charge?.locationId}
                          selectedId={backupLoc[userI]}
                          onPick={(id) =>
                            setBackupLoc((cur) => {
                              const next = { ...cur };
                              if (!id) delete next[userI];
                              else next[userI] = id;
                              return next;
                            })
                          }
                        />
                      </div>
                    ) : null}
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

function NetworksPanel({
  abo,
  onToggle,
}: {
  abo: Record<string, boolean>;
  onToggle: (id: string, on: boolean) => void;
}) {
  const [region, setRegion] = useState<EuRegion>("DK");
  const prices = useChargePrices();
  const networks = prices.data?.networks ?? EU_NETWORKS;
  const fx = prices.data?.fx ?? null;
  const profile = countryProfile(region);
  const blocId = EU_REGIONS.find((r) => r.id === region)?.bloc ?? "nordic";
  const bloc = EU_BLOCS.find((b) => b.id === blocId) ?? EU_BLOCS[0];
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
      <p className="text-sm text-muted">
        EU public networks. Spot is pay-as-you-go. Flip <span className="text-foreground">Abo</span> if
        you have that membership — trip cost uses the cheaper kWh. Monthly fees stay out of the
        route total.
      </p>
      <p className="text-[11px] tabular-nums text-subtle">
        {prices.loading
          ? "Fetching FX…"
          : prices.error
            ? prices.error
            : prices.data
              ? `EUR ${prices.data.fx.EUR.toFixed(3)} · NOK ${prices.data.fx.NOK.toFixed(3)} DKK · ${prices.data.fxSource} · ${prices.data.updatedAt.slice(11, 16)} UTC`
              : "Catalog rates"}
        <button
          type="button"
          onClick={() => prices.refresh()}
          className="ml-2 text-muted underline"
        >
          {prices.refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </p>
      {profile ? (
        <div className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            {profile.name} · {profile.ccy}
          </p>
          <p className="mt-1 text-sm">{profile.note}</p>
          <p className="mt-2 text-[11px] text-subtle">
            CPOs · {profile.cpos.map((id) => networks.find((n) => n.id === id)?.name ?? id).join(" · ")}
          </p>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
        <p className="px-4 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted">
          Roaming vs own · {region}
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
            {rows.map(({ n, on, own, roam, extra }) => (
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
      <ul className="space-y-2">
        {networks.map((n) => {
          const on = Boolean(abo[n.id]);
          const rate = on ? n.aboKr : n.spotKr;
          const roam = roamRate(n, on);
          const extra = roamExtra(n, on);
          return (
            <li key={n.id} className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{n.name}</p>
                  <p className="text-[11px] text-subtle">{n.region}</p>
                </div>
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
              <p className="mt-2 text-xs tabular-nums text-muted">
                Spot {formatKrPerKwh(n.spotKr, 2)}
                <span className="text-subtle"> · </span>
                {n.aboName} {n.unlimited ? "unlimited" : formatKrPerKwh(n.aboKr, 2)}
                {n.aboMonthlyKr > 0 ? ` · ${formatKrValue(n.aboMonthlyKr, 0)} kr/md` : ""}
              </p>
              <p className="mt-1 text-sm tabular-nums">
                Using {n.unlimited && on ? "0 kr/kWh" : formatKrPerKwh(rate, 2)}
                {roam == null
                  ? " · no roam"
                  : ` · roam ${formatKrPerKwh(roam, 2)}${extra != null && extra !== 0 ? ` (${extra > 0 ? "+" : ""}${formatKrPerKwh(extra, 2)})` : ""}`}
              </p>
              <p className="mt-1 text-[11px] text-subtle">{n.roamNote}</p>
              <p className="mt-1 text-[11px] text-subtle">{n.note}</p>
            </li>
          );
        })}
      </ul>
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
  const list = options.filter((o) => o.locationId !== primaryId).slice(0, 8);
  if (!list.length) return null;
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Backup · nearest / cheapest</p>
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
          const on = selectedId === o.locationId;
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

function HourRibbon({
  hours,
  currentHour,
  cheapHour,
}: {
  hours: HourPrice[];
  currentHour: string | null;
  cheapHour: string | null;
}) {
  const shown = hours.slice(0, 24);
  const { min, max } = shown.reduce(
    (acc, h) => ({
      min: Math.min(acc.min, h.krPerKwh),
      max: Math.max(acc.max, h.krPerKwh),
    }),
    { min: Infinity, max: -Infinity },
  );
  const span = max - min || 1;
  return (
    <div className="mt-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Live hours</p>
      <div className="mt-2 flex h-10 items-end gap-px">
        {shown.map((h) => {
          const t = (h.krPerKwh - min) / span;
          const current = h.hour === currentHour;
          const cheapMark = h.hour === cheapHour && h.hour !== currentHour;
          return (
            <div
              key={h.timeDk}
              title={`${h.hour}:00 · ${formatKrPerKwh(h.krPerKwh, 3)}`}
              className={cn(
                "min-w-0 flex-1 rounded-sm",
                current && "bg-foreground",
                cheapMark && "bg-accent",
                !current && !cheapMark && t >= 0.75 && "bg-danger/70",
                !current && !cheapMark && t < 0.75 && t > 0.33 && "bg-muted",
                !current && !cheapMark && t <= 0.33 && "bg-accent/50",
              )}
              style={{ height: `${18 + Math.round(t * 22)}px` }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-subtle">
        <span>{shown[0]?.hour}:00</span>
        <span>now · cheap in accent</span>
        <span>{shown[shown.length - 1]?.hour}:00</span>
      </div>
    </div>
  );
}
