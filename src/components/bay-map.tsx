import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils";

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "home" | "place" | "charger";
  badge?: string;
  radiusM?: number;
};

export type MapRoute = {
  id: string;
  from: [number, number];
  to: [number, number];
  weight: number;
  path?: [number, number][];
  color?: string;
};

function escapeHtml(s: string) {
  return s.replace(/[<>&"]/g, "");
}

function arc(a: [number, number], b: [number, number], steps = 18): [number, number][] {
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[1] - a[1];
  const dy = a[0] - b[0];
  const dist = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
  const bulge = Math.min(0.22, 0.08 + dist * 0.35);
  const cx = mx + bulge * dx;
  const cy = my + bulge * dy;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push([
      u * u * a[0] + 2 * u * t * cx + t * t * b[0],
      u * u * a[1] + 2 * u * t * cy + t * t * b[1],
    ]);
  }
  return pts;
}

export function BayMap({
  markers,
  routes = [],
  selectedId,
  selectedIds,
  onSelect,
  caption,
  onDrop,
  dropping = false,
  hidden = false,
  focus,
}: {
  markers: MapMarker[];
  routes?: MapRoute[];
  selectedId?: string | null;
  selectedIds?: string[];
  onSelect?: (id: string) => void;
  caption?: string;
  onDrop?: (lat: number, lng: number) => void;
  dropping?: boolean;
  hidden?: boolean;
  focus?: { lat: number; lng: number; zoom?: number } | null;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const groupRef = useRef<import("leaflet").LayerGroup | null>(null);
  const onSelectRef = useRef(onSelect);
  const onDropRef = useRef(onDrop);
  const [ready, setReady] = useState(false);
  onSelectRef.current = onSelect;
  onDropRef.current = onDrop;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    let cancelled = false;

    void (async () => {
      const leaflet = await import("leaflet");
      const L = leaflet.default;
      if (cancelled || !hostRef.current) return;

      const map = L.map(hostRef.current, {
        zoomControl: false,
        attributionControl: true,
        scrollWheelZoom: false,
      });
      L.control.zoom({ position: "bottomright" }).addTo(map);
      // No API key: public OSM raster tiles + CSS invert for a dark UI.
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">OpenStreetMap</a>',
      }).addTo(map);
      map.attributionControl?.setPosition("bottomleft");
      map.setView([37.45, -122.15], 10);
      groupRef.current = L.layerGroup().addTo(map);
      map.on("click", (e) => {
        onDropRef.current?.(e.latlng.lat, e.latlng.lng);
      });
      mapRef.current = map;
      map.invalidateSize();
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
      setReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
      groupRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;

    let disposed = false;
    void import("leaflet").then((leaflet) => {
      if (disposed || mapRef.current !== map) return;
      const L = leaflet.default;
      group.clearLayers();
      const bounds: [number, number][] = [];

      const selectedSet = new Set(
        [selectedId, ...(selectedIds ?? [])].filter((id): id is string => !!id),
      );
      const selectedRoutes = routes.filter((r) => selectedSet.has(r.id));
      const maxW = Math.max(1, ...routes.map((r) => r.weight));
      for (const route of routes) {
        const selected = selectedSet.has(route.id);
        const pts = route.path && route.path.length >= 2 ? route.path : arc(route.from, route.to);
        pts.forEach((p) => bounds.push(p));
        L.polyline(pts, {
          color: route.color || "#1ecf8a",
          opacity: selected ? 0.95 : selectedSet.size ? 0.16 : 0.28,
          weight: selected ? 4 : 1.6 + (route.weight / maxW) * 2.4,
          lineCap: "round",
          interactive: true,
        })
          .on("click", () => onSelectRef.current?.(route.id))
          .addTo(group);
      }

      for (const marker of markers) {
        bounds.push([marker.lat, marker.lng]);
        const onRoute = selectedRoutes.some((route) => {
          const pts = route.path && route.path.length >= 2 ? route.path : [route.from, route.to];
          return pts.some((p) => Math.abs(p[0] - marker.lat) < 1e-4 && Math.abs(p[1] - marker.lng) < 1e-4);
        });
        const selected = selectedSet.has(marker.id) || onRoute;
        if (marker.radiusM && marker.radiusM > 0 && (selected || dropping || markers.length <= 8)) {
          const circle = L.circle([marker.lat, marker.lng], {
            radius: marker.radiusM,
            color: "#1ecf8a",
            weight: selected ? 1.6 : 1,
            opacity: selected ? 0.85 : 0.28,
            fillColor: "#1ecf8a",
            fillOpacity: selected ? 0.16 : 0.05,
            interactive: false,
          }).addTo(group);
          if (selected) {
            const c = circle.getBounds();
            bounds.push([c.getSouth(), c.getWest()], [c.getNorth(), c.getEast()]);
          }
        }
        const html = `<div class="map-pin map-pin-${marker.kind}${selected ? " is-selected" : ""}">${
          marker.badge ? `<span class="map-pin-badge">${escapeHtml(marker.badge)}</span>` : `<span class="map-pin-dot"></span>`
        }<span class="map-pin-label">${escapeHtml(marker.label)}</span></div>`;
        L.marker([marker.lat, marker.lng], {
          icon: L.divIcon({
            className: "map-pin-wrap",
            html,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          }),
          zIndexOffset: selected ? 600 : 0,
        })
          .on("click", () => onSelectRef.current?.(marker.id))
          .addTo(group);
      }

      const focus =
        selectedRoutes.length > 0
          ? selectedRoutes.flatMap((r) => (r.path && r.path.length >= 2 ? r.path : arc(r.from, r.to)))
          : bounds;
      if (!dropping && focus.length >= 2) {
        map.fitBounds(L.latLngBounds(focus), {
          padding: [48, 48],
          maxZoom: selectedRoutes.length === 1 ? 13 : 9,
          animate: false,
        });
      } else if (!dropping && focus.length === 1) {
        map.setView(focus[0], 15, { animate: false });
      }
      map.invalidateSize();
    });

    return () => {
      disposed = true;
    };
  }, [ready, markers, routes, selectedId, selectedIds, dropping]);

  useEffect(() => {
    if (!ready || !focus) return;
    mapRef.current?.setView([focus.lat, focus.lng], focus.zoom ?? 15, { animate: false });
  }, [ready, focus]);

  if (hidden) {
    return (
      <div className="rounded-xl bg-surface px-5 py-8 shadow-[var(--shadow-border)]">
        <p className="text-sm font-medium">Location is off</p>
        <p className="mt-1 text-xs text-muted">
          Maps and coordinates stay on this device. Turn precise location on in Juniper to show them.
        </p>
      </div>
    );
  }

  return (
    <div className="relative isolate overflow-hidden rounded-xl bg-surface shadow-[var(--shadow-border)]">
      <div ref={hostRef} className={cn("bay-map h-80 w-full", dropping && "cursor-crosshair")} />
      {caption ? (
        <p className="pointer-events-none absolute left-3 top-3 rounded-full bg-background/85 px-3 py-1 text-xs text-foreground">
          {caption}
        </p>
      ) : null}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 rounded-xl",
          "shadow-[inset_0_0_0_1px_var(--color-border)]",
        )}
      />
    </div>
  );
}
