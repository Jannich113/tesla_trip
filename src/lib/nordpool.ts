/**
 * Public Nord Pool day-ahead prices (the JSON behind data.nordpoolgroup.com).
 * Not the paid Market Data API. Areas verified live: DK1, DK2, NO1–NO5,
 * SE1–SE4, FI, NL, and GER. Delivery codes DE and DE-LU return HTTP 204.
 * https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices
 */
import { countryOf, type PriceArea, type PriceCountry } from "./price-areas.ts";

export const NORDPOOL_SOURCE = "Nord Pool" as const;

export const NORDPOOL_DAY_AHEAD_URL = "https://dataportal-api.nordpoolgroup.com/api/DayAheadPrices";

export type NordPoolEntry = {
  deliveryStart?: string;
  entryPerArea?: Record<string, number | null>;
};

export type NordPoolDay = {
  currency?: string;
  exchangeRate?: number;
  updatedAt?: string;
  multiAreaEntries?: NordPoolEntry[];
};

export type QuarterPrice = {
  timeDk: string;
  dkkPerMwh: number;
};

export type SpotHour = {
  hour: string;
  timeDk: string;
  krPerKwh: number;
  orePerKwh: number;
};

export type SpotDay = {
  area: PriceArea;
  country: PriceCountry;
  source: typeof NORDPOOL_SOURCE;
  updatedAt: string;
  current: SpotHour | null;
  today: SpotHour[];
  tomorrow: SpotHour[];
};

/** Nordic zones publish in DKK. NL and GER 204 unless the currency is EUR. */
export function nordPoolCurrency(area: PriceArea): "DKK" | "EUR" {
  const country = countryOf(area);
  return country === "DE" || country === "NL" ? "EUR" : "DKK";
}

export function nordPoolDayUrl(area: PriceArea, date: string, currency: "DKK" | "EUR") {
  const url = new URL(NORDPOOL_DAY_AHEAD_URL);
  url.searchParams.set("date", date);
  url.searchParams.set("market", "DayAhead");
  url.searchParams.set("deliveryArea", area);
  url.searchParams.set("currency", currency);
  return url.toString();
}

/** EUR→DKK printed on a DKK day-ahead response. Rejects the EUR body's rate of 1. */
export function dkkPerEurFromNordPool(body: NordPoolDay): number | null {
  if (body.currency !== "DKK") return null;
  const fx = body.exchangeRate;
  if (typeof fx !== "number" || !Number.isFinite(fx) || fx < 6 || fx > 9) return null;
  return fx;
}

export function copenhagenStamp(isoUtc: string): string | null {
  const dt = new Date(isoUtc);
  if (Number.isNaN(dt.getTime())) return null;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(dt).map((p) => [p.type, p.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}:${parts.second}`;
}

export function copenhagenDate(offsetDays = 0, now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const [y, m, d] = [parts.year, parts.month, parts.day].map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  const next = Object.fromEntries(fmt.formatToParts(dt).map((p) => [p.type, p.value]));
  return `${next.year}-${next.month}-${next.day}`;
}

export function copenhagenHour(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    hour12: false,
  });
  const raw = fmt.formatToParts(now).find((p) => p.type === "hour")?.value ?? "00";
  return (raw === "24" ? "00" : raw).padStart(2, "0");
}

/**
 * Turn one delivery day into DKK/MWh quarters. `dkkPerEur` is used only when
 * the body is in EUR (NL, GER). Nordic DKK bodies ignore it.
 */
export function quartersFromDay(body: NordPoolDay, area: PriceArea, dkkPerEur = 1): QuarterPrice[] {
  const factor = body.currency === "EUR" ? dkkPerEur : 1;
  const out: QuarterPrice[] = [];
  for (const entry of body.multiAreaEntries ?? []) {
    const raw = entry.entryPerArea?.[area];
    if (typeof raw !== "number" || !Number.isFinite(raw) || !entry.deliveryStart) continue;
    const timeDk = copenhagenStamp(entry.deliveryStart);
    if (!timeDk) continue;
    out.push({ timeDk, dkkPerMwh: raw * factor });
  }
  return out;
}

/** Average 15-minute DKK/MWh slots into kr/kWh hours, same unit as the old EDS feed. */
export function hoursFromQuarters(quarters: QuarterPrice[]): SpotHour[] {
  type Bucket = { timeDk: string; hour: string; sum: number; count: number };
  const buckets = new Map<string, Bucket>();
  for (const quarter of quarters) {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2})/.exec(quarter.timeDk);
    if (!match || !Number.isFinite(quarter.dkkPerMwh)) continue;
    const key = `${match[1]}T${match[2]}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.sum += quarter.dkkPerMwh;
      existing.count += 1;
    } else {
      buckets.set(key, {
        timeDk: `${match[1]}T${match[2]}:00:00`,
        hour: match[2],
        sum: quarter.dkkPerMwh,
        count: 1,
      });
    }
  }
  return [...buckets.values()]
    .sort((a, b) => a.timeDk.localeCompare(b.timeDk))
    .map((bucket) => {
      const krPerKwh = bucket.sum / bucket.count / 1000;
      return {
        hour: bucket.hour,
        timeDk: bucket.timeDk,
        krPerKwh,
        orePerKwh: krPerKwh * 100,
      };
    });
}

export function buildSpotDay(
  area: PriceArea,
  today: QuarterPrice[],
  tomorrow: QuarterPrice[],
  now = new Date(),
): SpotDay {
  const hours = hoursFromQuarters([...today, ...tomorrow]);
  const todayDate = copenhagenDate(0, now);
  const tomorrowDate = copenhagenDate(1, now);
  const hour = copenhagenHour(now);
  const todayHours = hours.filter((h) => h.timeDk.startsWith(todayDate));
  const tomorrowHours = hours.filter((h) => h.timeDk.startsWith(tomorrowDate));
  const current = todayHours.find((h) => h.hour === hour) ?? null;
  return {
    area,
    country: countryOf(area),
    source: NORDPOOL_SOURCE,
    updatedAt: now.toISOString(),
    current,
    today: todayHours,
    tomorrow: tomorrowHours,
  };
}
