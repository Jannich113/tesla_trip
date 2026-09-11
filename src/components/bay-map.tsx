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

function arc(a: [number, number], b: [number, number], steps = 12): [number, number][] {
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

function overlayKey(
  markers: MapMarker[],
  routes: MapRoute[],
  selectedId: string | null | undefined,
  selectedIds: string[] | undefined,
  dropping: boolean,
) {
  const sel = `${selectedId ?? ""}:${(selectedIds ?? []).join(",")}`;
  const m = markers
    .map((x) => `${x.id}:${x.lat.toFixed(3)},${x.lng.toFixed(3)}:${x.badge ?? ""}:${x.kind}`)
    .join("|");
  const r = routes
    .map((x) => {
      const a = x.path?.[0] ?? x.from;
      const b = x.path?.at(-1) ?? x.to;
      return `${x.id}:${x.path?.length ?? 0}:${a[0].toFixed(3)},${a[1].toFixed(3)}>${b[0].toFixed(3)},${b[1].toFixed(3)}:${x.color ?? ""}`;
    })
    .join("|");
  return `${sel}#${m}#${r}#${dropping ? 1 : 0}`;
}

function pinColor(kind: MapMarker["kind"], badge?: string) {
  if (badge === "!") return "#ff5c5c";
  if (badge === "+") return "#1ecf8a";
  if (kind === "home") return "#c8cdd4";
  if (kind === "charger") return "#e6b84d";
  return "#6ea8ff";
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
  const LRef = useRef<typeof import("leaflet") | null>(null);
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
        const mod = leaflet as unknown as { default?: typeof leaflet } & typeof leaflet;
        const L = (mod.default ?? mod) as typeof leaflet;
        LRef.current = L;
        const map = L.map(hostRef.current, {
          zoomControl: false,
          attributionControl: true,
          scrollWheelZoom: false,
          fadeAnimation: false,
          zoomAnimation: false,
          markerZoomAnimation: false,
          renderer: L.canvas({ padding: 0.4 }),
        });
        L.control.zoom({ position: "bottomright" }).addTo(map);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          updateWhenIdle: true,
          keepBuffer: 1,
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
    }, 48);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
      setReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
      groupRef.current = null;
      LRef.current = null;
      drawKeyRef.current = "";
      fitKeyRef.current = "";
    };
  }, [hidden]);

  useEffect(() => {
    if (!ready || hidden) return;
    const map = mapRef.current;
    const group = groupRef.current;
    const leaflet = LRef.current;
    if (!map || !group || !leaflet) return;
    const key = overlayKey(markers, routes, selectedId, selectedIds, dropping);
    if (key === drawKeyRef.current) return;

    const raf = window.requestAnimationFrame(() => {
      if (mapRef.current !== map) return;
      drawKeyRef.current = key;
      const L = leaflet;
      group.clearLayers();
      const bounds: [number, number][] = [];
      const selectedSet = new Set(
        [selectedId, ...(selectedIds ?? [])].filter((id): id is string => !!id),
      );
      const selectedRoutes = routes.filter((r) => selectedSet.has(r.id));

      for (const route of routes) {
        const selected = selectedSet.has(route.id);
        const pts = thin(route.path && route.path.length >= 2 ? route.path : arc(route.from, route.to), 72);
        pts.forEach((p) => bounds.push(p));
        L.polyline(pts, {
          color: route.color || "#1ecf8a",
          opacity: selected ? 1 : selectedSet.size ? 0.45 : 0.85,
          weight: selected ? 4 : 2.4,
          lineCap: "round",
          lineJoin: "round",
          interactive: true,
          renderer: map.options.renderer,
        })
          .on("click", (e: { target?: unknown }) => {
            L.DomEvent.stopPropagation(e as import("leaflet").LeafletMouseEvent);
            onSelectRef.current?.(route.id);
          })
          .addTo(group);
      }

      const pins = markers.length > 16 ? markers.filter((m) => m.kind !== "charger").concat(markers.filter((m) => m.kind === "charger").slice(0, 10)) : markers;
      for (const marker of pins) {
        bounds.push([marker.lat, marker.lng]);
        const selected = selectedSet.has(marker.id);
        if (marker.radiusM && marker.radiusM > 0 && (selected || dropping)) {
          L.circle([marker.lat, marker.lng], {
            radius: marker.radiusM,
            color: "#1ecf8a",
            weight: selected ? 1.4 : 1,
            opacity: selected ? 0.8 : 0.25,
            fillColor: "#1ecf8a",
            fillOpacity: selected ? 0.14 : 0.04,
            interactive: false,
            renderer: map.options.renderer,
          }).addTo(group);
        }
        const color = pinColor(marker.kind, marker.badge);
        const dot = L.circleMarker([marker.lat, marker.lng], {
          radius: selected ? 8 : 6,
          color,
          weight: selected ? 2 : 1,
          opacity: 1,
          fillColor: color,
          fillOpacity: selected ? 1 : 0.85,
          renderer: map.options.renderer,
        }).addTo(group);
        dot.on("click", (e: { target?: unknown }) => {
          L.DomEvent.stopPropagation(e as import("leaflet").LeafletMouseEvent);
          onSelectRef.current?.(marker.id);
        });
        if (selected || marker.kind !== "charger") {
          dot.bindTooltip(escapeHtml(marker.label), {
            permanent: marker.kind !== "charger",
            direction: "right",
            offset: [8, 0],
            opacity: 0.92,
            className: "map-pin-tip",
          });
          if (marker.kind !== "charger") dot.openTooltip();
        }
      }

      const focusKey = `${routes.map((r) => r.id).join(",")}:${selectedRoutes.map((r) => r.id).join(",")}`;
      const fitPts =
        selectedRoutes.length > 0
          ? selectedRoutes.flatMap((r) => {
              const raw = r.path && r.path.length >= 2 ? r.path : [r.from, r.to];
              return [raw[0], raw[Math.floor(raw.length / 2)], raw[raw.length - 1]];
            })
          : bounds;
      if (fitPts.length >= 2 && fitKeyRef.current !== focusKey) {
        fitKeyRef.current = focusKey;
        map.fitBounds(L.latLngBounds(fitPts), {
          padding: [36, 36],
          maxZoom: selectedRoutes.length === 1 ? 12 : 8,
          animate: false,
        });
      } else if (fitPts.length === 1 && fitKeyRef.current !== focusKey) {
        fitKeyRef.current = focusKey;
        map.setView(fitPts[0], 12, { animate: false });
      }
    });

    return () => window.cancelAnimationFrame(raf);
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
