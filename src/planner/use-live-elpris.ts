import { useCallback, useEffect, useState } from "react";
import { type PriceArea } from "@/lib/el-providers";
import { type ElprisData, fetchElpris } from "@/lib/elpris";

const POLL_MS = 60_000;

export function useLiveElpris(area: PriceArea) {
  const [data, setData] = useState<ElprisData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      try {
        const next = await fetchElpris(area);
        setData(next);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kunne ikke hente elpris");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [area],
  );

  useEffect(() => {
    void load(false);
    const id = window.setInterval(() => void load(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  return { data, error, loading, refreshing, refresh: () => load(true) };
}
