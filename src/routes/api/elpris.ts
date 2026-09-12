import { createFileRoute } from "@tanstack/react-router";
import { noStore, publicCache } from "@/lib/http-cache";

type EdsRecord = {
  TimeDK: string;
  DayAheadPriceDKK: number | null;
  PriceArea?: string;
};

export type HourPrice = {
  hour: string;
  timeDk: string;
  krPerKwh: number;
  orePerKwh: number;
};

export type PriceArea = "DK1" | "DK2";

export type ElprisResponse = {
  area: PriceArea;
  source: "Energi Data Service";
  updatedAt: string;
  current: HourPrice | null;
  today: HourPrice[];
  tomorrow: HourPrice[];
};

function edsUrl(area: PriceArea) {
  return (
    "https://api.energidataservice.dk/dataset/DayAheadPrices" +
    "?start=StartOfDay&end=StartOfDay%2BP2D" +
    `&filter={"PriceArea":["${area}"]}&sort=TimeDK&limit=200`
  );
}

function parseArea(raw: string | null): PriceArea {
  return raw === "DK2" ? "DK2" : "DK1";
}

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}

/** Calendar date + hour in Europe/Copenhagen from a TimeDK string like 2026-09-11T14:15:00 */
function parseTimeDk(timeDk: string) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(timeDk);
  if (!m) return null;
  return { date: m[1], hour: m[2], minute: Number(m[3]) };
}

function dkNowParts(now = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hourRaw = parts.hour === "24" ? "00" : parts.hour;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: pad2(Number(hourRaw)),
  };
}

function nextDkDate(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  // Noon UTC avoids DST edge cases when stepping calendar days in DK
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(dt).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toHourPrices(records: EdsRecord[]): HourPrice[] {
  type Bucket = { timeDk: string; hour: string; sum: number; count: number };
  const buckets = new Map<string, Bucket>();

  for (const rec of records) {
    if (rec.DayAheadPriceDKK == null || !Number.isFinite(rec.DayAheadPriceDKK)) continue;
    const parsed = parseTimeDk(rec.TimeDK);
    if (!parsed) continue;
    const key = `${parsed.date}T${parsed.hour}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.sum += rec.DayAheadPriceDKK;
      existing.count += 1;
    } else {
      buckets.set(key, {
        timeDk: `${parsed.date}T${parsed.hour}:00:00`,
        hour: parsed.hour,
        sum: rec.DayAheadPriceDKK,
        count: 1,
      });
    }
  }

  return [...buckets.values()]
    .sort((a, b) => a.timeDk.localeCompare(b.timeDk))
    .map((b) => {
      const krPerKwh = b.sum / b.count / 1000;
      return {
        hour: b.hour,
        timeDk: b.timeDk,
        krPerKwh,
        orePerKwh: krPerKwh * 100,
      };
    });
}

function buildPayload(records: EdsRecord[], area: PriceArea): ElprisResponse {
  const hours = toHourPrices(records);
  const { date: todayDate, hour: currentHour } = dkNowParts();
  const tomorrowDate = nextDkDate(todayDate);

  const today = hours.filter((h) => h.timeDk.startsWith(todayDate));
  const tomorrow = hours.filter((h) => h.timeDk.startsWith(tomorrowDate));
  const current =
    today.find((h) => h.hour === currentHour) ??
    hours.find((h) => h.timeDk.startsWith(`${todayDate}T${currentHour}`)) ??
    null;

  return {
    area,
    source: "Energi Data Service",
    updatedAt: new Date().toISOString(),
    current,
    today,
    tomorrow,
  };
}

export const Route = createFileRoute("/api/elpris")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const area = parseArea(url.searchParams.get("area"));
          const res = await fetch(edsUrl(area), {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) {
            return Response.json(
              { error: `Energi Data Service returned ${res.status}` },
              { status: 502, headers: noStore },
            );
          }
          const body = (await res.json()) as { records?: EdsRecord[] };
          const records = Array.isArray(body.records) ? body.records : [];
          return Response.json(buildPayload(records, area), {
            headers: publicCache(120, 600),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to fetch prices";
          return Response.json({ error: message }, { status: 502, headers: noStore });
        }
      },
    },
  },
});
