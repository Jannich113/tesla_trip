import { memo, useEffect, useRef, useState } from "react";
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
  color?: string;
};

export type MapRoute = {
  id: string;
  from: [number, number];
  to: [number, number];
  weight: number;
  path?: [number, number][];
  color?: string;
};

type Leaflet = typeof import("leaflet");
type Polyline = import("leaflet").Polyline;
type CircleMarker = import("leaflet").CircleMarker;
type Circle = import("leaflet").Circle;

function arc(a: [number, number], b: [number, number], steps = 10): [number, number][] {
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

function thin(path: [number, number][], max = 80): [number, number][] {
  if (path.length <= max) return path;
  const step = Math.ceil(path.length / max);
  const out = path.filter((_, i) => i % step === 0);
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function routePts(route: MapRoute): [number, number][] {
  return thin(route.path && route.path.length >= 2 ? route.path : arc(route.from, route.to), 80);
}

function overlayKey(
  markers: MapMarker[],
  routes: MapRoute[],
  selectedId: string | null | undefined,
  selectedIds: string[] | undefined,
  dropping: boolean,
) {
  const sel = `${selectedId ?? ""}:${(selectedIds ?? []).join(",")}`;
  const m = markers
    .map((x) => `${x.id}:${x.lat.toFixed(3)},${x.lng.toFixed(3)}:${x.badge ?? ""}:${x.kind}:${x.color ?? ""}`)
    .join("|");
  const r = routes
    .map((x) => {
      const a = x.path?.[0] ?? x.from;
      const b = x.path?.at(-1) ?? x.to;
      return `${x.id}:${x.path?.length ?? 0}:${a[0].toFixed(3)}>${b[0].toFixed(3)}:${x.color ?? ""}`;
    })
    .join("|");
  return `${sel}#${m}#${r}#${dropping ? 1 : 0}`;
}

function pinColor(kind: MapMarker["kind"], badge?: string, color?: string) {
  if (color) return color;
  if (badge === "!") return "#ff5c5c";
  if (badge === "+") return "#1ecf8a";
  if (kind === "home") return "#c8cdd4";
  if (kind === "charger") return "#e6b84d";
  return "#6ea8ff";
}

function prune<T extends { remove: () => void }>(store: Map<string, T>, keep: Set<string>) {
  for (const [id, layer] of store) {
    if (keep.has(id)) continue;
    layer.remove();
    store.delete(id);
  }
}

function BayMapImpl({
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
  const LRef = useRef<Leaflet | null>(null);
  const canvasRef = useRef<import("leaflet").Renderer | null>(null);
  const routesRef = useRef(new Map<string, Polyline>());
  const dotsRef = useRef(new Map<string, CircleMarker>());
  const ringsRef = useRef(new Map<string, Circle>());
  const onSelectRef = useRef(onSelect);
  const onDropRef = useRef(onDrop);
  const fitKeyRef = useRef("");
  const drawKeyRef = useRef("");
  const [ready, setReady] = useState(false);
  onSelectRef.current = onSelect;
  onDropRef.current = onDrop;

  useEffect(() => {
    if (hidden) return;
    const el = hostRef.current;
    if (!el) return;
    let cancelled = false;

    const start = window.setTimeout(() => {
      void (async () => {
        const leaflet = await import("leaflet");
        if (cancelled || !hostRef.current) return;
        const mod = leaflet as unknown as { default?: Leaflet } & Leaflet;
        const L = (mod.default ?? mod) as Leaflet;
        LRef.current = L;
        const canvas = L.canvas({ padding: 0.12, tolerance: 12 });
        canvasRef.current = canvas;
        const map = L.map(hostRef.current, {
          zoomControl: false,
          attributionControl: true,
          scrollWheelZoom: false,
          dragging: false,
          doubleClickZoom: false,
          boxZoom: false,
          keyboard: false,
          touchZoom: false,
          fadeAnimation: false,
          zoomAnimation: false,
          markerZoomAnimation: false,
          inertia: false,
          preferCanvas: true,
          renderer: canvas,
        });
        L.control.zoom({ position: "bottomright" }).addTo(map);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          updateWhenIdle: true,
          updateWhenZooming: false,
          keepBuffer: 0,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">OpenStreetMap</a>',
        }).addTo(map);
        map.attributionControl?.setPosition("bottomleft");
        map.setView([37.45, -122.15], 10);
        mapRef.current = map;
        if (!cancelled) setReady(true);
      })();
    }, 48);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
      setReady(false);
      routesRef.current.forEach((l) => l.remove());
      dotsRef.current.forEach((l) => l.remove());
      ringsRef.current.forEach((l) => l.remove());
      routesRef.current.clear();
      dotsRef.current.clear();
      ringsRef.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
      LRef.current = null;
      canvasRef.current = null;
      drawKeyRef.current = "";
      fitKeyRef.current = "";
    };
  }, [hidden]);

  useEffect(() => {
    if (!ready || hidden) return;
    const map = mapRef.current;
    const L = LRef.current;
    const canvas = canvasRef.current;
    if (!map || !L || !canvas) return;
    const key = overlayKey(markers, routes, selectedId, selectedIds, dropping);
    if (key === drawKeyRef.current) return;

    const timer = window.setTimeout(() => {
      if (mapRef.current !== map) return;
      drawKeyRef.current = key;
      const selectedSet = new Set(
        [selectedId, ...(selectedIds ?? [])].filter((id): id is string => !!id),
      );
      const selectedRoutes = routes.filter((r) => selectedSet.has(r.id));
      const pins = markers.length > 40
        ? markers.filter((m) => m.kind !== "charger").concat(markers.filter((m) => m.kind === "charger").slice(0, 24))
        : markers;

      const keepRoutes = new Set<string>();
      for (const route of routes) {
        keepRoutes.add(route.id);
        const selected = selectedSet.has(route.id);
        const pts = routePts(route);
        const style = {
          color: route.color || "#1ecf8a",
          opacity: selected ? 1 : selectedSet.size ? 0.42 : 0.85,
          weight: selected ? 4 : 2.2,
        };
        let line = routesRef.current.get(route.id);
        if (!line) {
          line = L.polyline(pts, {
            ...style,
            lineCap: "round",
            lineJoin: "round",
            interactive: false,
            bubblingMouseEvents: true,
            smoothFactor: 1.8,
            renderer: canvas,
          });
          line.addTo(map);
          routesRef.current.set(route.id, line);
        } else {
          line.setLatLngs(pts);
          line.setStyle(style);
        }
      }
      prune(routesRef.current, keepRoutes);

      const keepDots = new Set<string>();
      const keepRings = new Set<string>();
      for (const marker of pins) {
        keepDots.add(marker.id);
        const selected = selectedSet.has(marker.id);
        const color = pinColor(marker.kind, marker.badge, marker.color);
        let dot = dotsRef.current.get(marker.id);
        if (!dot) {
          dot = L.circleMarker([marker.lat, marker.lng], {
            radius: selected ? 8 : 6,
            color,
            weight: selected ? 2 : 1,
            opacity: 1,
            fillColor: color,
            fillOpacity: selected ? 1 : 0.88,
            renderer: canvas,
            interactive: false,
            bubblingMouseEvents: true,
          });
          dot.addTo(map);
          dotsRef.current.set(marker.id, dot);
        } else {
          dot.setLatLng([marker.lat, marker.lng]);
          dot.setStyle({
            radius: selected ? 8 : 6,
            color,
            weight: selected ? 2 : 1,
            fillColor: color,
            fillOpacity: selected ? 1 : 0.88,
          });
        }

        const showRing = Boolean(marker.radiusM && marker.radiusM > 0 && (selected || dropping));
        if (showRing && marker.radiusM) {
          keepRings.add(marker.id);
          let ring = ringsRef.current.get(marker.id);
          if (!ring) {
            ring = L.circle([marker.lat, marker.lng], {
              radius: marker.radiusM,
              color: "#1ecf8a",
              weight: selected ? 1.4 : 1,
              opacity: selected ? 0.8 : 0.25,
              fillColor: "#1ecf8a",
              fillOpacity: selected ? 0.14 : 0.04,
              interactive: false,
              renderer: canvas,
            });
            ring.addTo(map);
            ringsRef.current.set(marker.id, ring);
          } else {
            ring.setLatLng([marker.lat, marker.lng]);
            ring.setRadius(marker.radiusM);
            ring.setStyle({
              weight: selected ? 1.4 : 1,
              opacity: selected ? 0.8 : 0.25,
              fillOpacity: selected ? 0.14 : 0.04,
            });
          }
        }
      }
      prune(dotsRef.current, keepDots);
      prune(ringsRef.current, keepRings);

      const focusKey = `${routes.map((r) => `${r.id}:${r.path?.length ?? 0}`).join(",")}:${pins.map((m) => m.id).join(",")}`;
      const fitPts: [number, number][] = [
        ...routes.flatMap((r) => {
          const raw = r.path && r.path.length >= 2 ? r.path : [r.from, r.to];
          return [raw[0], raw[Math.floor(raw.length / 2)], raw[raw.length - 1]] as [number, number][];
        }),
        ...pins.map((m) => [m.lat, m.lng] as [number, number]),
      ];
      if (fitPts.length >= 2 && fitKeyRef.current !== focusKey) {
        fitKeyRef.current = focusKey;
        map.fitBounds(L.latLngBounds(fitPts), {
          padding: [28, 28],
          maxZoom: 7,
          animate: false,
        });
      } else if (fitPts.length === 1 && fitKeyRef.current !== focusKey) {
        fitKeyRef.current = focusKey;
        map.setView(fitPts[0], 12, { animate: false });
      }
    });

    return () => window.clearTimeout(timer);
  }, [ready, hidden, markers, routes, selectedId, selectedIds, dropping]);

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
      {!ready ? (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted">
          Map
        </p>
      ) : null}
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

export const BayMap = memo(BayMapImpl);
