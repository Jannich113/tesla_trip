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
  addMinutesHhmm,
  chargeSearchKm,
  cheapestHour,
  DKK_PER_USD,
  dkNowHhmm,
  defaultSpeedEff,
  epaWhPerMi,
  fetchRoute,
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
import { useLiveElpris } from "./use-live-elpris";
import { useVehicleProfile } from "@/hooks/use-vehicle-profile";
import { useVehicleStore } from "@/store/vehicle-store";

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
  const locations = useChargeStore((s) => s.locations);
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
  const [showRoutes, setShowRoutes] = useState<Record<LegMode, boolean>>({
    eco: true,
    standard: true,
    fastest: true,
    cheapest: false,
  });
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
  }, [stops, detours]);

  const carWhPerMi = epaWhPerMi(profile.usableKwh, profile.epaRangeMi);
  const speedEff = speedEffOverride ?? defaultSpeedEff(whPerMiOverride && whPerMiOverride > 0 ? whPerMiOverride : carWhPerMi);
  const clock = when || dkNowHhmm();

  const hours = useMemo(() => {
    if (!elpris) return [];
    return remainingHours(
      applyTillægToHours(elpris.today, provider.tillægOre),
      applyTillægToHours(elpris.tomorrow, provider.tillægOre),
      elpris.current?.hour ?? null,
    );
  }, [elpris, provider.tillægOre]);

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

  const driveMinGuess = selectedRoutes.reduce((n, r) => n + r.seconds / 60, 0);
  const departHhmm =
    whenKind === "arrive" ? addMinutesHhmm(clock, -driveMinGuess) : clock;

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
  };

  const legs: PricedLeg[] = useMemo(() => {
    if (stops.length < 2 || selectedRoutes.length !== stops.length - 1) return [];
    return pricePlan({
      ...planArgs,
      modes: activeModes,
      routes: selectedRoutes,
    });
  }, [stops, activeModes, detours, selectedRoutes, soc, profile.usableKwh, profile.acKw, locations, hours, acKr, speedEff, departHhmm, legWhen]);

  const viewLegs = useMemo(() => {
    return legs.map((leg, i) => {
      const id = prefer[i];
      if (!id || !leg.charge || !leg.backup || id !== leg.backup.locationId) return leg;
      const billed = leg.advice !== null;
      return { ...leg, charge: leg.backup, backup: leg.charge, kr: billed ? leg.backup.kr : 0 };
    });
  }, [legs, prefer]);

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
  }, [routeMap, stops, detours, soc, profile.usableKwh, profile.acKw, locations, hours, acKr, speedEff, departHhmm, legWhen]);

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
      } else if (leg.charge?.locationId === locId) {
        setPrefer((cur) => {
          const next = { ...cur };
          delete next[i];
          return next;
        });
      }
      return;
    }
    const opt = /^opt-(eco|standard|fastest|cheapest)-(\d+)$/.exec(id);
    if (opt) {
      const mode = opt[1] as LegMode;
      const i = Number(opt[2]);
      setLegMode(i, mode);
      setSelected(`leg-${i}`);
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
  const seenPath = new Set<string>();
  function addRoute(id: string, from: PlanStop, to: PlanStop, route: RoutedLeg, color: string, weight: number) {
    const key = route.path.map((p) => p.join(",")).join("|") || `${from.id}-${to.id}`;
    if (weight < 3 && seenPath.has(key)) return;
    if (weight >= 3) seenPath.add(key);
    mapRoutes.push({
      id,
      from: [from.lat, from.lng],
      to: [to.lat, to.lng],
      weight,
      path: route.path,
      color,
    });
  }
  for (const [i, leg] of viewLegs.entries()) {
    addRoute(`leg-${i}`, leg.from, leg.to, leg.route, modeColor(leg.mode), 3);
  }
  for (const mode of LEG_MODES) {
    if (!showRoutes[mode]) continue;
    const option = routesFor(mode);
    if (option.length !== stops.length - 1) continue;
    for (let i = 0; i < option.length; i++) {
      addRoute(`opt-${mode}-${i}`, stops[i], stops[i + 1], option[i], modeColor(mode), 1);
    }
  }

  const chargerMarkers: MapMarker[] = [];
  for (const [i, leg] of viewLegs.entries()) {
    for (const spot of [leg.charge, leg.backup]) {
      if (!spot) continue;
      const loc = locations.find((x) => x.id === spot.locationId);
      if (!loc) continue;
      const isBackup = leg.backup?.locationId === spot.locationId && leg.charge?.locationId !== spot.locationId;
      chargerMarkers.push({
        id: `chg-${i}-${spot.locationId}`,
        lat: loc.lat,
        lng: loc.lng,
        label: isBackup ? `Backup · ${spot.name}` : spot.name,
        kind: "charger",
        badge: isBackup ? "B" : "C",
      });
    }
  }
  const mapMarkers: MapMarker[] = [
    ...stops.map((s, i) => ({
      id: s.id,
      lat: s.lat,
      lng: s.lng,
      label: s.name,
      kind: (i === 0 ? "home" : "place") as MapMarker["kind"],
      badge: String(i + 1),
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
              type="time"
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
          {whenKind === "arrive" ? `Arrive ${clock}` : `Leave ${departHhmm}`}
          {viewLegs[0] ? ` · first charge window from ${viewLegs[0].departAt}` : ""}
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
          {stops.map((stop, i) => {
            const leg = i > 0 ? viewLegs[i - 1] : null;
            return (
              <li
                key={stop.id}
                className={cn(
                  "border-b border-border py-3 last:border-0",
                  (selected === stop.id ||
                    selected === `leg-${i - 1}` ||
                    selected?.startsWith(`chg-${i - 1}-`)) &&
                    "rounded-xl bg-surface-2/80 px-2",
                )}
              >
                <div
                  className="flex items-center gap-3"
                  onClick={() => setSelected(i > 0 ? `leg-${i - 1}` : stop.id)}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs tabular-nums text-muted">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{stop.name}</p>
                    {leg ? (
                      <p className="text-xs text-muted">
                        {leg.departAt}–{leg.arriveAt}
                        <span className="text-subtle"> · </span>
                        {modeLabel(leg.mode)}
                        <span className="text-subtle"> · </span>
                        {formatDistance(leg.route.miles, units, 1)}
                        <span className="text-subtle"> · </span>
                        {formatNumber(leg.kwh, 1)} kWh
                        <span className="text-subtle"> · </span>
                        {formatNumber(leg.arriveSoc, 0)}% in
                        {leg.advice && leg.charge ? (
                          <>
                            <span className="text-subtle"> · </span>
                            {leg.advice === "required" ? "Required" : "Suggested"} {formatKrValue(leg.charge.kr, 2)} kr
                          </>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-xs text-muted">{formatNumber(soc, 0)}% now · leave {departHhmm}</p>
                    )}
                  </div>
                  {i > 0 ? (
                    <div className="flex shrink-0">
                      <button
                        type="button"
                        onClick={() => moveStop(stop.id, -1)}
                        disabled={i <= 1}
                        className="flex size-9 items-center justify-center rounded-full text-muted disabled:opacity-30"
                        aria-label={`Move ${stop.name} up`}
                      >
                        <ChevronUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveStop(stop.id, 1)}
                        disabled={i >= stops.length - 1}
                        className="flex size-9 items-center justify-center rounded-full text-muted disabled:opacity-30"
                        aria-label={`Move ${stop.name} down`}
                      >
                        <ChevronDown className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeStop(stop.id)}
                        className="flex size-9 items-center justify-center rounded-full text-muted"
                        aria-label={`Remove ${stop.name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ) : null}
                </div>
                {i > 0 ? (
                  <div className="mt-3 pl-10">
                    <div className="flex rounded-full bg-surface-2 p-1">
                      {LEG_MODES.map((mode) => {
                        const on = (modes[i - 1] ?? "standard") === mode;
                        return (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setLegMode(i - 1, mode)}
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
                    <p className="mt-2 text-[11px] text-subtle">
                      {modeHint((modes[i - 1] ?? "standard") as LegMode)}
                    </p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="flex rounded-full bg-surface-2 p-1">
                        {(["auto", "depart", "arrive"] as const).map((kind) => {
                          const on = (legWhen[i - 1]?.kind ?? "auto") === kind;
                          return (
                            <button
                              key={kind}
                              type="button"
                              onClick={() =>
                                setLegWhen(i - 1, {
                                  kind,
                                  hhmm: kind === "auto" ? "" : (legWhen[i - 1]?.hhmm || (leg?.departAt ?? clock)),
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
                      {(legWhen[i - 1]?.kind ?? "auto") !== "auto" ? (
                        <input
                          type="time"
                          value={legWhen[i - 1]?.hhmm || (leg?.departAt ?? clock)}
                          onChange={(e) =>
                            setLegWhen(i - 1, {
                              kind: legWhen[i - 1]?.kind === "arrive" ? "arrive" : "depart",
                              hhmm: e.target.value,
                            })
                          }
                          className="h-8 rounded-full bg-surface-2 px-3 text-xs text-foreground outline-none"
                        />
                      ) : (
                        <p className="flex h-8 items-center text-[11px] tabular-nums text-subtle">
                          {leg ? `${leg.departAt} → ${leg.arriveAt}` : "Follows previous"}
                        </p>
                      )}
                    </div>
                    <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">
                      {(modes[i - 1] ?? "standard") === "cheapest"
                        ? `Charge search · up to ${chargeSearchKm("cheapest", detours[i - 1] ?? 10)} km`
                        : "Max charge detour"}
                    </p>
                    <div className="mt-1 flex gap-1">
                      {DETOUR_KM.map((km) => {
                        const on = (detours[i - 1] ?? 10) === km;
                        return (
                          <button
                            key={km}
                            type="button"
                            onClick={() => setLegDetour(i - 1, km)}
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
                        />
                        <button
                          type="button"
                          onClick={() => insertCharge(i - 1, leg.charge!)}
                          className="h-9 w-full rounded-full bg-surface-2 text-xs font-medium text-muted"
                        >
                          Add charger as stop
                        </button>
                        {leg.backup ? (
                          <button
                            type="button"
                            onClick={() =>
                              setPrefer((cur) => ({ ...cur, [i - 1]: leg.backup!.locationId }))
                            }
                            className="block w-full text-left"
                          >
                            <ChargeChoice title="Backup" spot={leg.backup} active={false} />
                          </button>
                        ) : (
                          <p className="text-[11px] text-subtle">No backup in this detour</p>
                        )}
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
                .filter(([name]) => name !== "Home" && !name.includes("Supercharger") && !name.includes("Wall"))
                .slice(0, 8)
                .map(([name, g]) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => addStop({ label: name, lat: g.lat, lng: g.lng })}
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
    </div>
  );
}

function ChargeChoice({
  title,
  spot,
  active,
}: {
  title: string;
  spot: PricedCharge;
  active: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2",
        active ? "bg-surface-2 shadow-[var(--shadow-border)]" : "bg-transparent",
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{title}</p>
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
