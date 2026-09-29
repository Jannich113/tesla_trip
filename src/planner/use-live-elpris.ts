import { useCallback, useEffect, useState } from "react";
import { cacheGet, cacheSet, elprisTtlMs } from "./cache";
import { type PriceArea } from "@/lib/el-providers";
import { type ElprisData, fetchElpris } from "@/lib/elpris";
import { areaForPlanner } from "@/lib/price-areas";
import { usePlanStore } from "./store";

const POLL_MS = 60_000;

export function useLiveElpris(area: PriceArea) {
  const stops = usePlanStore((s) => s.stops);
  // Selected zone only when the route is in that country. See areaForPlanner.
  const resolved = areaForPlanner(area, stops);
  const cached = cacheGet<ElprisData>("elpris", resolved, { stale: true });
  const [data, setData] = useState<ElprisData | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cached);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      const hit = cacheGet<ElprisData>("elpris", resolved, { stale: true });
      if (hit && !isRefresh) {
        setData(hit);
        setLoading(false);
      }
      if (isRefresh || !hit) {
        if (isRefresh) setRefreshing(true);
        else if (!hit) setLoading(true);
      }
      try {
        const next = await fetchElpris(resolved);
        setData(next);
        setError(null);
        cacheSet("elpris", resolved, next, elprisTtlMs(), 6);
      } catch (err) {
        if (!hit) setError(err instanceof Error ? err.message : "Kunne ikke hente elpris");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [resolved],
  );

  useEffect(() => {
    void load(false);
    const id = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  return { data, error, loading, refreshing, refresh: () => load(true) };
}
