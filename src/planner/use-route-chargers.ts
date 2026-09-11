import { useEffect, useMemo, useState } from "react";
import { type ChargeLocation } from "@/lib/charge-locations";
import { type RouteCharger } from "@/routes/api/chargers";
import { type RoutedLeg } from "./engine";

export function useRouteChargers(routes: RoutedLeg[]) {
  const path = useMemo(() => {
    const out: [number, number][] = [];
    for (const r of routes) {
      for (const pt of r.path) out.push(pt);
    }
    return out;
  }, [routes]);

  const key = useMemo(() => {
    if (path.length < 2) return "";
    const a = path[0];
    const b = path[path.length - 1];
    const n = path.length;
    return `${a[0].toFixed(3)},${a[1].toFixed(3)}-${b[0].toFixed(3)},${b[1].toFixed(3)}-${n}`;
  }, [path]);

  const [chargers, setChargers] = useState<ChargeLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!key) {
      setChargers([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void fetch("/api/chargers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ path, radiusKm: 22 }),
      })
        .then(async (res) => {
          const body = (await res.json()) as { chargers?: RouteCharger[]; error?: string };
          if (cancelled) return;
          if (!res.ok) throw new Error(body.error || `Chargers ${res.status}`);
          setChargers(
            (body.chargers ?? []).map((c) => ({
              id: c.id,
              name: c.name,
              short: c.short,
              lat: c.lat,
              lng: c.lng,
              kind: c.kind,
              usdPerKwh: c.usdPerKwh,
              preset: false,
              radiusM: c.radiusM,
              networkId: c.networkId,
            })),
          );
          setError(null);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Charger search failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [key, path]);

  return { chargers, loading, error };
}