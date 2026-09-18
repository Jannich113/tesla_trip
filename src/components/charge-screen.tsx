import { lazy, Suspense, useDeferredValue, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BatteryBar } from "@/components/battery-bar";
import type { MapMarker } from "@/components/bay-map";
import { PeriodPills } from "@/components/period-pills";
import { HOME_LOCATION_ID, clampRadius, defaultRadius } from "@/lib/charge-locations";
import { searchAddress, type AddressHit } from "@/lib/geocode";
import {
  type Period,
  formatCents,
  formatDayLabel,
  formatUsd,
  laDayString,
  periodCaption,
  tripTotals,
} from "@/lib/history";
import { VEHICLE, energyKwh, formatNumber, minutesToHm, timeToLimitMin } from "@/lib/vehicle";
import { cn } from "@/lib/utils";
import { ranksFor, totalsFor, useChargeStore } from "@/store/charge-store";
import { useVehicleStore } from "@/store/vehicle-store";

const BayMap = lazy(() => import("@/components/bay-map").then((m) => ({ default: m.BayMap })));

type Draft = {
  name: string;
  address: string;
  cents: string;
  radiusM: string;
  lat: number;
  lng: number;
  hits: AddressHit[];
  searching: boolean;
};

export function ChargeScreen({ visible = true }: { visible?: boolean }) {
  const s = useVehicleStore();
  const locations = useChargeStore((st) => st.locations);
  const logged = useChargeStore((st) => st.logged);
  const chargeAtId = useChargeStore((st) => st.chargeAtId);
  const setChargeAt = useChargeStore((st) => st.setChargeAt);
  const addLocation = useChargeStore((st) => st.addLocation);
  const updateLocation = useChargeStore((st) => st.updateLocation);
  const removeLocation = useChargeStore((st) => st.removeLocation);

  const [period, setPeriod] = useState<Period>("month");
  const listPeriod = useDeferredValue(period);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [mapFocus, setMapFocus] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [mapOn, setMapOn] = useState(false);
  // Keep BayMap mounted across tab hides so reopen reuses the Leaflet instance.
  // First mount waits for idle so period pills / chrome stay tappable.
  useEffect(() => {
    if (!visible || mapOn) return;
    const kick = () => setMapOn(true);
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(kick, { timeout: 400 });
      return () => cancelIdleCallback(id);
    }
    const id = window.setTimeout(kick, 160);
    return () => window.clearTimeout(id);
  }, [visible, mapOn]);
  const today = useMemo(() => laDayString(), []);
  const totals = useMemo(() => totalsFor(locations, logged, listPeriod, today), [locations, logged, listPeriod, today]);
  const driven = useMemo(() => tripTotals(listPeriod, today), [listPeriod, today]);
  const ranks = useMemo(() => ranksFor(locations, logged, listPeriod, today), [locations, logged, listPeriod, today]);
  const blended = totals.kwh > 0 ? totals.usd / totals.kwh : 0;
  const remaining = Math.max(0, s.chargeLimit - s.soc);
  const minutes =
    s.mode === "charging"
      ? timeToLimitMin(s.soc, s.chargeLimit, Math.max(s.chargeKw, 0.1))
      : timeToLimitMin(s.soc, s.chargeLimit, VEHICLE.acKw);
  const activeId = selected && ranks.some((r) => r.id === selected) ? selected : (ranks[0]?.id ?? chargeAtId);
  const activeRank = ranks.find((r) => r.id === activeId);
  const chargeAt = locations.find((l) => l.id === chargeAtId) ?? locations[0];

  const markers: MapMarker[] = useMemo(() => {
    const list: MapMarker[] = ranks.map((r) => ({
      id: r.id,
      lat: r.lat,
      lng: r.lng,
      label: r.short,
      kind: r.kind === "home" ? "home" : "charger",
      badge: r.count > 0 ? String(r.count) : undefined,
      radiusM: r.radiusM,
    }));
    if (draft) {
      list.push({
        id: "draft",
        lat: draft.lat,
        lng: draft.lng,
        label: draft.name.trim() || "New",
        kind: "charger",
        radiusM: clampRadius(Number(draft.radiusM)),
      });
    }
    return list;
  }, [ranks, draft]);

  const [idleMarkers, setIdleMarkers] = useState<MapMarker[]>([]);
  useEffect(() => {
    if (!mapOn) return;
    const apply = () => setIdleMarkers(markers);
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(apply, { timeout: 400 });
      return () => cancelIdleCallback(id);
    }
    const t = window.setTimeout(apply, 160);
    return () => window.clearTimeout(t);
  }, [mapOn, markers]);

  function saveDraft() {
    if (!draft) return;
    const name = draft.name.trim() || draft.address.trim();
    const cents = Number(draft.cents);
    if (!name || !Number.isFinite(cents) || cents <= 0 || cents > 200) return;
    const loc = addLocation({
      name,
      usdPerKwh: cents / 100,
      lat: draft.lat,
      lng: draft.lng,
      radiusM: clampRadius(Number(draft.radiusM)),
    });
    setSelected(loc.id);
    setDraft(null);
    setMapFocus(null);
    toast(`Catch radius ${loc.radiusM} m at ${loc.short}`);
  }

  async function findAddress() {
    if (!draft || !s.shareLocation) {
      toast("Turn on precise location to look up an address");
      return;
    }
    setDraft({ ...draft, searching: true, hits: [] });
    try {
      const hits = await searchAddress(draft.address || draft.name);
      if (!hits.length) {
        toast("No address match — drop a pin instead");
        setDraft((cur) => (cur ? { ...cur, searching: false, hits: [] } : cur));
        return;
      }
      const top = hits[0];
      setDraft((cur) =>
        cur
          ? {
              ...cur,
              searching: false,
              hits,
              lat: top.lat,
              lng: top.lng,
              name: cur.name.trim() ? cur.name : top.label.split(",")[0],
            }
          : cur,
      );
      setMapFocus({ lat: top.lat, lng: top.lng, zoom: 16 });
    } catch {
      toast("Address lookup failed — drop a pin instead");
      setDraft((cur) => (cur ? { ...cur, searching: false } : cur));
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6">
      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              {s.mode === "charging"
                ? `Charging · ${formatNumber(s.chargeKw, 1)} kW`
                : s.pluggedIn
                  ? "Plugged in"
                  : "Unplugged"}
            </p>
            <p className="mt-1 text-3xl font-medium tracking-tight tabular-nums">
              {formatNumber(s.soc, 0)}
              <span className="ml-1 text-lg text-muted">%</span>
            </p>
          </div>
        </div>
        <div className="mt-3">
          <BatteryBar soc={s.soc} limit={s.chargeLimit} charging={s.mode === "charging"} />
        </div>
        <p className="mt-2 text-xs text-muted">
          {s.mode === "charging"
            ? `${minutesToHm(minutes)} to ${s.chargeLimit}%`
            : remaining <= 0
              ? "At daily limit"
              : `${formatNumber(Math.max(0, energyKwh(s.chargeLimit) - energyKwh(s.soc)), 1)} kWh to ${s.chargeLimit}%`}
        </p>
        <p className="mt-3 text-xs text-muted">
          Limit {s.chargeLimit}%
          <span className="text-subtle"> · </span>
          Sessions log to {chargeAt?.name ?? "Home"}
          {chargeAt ? (
            <span className="text-subtle">
              {" "}
              · {formatCents(chargeAt.usdPerKwh)} · {chargeAt.radiusM} m
            </span>
          ) : null}
        </p>
      </section>

      <PeriodPills
        value={period}
        onChange={(p) => {
          setPeriod(p);
          setSelected(null);
        }}
      />

      <section className="rounded-xl bg-surface px-5 py-5 shadow-[var(--shadow-border)]">
        <p className="text-xs font-medium text-muted">
          Charging cost · {periodCaption(period, today)}
        </p>
        <p className="mt-2 text-4xl font-medium tracking-tight tabular-nums">
          {formatUsd(totals.usd)}
        </p>
        <p className="mt-2 text-sm text-muted">
          {formatNumber(totals.kwh, 1)} kWh
          <span className="text-subtle"> · </span>
          {formatCents(blended)} blended
        </p>
      </section>

      {mapOn ? (
        <Suspense fallback={<div className="h-52 rounded-xl bg-surface shadow-[var(--shadow-border)]" />}>
          <BayMap
            markers={idleMarkers}
            selectedId={draft ? "draft" : activeId}
            onSelect={(id) => {
              if (id === "draft") return;
              setSelected(id);
              setChargeAt(id);
            }}
            onDrop={draft ? (lat, lng) => setDraft({ ...draft, lat, lng, hits: [] }) : undefined}
            dropping={!!draft}
            hidden={!s.shareLocation}
            focus={mapFocus}
            caption={
              draft
                ? "Tap map to place the pin · circle is the catch radius"
                : activeRank
                  ? `${activeRank.short} · ${formatCents(activeRank.usdPerKwh)} · ${activeRank.radiusM} m`
                  : `${ranks.length} locations`
            }
          />
        </Suspense>
      ) : (
        <div className="h-52 rounded-xl bg-surface shadow-[var(--shadow-border)]" />
      )}

      <section className="rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Locations by visits</p>
            <p className="mt-1 text-xs text-muted">{periodCaption(period, today)}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              const home = locations.find((l) => l.id === HOME_LOCATION_ID) ?? locations[0];
              setDraft({
                name: "",
                address: "",
                cents: "32.0",
                radiusM: String(defaultRadius("custom")),
                lat: home.lat + 0.008,
                lng: home.lng + 0.01,
                hits: [],
                searching: false,
              });
              setMapFocus({ lat: home.lat + 0.008, lng: home.lng + 0.01, zoom: 15 });
            }}
            className="h-9 rounded-full bg-surface-2 px-3 text-xs font-medium transition-[scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]"
          >
            Add location
          </button>
        </div>

        {draft ? (
          <form
            className="mt-4 space-y-3 rounded-lg bg-surface-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveDraft();
            }}
          >
            <label className="block">
              <span className="text-xs text-muted">Name</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Work garage"
                className="mt-1 h-10 w-full rounded-md bg-surface px-3 text-sm outline-none"
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Address</span>
              <div className="mt-1 flex gap-2">
                <input
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  placeholder="123 Castro St, Mountain View"
                  className="h-10 min-w-0 flex-1 rounded-md bg-surface px-3 text-sm outline-none"
                />
                <button
                  type="button"
                  onClick={() => void findAddress()}
                  disabled={draft.searching}
                  className="h-10 shrink-0 rounded-full bg-surface px-3 text-xs font-medium disabled:opacity-50"
                >
                  {draft.searching ? "Finding" : "Find"}
                </button>
              </div>
            </label>
            {draft.hits.length > 1 ? (
              <ul className="space-y-1">
                {draft.hits.map((hit) => (
                  <li key={`${hit.lat}-${hit.lng}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft({
                          ...draft,
                          lat: hit.lat,
                          lng: hit.lng,
                          name: draft.name.trim() ? draft.name : hit.label.split(",")[0],
                          address: hit.label,
                        });
                        setMapFocus({ lat: hit.lat, lng: hit.lng, zoom: 16 });
                      }}
                      className="w-full truncate rounded-md bg-surface px-3 py-2 text-left text-xs text-muted"
                    >
                      {hit.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-xs text-muted">Price · ¢/kWh</span>
                <input
                  value={draft.cents}
                  onChange={(e) => setDraft({ ...draft, cents: e.target.value })}
                  inputMode="decimal"
                  className="mt-1 h-10 w-full rounded-md bg-surface px-3 text-sm tabular-nums outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted">Radius · m</span>
                <input
                  value={draft.radiusM}
                  onChange={(e) => setDraft({ ...draft, radiusM: e.target.value })}
                  inputMode="numeric"
                  className="mt-1 h-10 w-full rounded-md bg-surface px-3 text-sm tabular-nums outline-none"
                />
              </label>
            </div>
            <p className="text-xs text-subtle">
              Sessions inside this circle attach automatically. Find sends the address to OpenStreetMap
              Nominatim only when you tap it.
            </p>
            <div className="flex gap-2">
              <button
                type="submit"
                className="h-10 flex-1 rounded-full bg-foreground text-sm font-medium text-background transition-[scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(null);
                  setMapFocus(null);
                }}
                className="h-10 flex-1 rounded-full bg-surface text-sm font-medium transition-[scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}

        <ol className="mt-2 divide-y divide-border">
          {ranks.map((place, i) => {
            const on = place.id === activeId;
            return (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(place.id);
                    setChargeAt(place.id);
                    setMapFocus({ lat: place.lat, lng: place.lng, zoom: 15 });
                  }}
                  className="flex w-full items-center gap-3 py-3 text-left"
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                      on ? "bg-foreground text-background" : "bg-surface-2 text-muted",
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-sm", on && "text-accent")}>{place.where}</p>
                    <p className="text-xs text-muted">
                      {place.count} {place.count === 1 ? "visit" : "visits"}
                      <span className="text-subtle"> · </span>
                      {formatCents(place.usdPerKwh)}
                      <span className="text-subtle"> · </span>
                      {place.radiusM} m
                      {place.lastDay ? (
                        <>
                          <span className="text-subtle"> · </span>
                          {formatDayLabel(place.lastDay, today)}
                        </>
                      ) : (
                        <span className="text-subtle"> · no sessions yet</span>
                      )}
                    </p>
                  </div>
                  <p className="text-sm tabular-nums">{place.count ? formatUsd(place.usd) : "—"}</p>
                </button>
                {on ? (
                  <div className="flex flex-wrap items-center gap-2 pb-3 pl-10">
                    <label className="flex items-center gap-2 text-xs text-muted">
                      Rate
                      <input
                        key={`${place.id}-rate-${place.usdPerKwh}`}
                        defaultValue={(place.usdPerKwh * 100).toFixed(1)}
                        onBlur={(e) => {
                          const cents = Number(e.target.value);
                          if (!Number.isFinite(cents) || cents <= 0 || cents > 200) return;
                          updateLocation(place.id, { usdPerKwh: cents / 100 });
                        }}
                        inputMode="decimal"
                        aria-label={`${place.where} rate cents per kWh`}
                        className="h-9 w-20 rounded-md bg-surface-2 px-2 text-sm tabular-nums text-foreground outline-none"
                      />
                      ¢
                    </label>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      Radius
                      <input
                        key={`${place.id}-r-${place.radiusM}`}
                        defaultValue={place.radiusM}
                        onBlur={(e) => {
                          const meters = Number(e.target.value);
                          if (!Number.isFinite(meters)) return;
                          updateLocation(place.id, { radiusM: clampRadius(meters) });
                        }}
                        inputMode="numeric"
                        aria-label={`${place.where} catch radius meters`}
                        className="h-9 w-16 rounded-md bg-surface-2 px-2 text-sm tabular-nums text-foreground outline-none"
                      />
                      m
                    </label>
                    {!place.preset ? (
                      <button
                        type="button"
                        onClick={() => removeLocation(place.id)}
                        className="h-9 rounded-full px-3 text-xs text-muted transition-[color,scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Tile label="Home" value={formatUsd(totals.homeUsd)} hint={`${formatNumber(totals.homeKwh, 0)} kWh`} />
        <Tile label="Supercharger" value={formatUsd(totals.scUsd)} hint={`${formatNumber(totals.scKwh, 0)} kWh`} />
        <Tile label="Custom" value={formatUsd(totals.otherUsd)} hint={`${formatNumber(totals.otherKwh, 0)} kWh`} />
        <Tile label="Per mile" value={driven.mi > 0 ? formatUsd(totals.usd / driven.mi, 3) : "—"} hint="cost to drive" />
      </div>
    </div>
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
