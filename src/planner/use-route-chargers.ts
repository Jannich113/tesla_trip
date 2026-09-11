import { useEffect, useMemo, useState } from "react";
import { type ChargeLocation } from "@/lib/charge-locations";
import { type RouteCharger } from "@/routes/api/chargers";
import { type RoutedLeg } from "./engine";
import { seedsAlongPath } from "./seed-chargers";
import { polylineBufferKm } from "./polyline";

function downsample(path: [number, number][], max = 80) {
  if (path.length <= max) return path;
  const step = Math.ceil(path.length / max);
  const out = path.filter((_, i) => i % step === 0);
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function asLocation(c: RouteCharger | ChargeLocation): ChargeLocation {
  return {
    id: c.id,
    name: c.name,
    short: c.short,
    lat: c.lat,
    lng: c.lng,
    kind: c.kind === "supercharger" ? "supercharger" : c.kind === "home" ? "home" : "custom",
    usdPerKwh: c.usdPerKwh,
    preset: false,
    radiusM: "radiusM" in c && c.radiusM ? c.radiusM : 250,
    networkId: "networkId" in c ? c.networkId : null,
  };
}

export function useRouteChargers(routes: RoutedLeg[]) {
  const path = useMemo(() => {
    const out: [number, number][] = [];
    for (const r of routes) {
      for (const pt of r.path) out.push(pt);
    }
    return downsample(out);
  }, [routes]);

  const key = useMemo(() => {
    if (path.length < 2) return "";
    const a = path[0];
    const b = path[path.length - 1];
    return `${a[0].toFixed(3)},${a[1].toFixed(3)}-${b[0].toFixed(3)},${b[1].toFixed(3)}-${path.length}`;
  }, [path]);

  const local = useMemo(() => {
    if (path.length < 2) return [];
    return seedsAlongPath(path, polylineBufferKm(path).wide * 1000).map(asLocation);
  }, [path]);
  const [live, setLive] = useState<ChargeLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setLive([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch("/api/chargers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ path }),
      })
        .then(async (res) => {
          const body = (await res.json()) as { chargers?: RouteCharger[]; error?: string };
          if (cancelled) return;
          const rows = (body.chargers ?? []).map(asLocation);
          setLive(rows);
          setError(res.ok ? null : body.error || `Chargers ${res.status}`);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Charger search failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, path]);

  const chargers = live.length ? live : local;
  return { chargers, loading, error, localCount: local.length };
}