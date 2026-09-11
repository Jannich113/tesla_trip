import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, MapPinned, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BayMap, type MapMarker, type MapRoute } from "@/components/bay-map";
import { searchAddress, type AddressHit } from "./search";
import {
  DETOUR_KM,
  LEG_MODES,
  type LegMode,
  type PlanStop,
  type PricedCharge,
  type PricedLeg,
  type RoutedLeg,
  cheapestHour,
  DKK_PER_USD,
  fetchRoute,
  formatDetour,
  minutesToHm,
  modeColor,
  modeLabel,
  pricePlan,
  remainingHours,
} from "./engine";
import { usePlanStore } from "./store";
import { formatKrPerKwh, formatKrValue, type HourPrice } from "@/lib/elpris";
import { applyTillægToHours, providerById, withTillæg } from "@/lib/el-providers";
import { PLACES } from "@/lib/places";
import { cn } from "@/lib/utils";
import { formatDistance, formatNumber } from "@/lib/vehicle";
import { HOME_USD_PER_KWH } from "@/lib/history";
import { useChargeStore } from "@/store/charge-store";
import { useElprisStore } from "@/store/elpris-store";
import { useLiveElpris } from "./use-live-elpris";
import { useVehicleProfile } from "@/hooks/use-vehicle-profile";
import { useVehicleStore } from "@/store/vehicle-store";

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
  const savePlan = usePlanStore((s) => s.savePlan);
  const loadPlan = usePlanStore((s) => s.loadPlan);
  const deleteSaved = usePlanStore((s) => s.deleteSaved);
  const reset = usePlanStore((s) => s.reset);

  const [routes, setRoutes] = useState<RoutedLeg[]>([]);
  const [routing, setRouting] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [prefer, setPrefer] = useState<Record<number, string>>({});
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
      setRoutes([]);
      return;
    }
    let cancelled = false;
    setRouting(true);
    void (async () => {
      const next: RoutedLeg[] = [];
      for (let i = 0; i < stops.length - 1; i++) {
        next.push(await fetchRoute(stops[i], stops[i + 1], modes[i] ?? "standard"));
        if (cancelled) return;
      }
      if (!cancelled) {
        setRoutes(next);
        setRouting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [stops, modes]);

  useEffect(() => {
    setPrefer({});
  }, [stops, detours]);

  const hours = useMemo(() => {
    if (!elpris) return [];
    return remainingHours(
      applyTillægToHours(elpris.today, provider.tillægOre),
      applyTillægToHours(elpris.tomorrow, provider.tillægOre),
      elpris.current?.hour ?? null,
    );
  }, [elpris, provider.tillægOre]);

  const acKr = hours[0]?.krPerKwh ?? HOME_USD_PER_KWH * DKK_PER_USD;

  const legs: PricedLeg[] = useMemo(() => {
    if (stops.length < 2 || routes.length !== stops.length - 1) return [];
    return pricePlan({
      stops,
      modes: modes.length ? modes : stops.slice(1).map(() => "standard"),
      detours: detours.length ? detours : stops.slice(1).map(() => 10),
      routes,
      soc,
      usableKwh: profile.usableKwh,
      locations,
      hours,
      acKw: profile.acKw,
      acKr,
    });
  }, [stops, modes, detours, routes, soc, profile.usableKwh, profile.acKw, locations, hours, acKr]);

  const viewLegs = useMemo(() => {
    return legs.map((leg, i) => {
      const id = prefer[i];
      if (!id || !leg.charge || !leg.backup || id !== leg.backup.locationId) return leg;
      const billed = leg.needed || leg.mode === "cheapest";
      return { ...leg, charge: leg.backup, backup: leg.charge, kr: billed ? leg.backup.kr : 0 };
    });
  }, [legs, prefer]);

  const totals = useMemo(() => {
    return viewLegs.reduce(
      (acc, leg) => {
        acc.mi += leg.route.miles;
        acc.kwh += leg.kwh;
        acc.kr += leg.kr;
        acc.min += leg.route.seconds / 60;
        acc.chargeKwh += leg.needed || leg.mode === "cheapest" ? (leg.charge?.kwh ?? 0) : 0;
        return acc;
      },
      { mi: 0, kwh: 0, kr: 0, min: 0, chargeKwh: 0 },
    );
  }, [viewLegs]);

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

  function onSave() {
    const plan = savePlan();
    if (!plan) {
      toast("Add a destination first");
      return;
    }
    toast(`Saved ${plan.name}`);
  }

  const mapRoutes: MapRoute[] = viewLegs.map((leg, i) => ({
    id: `leg-${i}`,
    from: [leg.from.lat, leg.from.lng],
    to: [leg.to.lat, leg.to.lng],
    weight: 3,
    path: leg.route.path,
    color: modeColor(leg.mode),
  }));

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
        <p className="mt-4 text-xs font-medium text-muted">
          {stops.length < 2 ? "Add a destination" : routing ? "Routing…" : `${viewLegs.length} ${viewLegs.length === 1 ? "leg" : "legs"}`}
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
          AC priced from live {area} hours + {provider.name} tillæg
          {totals.kr > 0 ? " · Superchargers at saved rates" : ""}
          {cheap ? ` · cheapest hour ${cheap.hour}:00` : ""}
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

      <BayMap
        markers={mapMarkers}
        routes={mapRoutes}
        selectedId={selected}
        onSelect={setSelected}
        onDrop={dropStop}
        dropping
        caption={routing ? "Routing…" : "Tap map to add a stop"}
        hidden={!shareLocation}
      />

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">Stops</p>
        <ol className="mt-2">
          {stops.map((stop, i) => {
            const leg = i > 0 ? viewLegs[i - 1] : null;
            return (
              <li key={stop.id} className="border-b border-border py-3 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs tabular-nums text-muted">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{stop.name}</p>
                    {leg ? (
                      <p className="text-xs text-muted">
                        {modeLabel(leg.mode)}
                        <span className="text-subtle"> · </span>
                        {formatDistance(leg.route.miles, units, 1)}
                        <span className="text-subtle"> · </span>
                        {formatNumber(leg.kwh, 1)} kWh
                        <span className="text-subtle"> · </span>
                        {formatNumber(leg.arriveSoc, 0)}% in
                        {leg.charge ? (
                          <>
                            <span className="text-subtle"> · </span>
                            {leg.charge.label} {formatKrValue(leg.charge.kr, 2)} kr
                          </>
                        ) : null}
                      </p>
                    ) : (
                      <p className="text-xs text-muted">{formatNumber(soc, 0)}% now</p>
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
                    <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted">
                      Max charge detour
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
                          title={leg.needed ? "Charge" : "Charge here"}
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
          {spot.cheapWindow ? " cheapest" : ""}
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
