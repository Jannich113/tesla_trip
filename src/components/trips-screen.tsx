import { useMemo, useState } from "react";
import { BayMap, type MapMarker, type MapRoute } from "@/components/bay-map";
import { PeriodPills } from "@/components/period-pills";
import {
  type EnergyDay,
  type Period,
  DELIVERED_DAY,
  TRIPS,
  dailyEnergy,
  formatDayLabel,
  formatDayRange,
  formatUsd,
  formatWhen,
  groupTrips,
  laDayString,
  periodCaption,
  periodEnergy,
  periodStart,
  tripCorridors,
  tripTotals,
  tripsInRange,
  type Trip,
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
} from "@/store/trip-store";
import { useVehicleStore } from "@/store/vehicle-store";

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

export function TripsScreen() {
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
  const [selected, setSelected] = useState<string | null>(null);
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [draftName, setDraftName] = useState("");
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");

  const today = useMemo(() => laDayString(), []);
  const periodTotals = useMemo(() => tripTotals(period, today), [period, today]);
  const groups = useMemo(() => groupTrips(period, today), [period, today]);
  const corridors = useMemo(() => tripCorridors(period, today), [period, today]);
  const album = albums.find((a) => a.id === albumId) ?? null;
  const albumItems = useMemo(() => (album ? albumTrips(album) : []), [album]);
  const pickedItems = useMemo(() => TRIPS.filter((t) => picked.includes(t.id)), [picked]);

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
    return periodEnergy(period, sessions, today);
  }, [focusTrips, sessions, today, period, spanStart, spanEnd, insight?.firstDay, insight?.lastDay]);
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
  const listed = groups.reduce((n, g) => n + g.items.length, 0);
  const visible = groups.slice(0, period === "week" || period === "day" ? 14 : 28);
  const hero = insight ?? periodTotals;
  const whMi = hero.mi > 0.1 ? (hero.kwh * 1000) / hero.mi : 0;
  const historyGroups = useMemo(() => {
    if (album && !picking) return byDay(albumItems, today);
    if (picking && rangeStart && rangeEnd) return byDay(tripsInRange(rangeStart, rangeEnd), today);
    return visible;
  }, [album, picking, albumItems, today, rangeStart, rangeEnd, visible]);

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
    <div className="space-y-5 px-4 pb-6">
      <PeriodPills
        value={period}
        onChange={(p) => {
          setPeriod(p);
          setSelected(null);
          if (!album) setAlbumId(null);
        }}
      />

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Road trips</p>
            <p className="mt-1 text-xs text-muted">
              {albums.length ? `${albums.length} saved` : "Group trips into a named trip"}
            </p>
          </div>
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

      <BayMap
        markers={mapMarkers}
        routes={mapRoutes}
        selectedId={active}
        selectedIds={selectedIds}
        onSelect={selectOnMap}
        caption={caption}
        hidden={!shareLocation}
      />

      <section className="rounded-xl bg-surface px-5 py-5 shadow-[var(--shadow-border)]">
        <p className="text-xs font-medium text-muted">
          {picking && insight
            ? `${insight.count} selected`
            : album
              ? album.name
              : periodCaption(period, today)}
        </p>
        {insight ? (
          <p className="mt-1 text-xs text-subtle">{formatDayRange(insight.firstDay, insight.lastDay, today)}</p>
        ) : null}
        <p className="mt-2 text-4xl font-medium tracking-tight tabular-nums">
          {formatDistance(hero.mi, units, hero.mi >= 100 ? 0 : 1)}
        </p>
        <p className="mt-2 text-sm text-muted">
          {formatNumber(hero.count, 0)} {hero.count === 1 ? "trip" : "trips"}
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
        <>
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
        </>
      ) : null}

      <EnergyDays
        days={energyDays}
        maxKwh={maxKwh}
        units={units}
        monthly={(period === "year" || period === "total") && !focusTrips}
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
            {picking
              ? `${picked.length} selected`
              : album
                ? `${albumItems.length} trips`
                : visible.length < groups.length
                  ? `Latest ${visible.reduce((n, g) => n + g.items.length, 0)} of ${listed}`
                  : `${listed} trips`}
          </p>
        </div>
        <div className="mt-2">
          {historyGroups.map((group) => (
            <div key={group.day} className="pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-subtle">
                {group.label}
              </p>
              <ul className="divide-y divide-border">
                {group.items.map((trip) => {
                  const key = `${trip.from}→${trip.to}`;
                  const on = !picking && key === active;
                  const marked = picked.includes(trip.id);
                  const owned = albumOfTrip(albums, trip.id);
                  const wh = (trip.kwh * 1000) / trip.mi;
                  return (
                    <li key={trip.id}>
                      <button
                        type="button"
                        onClick={() => (picking ? togglePick(trip.id) : setSelected(key))}
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
                          <p className={cn("truncate text-sm", (on || marked) && "text-accent")}>
                            {trip.to}
                          </p>
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
                          <p className="text-sm tabular-nums">
                            {formatDistance(trip.mi, units, 1)}
                          </p>
                          <p className="text-xs tabular-nums text-muted">
                            {formatNumber(trip.kwh, 1)} kWh · {formatEfficiency(wh, units)}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function byDay(trips: Trip[], today: string) {
  const groups: { day: string; label: string; items: Trip[] }[] = [];
  const sorted = [...trips].sort((a, b) => (a.day === b.day ? b.hour - a.hour : a.day < b.day ? 1 : -1));
  for (const t of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.day === t.day) last.items.push(t);
    else groups.push({ day: t.day, label: formatDayLabel(t.day, today), items: [t] });
  }
  return groups;
}

function EnergyDays({
  days,
  maxKwh,
  units,
  monthly,
}: {
  days: EnergyDay[];
  maxKwh: number;
  units: "mi" | "km";
  monthly?: boolean;
}) {
  if (!days.length) return null;
  const drive = days.reduce((n, d) => n + d.driveKwh, 0);
  const charge = days.reduce((n, d) => n + d.chargeKwh, 0);
  return (
    <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
      <div className="flex items-end justify-between gap-3">
        <p className="text-sm font-medium">{monthly ? "Monthly energy" : "Daily energy"}</p>
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
