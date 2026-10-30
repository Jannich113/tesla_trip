import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useDeferredValue, useRef, lazy, Suspense, memo, startTransition } from "react";
import type { KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Map as MapIcon, MapPin, MoreHorizontal, Navigation, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { MapMarker, MapRoute } from "@/components/bay-map";
import { ConfirmStrip } from "@/components/confirm-strip";
import { parseCoordinates, reverseAddress, searchAddress, suggestAddress, type AddressHit } from "./search";
import { buildPlanLocations, collectSearchRoutes, locationsForRoutes } from "./plan-locations";
import { chargeChain, type ChainEntry, type ChargeStatus } from "./charge-chain";
import { fastestOfModes } from "./pick-route";
import { drivingFactor, scaleSpeedEff, sessionDcKw, useCarSettings, variantFor } from "./car-settings";
import { CarPanel } from "./car-panel";
import { Sheet } from "./sheet";
import { NetworksPanel } from "./networks-panel";

/**
 * Address suggestions under a stop field: the picked row is highlighted, and a spelling fix
 * is called out so the user sees why "Odnese" turned into Odense.
 */
function HitList({
  query,
  hits,
  active,
  searching,
  onPick,
  onHover,
}: {
  query: string;
  hits: AddressHit[];
  active: number;
  searching: boolean;
  onPick: (hit: AddressHit) => void;
  onHover: (i: number) => void;
}) {
  if (!hits.length) {
    return searching && query.trim().length >= 2 ? (
      <p className="mt-1 px-3 text-[11px] text-subtle">Searching…</p>
    ) : null;
  }
  const top = hits[0];
  return (
    <div className="mt-1">
      {top.corrected && top.name ? (
        <p className="px-3 pb-1 text-[11px] text-muted">
          Did you mean <span className="font-medium text-foreground">{top.name}</span>?
        </p>
      ) : null}
      <ul className="overflow-hidden rounded-xl bg-surface-2" role="listbox">
        {hits.map((hit, i) => {
          const name = hit.name ?? hit.label.split(",")[0];
          const rest = hit.label.startsWith(name) ? hit.label.slice(name.length).replace(/^,\s*/, "") : hit.label;
          return (
            <li key={`${hit.lat},${hit.lng},${i}`} className="border-t border-border first:border-0">
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(hit)}
                className={cn("flex w-full flex-col px-3 py-2 text-left", i === active && "bg-background/50")}
              >
                <span className="truncate text-sm">{name}</span>
                {rest ? <span className="truncate text-[11px] text-subtle">{rest}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Arrow keys move through suggestions, Enter picks, Escape closes. */
function suggestKeys(
  e: KeyboardEvent<HTMLInputElement>,
  opts: {
    hits: AddressHit[];
    active: number;
    setActive: (i: number) => void;
    onPick: (hit: AddressHit) => void;
    onClose: () => void;
    onSearch: () => void;
  },
) {
  const { hits, active } = opts;
  if (e.key === "ArrowDown" && hits.length) {
    e.preventDefault();
    opts.setActive((active + 1) % hits.length);
  } else if (e.key === "ArrowUp" && hits.length) {
    e.preventDefault();
    opts.setActive((active - 1 + hits.length) % hits.length);
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (hits.length) opts.onPick(hits[Math.min(active, hits.length - 1)]);
    else opts.onSearch();
  } else if (e.key === "Escape") {
    opts.onClose();
  }
}

/** "Vestergade 12" from "Vestergade 12, Odense, Danmark"; bare coordinates stay whole. */
function stopName(hit: AddressHit) {
  if (parseCoordinates(hit.label)) return hit.label;
  return hit.label.split(",")[0] || hit.label;
}
import {
  DETOUR_KM,
  WAIT_MIN,
  DEFAULT_DETOUR_KM,
  DEFAULT_WAIT_MIN,
  LEG_MODES,
  type LegMode,
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
  timePenalized,
  SPEED_KMH,
  splitDateTime,
} from "./engine";
import { applyDraftShell, paintDraftRoutes, usePlanStore, type OptionSnap } from "./store";
import { withRetry } from "./retry";
import { formatKrPerKwh, formatKrValue, type ElprisData } from "@/lib/elpris";
import { applyTillægToHours, providerById } from "@/lib/el-providers";
import { cn } from "@/lib/utils";
import { formatDistance, formatNumber, type Units } from "@/lib/vehicle";
import { HOME_USD_PER_KWH } from "@/lib/history";
import { type ChargeLocation } from "@/lib/charge-locations";
import { useChargeStore } from "@/store/charge-store";
import { useElprisStore } from "@/store/elpris-store";
import { RoadFeeSuggestions } from "./road-fee-suggestions";
import { appleDirectionsUrl, googleDirectionsUrl, parseMapShareUrl } from "./maps-share";
import { ChargerPicker } from "./charger-picker";
import { chargePickRadiusM } from "./charger-radius";
import { simplifyPath } from "./polyline";
import { useRouteChargers } from "./use-route-chargers";
import { cacheGet, cacheOpenDisk } from "./cache";
import { useLiveElpris } from "./use-live-elpris";
import { EU_NETWORKS, networkIdFor, networkLabel } from "./networks";
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

/** Avoid chips above the route cards: ferries reroute every mode; the road ones shape Cheapest only. */
function AvoidToggles({ className }: { className?: string }) {
  const motorways = usePlanStore((s) => s.cheapAvoidMotorways);
  const tolls = usePlanStore((s) => s.cheapAvoidTolls);
  const roadFees = usePlanStore((s) => s.cheapAvoidRoadFees);
  const setCheapAvoid = usePlanStore((s) => s.setCheapAvoid);
  const avoidFerries = usePlanStore((s) => s.avoidFerries);
  const setAvoidFerries = usePlanStore((s) => s.setAvoidFerries);
  const chips = [
    { on: avoidFerries, label: "Ferries", cheapOnly: false, set: setAvoidFerries },
    { on: motorways, label: "Motorways", cheapOnly: true, set: (v: boolean) => setCheapAvoid({ motorways: v }) },
    { on: tolls, label: "Toll gates", cheapOnly: true, set: (v: boolean) => setCheapAvoid({ tolls: v }) },
    { on: roadFees, label: "Road fees", cheapOnly: true, set: (v: boolean) => setCheapAvoid({ roadFees: v }) },
  ];
  return (
    <div className={className}>
      {/* One row at every width: four equal cells, no wrap. */}
      <div className="grid grid-cols-4 gap-1" role="group" aria-label="Avoid on the route">
        {chips.map((chip) => (
          <button
            key={chip.label}
            type="button"
            aria-pressed={chip.on}
            aria-label={`Avoid ${chip.label.toLowerCase()}`}
            onClick={() => chip.set(!chip.on)}
            className={cn(
              "inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-full border px-1 text-[11px] transition-colors",
              chip.on
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-surface-2 text-muted hover:text-foreground",
            )}
          >
            <span className="truncate">{chip.label}</span>
            {chip.cheapOnly ? <span className="size-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden /> : null}
          </button>
        ))}
      </div>
      <p className="mt-1.5 flex items-center gap-1 text-[10px] text-subtle">
        Tap to avoid ·
        <span className="size-1.5 rounded-full bg-amber-400" aria-hidden />
        Cheapest only · ferries apply to every route
      </p>
    </div>
  );
}


function routeKeyFor(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  mode: LegMode,
  noFerry: boolean,
) {
  return corridorKey(from, to, mode, noFerry);
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
    ferryKr: snap.ferryKr ?? 0,
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
    if (a.mi !== b.mi || a.kr !== b.kr || a.driveMin !== b.driveMin || a.charges !== b.charges || a.tollKr !== b.tollKr || a.ferryKr !== b.ferryKr) {
      return false;
    }
  }
  return true;
}

const CHARGE_BADGE: Record<ChargeStatus, { label: string; className: string }> = {
  required: { label: "Required", className: "bg-amber-400/15 text-amber-300" },
  planned: { label: "Planned", className: "bg-surface text-muted" },
  "optional-added": { label: "Optional · added", className: "bg-emerald-400/15 text-emerald-300" },
  optional: { label: "Optional · good price", className: "bg-emerald-400/10 text-emerald-300/80" },
};

/** Google Maps search for chargers around a point where the planner knows none. */
function chargerSearchHref(lat: number, lng: number) {
  return `https://www.google.com/maps/search/EV+charging+station/@${lat.toFixed(5)},${lng.toFixed(5)},11z`;
}

function ChainRow({
  entry,
  onToggleOptional,
}: {
  entry: ChainEntry;
  onToggleOptional: (userIndex: number) => void;
}) {
  if (entry.type === "stop") {
    return <span className="font-medium text-foreground">{entry.name}</span>;
  }
  if (entry.type === "pass") {
    return <span className="text-subtle">Passes {entry.name} (no charge)</span>;
  }
  if (entry.type === "ferry") {
    const f = entry.ferry;
    const booking =
      f.bookingUrl ?? `https://www.google.com/search?q=${encodeURIComponent(`${f.name} ferry booking`)}`;
    return (
      <div>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-sky-400/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-300">Ferry</span>
          <span className="text-foreground">{entry.name}</span>
        </span>
        <span className="mt-0.5 block text-[11px] text-muted">
          {[
            f.operators.join(" / ") || null,
            `${minutesToHm(f.crossingMin)} crossing`,
            `check in ${f.checkInMin} min before`,
            "battery not used",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {f.everyMin ? (
          <span className="mt-0.5 block text-[11px] text-subtle">
            {`Usually sails every ${f.everyMin >= 1440 ? "day" : minutesToHm(f.everyMin)}; ${minutesToHm(f.departureWaitMin)} average wait counted${f.everyMin >= 1440 ? ", so book a sailing and time the drive to it" : ""} (typical timetable)`}
          </span>
        ) : null}
        <span className="mt-0.5 block text-[11px] text-subtle">
          {f.priceKr
            ? `≈ ${formatKrValue(f.fareKr, 0)} kr in the trip price (usually ${formatKrValue(f.priceKr.from, 0)}–${formatKrValue(f.priceKr.to, 0)} kr one way with car; rough estimate, varies by departure)`
            : `≈ ${formatKrValue(f.fareKr, 0)} kr in the trip price (a guess: fare unknown, check with the operator)`}
        </span>
        <a
          href={booking}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex h-7 items-center rounded-full bg-background px-2.5 text-[11px] font-medium text-foreground"
        >
          {f.bookingUrl ? `Book with ${f.operators[0] ?? "the operator"}` : "Find the ferry operator"}
        </a>
      </div>
    );
  }
  const badge = entry.placeholder
    ? { label: "Estimate", className: "bg-red-400/15 text-red-300" }
    : CHARGE_BADGE[entry.status];
  const optional = entry.status === "optional" || entry.status === "optional-added";
  return (
    <div className={cn(entry.status === "optional" && "opacity-80")}>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", badge.className)}>{badge.label}</span>
        <span className="text-foreground">{entry.name}</span>
      </span>
      <span className="mt-0.5 block text-[11px] text-muted">
        {entry.placeholder
          ? `No charger known near here · about ${formatNumber(entry.kwh, 0)} kWh ≈ ${formatKrValue(entry.kr, 0)} kr`
          : [
              entry.network,
              `${formatKrValue(entry.rateKr, 2)} kr/kWh`,
              entry.toSoc ? `${formatNumber(entry.kwh, 0)} kWh to ${entry.toSoc}%` : `${formatNumber(entry.kwh, 0)} kWh`,
              `${formatKrValue(entry.kr, 0)} kr`,
            ]
              .filter(Boolean)
              .join(" · ")}
      </span>
      {entry.placeholder && entry.lat !== null && entry.lng !== null ? (
        <a
          href={chargerSearchHref(entry.lat, entry.lng)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-flex h-7 items-center rounded-full bg-background px-2.5 text-[11px] font-medium text-foreground"
        >
          Find chargers near here
        </a>
      ) : null}
      {optional ? (
        <button
          type="button"
          onClick={() => onToggleOptional(entry.userIndex)}
          className="mt-1 inline-flex h-7 items-center rounded-full bg-background px-2.5 text-[11px] font-medium text-foreground"
        >
          {entry.status === "optional" ? "Add this charge" : "Remove"}
        </button>
      ) : null}
    </div>
  );
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
  networkOf,
  onToggleOptional,
  onFineTune,
}: {
  rows: OptionRowView[];
  mixed: boolean;
  active: LegMode;
  routing: boolean;
  units: Units;
  cheapAvoid: { motorways: boolean; tolls: boolean; roadFees: boolean };
  onPick: (mode: LegMode) => void;
  networkOf: (charge: PricedCharge) => string | null;
  onToggleOptional: (userIndex: number) => void;
  /** Opens the stop-by-stop charge planner over the route list. */
  onFineTune?: () => void;
}) {
  const fastest = rows.find((r) => r.mode === "fastest")?.totals;
  const picked = mixed ? null : rows.find((r) => r.mode === active) ?? null;
  const pt = picked?.totals ?? null;
  const pickedSave = pt && fastest && picked && picked.mode !== "fastest" ? detourSavings(fastest, pt) : null;
  const pickedSlow = Boolean(
    pt && fastest && picked?.mode === "eco" && timePenalized(fastest.driveMin, pt.driveMin),
  );
  const chain = picked ? chargeChain(picked.legs, networkOf) : [];
  const estimates = chain.filter((e) => e.type === "charge" && e.placeholder).length;
  return (
    <div className="mt-2">
      {/* One card per mode: compare time, price and charges at a glance. */}
      <div className="grid grid-cols-3 gap-2">
        {rows.map((row) => {
          const on = !mixed && active === row.mode;
          const t = row.totals;
          return (
            <button
              key={row.mode}
              type="button"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                onPick(row.mode);
              }}
              onClick={(e) => {
                e.preventDefault();
                onPick(row.mode);
              }}
              aria-pressed={on}
              className={cn(
                "min-w-0 rounded-xl bg-surface-2 px-2.5 py-2 text-left shadow-[inset_0_0_0_1px_var(--color-border)]",
                "transition-[box-shadow,scale] duration-150 ease-[var(--ease-out)] active:scale-[0.98]",
              )}
              style={on ? { boxShadow: `inset 0 0 0 2px ${modeColor(row.mode)}` } : undefined}
            >
              <span className="flex items-center gap-1.5 text-[11px] text-muted">
                <span className="size-2 shrink-0 rounded-full" style={{ background: modeColor(row.mode) }} />
                <span className="truncate">{modeLabel(row.mode)}</span>
              </span>
              <span className="mt-1 block text-sm font-medium tabular-nums">
                {t ? minutesToHm(t.driveMin) : routing ? "…" : "—"}
              </span>
              <span className="block text-xs tabular-nums text-muted">
                {t ? `${formatKrValue(t.kr, 0)} kr` : " "}
              </span>
              <span className="block truncate text-[11px] text-subtle">
                {t ? (t.charges > 0 ? `${t.charges} ${t.charges === 1 ? "charge" : "charges"}` : "no charge") : " "}
              </span>
            </button>
          );
        })}
      </div>

      {/* The picked mode, step by step. */}
      {picked && pt ? (
        <div className="mt-3 rounded-xl bg-surface-2 px-3 py-3">
          <p className="text-xs text-muted">
            {formatDistance(pt.mi, units, pt.mi >= 100 ? 0 : 1)}
            <span className="text-subtle"> · </span>
            avg {formatNumber(picked.kmh, 0)} km/t
            {pickedSlow ? " · 2× slower" : ""}
            {pt.tollKr >= 1 ? ` · toll ${formatKrValue(pt.tollKr, 0)} kr` : " · no toll"}
            {(() => {
              // Ferry fares are in the trip price; they are estimates, so say so (#71).
              const ferries = picked.legs.filter((l) => l.ferry);
              if (!ferries.length) return "";
              const label = ferries.length === 1 ? "ferry" : `${ferries.length} ferries`;
              const guessed = ferries.some((l) => !l.ferry?.priceKr);
              return ` · ${label} ≈ ${formatKrValue(pt.ferryKr, 0)} kr${guessed ? " (guessed)" : ""}`;
            })()}
            {pickedSave && pickedSave.significant
              ? ` · saves ${formatKrValue(pickedSave.net, 0)} kr${pickedSave.extraMin >= 1 ? ` for +${minutesToHm(pickedSave.extraMin)}` : ""}`
              : pickedSave && pickedSave.net <= -1
                ? ` · ${formatKrValue(-pickedSave.net, 0)} kr more`
                : ""}
            {picked.mode === "cheapest" || pt.waitMin > 0
              ? ` · ${pt.waitMin > 0 ? minutesToHm(pt.waitMin) : "no"} wait`
              : ""}
            {picked.mode === "cheapest"
              ? (() => {
                  const bits = [
                    cheapAvoid.motorways && "no motorways",
                    cheapAvoid.tolls && pt.tollKr < 1 && "no toll gates",
                    cheapAvoid.roadFees && "no road fees",
                  ].filter(Boolean);
                  return bits.length ? ` · ${bits.join(" · ")}` : " · cheapest stalls";
                })()
              : ""}
          </p>
          {estimates ? (
            <p className="mt-2 rounded-lg bg-red-400/10 px-2.5 py-2 text-[11px] text-red-200">
              {estimates === 1 ? "One charge stop has" : `${estimates} charge stops have`} no known charger nearby. The
              price is an estimate; check for a charger before you go.
            </p>
          ) : null}
          {chain.length ? (
            <ol className="mt-3 space-y-2.5 border-l border-border pl-3">
              {chain.map((entry, i) => (
                <li key={`${picked.mode}-${i}`} className="text-xs">
                  <ChainRow entry={entry} onToggleOptional={onToggleOptional} />
                </li>
              ))}
            </ol>
          ) : null}
          {onFineTune ? (
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={onFineTune}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-background px-3 text-xs font-medium text-foreground shadow-[var(--shadow-border)]"
              >
                <SlidersHorizontal className="size-3.5" aria-hidden />
                Fine-tune stops
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

const BayMap = lazy(() => import("@/components/bay-map").then((m) => ({ default: m.BayMap })));

function ElprisAfterPaint({
  area,
  onData,
}: {
  area: Parameters<typeof useLiveElpris>[0];
  onData: (data: ElprisData | null) => void;
}) {
  const { data } = useLiveElpris(area);
  useEffect(() => {
    onData(data);
  }, [data, onData]);
  return null;
}

export function PlanScreen() {
  const units = useVehicleStore((s) => s.units);
  const setUnits = useVehicleStore((s) => s.setUnits);
  const setModelId = useVehicleStore((s) => s.setModelId);
  const { profile } = useVehicleProfile();
  const car = useCarSettings();
  const soc = car.startSoc;
  const variant = variantFor(profile.id, car.variantId);
  const carAcKw = car.acKw ?? variant.acKw;
  const carPeakDcKw = car.peakDcKw ?? variant.peakDcKw;
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
  const replaceStop = usePlanStore((s) => s.replaceStop);
  const moveStop = usePlanStore((s) => s.moveStop);
  const setLegMode = usePlanStore((s) => s.setLegMode);
  const setLegDetour = usePlanStore((s) => s.setLegDetour);
  const setAllDetours = usePlanStore((s) => s.setAllDetours);
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
  // "Avoid ferries" (#71) routes every mode again, under its own cache keys.
  const avoidFerries = usePlanStore((s) => s.avoidFerries);
  const routeKey = useCallback(
    (from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: LegMode) =>
      routeKeyFor(from, to, mode, avoidFerries),
    [avoidFerries],
  );
  const whenKind = usePlanStore((s) => s.whenKind);
  const when = usePlanStore((s) => s.when);
  const legWhen = usePlanStore((s) => s.legWhen);
  const whPerMiOverride = usePlanStore((s) => s.whPerMi);
  const usableKwhOverride = usePlanStore((s) => s.usableKwh);
  const speedEffOverride = usePlanStore((s) => s.speedEff);
  const setWhenKind = usePlanStore((s) => s.setWhenKind);
  const setWhen = usePlanStore((s) => s.setWhen);
  const setLegWhen = usePlanStore((s) => s.setLegWhen);
  const setSpeedEff = usePlanStore((s) => s.setSpeedEff);
  const setUsableKwh = usePlanStore((s) => s.setUsableKwh);
  const networkAbo = usePlanStore((s) => s.networkAbo);
  const setNetworkAbo = usePlanStore((s) => s.setNetworkAbo);
  const preferredNetwork = usePlanStore((s) => s.preferredNetwork);
  const setPreferredNetwork = usePlanStore((s) => s.setPreferredNetwork);
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
  const [hitActive, setHitActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [editActive, setEditActive] = useState(0);
  const [editSearching, setEditSearching] = useState(false);
  const [addKind, setAddKind] = useState<"auto" | "depart" | "arrive">("depart");
  const [addAt, setAddAt] = useState("");
  const [addWhenOpen, setAddWhenOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editWhen, setEditWhen] = useState<string | null>(null);
  const [editStop, setEditStop] = useState<string | null>(null);
  const [editQuery, setEditQuery] = useState("");
  const [editHits, setEditHits] = useState<AddressHit[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [prefer, setPrefer] = useState<Record<number, string>>({});
  const [acceptCharge, setAcceptCharge] = useState<Record<number, boolean>>({});
  const [chargeToSoc, setChargeToSoc] = useState<Record<number, number>>({});
  const [backupLoc, setBackupLoc] = useState<Record<number, string>>({});
  const [openStops, setOpenStops] = useState<Record<string, boolean>>({});
  const [showAllRoutes, setShowAllRoutes] = useState(false);
  const [picking, setPicking] = useState(false);
  const [naming, setNaming] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [importUrl, setImportUrl] = useState("");
  const [importError, setImportError] = useState("");
  const [pane, setPane] = useState<"plan" | "advanced" | "members">("plan");
  const [fineTune, setFineTune] = useState(false);
  const closeFineTune = useCallback(() => setFineTune(false), []);
  // Import from, or open in, Google / Apple Maps.
  const [mapsOpen, setMapsOpen] = useState(false);
  const closeMaps = useCallback(() => setMapsOpen(false), []);
  const [pickerStop, setPickerStop] = useState<string | null>(null);
  const [elpris, setElpris] = useState<ElprisData | null>(null);

  useLayoutEffect(() => {
    applyDraftShell();
  }, []);

  useEffect(() => {
    const kick = () => {
      try {
        cacheOpenDisk();
        paintDraftRoutes();
        const hit = cacheGet<ElprisData>("elpris", useElprisStore.getState().area, { stale: true });
        if (hit) setElpris(hit);
      } finally {
        setLive(true);
      }
    };
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(kick, { timeout: 250 });
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(kick, 0);
    return () => window.clearTimeout(t);
  }, []);

  // Suggestions lean towards the last stop, so "Vestergade" finds the one in the trip's town.
  const lastStop = stops.at(-1);
  const suggestBias = lastStop ? { lat: lastStop.lat, lng: lastStop.lng } : undefined;
  const biasKey = suggestBias ? `${suggestBias.lat.toFixed(1)},${suggestBias.lng.toFixed(1)}` : "";

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    const ctrl = new AbortController();
    setSearching(true);
    const t = window.setTimeout(() => {
      void suggestAddress(q, { bias: suggestBias, signal: ctrl.signal })
        .then((next) => {
          setHits(next);
          setHitActive(0);
        })
        .catch(() => {})
        .finally(() => {
          if (!ctrl.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
    // biasKey stands in for suggestBias so a new object each render does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, biasKey]);

  useEffect(() => {
    if (!editStop) {
      setEditHits([]);
      return;
    }
    const q = editQuery.trim();
    if (q.length < 2) {
      setEditHits([]);
      setEditSearching(false);
      return;
    }
    const near = stops.find((s) => s.id === editStop);
    const ctrl = new AbortController();
    setEditSearching(true);
    const t = window.setTimeout(() => {
      void suggestAddress(q, { bias: near ? { lat: near.lat, lng: near.lng } : undefined, signal: ctrl.signal })
        .then((next) => {
          setEditHits(next);
          setEditActive(0);
        })
        .catch(() => {})
        .finally(() => {
          if (!ctrl.signal.aborted) setEditSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editQuery, editStop]);

  /** Enter with no suggestions: one full search (Nominatim knows Danish names like "Hamborg"). */
  async function searchNow(q: string, apply: (hits: AddressHit[]) => void) {
    if (q.trim().length < 3) return;
    const found = await searchAddress(q).catch(() => []);
    if (found.length) apply(found);
    else toast(`No places found for "${q.trim()}"`);
  }

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
          const hit = routeMap[key] ?? lookupCachedRoute(from, to, mode, avoidFerries);
          if (hit && hit.source !== "air" && hit.path.length >= 3) {
            if (!routeMap[key]) jobs.push({ from, to, mode, key });
            continue;
          }
          jobs.push({ from, to, mode, key });
        }
        const needNet = jobs.filter((job) => {
          const hit = routeMap[job.key] ?? lookupCachedRoute(job.from, job.to, job.mode, avoidFerries);
          return !hit || hit.source === "air" || hit.path.length < 3;
        });
        if (mode === "fastest" && needNet.length) setRouting(true);
        else if (mode === "fastest") setRouting(false);
        const patch: Record<string, RoutedLeg> = {};
        for (const job of jobs) {
          const cached = routeMap[job.key] ?? lookupCachedRoute(job.from, job.to, job.mode, avoidFerries);
          if (cached && cached.source !== "air" && cached.path.length >= 3) {
            if (!routeMap[job.key]) patch[job.key] = cached;
            continue;
          }
          if (cancelled) return;
          const route = await fetchRoute(job.from, job.to, job.mode, avoidFerries);
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
    // routeMap is read only to skip cached hops; adding it retriggers this effect on every cache write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, stops, setRouteCache, routeKey]);

  useEffect(() => {
    setPrefer({});
    setAcceptCharge({});
    setChargeToSoc({});
    setBackupLoc({});
  }, [stops, detours]);

  const packKwh = usableKwhOverride && usableKwhOverride > 0 ? usableKwhOverride : variant.usableKwh;
  /** The car's own kWh/100 km per speed (EPA-based or the user's table). */
  const baseSpeedEff = normalizeSpeedEff(
    speedEffOverride,
    whPerMiOverride && whPerMiOverride > 0 ? whPerMiOverride : epaWhPerMi(packKwh, variant.epaRangeMi),
  );
  const driveFactor = drivingFactor(car.style, car.conditions);
  const baseEffKey = SPEED_KMH.map((k) => baseSpeedEff[k]).join(",");
  /** What the planner uses: the car's figures under this trip's driving style and conditions. */
  const speedEff = useMemo(
    () => scaleSpeedEff(baseSpeedEff, driveFactor),
    // baseSpeedEff is rebuilt every render; its values are in baseEffKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseEffKey, driveFactor],
  );
  const dcKw = sessionDcKw(carPeakDcKw);
  const limits = car.limits;
  useEffect(() => {
    if (preferredNetwork && !networkAbo[preferredNetwork]) setPreferredNetwork(null);
  }, [preferredNetwork, networkAbo, setPreferredNetwork]);
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

  /** The route a mode drives on leg i. Fastest takes the quickest route any mode found (#70). */
  function legRoute(i: number, mode: LegMode): RoutedLeg | undefined {
    const at = (m: LegMode) => routeMap[routeKey(stops[i], stops[i + 1], m)];
    if (mode !== "fastest") return at(mode);
    return fastestOfModes(at("fastest"), [at("eco"), at("cheapest")]);
  }

  function routesFor(mode: LegMode): RoutedLeg[] {
    if (stops.length < 2) return [];
    const list: RoutedLeg[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const hit = legRoute(i, mode);
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
          return legRoute(i, pathMode(m, avoidForMode(m, cheapAvoid)));
        })
        .filter((r): r is RoutedLeg => Boolean(r))
    : routesFor(pathMode(activeModes[0] ?? "fastest", avoidForMode(activeModes[0] ?? "fastest", cheapAvoid)));

  // Eco + Fastest corridors never depend on cheapAvoid — keeps their chargers/totals still.
  const stableSearchRoutes = useMemo(
    () => collectSearchRoutes(["eco", "fastest"], routesFor),
    // routesFor closes over routeMap and stops; its identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routeMap, stops, routeKey],
  );
  const cheapPathM = pathMode("cheapest", cheapAvoid);
  const cheapSearchRoutes = useMemo(() => {
    // Only when Cheapest has its own corridor (toll/fee avoid), not when sharing eco/fastest.
    if (cheapPathM === "eco" || cheapPathM === "fastest") return [] as RoutedLeg[];
    return collectSearchRoutes(["cheapest"], routesFor);
    // routesFor closes over routeMap and stops; its identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMap, stops, cheapPathM, routeKey]);
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
    () => buildPlanLocations(live, locationsStored, stableChargers, stableSearchRoutes, preferredNetwork),
    [live, locationsStored, stableChargers, stableSearchRoutes, preferredNetwork],
  );
  const locations = useMemo(
    () => buildPlanLocations(live, locationsStored, routeChargers, searchRoutes, preferredNetwork),
    [live, locationsStored, routeChargers, searchRoutes, preferredNetwork],
  );
  const chargerById = useMemo(() => {
    const byId = new Map<string, ChargeLocation>();
    for (const c of locations) byId.set(c.id, c);
    for (const c of routeChargers) byId.set(c.id, c);
    return byId;
  }, [locations, routeChargers]);
  /** "Tesla Supercharger · member price", "IONITY"… for a charge in the route list. */
  const networkOf = useCallback(
    (charge: PricedCharge) => {
      const id = networkIdFor(charge.kind, chargerById.get(charge.locationId)?.networkId);
      if (!id) return null;
      const net = EU_NETWORKS.find((n) => n.id === id);
      if (!net) return networkLabel(id, Boolean(networkAbo[id]));
      return networkAbo[id] ? `${net.name} · member price` : net.name;
    },
    [chargerById, networkAbo],
  );
  const toggleOptionalCharge = useCallback(
    (userIndex: number) => setAcceptCharge((cur) => ({ ...cur, [userIndex]: !cur[userIndex] })),
    [],
  );
  const chargerPool = useMemo(() => {
    const byId = new Map<string, ChargeLocation>();
    for (const c of locations) byId.set(c.id, c);
    for (const c of routeChargers) byId.set(c.id, c);
    return [...byId.values()];
  }, [locations, routeChargers]);

  const driveMinGuess = selectedRoutes.reduce((n, r) => n + r.seconds / 60, 0);
  const departHhmm =
    whenKind === "arrive" ? addMinutesDateTime(clock, -driveMinGuess) : clock;

  const planArgs = {
    stops,
    detours: detours.length ? detours : stops.slice(1).map(() => DEFAULT_DETOUR_KM),
    waitCapMin: waits.length ? waits : stops.slice(1).map(() => DEFAULT_WAIT_MIN),
    soc,
    usableKwh: packKwh,
    locations,
    hours,
    acKw: carAcKw,
    limits,
    dcKw,
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
    preferredNetwork: preferredNetwork && networkAbo[preferredNetwork] ? preferredNetwork : null,
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
  }, [stops, pathModes, routeMap, routeKey]);

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
      const cacheKey = `${mode}|${corridorStamp}|${soc}|${locPool.length}|${hours.length}|${avoid.motorways}|${avoid.tolls}|${avoid.roadFees}|${planArgs.detours.join(",")}|${planArgs.preferredNetwork ?? ""}|${packKwh}|${dcKw}|${carAcKw}|${limits.floorSoc},${limits.targetSoc},${limits.destSoc}|${SPEED_KMH.map((k) => speedEff[k]).join(",")}|stalls3`;
      const cached = pricedMemo.current.get(cacheKey);
      if (cached) return { mode, avoid, priced: cached };
      const priced = pricePlan({
        ...planArgs,
        modes: stops.slice(1).map(() => mode),
        focuses: stops.slice(1).map(() => (mode === "cheapest" ? "pris" : mode === "eco" ? "distance" : "time")),
        detours: planArgs.detours.map((d) => (mode === "cheapest" ? Math.max(15, d) : d)),
        routes: optionRoutes,
        locations: locationsForRoutes(
          locPool,
          optionRoutes,
          mode === "fastest" ? 40_000 : 22_000,
          mode === "cheapest" ? planArgs.preferredNetwork : null,
        ),
        avoid,
      });
      pricedMemo.current.set(cacheKey, priced);
      if (pricedMemo.current.size > 12) {
        const first = pricedMemo.current.keys().next().value;
        if (first) pricedMemo.current.delete(first);
      }
      return { mode, avoid, priced };
    });
    // planArgs and routesFor are new every render; their inputs are already listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, corridorStamp, stops, detours, waits, soc, packKwh, carAcKw, dcKw, limits, locations, stableLocations, hours, acKr, speedEff, departHhmm, legWhen, acceptCharge, chargeToSoc, backupLoc, prefer, networkAbo, preferredNetwork, cheapAvoid]);

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
  }, [pricedRows, deferredMap, speedEff, cheapAvoid, stops, lastOptions, routeKey]);

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
        ferryKr: row.totals.ferryKr,
        kmh: row.kmh,
      };
    }
    if (!Object.keys(rows).length) return;
    const next = { key, rows };
    if (sameLastOptions(lastOptions, next)) return;
    setLastOptions(next);
  }, [live, optionRows, stops, lastOptions, setLastOptions]);

  const legs: PricedLeg[] = useMemo(() => {
    if (!live) return [];
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
    // planArgs is a fresh object every render; adding it would reprice mixed legs every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, mixed, optionRows, activeModes, stops, selectedRoutes, packKwh, dcKw, limits, speedEff]);

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
  const snapRow = optionRows.find((r) => r.mode === (activeModes[0] ?? "fastest"));
  const headline = viewLegs.length ? totals : (snapRow?.totals ?? totals);
  const headlineLive = viewLegs.length > 0;

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
              const route = await fetchRoute(job.from, job.to, job.mode, avoidFerries);
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
    // hopKey already tracks geometry; optionRows/routeMap would refetch and can loop via setRouteCache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hopKey, cheapAvoid, routeKey]);

  function addStop(hit: AddressHit) {
    const idx = stops.length;
    const at = asDateTime(addAt || clock);
    addStopToStore({ name: stopName(hit), lat: hit.lat, lng: hit.lng });
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

  async function addStopFromMap(lat: number, lng: number) {
    setPicking(false);
    const what = stops.length === 0 ? "start" : stops.length === 1 ? "destination" : "stop";
    const pending = toast.loading(`Finding the address for your ${what}…`);
    const hit = await reverseAddress(lat, lng);
    toast.dismiss(pending);
    addStop(hit);
    toast(`Added ${stopName(hit)}`);
  }

  function replaceStopPlace(id: string, hit: AddressHit) {
    replaceStop(id, {
      name: stopName(hit),
      lat: hit.lat,
      lng: hit.lng,
    });
    setEditStop(null);
    setEditQuery("");
    setEditHits([]);
  }

  function toggleEditStop(id: string) {
    const open = editStop !== id;
    setEditStop(open ? id : null);
    setEditWhen(null);
    setEditQuery("");
    setEditHits([]);
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

  /** True when the link was read and its stops replaced the plan's. */
  function importFromMaps() {
    let trip: ReturnType<typeof parseMapShareUrl>;
    try {
      trip = parseMapShareUrl(importUrl);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not read that share link";
      setImportError(message);
      toast.error(message);
      return false;
    }
    setImportError("");
    reset();
    for (const stop of trip.stops) {
      addStopToStore({ name: stop.name, lat: stop.lat, lng: stop.lng });
    }
    const title = tripTitle(trip.stops);
    if (title) setName(title);
    setImportUrl("");
    toast(`Imported ${trip.stops.length} stops`);
    return true;
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
  }, [stops, routeMap, cheapAvoid, mapMode, showAllRoutes, optionRows, routeKey]);

  const overviewFeePath = useMemo(() => {
    const path = mapRoutes.find((r) => r.id === `opt-${mapMode}-0`)?.path;
    return path && path.length >= 2 ? path : [];
  }, [mapRoutes, mapMode]);

  const mapMarkers: MapMarker[] = useMemo(() => {
    const row = optionRows.find((r) => r.mode === mapMode);
    const seq: { id: string; lat: number; lng: number; label: string; via: boolean }[] = [];
    if (row?.legs.length) {
      const first = row.legs[0].from;
      seq.push({ id: first.id, lat: first.lat, lng: first.lng, label: first.name, via: false });
      for (const leg of row.legs) {
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

  const sharePts = routePoints();
  let googleHref = "";
  let appleHref = "";
  if (sharePts.length >= 2) {
    try {
      googleHref = googleDirectionsUrl(sharePts);
      appleHref = appleDirectionsUrl(sharePts);
    } catch {
      googleHref = "";
      appleHref = "";
    }
  }

  // The stop-by-stop charge planner: in the Car pane and in the Fine-tune overlay on the Trip pane.
  const stopsPlanner = (
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
          const pickMode = (chargedLeg?.mode ?? modes[userI] ?? "fastest") as LegMode;
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
                      {(via || chargedLeg?.charge) && i > 0 ? (
                        <ChargerPicker
                          open={pickerStop === stop.id}
                          onToggle={() => setPickerStop((cur) => (cur === stop.id ? null : stop.id))}
                          origin={{ lat: stop.lat, lng: stop.lng, name: stop.name }}
                          radiusM={chargePickRadiusM(pickMode, detours[userI] ?? DEFAULT_DETOUR_KM)}
                          radiusLabel={modeLabel(pickMode)}
                          locations={chargerPool}
                          memberships={networkAbo}
                          acKw={carAcKw}
                          activeId={
                            chargedLeg?.charge?.locationId ??
                            (stop.id.startsWith("via-") ? stop.id.slice("via-".length) : undefined)
                          }
                          onPick={(hit) => {
                            if (inStore) {
                              replaceStop(stop.id, hit);
                            } else {
                              const detour = detours[userI] ?? DEFAULT_DETOUR_KM;
                              insertStopAt(userI + 1, hit);
                              setLegMode(userI, pickMode);
                              setLegDetour(userI, detour);
                            }
                            setPickerStop(null);
                            toast(`Charging stop set to ${hit.name}`);
                          }}
                        />
                      ) : null}
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

    </section>
  );

  return (
    // Phones: map on top, everything else below. Laptops: fixed sidebar, map fills the rest.
    <div className="[touch-action:manipulation] lg:grid lg:h-full lg:grid-cols-[400px_minmax(0,1fr)]">
      {live ? <ElprisAfterPaint area={area} onData={setElpris} /> : null}

      <div
        className={cn(
          "px-4 pb-4 lg:order-last lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:py-4 lg:pl-0 lg:pr-4",
          pane !== "plan" && "hidden lg:flex",
        )}
      >
        <div className="mb-2 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
          {stops.length >= 2 ? (
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
          ) : null}
          <p className="min-w-0 text-xs tabular-nums text-muted">
            {stops.length < 2 ? (
              stops.length === 0 ? "Add a start and a destination" : "Add a destination"
            ) : routing ? (
              "Routing…"
            ) : (
              <>
                <span className="text-sm font-medium text-foreground">
                  {formatDistance(headline.mi, units, headline.mi >= 100 ? 0 : 1)}
                </span>
                {headline.driveMin > 0
                  ? ` · ${minutesToHm(headlineLive && totals.min > 0 ? totals.min : headline.driveMin)}`
                  : ""}
                {` · ${formatKrValue(headline.kr, 0)} kr`}
                {headlineLive && totals.chargeKwh > 0 ? ` · ${formatNumber(totals.chargeKwh, 1)} kWh charge` : ""}
                {` · ${whenKind === "arrive" ? `Arrive ${formatDateTime(clock)}` : `Leave ${formatDateTime(departHhmm)}`}`}
                {chargersLoading ? " · Finding chargers…" : ""}
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => setPicking((on) => !on)}
            aria-pressed={picking}
            className={cn(
              "ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-medium",
              "transition-[background-color,color,scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
              picking ? "bg-foreground text-background" : "bg-surface-2 text-muted",
            )}
          >
            {picking ? <X className="size-3.5" /> : <MapPin className="size-3.5" />}
            {picking ? "Cancel" : "Pick on map"}
          </button>
        </div>
        <Suspense fallback={<div className="h-[38dvh] min-h-56 rounded-xl bg-surface lg:h-auto lg:flex-1" />}>
          {live ? (
            <BayMap
              markers={idleMap.markers}
              routes={idleMap.routes}
              selectedId={selected}
              selectedIds={selectedIds}
              onSelect={onMapSelect}
              interactive
              autoFit
              dropping={picking}
              onDrop={(lat, lng) => void addStopFromMap(lat, lng)}
              caption={
                picking
                  ? `Tap the map to add your ${stops.length === 0 ? "start" : stops.length === 1 ? "destination" : "next stop"}`
                  : routing
                    ? "Routing…"
                    : undefined
              }
              className="lg:min-h-0 lg:flex-1"
              mapClassName="h-[38dvh] min-h-56 lg:h-full lg:min-h-0"
            />
          ) : (
            <div className="h-[38dvh] min-h-56 rounded-xl bg-surface lg:h-auto lg:flex-1" />
          )}
        </Suspense>
      </div>

      <div className="space-y-5 px-4 pb-6 lg:h-full lg:overflow-y-auto lg:py-4">
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
            {id === "plan" ? "Trip" : id === "advanced" ? "Car" : "Networks"}
          </button>
        ))}
      </div>

      {pane === "members" ? (
        <NetworksPanel
          abo={networkAbo}
          onToggle={setNetworkAbo}
          preferSlot={<PreferNetwork abo={networkAbo} preferred={preferredNetwork} onPick={setPreferredNetwork} />}
        />
      ) : (
      <>
      {pane === "advanced" ? (
        <CarPanel
          modelId={profile.id}
          modelName={profile.model}
          modelYear={profile.year}
          onModel={setModelId}
          variant={variant}
          packKwh={packKwh}
          packOverridden={usableKwhOverride != null}
          onPackKwh={setUsableKwh}
          peakDcKw={carPeakDcKw}
          acKw={carAcKw}
          baseSpeedEff={baseSpeedEff}
          speedEff={speedEff}
          effOverridden={Boolean(speedEffOverride)}
          onSpeedEff={setSpeedEff}
          detours={detours}
          onDetour={setAllDetours}
          units={units}
          onUnits={setUnits}
        />
      ) : null}

      {pane === "plan" ? (
      <div className="space-y-5">

      <Sheet open={mapsOpen} onClose={closeMaps} title="Google and Apple Maps" subtitle="Import a route, or open this trip">
        <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Import a route</p>
          <p className="mt-1 text-xs text-muted">
            In Google or Apple Maps, plan the route and tap Share, then paste the link here. It replaces the stops in this plan.
          </p>
          <div className="mt-3">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (importFromMaps()) closeMaps();
              }}
            >
              <input
                value={importUrl}
                onChange={(e) => {
                  setImportUrl(e.target.value);
                  if (importError) setImportError("");
                }}
                placeholder="Paste a Google or Apple Maps link"
                aria-label="Google or Apple Maps share link"
                aria-invalid={importError ? true : undefined}
                className="h-11 min-w-0 flex-1 rounded-xl bg-surface-2 px-3 text-sm outline-none"
              />
              <button
                type="submit"
                className="h-11 shrink-0 rounded-full bg-surface-2 px-4 text-sm font-medium text-muted"
              >
                Import
              </button>
            </form>
            {importError ? (
              <p role="alert" className="mt-2 text-xs text-amber-200">
                {importError}
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-subtle">Stops only. Eco, Fastest, and Cheapest still run here.</p>
            )}
          </div>
        </section>
        <section className="mt-3 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">Open this trip in</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {googleHref ? (
              <a
                href={googleHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 items-center rounded-full bg-surface-2 px-3 text-[11px] font-medium text-muted"
              >
                Google Maps
              </a>
            ) : (
              <button
                type="button"
                onClick={() => toast.error("Add a destination first")}
                className="flex h-9 items-center rounded-full bg-surface-2 px-3 text-[11px] font-medium text-muted"
              >
                Google Maps
              </button>
            )}
            {appleHref ? (
              <a
                href={appleHref}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-9 items-center rounded-full bg-surface-2 px-3 text-[11px] font-medium text-muted"
              >
                Apple Maps
              </a>
            ) : (
              <button
                type="button"
                onClick={() => toast.error("Add a destination first")}
                className="flex h-9 items-center rounded-full bg-surface-2 px-3 text-[11px] font-medium text-muted"
              >
                Apple Maps
              </button>
            )}
          </div>
        </section>
      </Sheet>

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={stops.length >= 2 ? tripTitle(stops) : "Name this plan"}
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-foreground outline-none placeholder:text-subtle"
          />
          <button
            type="button"
            onClick={() => setMapsOpen(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-background px-3 text-xs font-medium text-foreground shadow-[var(--shadow-border)]"
          >
            <MapIcon className="size-3.5" aria-hidden />
            Maps link
          </button>
        </div>
        <p className="mt-2 text-xs text-muted">
          {formatNumber(packKwh, 0)} kWh usable · {formatNumber(soc, 0)}% at start
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
                    <button
                      type="button"
                      onClick={() => toggleEditStop(stop.id)}
                      className="min-w-0 flex-1 truncate text-left text-sm"
                      aria-expanded={editStop === stop.id}
                      aria-label={`Edit address for ${stop.name}`}
                    >
                      {stop.name}
                    </button>
                    {w.note && w.at ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditWhen(editWhen === stop.id ? null : stop.id);
                          setEditStop(null);
                          setEditQuery("");
                          setEditHits([]);
                        }}
                        className="ml-auto shrink-0 text-xs tabular-nums text-muted"
                        aria-expanded={editWhen === stop.id}
                        aria-label={`Edit ${w.kind === "arrive" ? "arrive" : "leave"} time for ${stop.name}`}
                      >
                        {w.kind === "arrive" ? "Arrive" : "Leave"} {formatDateTime(w.at)}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setEditWhen(editWhen === stop.id ? null : stop.id);
                          setEditStop(null);
                          setEditQuery("");
                          setEditHits([]);
                        }}
                        className="ml-auto shrink-0 text-xs text-subtle"
                        aria-expanded={editWhen === stop.id}
                      >
                        Set time
                      </button>
                    )}
                  </div>
                  {editStop === stop.id ? (
                    <div className="mt-1">
                      <input
                        autoFocus
                        value={editQuery}
                        onChange={(e) => setEditQuery(e.target.value)}
                        onKeyDown={(e) =>
                          suggestKeys(e, {
                            hits: editHits,
                            active: editActive,
                            setActive: setEditActive,
                            onPick: (hit) => replaceStopPlace(stop.id, hit),
                            onClose: () => {
                              setEditStop(null);
                              setEditQuery("");
                            },
                            onSearch: () => void searchNow(editQuery, setEditHits),
                          })
                        }
                        placeholder="Search address or lat, lng"
                        autoComplete="off"
                        aria-autocomplete="list"
                        className="h-11 w-full rounded-xl bg-surface-2 px-3 text-sm outline-none placeholder:text-subtle"
                      />
                      <HitList
                        query={editQuery}
                        hits={editHits}
                        active={editActive}
                        searching={editSearching}
                        onPick={(hit) => replaceStopPlace(stop.id, hit)}
                        onHover={setEditActive}
                      />
                    </div>
                  ) : null}
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
                onKeyDown={(e) =>
                  suggestKeys(e, {
                    hits,
                    active: hitActive,
                    setActive: setHitActive,
                    onPick: addStop,
                    onClose: () => setHits([]),
                    onSearch: () => void searchNow(query, setHits),
                  })
                }
                autoComplete="off"
                aria-autocomplete="list"
                placeholder={`${stops.length === 0 ? "Add a start" : stops.length === 1 ? "Add a destination" : "Add a stop"} · address or lat, lng`}
                className="h-11 w-full rounded-xl bg-surface-2 px-3 text-sm outline-none placeholder:text-subtle"
              />
              {(() => {
                const kind = stops.length === 0 ? "depart" : addKind;
                const label =
                  kind === "auto"
                    ? "Auto time"
                    : `${kind === "arrive" ? "Arrive" : "Leave"} ${addAt ? formatDateTime(addAt) : "now"}`;
                return (
                  <button
                    type="button"
                    onClick={() => setAddWhenOpen((open) => !open)}
                    aria-expanded={addWhenOpen}
                    className="mt-1 flex h-8 items-center gap-1 px-1 text-xs text-muted"
                  >
                    {label}
                    <ChevronDown className={cn("size-3.5 transition", addWhenOpen && "rotate-180")} />
                  </button>
                );
              })()}
              {addWhenOpen ? (
                <WhenFields
                  kind={stops.length === 0 ? "depart" : addKind}
                  at={asDateTime(addAt || clock)}
                  allowAuto={stops.length > 0}
                  onKind={setAddKind}
                  onAt={setAddAt}
                />
              ) : null}
              <HitList
                query={query}
                hits={hits}
                active={hitActive}
                searching={searching}
                onPick={addStop}
                onHover={setHitActive}
              />
            </div>
          </li>
        </ol>

        {stops.length >= 2 ? (
          <>
            <p className="mt-5 text-[11px] font-medium uppercase tracking-wide text-muted">Routes</p>
            <AvoidToggles className="mt-2 mb-3" />
            <OptionList
              rows={optionRows}
              mixed={mixed}
              active={activeModes[0] ?? "fastest"}
              routing={routing}
              units={units}
              cheapAvoid={cheapAvoid}
              onPick={setAllModes}
              networkOf={networkOf}
              onToggleOptional={toggleOptionalCharge}
              onFineTune={() => setFineTune(true)}
            />
            <Sheet
              open={fineTune}
              onClose={closeFineTune}
              title="Fine-tune stops"
              subtitle={(() => {
                const row = optionRows.find((r) => r.mode === (activeModes[0] ?? "fastest"));
                const t = row?.totals;
                if (!t) return modeLabel(activeModes[0] ?? "fastest");
                return `${mixed ? "Mixed" : modeLabel(activeModes[0] ?? "fastest")} · ${minutesToHm(t.min)} · ${formatKrValue(t.kr, 0)} kr · ${t.charges} ${t.charges === 1 ? "charge" : "charges"}`;
              })()}
            >
              {stopsPlanner}
            </Sheet>
            <PreferNetwork abo={networkAbo} preferred={preferredNetwork} onPick={setPreferredNetwork} />
            <p className="mt-3 text-[10px] leading-relaxed text-subtle">
              Chargers from Open Charge Map, OpenStreetMap and supercharge.info (community data, not
              from Tesla or the operators).
            </p>
          </>
        ) : null}

        <RoadFeeSuggestions path={overviewFeePath} className="mt-4" />
        <div className="mt-4 flex gap-2">
          {clearConfirm ? (
            <ConfirmStrip
              className="min-w-0 flex-1"
              title="Clear this plan?"
              body="Stops, modes, and draft reset. Saved plans stay."
              confirmLabel="Clear"
              cancelLabel="Keep"
              onConfirm={() => {
                setClearConfirm(false);
                reset();
              }}
              onCancel={() => setClearConfirm(false)}
            />
          ) : naming ? (
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
                className="h-11 flex-1 rounded-full bg-surface-2 text-sm font-medium text-foreground"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => void exportToTesla(routePoints(), name.trim() || "Tesla trip")}
                className="flex h-11 flex-[1.4] items-center justify-center gap-1.5 rounded-full bg-foreground text-sm font-medium text-background"
              >
                <Navigation className="size-4" />
                Send to Tesla
              </button>
              <button
                type="button"
                onClick={() => setMoreOpen((open) => !open)}
                aria-expanded={moreOpen}
                aria-label="More actions"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </>
          )}
        </div>
        {moreOpen ? (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => {
            setNaming(false);
            setMoreOpen(false);
            setClearConfirm(true);
          }}
          className="h-9 rounded-full bg-surface-2 px-4 text-xs font-medium text-muted"
        >
          Clear plan
        </button>
        </div>
        ) : null}
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
      </div>
      ) : null}
      </>
      )}
      </div>
    </div>
  );
}

function PreferNetwork({
  abo,
  preferred,
  onPick,
}: {
  abo: Record<string, boolean>;
  preferred: string | null;
  onPick: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const subscribed = EU_NETWORKS.filter((n) => abo[n.id]);
  const current = subscribed.find((n) => n.id === preferred) ?? null;
  return (
    <div className="relative mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-9 max-w-full items-center gap-2 rounded-full bg-surface-2 px-3 text-xs"
      >
        <span className="truncate">
          {current ? `Prefer ${current.name}` : "Prefer a network"}
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
      </button>
      {current ? (
        <p className="mt-1 text-[11px] text-subtle">
          Fastest uses only {current.name}. Cheapest uses it unless another stall is cheaper.
        </p>
      ) : null}
      {open ? (
        <div className="absolute left-0 z-30 mt-1 w-64 overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
          <button
            type="button"
            onClick={() => {
              onPick(null);
              setOpen(false);
            }}
            className={cn(
              "flex w-full px-3 py-2.5 text-left text-sm",
              !current ? "text-foreground" : "text-muted",
            )}
          >
            No preference
          </button>
          {subscribed.length === 0 ? (
            <p className="border-t border-border px-3 py-2.5 text-[11px] text-subtle">
              Turn on a membership first. Only networks with an abo can be preferred.
            </p>
          ) : (
            subscribed.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  onPick(n.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full flex-col border-t border-border px-3 py-2.5 text-left",
                  current?.id === n.id ? "bg-surface-2" : "",
                )}
              >
                <span className="text-sm">{n.name}</span>
                <span className="text-[11px] text-muted">{n.aboName}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
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
