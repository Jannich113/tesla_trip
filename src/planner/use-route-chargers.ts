import { useEffect, useMemo, useState } from "react";
import { type ChargeLocation } from "@/lib/charge-locations";
import { type RouteCharger } from "@/routes/api/chargers";
import { type RoutedLeg } from "./engine";
import { seedsAlongPath } from "./seed-chargers";
import { withRetry, fetchWithTimeout } from "./retry";
import { cacheGet, cacheSet, CHARGER_TTL_MS } from "./cache";

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

export function useRouteChargers(routes: RoutedLeg[], radiusKm?: number) {
  const paths = useMemo(() => {
    const out: [number, number][][] = [];
    const seen = new Set<string>();
    for (const r of routes) {
      if (r.path.length < 2) continue;
      const k = `${r.path[0][0].toFixed(3)},${r.path[0][1].toFixed(3)}-${r.path.at(-1)![0].toFixed(3)},${r.path.at(-1)![1].toFixed(3)}-${r.miles.toFixed(0)}-${r.source}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(downsample(r.path, 60));
    }
    return out.slice(0, 8);
  }, [routes]);

  const key = useMemo(() => {
    if (!paths.length) return "";
    return paths
      .map((p) => `${p[0][0].toFixed(3)},${p[0][1].toFixed(3)}>${p.at(-1)![0].toFixed(3)},${p.at(-1)![1].toFixed(3)}:${p.length}`)
      .join("|") + `:${radiusKm ?? 0}`;
  }, [paths, radiusKm]);

  const local = useMemo(() => {
    const km = Math.max(12, radiusKm ?? 0);
    const byId = new Map<string, ChargeLocation>();
    for (const path of paths) {
      for (const c of seedsAlongPath(path, km * 1000)) byId.set(c.id, asLocation(c));
    }
    return [...byId.values()];
  }, [paths, radiusKm]);
  const cached = key ? cacheGet<ChargeLocation[]>("chargers", key, { stale: true }) : undefined;
  const [live, setLive] = useState<ChargeLocation[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached && Boolean(key));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setLive([]);
      setLoading(false);
      return;
    }
    const hit = cacheGet<ChargeLocation[]>("chargers", key, { stale: true });
    if (hit?.length) {
      setLive(hit);
      setLoading(false);
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!hit?.length) setLoading(true);
      void withRetry(async () => {
        const res = await fetchWithTimeout("/api/chargers", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ paths, radiusKm }),
        }, 8000);
        const body = (await res.json()) as { chargers?: RouteCharger[]; error?: string };
        if (!res.ok) throw new Error(body.error || `Chargers ${res.status}`);
        return { rows: (body.chargers ?? []).map(asLocation), warning: body.error };
      })
        .then((result) => {
          if (cancelled) return;
          setLive(result.rows);
          setError(null);
          cacheSet("chargers", key, result.rows, CHARGER_TTL_MS);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Charger search failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, hit?.length ? 0 : 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, radiusKm]);

  const chargers = live.length ? live : local;
  return { chargers, loading, error, localCount: local.length };
}