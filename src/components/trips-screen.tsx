import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { ChevronDown, MapPinned } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { MapMarker, MapRoute } from "@/components/bay-map";
import { PeriodPills } from "@/components/period-pills";
import {
  type EnergyDay,
  type Period,
  DELIVERED_DAY,
  getTrips,
  dailyEnergy,
  formatDayRange,
  formatUsd,
  formatWhen,
  laDayString,
  nestTrips,
  periodCaption,
  periodEnergy,
  periodStart,
  tripCorridors,
  tripTotals,
  tripsIn,
  tripsInRange,
  type Trip,
  type TripHistoryGroup,
} from "@/lib/history";
import { geo } from "@/lib/places";
import { cn } from "@/lib/utils";
import { formatDistance, formatEfficiency, formatNumber, minutesToHm } from "@/lib/vehicle";
import { pricedSessions, useChargeStore } from "@/store/charge-store";
import {
  albumInsight,
  albumOfTrip,
  albumTotals,
  albumTrips,
  useTripStore,
  type TripAlbum,
} from "@/store/trip-store";
import { useVehicleStore } from "@/store/vehicle-store";

const BayMap = lazy(() => import("@/components/bay-map").then((m) => ({ default: m.BayMap })));

function routesFromTrips(trips: Trip[]): { routes: MapRoute[]; markers: MapMarker[]; keys: string[] } {
  const corridors = new Map<string, MapRoute>();
  const markers: MapMarker[] = [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const trip of trips) {
    const from = geo(trip.from);
    const to = geo(trip.to);
    if (!from || !to) continue;
    const key = `${trip.from}→${trip.to}`;
    keys.push(key);
    const prev = corridors.get(key);
    if (prev) prev.weight += 1;
    else corridors.set(key, { id: key, from: [from.lat, from.lng], to: [to.lat, to.lng], weight: 1 });
    for (const [name, g] of [
      [trip.from, from],
      [trip.to, to],
    ] as const) {
      if (seen.has(name)) continue;
      seen.add(name);
      markers.push({
        id: name,
        lat: g.lat,
        lng: g.lng,
        label: g.short,
        kind: name === "Home" ? "home" : "place",
      });
    }
  }
  return { routes: [...corridors.values()], markers, keys };
}

export function TripsScreen({ visible = true }: { visible?: boolean }) {
  const units = useVehicleStore((s) => s.units);
  const shareLocation = useVehicleStore((s) => s.shareLocation);
  const albums = useTripStore((s) => s.albums);
  const addAlbum = useTripStore((s) => s.addAlbum);
  const renameAlbum = useTripStore((s) => s.renameAlbum);
  const removeAlbum = useTripStore((s) => s.removeAlbum);
  const locations = useChargeStore((s) => s.locations);
  const logged = useChargeStore((s) => s.logged);
  const sessions = useMemo(() => pricedSessions(locations, logged), [locations, logged]);

  const [period, setPeriod] = useState<Period>("week");
  const listPeriod = useDeferredValue(period);
  const [selected, setSelected] = useState<string | null>(null);
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [draftName, setDraftName] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [mapOn, setMapOn] = useState(false);
  useEffect(() => {
    if (!visible) {
      setMapOn(false);
      return;
    }
    const id = window.setTimeout(() => setMapOn(true), 400);
    return () => window.clearTimeout(id);
  }, [visible]);

  const today = useMemo(() => laDayString(), []);
  const periodTotals = useMemo(() => tripTotals(listPeriod, today), [listPeriod, today]);
  const corridors = useMemo(() => tripCorridors(listPeriod, today), [listPeriod, today]);
  const album = albums.find((a) => a.id === albumId) ?? null;
  const albumItems = useMemo(() => (album ? albumTrips(album) : []), [album]);
  const pickedItems = useMemo(() => getTrips().filter((t) => picked.includes(t.id)), [picked]);

  const focusTrips: Trip[] | null = picking && pickedItems.length
    ? pickedItems
    : album
      ? albumItems
      : null;
  const insight = useMemo(
    () => (focusTrips ? albumInsight(focusTrips, sessions, today) : null),
    [focusTrips, sessions, today],
  );
  const spanStart = picking ? rangeStart : album?.startDay || insight?.firstDay;
  const spanEnd = picking ? rangeEnd : album?.endDay || insight?.lastDay;
  const energyDays = useMemo(() => {
    if (focusTrips?.length) {
      const start = spanStart || insight?.firstDay;
      const end = spanEnd || insight?.lastDay;
      return dailyEnergy(
        focusTrips,
        sessions,
        today,
        start && end ? { start, end, fill: true } : undefined,
      );
    }
    return periodEnergy(listPeriod, sessions, today);
  }, [focusTrips, sessions, today, listPeriod, spanStart, spanEnd, insight?.firstDay, insight?.lastDay]);
  const maxKwh = Math.max(0.1, ...energyDays.flatMap((d) => [d.driveKwh, d.chargeKwh]));

  const corridorView = useMemo(() => {
    const shown = corridors.slice(0, 12);
    const routes: MapRoute[] = shown.flatMap((c) => {
      const from = geo(c.from);
      const to = geo(c.to);
      if (!from || !to) return [];
      return [{ id: c.key, from: [from.lat, from.lng], to: [to.lat, to.lng], weight: c.count }];
    });
    const markers: MapMarker[] = [];
    const destSeen = new Set<string>();
    for (const c of shown) {
      for (const name of [c.from, c.to]) {
        const g = geo(name);
        if (!g || destSeen.has(name)) continue;
        destSeen.add(name);
        markers.push({
          id: name,
          lat: g.lat,
          lng: g.lng,
          label: g.short,
          kind: name === "Home" ? "home" : "place",
        });
      }
    }
    return { routes, markers };
  }, [corridors]);

  const focusView = useMemo(
    () => (focusTrips ? routesFromTrips(focusTrips) : null),
    [focusTrips],
  );

  const mapRoutes = focusView?.routes ?? corridorView.routes;
  const mapMarkers = useMemo(() => {
    const base = focusView?.markers ?? corridorView.markers;
    if (!insight?.charges.length) return base;
    const seen = new Set(base.map((m) => m.id));
    const extra: MapMarker[] = [];
    for (const c of insight.charges) {
      const g = geo(c.where);
      if (!g || seen.has(c.where)) continue;
      seen.add(c.where);
      extra.push({
        id: c.where,
        lat: g.lat,
        lng: g.lng,
        label: g.short,
        kind: "charger",
        badge: String(c.count),
      });
    }
    return extra.length ? [...base, ...extra] : base;
  }, [focusView, corridorView, insight]);
  const active = selected && mapRoutes.some((r) => r.id === selected) ? selected : mapRoutes[0]?.id;
  const selectedIds = useMemo(
    () => (focusView ? focusView.keys : active ? [active] : []),
    [focusView, active],
  );
  const historyTree = useMemo(() => {
    if (album && !picking) return nestTrips(albumItems, "week", today);
    if (picking && rangeStart && rangeEnd) return nestTrips(tripsInRange(rangeStart, rangeEnd), "week", today);
    return nestTrips(tripsIn(listPeriod, today), listPeriod, today);
  }, [album, picking, albumItems, today, rangeStart, rangeEnd, listPeriod]);
  const listed = historyTree.reduce((n, g) => n + g.items.length, 0);
  const hero = insight ?? periodTotals;
  const whMi = hero.mi > 0.1 ? (hero.kwh * 1000) / hero.mi : 0;

  const caption = picking && picked.length
    ? `${picked.length} selected`
    : album && insight
      ? `${album.name} · ${insight.count} trips`
      : corridors.find((c) => c.key === active)
        ? `${corridors.find((c) => c.key === active)!.from.split(" · ")[0]} → ${corridors.find((c) => c.key === active)!.to.split(",")[0].split(" · ")[0]}`
        : `${formatNumber(periodTotals.count, 0)} trips`;

  function applyRange(start: string, end: string) {
    setRangeStart(start);
    setRangeEnd(end);
    if (start && end) {
      setPicked(tripsInRange(start, end).map((t) => t.id));
    }
  }

  function togglePick(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function saveGroup() {
    const created = addAlbum(
      draftName,
      picked,
      rangeStart && rangeEnd ? { startDay: rangeStart, endDay: rangeEnd } : undefined,
    );
    if (!created) return;
    setPicking(false);
    setPicked([]);
    setDraftName("");
    setRangeStart("");
    setRangeEnd("");
    setAlbumId(created.id);
    setSelected(null);
  }

  function selectOnMap(id: string) {
    if (picking) return;
    if (id.includes("→")) {
      setSelected(id);
      return;
    }
    const hit = mapRoutes.find((r) => r.id.startsWith(id) || r.id.endsWith(id));
    if (hit) setSelected(hit.id);
  }

  return (
    <div className="space-y-5 px-4 pb-6" data-period={period}>
      <PeriodPills
        value={period}
        onChange={(p) => {
          setPeriod(p);
          setSelected(null);
          setOpenGroups({});
          if (!album) setAlbumId(null);
        }}
      />

      <section className="rounded-xl bg-surface px-5 py-5 shadow-[var(--shadow-border)]">
        <p className="text-xs font-medium text-muted">{periodCaption(period, today)}</p>
        {insight ? (
          <p className="mt-1 text-xs text-subtle">
            {picking
              ? `${insight.count} selected · ${formatDayRange(insight.firstDay, insight.lastDay, today)}`
              : album
                ? `${album.name} · ${formatDayRange(insight.firstDay, insight.lastDay, today)}`
                : formatDayRange(insight.firstDay, insight.lastDay, today)}
          </p>
        ) : null}
        <p className="mt-2 text-4xl font-medium tracking-tight tabular-nums">
          {formatDistance(hero.mi, units, hero.mi >= 100 ? 0 : 1)}
        </p>
        <p className="mt-2 text-sm text-muted">
          {formatNumber(hero.count, 0)} {hero.count === 1 ? "trip" : "trips"}
          <span className="text-subtle"> · </span>
          {formatNumber(hero.kwh, 1)} kWh
          {insight ? (
            <>
              <span className="text-subtle"> · </span>
              {insight.days.length} {insight.days.length === 1 ? "day" : "days"}
            </>
          ) : null}
          <span className="text-subtle"> · </span>
          {formatEfficiency(whMi, units)}
          <span className="text-subtle"> · </span>
          {minutesToHm(hero.min)}
        </p>
      </section>

      {insight ? (
        <div className="grid grid-cols-2 gap-3">
          <Tile
            label="Drive cost"
            value={formatUsd(insight.driveUsd)}
            hint={insight.chargeCount ? "at charging mix" : "est. home rate"}
          />
          <Tile
            label="Energy"
            value={`${formatNumber(insight.kwh, 1)} kWh`}
            hint={insight.farthest ? `Longest ${formatDistance(insight.farthest.mi, units, 1)}` : undefined}
          />
          <Tile label="Time" value={minutesToHm(insight.min)} hint={`${formatNumber(insight.mi / Math.max(insight.count, 1), 1)} avg`} />
          <Tile
            label="Places"
            value={String(insight.places.length)}
            hint={insight.places[0] ? insight.places[0].short : undefined}
          />
        </div>
      ) : null}

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Road trips</p>
            <p className="mt-1 text-xs text-muted">
              {albums.length ? `${albums.length} saved` : "Group trips into a named trip"}
            </p>
          </div>
          <Link
            to="/plan"
            className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-muted"
            aria-label="Open trip planner"
          >
            <MapPinned className="size-4" />
          </Link>
          <button
            type="button"
            onClick={() => {
              setPicking((on) => !on);
              setPicked([]);
              setDraftName("");
              setRangeStart("");
              setRangeEnd("");
              if (!picking) setAlbumId(null);
            }}
            className={cn(
              "h-9 rounded-full px-3 text-xs font-medium",
              "transition-[scale,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
              picking ? "bg-foreground text-background" : "bg-surface-2",
            )}
          >
            {picking ? "Cancel" : "Group trips"}
          </button>
        </div>

        {albums.length ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {albums.map((item) => {
              const on = item.id === albumId && !picking;
              const stats = albumTotals(item);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicking(false);
                      setAlbumId(on ? null : item.id);
                      setSelected(null);
                    }}
                    className={cn(
                      "h-9 rounded-full px-3 text-xs font-medium",
                      "transition-[scale,background-color,color] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
                      on ? "bg-foreground text-background" : "bg-surface-2 text-muted",
                    )}
                  >
                    {item.name}
                    <span className="ml-1 tabular-nums opacity-70"> {stats.count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}

        {album && !picking ? (
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                key={album.id}
                defaultValue={album.name}
                onBlur={(e) => renameAlbum(album.id, e.target.value)}
                aria-label="Road trip name"
                className="h-10 min-w-0 flex-1 rounded-md bg-surface-2 px-3 text-sm outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  removeAlbum(album.id);
                  setAlbumId(null);
                }}
                className="h-10 rounded-full px-3 text-xs text-muted"
              >
                Remove
              </button>
            </div>
            {album.startDay && album.endDay ? (
              <p className="text-xs text-muted">{formatDayRange(album.startDay, album.endDay, today)}</p>
            ) : null}
          </div>
        ) : null}

        {picking ? (
          <form
            className="mt-3 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveGroup();
            }}
          >
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder="Napa weekend"
              aria-label="Group name"
              className="h-11 w-full rounded-md bg-surface-2 px-3 text-sm outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-muted">
                Start
                <input
                  type="date"
                  value={rangeStart}
                  min={DELIVERED_DAY}
                  max={rangeEnd || today}
                  onChange={(e) => applyRange(e.target.value, rangeEnd || e.target.value)}
                  aria-label="Road trip start date"
                  className="mt-1 h-11 w-full rounded-md bg-surface-2 px-3 text-sm text-foreground outline-none"
                />
              </label>
              <label className="text-xs text-muted">
                End
                <input
                  type="date"
                  value={rangeEnd}
                  min={rangeStart || DELIVERED_DAY}
                  max={today}
                  onChange={(e) => applyRange(rangeStart || e.target.value, e.target.value)}
                  aria-label="Road trip end date"
                  className="mt-1 h-11 w-full rounded-md bg-surface-2 px-3 text-sm text-foreground outline-none"
                />
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => applyRange(periodStart("week", today), today)}
                className="h-9 flex-1 rounded-full bg-surface-2 text-xs font-medium"
              >
                This week
              </button>
              <button
                type="button"
                onClick={() => applyRange(periodStart("month", today), today)}
                className="h-9 flex-1 rounded-full bg-surface-2 text-xs font-medium"
              >
                This month
              </button>
            </div>
            <button
              type="submit"
              disabled={!draftName.trim() || picked.length < 2}
              className="h-11 w-full rounded-full bg-foreground text-sm font-medium text-background transition-[scale,opacity] duration-150 ease-[var(--ease-out)] active:scale-[0.96] disabled:opacity-40"
            >
              Save {picked.length ? `${picked.length} trips` : "group"}
            </button>
            <p className="text-xs text-subtle">
              {rangeStart && rangeEnd
                ? `${picked.length} trips from ${formatDayRange(rangeStart, rangeEnd, today)}. Uncheck any to drop.`
                : "Pick dates to grab every trip in the window, or mark them below."}
            </p>
          </form>
        ) : null}
      </section>

      {mapOn && visible ? (
        <Suspense fallback={<div className="h-52 rounded-xl bg-surface shadow-[var(--shadow-border)]" />}>
          <BayMap
            markers={mapMarkers}
            routes={mapRoutes}
            selectedId={active}
            selectedIds={selectedIds}
            onSelect={selectOnMap}
            caption={caption}
            hidden={!shareLocation}
          />
        </Suspense>
      ) : (
        <div className="h-52 rounded-xl bg-surface shadow-[var(--shadow-border)]" />
      )}

      <EnergyDays
        days={energyDays}
        maxKwh={maxKwh}
        units={units}
        title={
          focusTrips
            ? "Daily energy"
            : period === "total"
              ? "Yearly energy"
              : period === "year"
                ? "Monthly energy"
                : period === "month"
                  ? "Weekly energy"
                  : "Daily energy"
        }
      />

      {insight ? (
        <>
          <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
            <p className="text-sm font-medium">Places</p>
            <ol className="mt-2 divide-y divide-border">
              {insight.places.map((place, i) => (
                <li key={place.name} className="flex items-center gap-3 py-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs tabular-nums text-muted">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{place.name}</p>
                    <p className="text-xs text-muted">
                      {place.count} {place.count === 1 ? "stop" : "stops"}
                    </p>
                  </div>
                  <p className="text-sm tabular-nums">{formatDistance(place.mi, units, 1)}</p>
                </li>
              ))}
            </ol>
          </section>

          {insight.charges.length ? (
            <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
              <div className="flex items-end justify-between">
                <p className="text-sm font-medium">Charging on this trip</p>
                <p className="text-xs text-muted">{formatUsd(insight.chargeUsd)}</p>
              </div>
              <ol className="mt-2 divide-y divide-border">
                {insight.charges.map((c) => (
                  <li key={c.where} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{c.where}</p>
                      <p className="text-xs text-muted">
                        {c.count} {c.count === 1 ? "session" : "sessions"}
                        <span className="text-subtle"> · </span>
                        {formatNumber(c.kwh, 1)} kWh
                      </p>
                    </div>
                    <p className="text-sm tabular-nums">{formatUsd(c.usd)}</p>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      ) : null}

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-end justify-between">
          <p className="text-sm font-medium">{album && !picking ? album.name : "History"}</p>
          <p className="text-xs text-muted">
            {picking ? `${picked.length} selected` : `${listed} trips`}
          </p>
        </div>
        <div className="mt-1">
          {historyTree.map((group) => (
            <HistoryGroup
              key={group.key}
              group={group}
              depth={0}
              open={openGroups}
              onToggle={(key) => setOpenGroups((cur) => ({ ...cur, [key]: !cur[key] }))}
              picking={picking}
              picked={picked}
              active={active}
              album={album}
              albums={albums}
              today={today}
              units={units}
              onPick={togglePick}
              onSelect={setSelected}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function HistoryGroup({
  group,
  depth,
  open,
  onToggle,
  picking,
  picked,
  active,
  album,
  albums,
  today,
  units,
  onPick,
  onSelect,
}: {
  group: TripHistoryGroup;
  depth: number;
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
  picking: boolean;
  picked: string[];
  active: string | undefined;
  album: TripAlbum | null;
  albums: TripAlbum[];
  today: string;
  units: "mi" | "km";
  onPick: (id: string) => void;
  onSelect: (key: string) => void;
}) {
  const expanded = Boolean(open[group.key]);
  const miles = group.items.reduce((n, t) => n + t.mi, 0);
  return (
    <div className={depth ? "pl-4" : undefined}>
      <button
        type="button"
        onClick={() => onToggle(group.key)}
        className="flex w-full items-center gap-3 py-3 text-left transition-[scale] duration-150 ease-[var(--ease-out)] active:scale-[0.99]"
      >
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted transition-transform duration-150 ease-[var(--ease-out)]",
            expanded ? "rotate-0" : "-rotate-90",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate", depth ? "text-sm" : "text-sm font-medium")}>{group.label}</p>
          <p className="text-xs text-muted">
            {group.items.length} {group.items.length === 1 ? "trip" : "trips"}
            {miles > 0 ? (
              <>
                <span className="text-subtle"> · </span>
                {formatDistance(miles, units, miles >= 100 ? 0 : 1)}
              </>
            ) : null}
          </p>
        </div>
      </button>
      {expanded ? (
        group.groups.length ? (
          group.groups.map((child) => (
            <HistoryGroup
              key={child.key}
              group={child}
              depth={depth + 1}
              open={open}
              onToggle={onToggle}
              picking={picking}
              picked={picked}
              active={active}
              album={album}
              albums={albums}
              today={today}
              units={units}
              onPick={onPick}
              onSelect={onSelect}
            />
          ))
        ) : (
          <ul className="divide-y divide-border pl-7">
            {group.items.map((trip) => {
              const key = `${trip.from}→${trip.to}`;
              const on = !picking && key === active;
              const marked = picked.includes(trip.id);
              const owned = albumOfTrip(albums, trip.id);
              const wh = trip.mi > 0 ? (trip.kwh * 1000) / trip.mi : 0;
              return (
                <li key={trip.id}>
                  <button
                    type="button"
                    onClick={() => (picking ? onPick(trip.id) : onSelect(key))}
                    className={cn(
                      "flex w-full items-center gap-3 py-3 text-left",
                      "transition-[opacity] duration-150 ease-[var(--ease-out)]",
                      picking && marked ? "opacity-100" : on ? "opacity-100" : "opacity-80",
                    )}
                  >
                    {picking ? (
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full",
                          marked ? "bg-foreground" : "bg-surface-2 shadow-[var(--shadow-border)]",
                        )}
                      >
                        {marked ? <span className="size-2 rounded-full bg-background" /> : null}
                      </span>
                    ) : null}
                    <div className="min-w-0 flex-1 pr-3">
                      <p className={cn("truncate text-sm", (on || marked) && "text-accent")}>{trip.to}</p>
                      <p className="truncate text-xs text-muted">
                        {formatWhen(trip.day, trip.hour, trip.minute, today)}
                        <span className="text-subtle"> · </span>
                        {trip.from}
                        {owned && !album ? (
                          <>
                            <span className="text-subtle"> · </span>
                            {owned.name}
                          </>
                        ) : null}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm tabular-nums">{formatDistance(trip.mi, units, 1)}</p>
                      <p className="text-xs tabular-nums text-muted">
                        {formatNumber(trip.kwh, 1)} kWh · {formatEfficiency(wh, units)}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}

function EnergyDays({
  days,
  maxKwh,
  units,
  title,
}: {
  days: EnergyDay[];
  maxKwh: number;
  units: "mi" | "km";
  title: string;
}) {
  if (!days.length) return null;
  const drive = days.reduce((n, d) => n + d.driveKwh, 0);
  const charge = days.reduce((n, d) => n + d.chargeKwh, 0);
  return (
    <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted">
          <span className="text-accent">Driven</span>
          <span className="text-subtle"> · </span>
          Charged
        </p>
      </div>
      <p className="mt-1 text-xs text-subtle">
        {formatNumber(drive, 1)} kWh out
        <span className="text-subtle"> · </span>
        {formatNumber(charge, 1)} kWh in
      </p>
      <ul className="mt-2 divide-y divide-border">
        {days.map((day) => (
          <li key={day.key} className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm">{day.label}</p>
                <p className="text-xs text-muted">
                  {day.trips} {day.trips === 1 ? "trip" : "trips"}
                  {day.mi > 0 ? (
                    <>
                      <span className="text-subtle"> · </span>
                      {formatDistance(day.mi, units, day.mi >= 100 ? 0 : 1)}
                    </>
                  ) : null}
                  {day.chargeKwh > 0 ? (
                    <>
                      <span className="text-subtle"> · </span>
                      {formatNumber(day.chargeKwh, 1)} kWh in
                      {day.chargeUsd > 0 ? ` · ${formatUsd(day.chargeUsd)}` : ""}
                    </>
                  ) : null}
                </p>
              </div>
              <p className="text-sm tabular-nums">{formatNumber(day.driveKwh, 1)} kWh</p>
            </div>
            <div className="mt-2 space-y-1">
              <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.min(100, (day.driveKwh / maxKwh) * 100)}%` }}
                />
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-foreground/35"
                  style={{ width: `${Math.min(100, (day.chargeKwh / maxKwh) * 100)}%` }}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-4 shadow-[var(--shadow-border)]">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-medium tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}
