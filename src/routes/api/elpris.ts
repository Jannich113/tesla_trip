import { createFileRoute } from "@tanstack/react-router";
import { noStore, publicCache } from "@/lib/http-cache";
import {
  buildSpotDay,
  copenhagenDate,
  dkkPerEurFromNordPool,
  nordPoolCurrency,
  nordPoolDayUrl,
  quartersFromDay,
  type NordPoolDay,
  type QuarterPrice,
} from "@/lib/nordpool";
import { isPriceArea, type PriceArea } from "@/lib/price-areas";

const NORDPOOL_HEADERS = {
  Accept: "application/json",
  "User-Agent": "tesla_trip",
};

function parseArea(raw: string | null): PriceArea {
  return isPriceArea(raw) ? raw : "DK1";
}

async function fetchDay(
  area: PriceArea,
  date: string,
  currency: "DKK" | "EUR",
): Promise<NordPoolDay> {
  const res = await fetch(nordPoolDayUrl(area, date, currency), { headers: NORDPOOL_HEADERS });
  if (res.status === 204) return { currency, multiAreaEntries: [] };
  if (!res.ok) throw new Error(`Nord Pool returned ${res.status}`);
  return (await res.json()) as NordPoolDay;
}

async function eurToDkk(today: string): Promise<number | null> {
  try {
    const fx = dkkPerEurFromNordPool(await fetchDay("DK1", today, "DKK"));
    if (fx) return fx;
  } catch {
    /* Frankfurter below */
  }
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=EUR&to=DKK", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { rates?: { DKK?: number } };
    const rate = body.rates?.DKK;
    return typeof rate === "number" && rate > 6 && rate < 9 ? rate : null;
  } catch {
    return null;
  }
}

async function dayQuarters(
  area: PriceArea,
  date: string,
  dkkPerEur: number,
): Promise<QuarterPrice[]> {
  const currency = nordPoolCurrency(area);
  const body = await fetchDay(area, date, currency);
  if (currency === "EUR" && !(dkkPerEur > 1)) {
    throw new Error("Missing EUR to DKK rate");
  }
  return quartersFromDay(body, area, dkkPerEur);
}

export const Route = createFileRoute("/api/elpris")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const area = parseArea(url.searchParams.get("area"));
          const today = copenhagenDate(0);
          const tomorrow = copenhagenDate(1);
          const dkkPerEur = nordPoolCurrency(area) === "EUR" ? await eurToDkk(today) : 1;
          if (dkkPerEur == null) {
            return Response.json(
              { error: "Nord Pool EUR prices need a DKK exchange rate" },
              { status: 502, headers: noStore },
            );
          }
          const [todayQ, tomorrowQ] = await Promise.all([
            dayQuarters(area, today, dkkPerEur),
            dayQuarters(area, tomorrow, dkkPerEur).catch(() => [] as QuarterPrice[]),
          ]);
          const payload = buildSpotDay(area, todayQ, tomorrowQ);
          if (payload.today.length === 0 && payload.tomorrow.length === 0) {
            return Response.json(
              { error: `Nord Pool returned no day-ahead prices for ${area}` },
              { status: 502, headers: noStore },
            );
          }
          return Response.json(payload, { headers: publicCache(120, 600) });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to fetch prices";
          return Response.json({ error: message }, { status: 502, headers: noStore });
        }
      },
    },
  },
});
