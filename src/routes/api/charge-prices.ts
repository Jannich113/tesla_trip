import { createFileRoute } from "@tanstack/react-router";
import { type ChargePricesResponse } from "@/planner/charge-prices";
import { COUNTRY_PROFILES } from "@/planner/country-profiles";
import { CATALOG_FX, NETWORK_NATIVE, toDkk, type FxTable } from "@/planner/charge-fx";
import { EU_NETWORKS, type ChargeNetwork } from "@/planner/networks";

const TTL_MS = 6 * 60 * 60 * 1000;

let cache: { at: number; body: ChargePricesResponse } | null = null;

async function frankfurter(from: "EUR" | "NOK"): Promise<number | null> {
  const url = `https://api.frankfurter.app/latest?from=${from}&to=DKK`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const body = (await res.json()) as { rates?: { DKK?: number } };
  const n = body.rates?.DKK;
  return typeof n === "number" && n > 0 ? n : null;
}

async function loadFx(): Promise<{ fx: FxTable; fxSource: string }> {
  try {
    const [eur, nok] = await Promise.all([frankfurter("EUR"), frankfurter("NOK")]);
    if (eur && nok) {
      return { fx: { EUR: eur, DKK: 1, NOK: nok }, fxSource: "Frankfurter ECB" };
    }
  } catch {
    /* catalog fallback */
  }
  return { fx: { ...CATALOG_FX }, fxSource: "catalog fallback" };
}

function convertNetworks(fx: FxTable): ChargeNetwork[] {
  return EU_NETWORKS.map((n) => {
    const native = NETWORK_NATIVE[n.id];
    if (!native) return n;
    return {
      ...n,
      spotKr: toDkk(native.spot, native.ccy, fx),
      aboKr: toDkk(native.abo, native.ccy, fx),
      aboMonthlyKr: toDkk(native.monthly, native.ccy, fx),
      roamKr: native.roam == null ? null : toDkk(native.roam, native.ccy, fx),
      roamAboKr: native.roamAbo == null ? n.roamAboKr : toDkk(native.roamAbo, native.ccy, fx),
    };
  });
}

async function gather(force: boolean): Promise<ChargePricesResponse> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.body;
  const { fx, fxSource } = await loadFx();
  const body: ChargePricesResponse = {
    source: "catalog + live FX",
    updatedAt: new Date().toISOString(),
    ttlSec: TTL_MS / 1000,
    fx,
    fxSource,
    networks: convertNetworks(fx),
    countries: COUNTRY_PROFILES,
  };
  cache = { at: Date.now(), body };
  return body;
}

export const Route = createFileRoute("/api/charge-prices")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const force = new URL(request.url).searchParams.get("refresh") === "1";
          const body = await gather(force);
          return Response.json(body, {
            headers: {
              "Cache-Control": force ? "no-store" : "public, max-age=300",
            },
          });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "charge prices failed" },
            { status: 502 },
          );
        }
      },
    },
  },
});
