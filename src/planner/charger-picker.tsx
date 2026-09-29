import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { MapMarker } from "@/components/bay-map";
import { formatKrPerKwh } from "@/lib/elpris";
import type { ChargeLocation } from "@/lib/charge-locations";
import { cn } from "@/lib/utils";
import { chargerMark, chargersWithinRadius } from "./charger-radius";
import { haversineM } from "./insert";
import { searchAddress, type AddressHit } from "./search";

const BayMap = lazy(() => import("@/components/bay-map").then((m) => ({ default: m.BayMap })));

export type ChargerPick = { name: string; lat: number; lng: number };

function zoomForRadius(lat: number, radiusM: number) {
  const mPerPx = Math.max(radiusM, 500) / 108;
  const cos = Math.cos((lat * Math.PI) / 180) || 1;
  const zoom = Math.log2((156543.03392 * Math.abs(cos)) / mPerPx);
  return Math.max(8, Math.min(13, Math.round(zoom)));
}

function placeName(label: string) {
  return label.split(",")[0]?.trim() || label;
}

export function ChargerPicker({
  open,
  onToggle,
  origin,
  radiusM,
  radiusLabel,
  locations,
  memberships,
  acKw,
  activeId,
  onPick,
}: {
  open: boolean;
  onToggle: () => void;
  origin: { lat: number; lng: number; name: string };
  radiusM: number;
  radiusLabel: string;
  locations: ChargeLocation[];
  memberships: Record<string, boolean>;
  acKw: number;
  activeId?: string;
  onPick: (hit: ChargerPick) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [highlight, setHighlight] = useState<string | null>(activeId ?? null);

  useEffect(() => {
    if (open) setHighlight(activeId ?? null);
  }, [open, activeId]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      return;
    }
    const q = query.trim();
    if (q.length < 3) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchAddress(q).then(setHits);
    }, 280);
    return () => window.clearTimeout(t);
  }, [open, query]);

  const nearby = useMemo(
    () => chargersWithinRadius(locations, { lat: origin.lat, lng: origin.lng }, radiusM),
    [locations, origin.lat, origin.lng, radiusM],
  );

  const focus = useMemo(
    () => ({ lat: origin.lat, lng: origin.lng, zoom: zoomForRadius(origin.lat, radiusM) }),
    [origin.lat, origin.lng, radiusM],
  );

  const markers = useMemo(() => {
    const pins: MapMarker[] = [
      {
        id: "picker-origin",
        lat: origin.lat,
        lng: origin.lng,
        label: origin.name,
        kind: "place",
        radiusM,
      },
    ];
    for (const { loc } of nearby) {
      const mark = chargerMark(loc, memberships, acKw);
      const price = mark.priceKr != null ? formatKrPerKwh(mark.priceKr, 2) : "price unknown";
      pins.push({
        id: loc.id,
        lat: loc.lat,
        lng: loc.lng,
        label: `${mark.short} · ${price}`,
        kind: "charger",
        badge: String(mark.kw),
      });
    }
    return pins;
  }, [nearby, origin.lat, origin.lng, origin.name, radiusM, memberships, acKw]);

  function pickLocation(id: string) {
    if (id === "picker-origin") return;
    const hit = nearby.find((row) => row.loc.id === id);
    if (!hit) return;
    setHighlight(id);
    onPick({ name: hit.loc.short || hit.loc.name, lat: hit.loc.lat, lng: hit.loc.lng });
  }

  const km = radiusM / 1000;
  const shown = nearby.slice(0, 16);

  return (
    <div className="mt-3" data-charger-picker="">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="h-9 w-full rounded-full bg-surface-2 text-xs font-medium text-muted"
      >
        {open ? "Close charger map" : "Pick charger on map"}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-subtle">
            {radiusLabel} · {Number.isInteger(km) ? km.toFixed(0) : km.toFixed(1)} km radius · {nearby.length}{" "}
            {nearby.length === 1 ? "stall" : "stalls"}
          </p>
          <Suspense fallback={<div className="h-80 rounded-xl bg-surface-2" />}>
            <BayMap
              interactive
              markers={markers}
              selectedId={highlight}
              focus={focus}
              onSelect={pickLocation}
              caption="Tap a stall to replace this stop"
            />
          </Suspense>
          <label className="block text-xs text-muted">
            Address or place
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Address or place"
              className="mt-1 h-11 w-full rounded-md bg-surface-2 px-3 text-sm text-foreground outline-none placeholder:text-subtle"
            />
          </label>
          {hits.length ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl bg-surface-2">
              {hits.map((hit) => {
                const distM = haversineM(origin, hit);
                return (
                  <li key={`${hit.lat},${hit.lng}`}>
                    <button
                      type="button"
                      onClick={() =>
                        onPick({ name: placeName(hit.label), lat: hit.lat, lng: hit.lng })
                      }
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{hit.label}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-subtle">
                        {(distM / 1000).toFixed(1)} km from stop
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {shown.length ? (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted">In this radius</p>
              <ul className="mt-1 divide-y divide-border rounded-xl bg-surface-2">
                {shown.map(({ loc, distM }) => {
                  const mark = chargerMark(loc, memberships, acKw);
                  const on = highlight === loc.id || (!highlight && loc.id === activeId);
                  const price = mark.priceKr != null ? formatKrPerKwh(mark.priceKr, 2) : "price unknown";
                  return (
                    <li key={loc.id}>
                      <button
                        type="button"
                        onClick={() => pickLocation(loc.id)}
                        className={cn("flex w-full items-center gap-3 px-3 py-2 text-left", on && "bg-background/40")}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{loc.short || loc.name}</span>
                          <span className="block text-[11px] text-subtle">
                            {mark.network} · {mark.kw} kW · {price} · {(distM / 1000).toFixed(1)} km
                            {loc.id === activeId ? " · current" : ""}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              {nearby.length > shown.length ? (
                <p className="mt-1 text-[11px] text-subtle">
                  Nearest {shown.length} of {nearby.length} — every stall in the radius is on the map.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[11px] text-subtle">No stalls in this radius. Type a place to use it as the stop.</p>
          )}
          <p className="text-[11px] text-subtle">Nearest and cheapest stay in the list below.</p>
        </div>
      ) : null}
    </div>
  );
}
