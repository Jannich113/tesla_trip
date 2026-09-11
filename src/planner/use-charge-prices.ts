import { useCallback, useEffect, useState } from "react";
import { type ChargePricesResponse } from "./charge-prices";

const POLL_MS = 30 * 60 * 1000;

export async function fetchChargePrices(refresh = false) {
  const res = await fetch(refresh ? "/api/charge-prices?refresh=1" : "/api/charge-prices");
  if (!res.ok) throw new Error(`Charge prices ${res.status}`);
  return (await res.json()) as ChargePricesResponse;
}

export function useChargePrices() {
  const [data, setData] = useState<ChargePricesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const next = await fetchChargePrices(isRefresh);
      setData(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch charge prices");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    const id = window.setInterval(() => void load(false), POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  return { data, error, loading, refreshing, refresh: () => load(true) };
}