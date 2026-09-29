import { type FxTable, CATALOG_FX } from "./charge-fx.ts";

/** Planner clocks are Europe/Copenhagen wall time. Amsterdam shares that offset. */
export const PLANNER_ZONE = "Europe/Copenhagen";
/** Costs sessions store plug-in hour in America/Los_Angeles (see history.ts). */
export const SESSION_ZONE = "America/Los_Angeles";
/** Same peg as the planner's DKK_PER_USD. Used only to show a published EUR rate in the USD Costs tab. */
export const DKK_PER_USD = 6.85;

export const NDW_TARIFF_URL = "https://opendata.ndw.nu/charging_point_tariffs_ocpi.json.gz";
export const NDW_LOCATION_URL = "https://opendata.ndw.nu/charging_point_locations_ocpi.json.gz";

/**
 * What was verified against the public NDW OCPI dump (NL) and what is not a
 * published anonymous hour schedule. Do not invent the missing rates.
 */
export const VARIABLE_RATE_NOTE =
  "Live time-of-day kWh is Tesla Superchargers in the Netherlands from NDW OCPI party US/TSL (one ENERGY schedule per site, vat null, used as published — not split into owner vs non-Tesla, and not grossed up). " +
  "Catalog fallback, no invented numbers: Tesla outside NL (Fleet API not called; tesla.com is not an anonymous feed we could read), " +
  "IONITY (flat ad-hoc ENERGY by power class), Fastned (one flat NL tariff), Allego (flat or seasonal kWh; clock bands are idle TIME/PARKING_TIME), " +
  "Electra (OCPI requires a bilateral token), MER, Recharge, Clever and the other catalog networks. " +
  "NDW rows are CPO tariffs, not an eMSP markup. EFL calendar-dated hourly slices are not a stable network card and are not applied.";

/** Nearest published site within this many metres wins. NL Superchargers are much farther apart. */
export const VARIABLE_MATCH_M = 750;

export type VariableBand = {
  /** "HH:MM" local to the site. null = unrestricted fallback element. */
  start: string | null;
  end: string | null;
  /** JS weekday 0=Sun … 6=Sat. null = every day. */
  days: number[] | null;
  /** Energy price in `ccy` as published (VAT included only when the feed stated a VAT rate). */
  price: number;
  /** Unrestricted ENERGY element. Used only when no restricted band matches. Not added on top. */
  fallback: boolean;
};

export type VariableSite = {
  id: string;
  networkId: "tesla";
  name: string;
  lat: number;
  lng: number;
  ccy: "EUR";
  tz: string;
  bands: VariableBand[];
};

export type VariableFeed = {
  source: string;
  updatedAt: string;
  note: string;
  fx: FxTable;
  sites: VariableSite[];
};

const WEEKDAY_INDEX: Record<string, number> = {
  SUNDAY: 0,
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
};

let active: VariableFeed | null = null;
let revision = 0;

export function activeVariableFeed() {
  return active;
}

export function variableFeedRevision() {
  return revision;
}

export function setActiveVariableFeed(feed: VariableFeed | null) {
  const prev = active;
  const same =
    prev === feed ||
    (prev != null &&
      feed != null &&
      prev.updatedAt === feed.updatedAt &&
      prev.source === feed.source &&
      prev.sites.length === feed.sites.length);
  active = feed;
  if (!same) revision += 1;
}

export function clearActiveVariableFeed() {
  setActiveVariableFeed(null);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function weekdayIndex(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}

export function minutesOfDay(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function normalizeHhmm(value: string | null | undefined) {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h === 24 && min === 0) return "24:00";
  if (h > 23 || min > 59) return null;
  return `${pad2(h)}:${pad2(min)}`;
}

function zonedParts(ms: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = g("hour") === "24" ? "00" : g("hour");
  return {
    ymd: `${g("year")}-${g("month")}-${g("day")}`,
    hhmm: `${hour.padStart(2, "0")}:${g("minute").padStart(2, "0")}`,
  };
}

/** Wall clock in `timeZone` → UTC epoch ms. */
export function wallToUtcMs(ymd: string, hhmm: string, timeZone: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const utc = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0);
  const got = zonedParts(utc, timeZone);
  const gotMs = Date.UTC(
    Number(got.ymd.slice(0, 4)),
    Number(got.ymd.slice(5, 7)) - 1,
    Number(got.ymd.slice(8, 10)),
    Number(got.hhmm.slice(0, 2)),
    Number(got.hhmm.slice(3, 5)),
  );
  let ms = utc - (gotMs - utc);
  const check = zonedParts(ms, timeZone);
  const want = `${pad2(hh || 0)}:${pad2(mm || 0)}`;
  if (check.ymd !== ymd || check.hhmm !== want) {
    const checkMs = Date.UTC(
      Number(check.ymd.slice(0, 4)),
      Number(check.ymd.slice(5, 7)) - 1,
      Number(check.ymd.slice(8, 10)),
      Number(check.hhmm.slice(0, 2)),
      Number(check.hhmm.slice(3, 5)),
    );
    const wantMs = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
    ms += wantMs - checkMs;
  }
  return ms;
}

export function addWallMinutes(ymd: string, hhmm: string, add: number) {
  const base = minutesOfDay(hhmm) + add;
  const dayShift = Math.floor(base / 1440);
  const mins = ((base % 1440) + 1440) % 1440;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + dayShift));
  return {
    ymd: dt.toISOString().slice(0, 10),
    hhmm: `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`,
  };
}

function bandDurationMin(band: VariableBand) {
  if (band.fallback || !band.start || !band.end) return 1440;
  const s = minutesOfDay(band.start);
  let e = band.end === "00:00" || band.end === "24:00" ? 1440 : minutesOfDay(band.end);
  if (e <= s) e += 1440;
  return e - s;
}

function bandCovers(band: VariableBand, ymd: string, hhmm: string) {
  if (band.fallback) return false;
  if (band.days && !band.days.includes(weekdayIndex(ymd))) return false;
  if (!band.start || !band.end) return false;
  const m = minutesOfDay(hhmm);
  const s = minutesOfDay(band.start);
  const e = band.end === "00:00" || band.end === "24:00" ? 1440 : minutesOfDay(band.end);
  if (e > s) return m >= s && m < e;
  return m >= s || m < e;
}

/** ENERGY price in site currency at a wall clock in the site's own zone. */
export function energyPriceAt(site: VariableSite, ymd: string, hhmm: string) {
  const hits = site.bands.filter((b) => bandCovers(b, ymd, hhmm));
  if (hits.length) {
    hits.sort(
      (a, b) =>
        bandDurationMin(a) - bandDurationMin(b) ||
        minutesOfDay(b.start || "00:00") - minutesOfDay(a.start || "00:00"),
    );
    return hits[0].price;
  }
  const fallback = site.bands.find((b) => b.fallback);
  return fallback ? fallback.price : null;
}

export type EnergyQuote = {
  native: number;
  rateKr: number;
  waitMin: number;
  cheapWindow: boolean;
  /** Site-local HH:MM the rate applies, plus wait when cheapest mode delays. */
  label: string;
};

/**
 * Price at the planned arrival. In cheapest mode, if a later band at this same
 * site is cheaper and starts within maxWaitMin, quote that band instead.
 */
export function quoteEnergy(opts: {
  site: VariableSite;
  ymd: string;
  hhmm: string;
  zone: string;
  preferCheap: boolean;
  maxWaitMin: number;
  fxEur: number;
}): EnergyQuote | null {
  const arrivalMs = wallToUtcMs(opts.ymd, opts.hhmm, opts.zone);
  const arrival = zonedParts(arrivalMs, opts.site.tz);
  const nowPrice = energyPriceAt(opts.site, arrival.ymd, arrival.hhmm);
  if (nowPrice == null) return null;
  let bestPrice = nowPrice;
  let bestWait = 0;
  let best = arrival;
  const maxWait = opts.preferCheap ? Math.max(0, opts.maxWaitMin) : 0;
  if (maxWait > 0) {
    const waits = new Set<number>([0]);
    for (const band of opts.site.bands) {
      if (band.fallback || !band.start) continue;
      const startMin = minutesOfDay(band.start);
      const cur = minutesOfDay(arrival.hhmm);
      let delta = (startMin - cur + 1440) % 1440;
      if (delta === 0) delta = 1440;
      for (let day = 0; day < 8; day++) {
        const w = delta + day * 1440;
        if (w > maxWait) break;
        const wall = addWallMinutes(arrival.ymd, arrival.hhmm, w);
        if (band.days && !band.days.includes(weekdayIndex(wall.ymd))) continue;
        waits.add(w);
        break;
      }
    }
    for (const w of waits) {
      const wall = addWallMinutes(arrival.ymd, arrival.hhmm, w);
      const price = energyPriceAt(opts.site, wall.ymd, wall.hhmm);
      if (price == null) continue;
      if (price < bestPrice - 1e-9 || (Math.abs(price - bestPrice) < 1e-9 && w < bestWait)) {
        bestPrice = price;
        bestWait = w;
        best = wall;
      }
    }
  }
  const rateKr = Math.round(bestPrice * opts.fxEur * 1000) / 1000;
  const cheapWindow = bestWait > 0;
  return {
    native: bestPrice,
    rateKr,
    waitMin: bestWait,
    cheapWindow,
    label: cheapWindow ? `${best.hhmm} · wait ${bestWait} min` : best.hhmm,
  };
}

function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function matchVariableSite(
  sites: VariableSite[],
  lat: number,
  lng: number,
  networkId: string | null | undefined,
  maxM = VARIABLE_MATCH_M,
) {
  if (!networkId) return null;
  let best: VariableSite | null = null;
  let bestD = maxM;
  for (const site of sites) {
    if (site.networkId !== networkId) continue;
    const d = metersBetween({ lat, lng }, site);
    if (d <= bestD) {
      best = site;
      bestD = d;
    }
  }
  return best;
}

export function eurToUsd(eur: number, fxEurToDkk: number) {
  return (eur * fxEurToDkk) / DKK_PER_USD;
}

/**
 * USD/kWh for a Supercharger session at plug-in, or null to keep the saved catalog rate.
 * Plug-in day/hour/minute is the Costs clock (America/Los_Angeles), then read in the site zone.
 */
export function superchargerUsdPerKwh(opts: {
  kind: string;
  networkId?: string | null;
  lat: number;
  lng: number;
  day: string;
  hour: number;
  minute: number;
  feed: VariableFeed | null;
}) {
  if (!opts.feed) return null;
  const networkId = opts.networkId || (opts.kind === "supercharger" ? "tesla" : null);
  const site = matchVariableSite(opts.feed.sites, opts.lat, opts.lng, networkId);
  if (!site) return null;
  const hhmm = `${pad2(opts.hour)}:${pad2(opts.minute)}`;
  const ms = wallToUtcMs(opts.day, hhmm, SESSION_ZONE);
  const wall = zonedParts(ms, site.tz);
  const native = energyPriceAt(site, wall.ymd, wall.hhmm);
  if (native == null) return null;
  return eurToUsd(native, opts.feed.fx.EUR || CATALOG_FX.EUR);
}

type OcpiComponent = { type?: string; price?: number; vat?: number | null };
type OcpiElement = {
  restrictions?: {
    start_time?: string | null;
    end_time?: string | null;
    day_of_week?: string[] | null;
  } | null;
  price_components?: OcpiComponent[];
};
type OcpiTariff = {
  id?: string;
  party_id?: string;
  currency?: string;
  elements?: OcpiElement[];
};
type OcpiLocation = {
  id?: string;
  name?: string | null;
  city?: string | null;
  party_id?: string;
  time_zone?: string | null;
  coordinates?: { latitude?: string; longitude?: string };
  evses?: { connectors?: { tariff_ids?: string[] | null }[] | null }[] | null;
};

function consumerPrice(pc: OcpiComponent) {
  const price = pc.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price < 0) return null;
  const vat = pc.vat;
  if (typeof vat === "number" && vat > 0 && vat < 100) {
    return Math.round(price * (1 + vat / 100) * 10000) / 10000;
  }
  return price;
}

function bandsFromTariff(tariff: OcpiTariff): VariableBand[] {
  const bands: VariableBand[] = [];
  for (const el of tariff.elements ?? []) {
    const energy = (el.price_components ?? []).filter((pc) => pc.type === "ENERGY");
    if (!energy.length) continue;
    const price = consumerPrice(energy[0]);
    if (price == null) continue;
    const r = el.restrictions;
    const start = normalizeHhmm(r?.start_time);
    const end = normalizeHhmm(r?.end_time);
    const daysRaw = (r?.day_of_week ?? []).flatMap((d) => {
      const n = WEEKDAY_INDEX[String(d).toUpperCase()];
      return n == null ? [] : [n];
    });
    const days =
      daysRaw.length && daysRaw.length < 7 ? [...new Set(daysRaw)].sort((a, b) => a - b) : null;
    const timed = Boolean(start && end);
    bands.push({
      start: timed ? start : null,
      end: timed ? end : null,
      days: timed ? days : null,
      price,
      fallback: !timed,
    });
  }
  return bands;
}

/** Tesla NL sites from an NDW-shaped OCPI locations list + tariffs list. Other parties are ignored. */
export function teslaSitesFromOcpi(tariffsRaw: unknown, locationsRaw: unknown): VariableSite[] {
  if (!Array.isArray(tariffsRaw) || !Array.isArray(locationsRaw)) return [];
  const tariffs = new Map<string, OcpiTariff>();
  for (const row of tariffsRaw as OcpiTariff[]) {
    if (row?.party_id !== "TSL" || row.currency !== "EUR" || !row.id) continue;
    tariffs.set(row.id, row);
  }
  const sites: VariableSite[] = [];
  for (const loc of locationsRaw as OcpiLocation[]) {
    if (loc?.party_id !== "TSL" || !loc.id) continue;
    const lat = Number(loc.coordinates?.latitude);
    const lng = Number(loc.coordinates?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const ids = new Set<string>();
    for (const ev of loc.evses ?? []) {
      for (const c of ev?.connectors ?? []) {
        for (const id of c?.tariff_ids ?? []) ids.add(id);
      }
    }
    let bands: VariableBand[] = [];
    for (const id of ids) {
      const tariff = tariffs.get(id);
      if (!tariff) continue;
      const next = bandsFromTariff(tariff);
      const timed = next.filter((b) => !b.fallback).length;
      const prev = bands.filter((b) => !b.fallback).length;
      if (!bands.length || timed > prev) bands = next;
    }
    if (!bands.length) continue;
    const name = (loc.name || loc.city || loc.id).trim();
    sites.push({
      id: loc.id,
      networkId: "tesla",
      name,
      lat,
      lng,
      ccy: "EUR",
      tz: loc.time_zone || "Europe/Amsterdam",
      bands,
    });
  }
  sites.sort((a, b) => a.name.localeCompare(b.name));
  return sites;
}
