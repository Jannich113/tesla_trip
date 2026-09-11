import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Navigation, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BayMap, type MapMarker, type MapRoute } from "@/components/bay-map";
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
  asDateTime,
  chargeSearchKm,
  DKK_PER_USD,
  dkNowDateTime,
  defaultSpeedEff,
  epaWhPerMi,
  fetchRoute,
  formatDateTime,
  formatDetour,
  formatWaitCap,
  interpolateWhPerMi,
  avgSpeedKmh,
  minutesToHm,
  modeColor,
  modeHint,
  modeLabel,
  pathMode,
  planTotals,
  pricePlan,
  remainingHours,
  SPEED_KMH,
  splitDateTime,
} from "./engine";
import { usePlanStore } from "./store";
import { withRetry } from "./retry";
import { formatKrPerKwh, formatKrValue, type HourPrice } from "@/lib/elpris";
import { applyTillægToHours, providerById } from "@/lib/el-providers";
import { PLACES } from "@/lib/places";
import { cn } from "@/lib/utils";
import { formatDistance, formatEfficiency, formatNumber } from "@/lib/vehicle";
import { HOME_USD_PER_KWH } from "@/lib/history";
import { type ChargeLocation } from "@/lib/charge-locations";
import { useChargeStore } from "@/store/charge-store";
import { useElprisStore } from "@/store/elpris-store";
import { NETWORK_NATIVE, scaleCatalogKr, type FxTable } from "./charge-fx";
import { countryProfile } from "./country-profiles";
import { minDistToPathM } from "./insert";
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

function routeKey(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: LegMode,
) {
  return `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}|${mode}`;
}

const PATH_MODES: LegMode[] = ["eco", "fastest", "cheapest"];

export function PlanScreen() {
  const units = useVehicleStore((s) => s.units);
  const soc = useVehicleStore((s) => Math.round(s.soc));
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
  const cheapAvoidFees = usePlanStore((s) => s.cheapAvoidFees);
  const setCheapAvoidFees = usePlanStore((s) => s.setCheapAvoidFees);
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

  const [routing, setRouting] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [prefer, setPrefer] = useState<Record<number, string>>({});
  const [acceptCharge, setAcceptCharge] = useState<Record<number, boolean>>({});
  const [chargeToSoc, setChargeToSoc] = useState<Record<number, number>>({});
  const [backupLoc, setBackupLoc] = useState<Record<number, string>>({});
  const [openStops, setOpenStops] = useState<Record<string, boolean>>({});
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const [naming, setNaming] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [pane, setPane] = useState<"plan" | "advanced">("plan");
  const { data: elpris } = useLiveElpris(area);

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
    if (stops.length < 2) return;
    let cancelled = false;
    const jobs: { from: (typeof stops)[number]; to: (typeof stops)[number]; mode: LegMode; key: string }[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      for (const mode of PATH_MODES) {
        const from = stops[i];
        const to = stops[i + 1];
        jobs.push({ from, to, mode, key: routeKey(from, to, mode) });
      }
    }
    const missing = jobs.some((job) => {
      const hit = routeMap[job.key];
      return !hit || hit.source === "air" || hit.path.length < 8;
    });
    if (missing) setRouting(true);
    else setRouting(false);
    void (async () => {
      await Promise.all(
        jobs.map(async (job) => {
          const route = await fetchRoute(job.from, job.to, job.mode);
          if (cancelled) return;
          setRouteCache({ [job.key]: route });
        }),
      );
      if (!cancelled) setRouting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [stops, setRouteCache]);

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
          return routeMap[routeKey(stops[i], stops[i + 1], pathMode(m, cheapAvoidFees))];
        })
        .filter((r): r is RoutedLeg => Boolean(r))
    : routesFor(pathMode(activeModes[0] ?? "fastest", cheapAvoidFees));

  const searchRoutes = useMemo(() => {
    const all: RoutedLeg[] = [];
    const seen = new Set<string>();
    for (const mode of PATH_MODES) {
      for (const r of routesFor(mode)) {
        const a = r.path[0];
        const b = r.path.at(-1);
        if (!a || !b) continue;
        const k = `${a.join()}-${b.join()}-${r.miles.toFixed(1)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        all.push(r);
      }
    }
    return all;
  }, [routeMap, stops]);

  const { chargers: routeChargers, loading: chargersLoading } = useRouteChargers(
    searchRoutes,
    Math.max(
      DEFAULT_DETOUR_KM,
      ...stops.slice(1).flatMap((_, i) =>
        (["eco", "fastest", "cheapest"] as LegMode[]).map((m) =>
          chargeSearchKm(m, detours[i] ?? DEFAULT_DETOUR_KM),
        ),
      ),
    ),
  );

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
    const all = [...byId.values()];
    if (!paths.length) return all;
    const picked = new Map<string, ChargeLocation>();
    for (const p of paths) {
      const ranked = all
        .map((l) => ({ l, d: minDistToPathM(l.lat, l.lng, p) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 36);
      for (const s of ranked) picked.set(s.l.id, s.l);
    }
    return [...picked.values()];
  }, [locationsStored, routeChargers, searchRoutes]);

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
  };

  const legs: PricedLeg[] = useMemo(() => {
    if (stops.length < 2 || selectedRoutes.length !== stops.length - 1) return [];
    return pricePlan({
      ...planArgs,
      modes: activeModes,
      routes: selectedRoutes,
    });
  }, [stops, activeModes, cheapAvoidFees, detours, waits, selectedRoutes, soc, profile.usableKwh, profile.acKw, locations, hours, acKr, speedEff, departHhmm, legWhen, acceptCharge, chargeToSoc, backupLoc, prefer, networkAbo]);

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
      const optionRoutes = routesFor(pathMode(mode, cheapAvoidFees));
      if (optionRoutes.length !== Math.max(0, stops.length - 1) || stops.length < 2) {
        return { mode, totals: null as ReturnType<typeof planTotals> | null, kmh: 0, kwhPerMi: 0, legs: [] as PricedLeg[] };
      }
      const priced = pricePlan({
        ...planArgs,
        modes: stops.slice(1).map(() => mode),
        focuses: stops.slice(1).map(() => (mode === "cheapest" ? "pris" : mode === "eco" ? "distance" : "time")),
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
        legs: priced,
      };
    });
  }, [routeMap, stops, detours, waits, soc, profile.usableKwh, profile.acKw, locations, hours, acKr, speedEff, departHhmm, legWhen, acceptCharge, chargeToSoc, backupLoc, prefer, networkAbo, cheapAvoidFees]);

  function addStop(hit: AddressHit) {
    addStopToStore({ name: hit.label.split(",")[0] || hit.label, lat: hit.lat, lng: hit.lng });
    setQuery("");
    setHits([]);
    setSelected(`leg-${stops.length - 1}`);
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
      for (let i = 0; i < stops.length - 1; i++) {
        const hit =
          routeMap[routeKey(stops[i], stops[i + 1], pathMode(mode, cheapAvoidFees))] ??
          routeMap[routeKey(stops[i], stops[i + 1], mode)] ??
          (mode === "cheapest" ? routeMap[routeKey(stops[i], stops[i + 1], "fastest")] : undefined);
        if (!hit) continue;
        const raw =
          hit.path.length >= 2
            ? simplifyPath(hit.path, 48)
            : ([[stops[i].lat, stops[i].lng], [stops[i + 1].lat, stops[i + 1].lng]] as [number, number][]);
        out.push({
          id: `opt-${mode}-${i}`,
          from: [stops[i].lat, stops[i].lng],
          to: [stops[i + 1].lat, stops[i + 1].lng],
          weight: showAllRoutes && mode !== mapMode ? 2.4 : 3.2,
          path: offsetPath(raw, showAllRoutes ? ROUTE_OFFSET_M[mode] : 0),
          color: modeColor(mode),
        });
      }
    }
    return out;
  }, [stops, routeMap, cheapAvoidFees, mapMode, showAllRoutes]);

  const mapMarkers: MapMarker[] = useMemo(() => {
    const chargerMarkers: MapMarker[] = [];
    for (const row of optionRows) {
      if (!showAllRoutes && row.mode !== mapMode) continue;
      const [dLat, dLng] = CHARGE_OFFSET[row.mode];
      const color = modeColor(row.mode);
      for (const [i, leg] of row.legs.entries()) {
        const spot = leg.charge;
        const lat = spot
          ? (locations.find((x) => x.id === spot.locationId)?.lat ?? (leg.via ? leg.to.lat : undefined))
          : leg.via
            ? leg.to.lat
            : undefined;
        const lng = spot
          ? (locations.find((x) => x.id === spot.locationId)?.lng ?? (leg.via ? leg.to.lng : undefined))
          : leg.via
            ? leg.to.lng
            : undefined;
        if (lat == null || lng == null) continue;
        chargerMarkers.push({
          id: spot ? `chg-${row.mode}-${i}-${spot.locationId}` : `via-${row.mode}-${leg.to.id}`,
          lat: lat + dLat,
          lng: lng + dLng,
          label: `${modeLabel(row.mode)} · ${spot?.name ?? leg.to.name}`,
          kind: "charger",
          badge: row.mode === "eco" ? "E" : row.mode === "cheapest" ? "$" : "F",
          color,
        });
      }
    }
    return [
      ...stops.map((s, i) => ({
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        label: s.name,
        kind: (s.id === "home" || s.name === "Home" ? "home" : "place") as MapMarker["kind"],
        badge: String(i + 1),
      })),
      ...chargerMarkers,
    ];
  }, [optionRows, locations, stops, mapMode, showAllRoutes]);

  return (
    <div className="space-y-5 px-4 pb-6">
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
        <div className="space-y-4">
          <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">kWh / mi at speed</p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {SPEED_KMH.map((kmh) => (
                <label key={kmh} className="text-center text-[11px] text-muted">
                  {kmh}
                  <span className="text-subtle"> km/t</span>
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
                    className="mt-1 h-11 w-full rounded-xl bg-surface-2 px-2 text-center text-sm tabular-nums text-foreground outline-none"
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-subtle">
              From each leg’s average speed · EPA {formatEfficiency(carWhPerMi, units)}
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
          <NetworksPanel abo={networkAbo} onToggle={setNetworkAbo} />
        </div>
      ) : (
      <>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={stops.length >= 2 ? tripTitle(stops) : "Name this plan"}
          className="w-full bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-subtle"
        />
        <div className="mt-3 flex rounded-full bg-surface-2 p-1">
          {(["depart", "arrive"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setWhenKind(kind)}
              className={cn(
                "h-8 flex-1 rounded-full text-[11px] font-medium",
                whenKind === kind ? "bg-foreground text-background" : "text-muted",
              )}
            >
              {kind === "depart" ? "Leave" : "Arrive"}
            </button>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            type="date"
            value={clock.slice(0, 10)}
            onChange={(e) => setWhen(`${e.target.value}T${clock.slice(11, 16) || "00:00"}`)}
            className="h-10 rounded-xl bg-surface-2 px-3 text-sm tabular-nums text-foreground outline-none"
          />
          <input
            type="time"
            value={clock.slice(11, 16)}
            onChange={(e) => setWhen(`${clock.slice(0, 10)}T${e.target.value}`)}
            className="h-10 rounded-xl bg-surface-2 px-3 text-sm tabular-nums text-foreground outline-none"
          />
        </div>
        <p className="mt-2 text-xs text-muted">
          {profile.usableKwh} kWh usable · {formatNumber(soc, 0)}% now
        </p>

        <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-muted">Route options</p>
        <p className="mt-1 text-[11px] text-subtle">
          Eco skips motorways and tolls. Fastest takes them. Cheapest hunts the lowest kWh.
        </p>
        <ul className="mt-2 divide-y divide-border rounded-xl bg-surface-2">
          {optionRows.map((row) => {
            const on = !mixed && activeModes[0] === row.mode;
            const t = row.totals;
            const fastest = optionRows.find((r) => r.mode === "fastest")?.totals;
            const sameCorridor =
              Boolean(
                t &&
                  fastest &&
                  row.mode !== "fastest" &&
                  Math.abs(fastest.mi - t.mi) < 0.8 &&
                  Math.abs(fastest.driveMin - t.driveMin) < 2,
              );
            return (
              <li key={row.mode}>
                <div className={cn("px-3 py-3", on && "bg-background/40")}>
                <button
                  type="button"
                  onClick={() => setAllModes(row.mode)}
                  className="flex w-full items-start gap-3 text-left"
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
                          avg {formatNumber(row.kmh, 0)} km/t
                          {row.mode === "cheapest"
                            ? cheapAvoidFees
                              ? " · no motorways / tolls"
                              : " · motorways, no tolls"
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
                {row.mode === "cheapest" ? (
                  <label className="mt-2 flex items-center gap-2 pl-5 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={cheapAvoidFees}
                      onChange={(e) => setCheapAvoidFees(e.target.checked)}
                      className="size-4 accent-foreground"
                    />
                    Also skip motorways
                  </label>
                ) : null}
                </div>
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
            onClick={() => setShowAllRoutes(true)}
            className={cn(
              "h-8 rounded-full px-3 text-[11px] font-medium",
              showAllRoutes ? "bg-foreground text-background" : "bg-surface-2 text-muted",
            )}
          >
            All 3
          </button>
        </div>
        <BayMap
          markers={mapMarkers}
          routes={mapRoutes}
          selectedId={selected}
          selectedIds={selectedIds}
          onSelect={onMapSelect}
          caption={
            routing
              ? "Routing…"
              : showAllRoutes
                ? "All modes · tap a leg or charger"
                : `${modeLabel(mapMode)} · tap a leg or charger`
          }
          hidden={!shareLocation}
        />
      </div>

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
                  onClick={() => setAllModes(mode)}
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
            const chargedLeg = via ? inbound : inbound?.charge ? inbound : outbound;
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
                    onClick={() => {
                      setSelected(inbound ? `leg-${userI}` : stop.id);
                      if (inbound || outbound) setOpenStops((cur) => ({ ...cur, [stop.id]: !cur[stop.id] }));
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
                        inbound.charge ? (
                          <p className="truncate text-[11px]" style={{ color: modeColor(inbound.mode) }}>
                            {inbound.via ? "via " : ""}
                            {inbound.charge.name}
                            {` · ${formatNumber(inbound.charge.kwh, 0)} kWh · ${formatKrValue(inbound.charge.kr, 0)} kr`}
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
                        max={100}
                        value={Math.round(chargeTo)}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          const v = Math.max(5, Math.min(100, Math.round(n)));
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
                    {(modes[userI] ?? "fastest") === "cheapest" ? (
                      <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                        <input
                          type="checkbox"
                          checked={cheapAvoidFees}
                          onChange={(e) => setCheapAvoidFees(e.target.checked)}
                          className="size-4 accent-foreground"
                        />
                        Also skip motorways
                      </label>
                    ) : null}
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
                              max={100}
                              value={Math.round(
                                chargeToSoc[userI] ??
                                  (chargedLeg.accepted ? chargedLeg.startSoc : chargedLeg.autoStartSoc),
                              )}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                if (!Number.isFinite(n)) return;
                                const v = Math.max(5, Math.min(100, Math.round(n)));
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
                            max={100}
                            value={Math.round(chargeToSoc[userI] ?? leftPct)}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (!Number.isFinite(n)) return;
                              const v = Math.max(5, Math.min(100, Math.round(n)));
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
