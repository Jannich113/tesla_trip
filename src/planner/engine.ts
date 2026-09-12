import { type ChargeLocation } from "@/lib/charge-locations";
import { type HourPrice } from "@/lib/elpris";
import { type Units } from "@/lib/vehicle";
import {
  type LegMode,
  type ModeFocus,
  type SpeedEff,
  type CheapAvoid,
  addDaysYmd,
  addMinutesDateTime,
  addMinutesHhmm,
  asDateTime,
  chargeSearchKm,
  cheapDetourKm,
  extraMileageKr,
  chargeFitScore,
  defaultFocus,
  DEFAULT_DETOUR_KM,
  CHEAP_STALL_KM,
  STALL_SAVE_KR,
  dkNowDateTime,
  dkNowParts,
  driveKwhAtSpeed,
  hoursFrom,
  maxDateTime,
  minutesBetweenDateTime,
  splitDateTime,
  stallKw,
  waitDelayMin,
  waitMinUntil,
  waitMinUntilDated,
} from "./modes";
import { networkIdFor, networkLabel, rateForNetwork } from "./networks";
import {
  alongFraction,
  haversineM,
  minDistToPathM,
  pickViaAtRange,
  splitRoutedLeg,
  spreadAlongPath,
  locationsNearPath,
} from "./insert";
import { estimateTolls } from "./tolls";
import { withRetry, fetchWithTimeout } from "./retry";

export { alongFraction, haversineM, minDistToPathM, pathMeters, pickViaAtRange, pickViaOnPath, pointAlongPath, splitRoutedLeg, spreadAlongPath } from "./insert";

export {
  DEFAULT_DETOUR_KM,
  DEFAULT_WAIT_MIN,
  DETOUR_KM,
  LEG_MODES,
  SPEED_KMH,
  WAIT_MIN,
  addMinutesDateTime,
  addMinutesHhmm,
  asDateTime,
  chargeSearchKm,
  chargeFitScore,
  defaultFocus,
  defaultSpeedEff,
  dkNowDateTime,
  driveKwhAtSpeed,
  epaWhPerMi,
  formatDateTime,
  formatWaitCap,
  hoursFrom,
  interpolateWhPerMi,
  kwhPerMiFrom100km,
  normalizeSpeedEff,
  avgSpeedKmh,
  splitDateTime,
  modeColor,
  modeHint,
  modeLabel,
  normalizeMode,
  MODE_FOCUSES,
  DEFAULT_MODE_FOCUS,
  pathMode,
  asCheapAvoid,
  type CheapAvoid,
  routeAb,
  timePenalized,
  stallKw,
  cheapDetourKm,
  detourPays,
  detourSavings,
  type DetourKm,
  type LegMode,
  type ModeFocus,
  type SpeedEff,
  type SpeedKmh,
} from "./modes";

export type ChargeAdvice = "required" | "suggested" | null;

export type LegWhen = {
  kind: "auto" | "depart" | "arrive";
  hhmm: string;
  at?: string;
};

export type PlanStop = {
  id: string;
  name: string;
  lat: number;
  lng: number;
};

export type RoutedLeg = {
  miles: number;
  seconds: number;
  path: [number, number][];
  source: "valhalla" | "osrm" | "air";
  hasToll?: boolean;
  tollKr?: number;
  tollLabel?: string;
};

export type PricedCharge = {
  locationId: string;
  name: string;
  kind: ChargeLocation["kind"];
  kwh: number;
  kr: number;
  rateKr: number;
  label: string;
  inBand: boolean;
  distM: number;
  windowLabel: string;
  cheapWindow: boolean;
  waitMin: number;
  nearest?: boolean;
  cheapest?: boolean;
};

export type PricedLeg = {
  from: PlanStop;
  to: PlanStop;
  mode: LegMode;
  detourKm: number;
  route: RoutedLeg;
  kwh: number;
  arriveSoc: number;
  needed: boolean;
  suggested: boolean;
  advice: ChargeAdvice;
  departAt: string;
  arriveAt: string;
  chargeMin: number;
  waitMin: number;
  startSoc: number;
  charge: PricedCharge | null;
  backup: PricedCharge | null;
  kr: number;
  accepted: boolean;
  autoStartSoc: number;
  extraKr: number;
  chargeOptions: PricedCharge[];
  /** Original user-leg index (accept / charge-to / backup). */
  userIndex: number;
  /** `to` was auto-inserted because the user leg was longer than range. */
  via: boolean;
  tollKr: number;
  tollLabel: string;
};

export const DKK_PER_USD = 6.85;
/** Never plan to arrive below this. */
const FLOOR_SOC = 8;
/** Stop to charge when SOC would be under this. Lower in the 8–25 band is faster DC. */
const REQUIRE_SOC = 25;
/** Optional stop only in this band, and only when the kWh price is good. */
const SUGGEST_SOC_MIN = 26;
const SUGGEST_SOC_MAX = 45;
const TARGET_SOC = 80;
/** Every charge session adds at least this much SOC, never past TARGET_SOC. */
const MIN_ADD_SOC = 20;
const CHEAP_VS_LIVE = 0.85;

export function airRoute(from: PlanStop, to: PlanStop): RoutedLeg {
  const m = haversineM(from, to) * 1.22;
  const miles = m / 1609.344;
  const path: [number, number][] = [
    [from.lat, from.lng],
    [to.lat, to.lng],
  ];
  const toll = estimateTolls(path, miles, false, "fastest");
  return {
    miles,
    seconds: (miles / 42) * 3600,
    path,
    source: "air",
    hasToll: toll.hasToll,
    tollKr: toll.kr,
    tollLabel: toll.label,
  };
}

const routeCache = new Map<string, RoutedLeg>();

export function primeRouteCache(entries: Record<string, RoutedLeg>) {
  for (const [key, route] of Object.entries(entries)) {
    if (route?.source === "air") continue;
    if (route?.path?.length >= 2 && Number.isFinite(route.miles)) routeCache.set(key, route);
  }
}

export function cachedRoutes(): Record<string, RoutedLeg> {
  return Object.fromEntries(routeCache);
}

export async function fetchRoute(from: PlanStop, to: PlanStop, mode: LegMode): Promise<RoutedLeg> {
  const key = `${from.lat.toFixed(4)},${from.lng.toFixed(4)}|${to.lat.toFixed(4)},${to.lng.toFixed(4)}|${mode}|v11`;
  const hit = routeCache.get(key);
  if (hit && hit.source !== "air" && hit.path.length >= 3) return hit;
  try {
    const body = await withRetry(async () => {
      const qs = new URLSearchParams({
        from: `${from.lat.toFixed(4)},${from.lng.toFixed(4)}`,
        to: `${to.lat.toFixed(4)},${to.lng.toFixed(4)}`,
        mode,
        v: "11",
      });
      let res = await fetchWithTimeout(`/api/drive?${qs}`, {
        headers: { Accept: "application/json" },
      }, 20_000);
      if (!res.ok) {
        res = await fetchWithTimeout("/api/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            from: { lat: from.lat, lng: from.lng },
            to: { lat: to.lat, lng: to.lng },
            mode,
          }),
        }, 20_000);
      }
      if (!res.ok) throw new Error(`Route ${res.status}`);
      const json = (await res.json()) as RoutedLeg;
      if (json.source === "air" || (json.path?.length ?? 0) < 3 || !Number.isFinite(json.miles)) {
        throw new Error("Empty route");
      }
      return json;
    }, { delaysMs: [400, 1200] });
    routeCache.set(key, body);
    return body;
  } catch {
    return airRoute(from, to);
  }
}

export function driveKwh(miles: number, seconds: number, speedEff: SpeedEff) {
  return driveKwhAtSpeed(miles, seconds, speedEff);
}

/** Swap geometric via splits for a real road through the charger (Tesla-style). */
export function applyLiveRoutes(
  legs: PricedLeg[],
  lookup: (from: PlanStop, to: PlanStop, mode: LegMode) => RoutedLeg | undefined,
  speedEff: SpeedEff,
  avoid: boolean | CheapAvoid = false,
): PricedLeg[] {
  return legs.map((leg) => {
    const live = lookup(leg.from, leg.to, leg.mode);
    if (!live || live.source === "air" || live.path.length < 3) return leg;
    const kwh = driveKwh(live.miles, live.seconds, speedEff);
    const toll = estimateTolls(
      live.path,
      live.miles,
      Boolean(live.hasToll),
      leg.mode,
    );
    const chargeKr = Math.max(0, leg.kr - (leg.tollKr ?? 0));
    return { ...leg, route: live, kwh, tollKr: toll.kr, tollLabel: toll.label, kr: chargeKr + toll.kr };
  });
}

export function dkNowHhmm() {
  return dkNowParts().hhmm;
}

export type DatedHour = HourPrice & { ymd: string; estimated?: boolean };

function usdToKr(usd: number) {
  return usd * DKK_PER_USD;
}

export type ChargeWindow = {
  hours: HourPrice[];
  kr: number;
  avgKr: number;
  label: string;
  waitMin: number;
  startHour: string;
  startYmd?: string;
};

function hourSpan(h: string, add: number) {
  return String((Number(h) + add + 24) % 24).padStart(2, "0");
}

export function formatChargeWindow(hours: HourPrice[]) {
  if (!hours.length) return "live";
  const start = hours[0].hour;
  const time = hours.length === 1 ? `${start}:00` : `${start}–${hourSpan(hours[hours.length - 1].hour, 1)}`;
  const ymd = (hours[0] as DatedHour).ymd;
  if (!ymd) return time;
  const [, m, d] = ymd.split("-");
  return `${d}/${m} ${time}`;
}

function windowCost(hours: HourPrice[], start: number, kwh: number, acKw: number) {
  const kw = Math.max(acKw, 1);
  const n = Math.max(1, Math.ceil(kwh / kw));
  let left = kwh;
  let cost = 0;
  for (let j = 0; j < n && left > 0.001; j++) {
    const hour = hours[Math.min(start + j, hours.length - 1)];
    const slice = Math.min(left, kw);
    cost += slice * hour.krPerKwh;
    left -= slice;
  }
  return cost;
}

/** Sequential hours from now (remaining list already starts at the current hour). */
export function nowWindow(hours: HourPrice[], kwh: number, acKw: number): ChargeWindow | null {
  if (kwh <= 0 || hours.length === 0) return null;
  const kw = Math.max(acKw, 1);
  const n = Math.max(1, Math.ceil(kwh / kw));
  const used = hours.slice(0, Math.min(n, hours.length));
  while (used.length < n) used.push(hours[hours.length - 1]);
  const kr = windowCost(hours, 0, kwh, acKw);
  return {
    hours: used,
    kr,
    avgKr: kr / kwh,
    label: formatChargeWindow(used),
    waitMin: 0,
    startHour: used[0]?.hour ?? "00",
    startYmd: (used[0] as DatedHour | undefined)?.ymd,
  };
}

/** Cheapest contiguous window that covers the AC session, after optional wait. */
export function cheapestWindow(
  hours: HourPrice[],
  kwh: number,
  acKw: number,
  clock: string,
  maxWaitMin = 18 * 60,
): ChargeWindow | null {
  if (kwh <= 0 || hours.length === 0) return null;
  const clockDt = asDateTime(clock);
  const kw = Math.max(acKw, 1);
  const n = Math.max(1, Math.ceil(kwh / kw));
  const last = Math.max(0, hours.length - n);
  let bestI = -1;
  let best = Infinity;
  for (let i = 0; i <= last; i++) {
    const wait = hourWait(clockDt, hours[i]);
    if (wait > maxWaitMin) continue;
    const cost = windowCost(hours, i, kwh, acKw);
    if (cost < best) {
      best = cost;
      bestI = i;
    }
  }
  if (bestI < 0) return nowWindow(hours, kwh, acKw);
  const used = hours.slice(bestI, bestI + n);
  while (used.length < n) used.push(hours[hours.length - 1]);
  const start = used[0];
  return {
    hours: used,
    kr: best,
    avgKr: best / kwh,
    label: formatChargeWindow(used),
    waitMin: hourWait(clockDt, start),
    startHour: start.hour,
    startYmd: (start as DatedHour).ymd,
  };
}

function hourWait(clockDt: string, hour: HourPrice) {
  const dated = hour as DatedHour;
  if (dated.ymd) return waitMinUntilDated(clockDt, dated.ymd, hour.hour);
  return waitMinUntil(splitDateTime(clockDt).hhmm, hour.hour);
}

export function cheapestHour(hours: HourPrice[]): HourPrice | null {
  if (!hours.length) return null;
  return hours.reduce((best, h) => (h.krPerKwh < best.krPerKwh ? h : best));
}

/** Blend live spot hours over the AC session length. */
export function acChargeKr(kwh: number, hours: HourPrice[], acKw: number) {
  return nowWindow(hours, kwh, acKw)?.kr ?? 0;
}

export function remainingHours(
  today: HourPrice[],
  tomorrow: HourPrice[],
  currentHour: string | null,
  throughDt?: string,
): DatedHour[] {
  const todayYmd = dkNowParts().ymd;
  const tomorrowYmd = addDaysYmd(todayYmd, 1);
  const through = throughDt ? splitDateTime(throughDt).ymd : addDaysYmd(todayYmd, 1);
  const rest = currentHour ? today.filter((h) => h.hour >= currentHour) : today;
  const out: DatedHour[] = [
    ...(rest.length ? rest : today).map((h) => ({ ...h, ymd: todayYmd })),
    ...tomorrow.map((h) => ({ ...h, ymd: tomorrowYmd })),
  ];
  const template = tomorrow.length ? tomorrow : today;
  let day = 2;
  while (addDaysYmd(todayYmd, day) <= through && day <= 14) {
    const ymd = addDaysYmd(todayYmd, day);
    for (const h of template) out.push({ ...h, ymd, estimated: true });
    day += 1;
  }
  return out;
}

function chargerLabel(loc: ChargeLocation, hasAbo = false) {
  const netId = networkIdFor(loc.kind, (loc as { networkId?: string }).networkId);
  if (netId) return networkLabel(netId, hasAbo);
  if (loc.kind === "supercharger") return `${loc.short} Supercharger`;
  if (loc.kind === "home") return "Home · live spot";
  return loc.short || loc.name;
}

function toPriced(
  loc: ChargeLocation,
  kwhNeed: number,
  acKr: number,
  hours: HourPrice[],
  acKw: number,
  distM: number,
  inBand: boolean,
  preferCheap: boolean,
  clockHhmm: string,
  maxWaitMin: number,
  memberships: Record<string, boolean> = {},
): PricedCharge {
  const loss = loc.kind === "home" ? 1.1 : 1.08;
  const billedKwh = kwhNeed * loss;
  const netId = networkIdFor(loc.kind, (loc as { networkId?: string }).networkId);
  if (netId) {
    const hasAbo = Boolean(memberships[netId]);
    const rate = rateForNetwork(netId, hasAbo) ?? usdToKr(loc.usdPerKwh);
    return {
      locationId: loc.id,
      name: loc.short || loc.name,
      kind: loc.kind,
      kwh: billedKwh,
      kr: billedKwh * rate,
      rateKr: rate,
      label: chargerLabel(loc, hasAbo),
      inBand,
      distM,
      windowLabel: hasAbo ? networkLabel(netId, true) : "Ad-hoc",
      cheapWindow: false,
      waitMin: 0,
    };
  }
  if (loc.kind !== "home") {
    const rate = usdToKr(loc.usdPerKwh) || acKr;
    return {
      locationId: loc.id,
      name: loc.short || loc.name,
      kind: loc.kind,
      kwh: billedKwh,
      kr: billedKwh * rate,
      rateKr: rate,
      label: chargerLabel(loc),
      inBand,
      distM,
      windowLabel: "DC now",
      cheapWindow: false,
      waitMin: 0,
    };
  }
  const win = preferCheap
    ? cheapestWindow(hours, billedKwh, acKw, clockHhmm, maxWaitMin)
    : nowWindow(hours, billedKwh, acKw);
  const kr = win?.kr ?? billedKwh * acKr;
  const waitMin = win?.waitMin ?? 0;
  const windowLabel =
    waitMin > 0 && win ? `${win.label} · wait ${minutesToHm(waitMin)}` : (win?.label ?? "live");
  return {
    locationId: loc.id,
    name: loc.short || loc.name,
    kind: loc.kind,
    kwh: billedKwh,
    kr,
    rateKr: win?.avgKr ?? acKr,
    label: chargerLabel(loc),
    inBand,
    distM,
    windowLabel,
    cheapWindow: Boolean(preferCheap && win),
    waitMin,
  };
}

export function pickCharges(opts: {
  kwhNeed: number;
  path: [number, number][];
  detourKm: number;
  mode: LegMode;
  focus?: ModeFocus;
  locations: ChargeLocation[];
  acKr: number;
  hours: HourPrice[];
  acKw: number;
  speedEff: SpeedEff;
  clockHhmm: string;
  maxWaitMin: number;
  backupId?: string | null;
  preferId?: string | null;
  memberships?: Record<string, boolean>;
  routeSeconds?: number;
}): { primary: PricedCharge; backup: PricedCharge | null; options: PricedCharge[] } | null {
  const { kwhNeed, path, detourKm, mode, locations, acKr, hours, acKw, speedEff, clockHhmm, maxWaitMin, backupId, preferId, memberships = {} } = opts;
  const focus = opts.focus ?? defaultFocus(mode);
  if (kwhNeed <= 0.05 || !locations.length) return null;
  const preferCheap = focus === "pris";
  const userBand = Math.max(Math.min(detourKm, CHEAP_STALL_KM) * 1000, 80);
  const searchBand = preferCheap
    ? CHEAP_STALL_KM * 1000
    : Math.max(chargeSearchKm(mode, detourKm, focus, opts.routeSeconds) * 1000, userBand);
  const maxExtraMin = preferCheap ? (CHEAP_STALL_KM / 80) * 60 : Infinity;
  const locRate = (loc: ChargeLocation) => {
    const id = networkIdFor(loc.kind, loc.networkId);
    return (id ? rateForNetwork(id, Boolean(memberships[id])) : null) ?? usdToKr(loc.usdPerKwh);
  };

  const band = preferCheap ? CHEAP_STALL_KM * 1000 : Math.max(searchBand, 40_000);
  const nearby = [
    ...locationsNearPath(locations, path, band),
    ...locations.filter((l) => l.id === preferId || l.id === backupId),
  ]
    .filter((loc, i, arr) => arr.findIndex((x) => x.id === loc.id) === i)
    .map((loc) => ({ loc, distM: minDistToPathM(loc.lat, loc.lng, path) }))
    .filter(
      (s) =>
        s.loc.id === preferId ||
        s.loc.id === backupId ||
        ((s.distM / 1000 / 80) * 60 <= maxExtraMin && locRate(s.loc) > 0.3),
    );
  const rankedNear = preferCheap
    ? [...nearby].sort((a, b) => locRate(a.loc) - locRate(b.loc) || a.distM - b.distM).slice(0, 36)
    : [...nearby].sort((a, b) => a.distM - b.distM).slice(0, 24);
  const cheapPool = preferCheap
    ? [...nearby].sort((a, b) => locRate(a.loc) - locRate(b.loc) || a.distM - b.distM).slice(0, 28)
    : [];
  const seen = new Set<string>();
  const pool = [...rankedNear, ...cheapPool].filter((s) => {
    if (seen.has(s.loc.id)) return false;
    seen.add(s.loc.id);
    return true;
  });

  const scored = pool.map((s) => ({
    loc: s.loc,
    distM: s.distM,
    priced: toPriced(
      s.loc,
      kwhNeed,
      acKr,
      hours,
      acKw,
      s.distM,
      s.distM <= userBand,
      preferCheap,
      clockHhmm,
      maxWaitMin,
      memberships,
    ),
  }));

  const extraDriveKr = (distM: number) => {
    const miles = distM / 1609.344;
    const seconds = ((miles * 1.609344) / 80) * 3600;
    return extraMileageKr(distM, {
      acKr,
      kwh: driveKwh(miles, seconds, speedEff),
    });
  };
  const onPath = [...scored].filter((s) => s.distM <= 5000).sort((a, b) => a.priced.kr - b.priced.kr || a.distM - b.distM);
  const baselineKr = onPath[0]?.priced.kr ?? [...scored].sort((a, b) => a.distM - b.distM)[0]?.priced.kr ?? 0;
  const netSave = (s: (typeof scored)[0]) => baselineKr - s.priced.kr - extraDriveKr(s.distM);

  const byRank = (a: (typeof scored)[0], b: (typeof scored)[0]) => {
    if (preferCheap) return netSave(b) - netSave(a) || a.distM - b.distM;
    const as = chargeFitScore(focus, {
      distM: a.distM,
      kr: a.priced.kr,
      dc: a.loc.kind === "supercharger",
      extraDriveKr: extraDriveKr(a.distM),
      extraKwh: extraDriveKr(a.distM) / Math.max(acKr, 0.01),
    });
    const bs = chargeFitScore(focus, {
      distM: b.distM,
      kr: b.priced.kr,
      dc: b.loc.kind === "supercharger",
      extraDriveKr: extraDriveKr(b.distM),
      extraKwh: extraDriveKr(b.distM) / Math.max(acKr, 0.01),
    });
    return as - bs || a.distM - b.distM;
  };

  const worth = preferCheap
    ? scored.filter((s) => s.distM <= CHEAP_STALL_KM * 1000 && netSave(s) >= STALL_SAVE_KR)
    : scored;
  const rankedPool = worth.length ? worth : scored;

  const nearestId = [...rankedPool].sort((a, b) => a.distM - b.distM)[0]?.loc.id;
  const cheapestId = [...rankedPool].sort((a, b) => a.priced.kr - b.priced.kr)[0]?.loc.id;
  const tag = (priced: PricedCharge, locId: string): PricedCharge => ({
    ...priced,
    nearest: locId === nearestId,
    cheapest: locId === cheapestId,
  });

  const inSearch = rankedPool.filter((s) => s.distM <= searchBand).sort(byRank);
  const outside = rankedPool.filter((s) => s.distM > searchBand).sort(byRank);
  const forced =
    preferId
      ? scored.find((s) => s.loc.id === preferId && s.distM <= Math.max(searchBand, 40_000))
      : null;
  const primarySrc = preferCheap
    ? (inSearch[0] ?? forced ?? outside[0])
    : (forced ?? inSearch[0] ?? outside[0]);
  if (!primarySrc) return null;

  const backupSrc =
    (backupId
      ? scored.find((s) => s.loc.id === backupId && s.loc.id !== primarySrc.loc.id)
      : null) ??
    inSearch.find((s) => s.loc.id !== primarySrc.loc.id) ??
    outside.find((s) => s.loc.id !== primarySrc.loc.id) ??
    null;

  const ranked = [...rankedPool].sort(byRank);

  return {
    primary: tag(primarySrc.priced, primarySrc.loc.id),
    backup: backupSrc
      ? {
          ...tag(backupSrc.priced, backupSrc.loc.id),
          label: backupSrc.priced.inBand
            ? backupSrc.priced.label
            : `${backupSrc.priced.label} · farther`,
        }
      : null,
    options: ranked.slice(0, 16).map((s) => {
      const priced = tag(s.priced, s.loc.id);
      return s.priced.inBand ? priced : { ...priced, label: `${priced.label} · farther` };
    }),
  };
}

export function pricePlan(opts: {
  stops: PlanStop[];
  modes: LegMode[];
  detours: number[];
  routes: RoutedLeg[];
  soc: number;
  usableKwh: number;
  locations: ChargeLocation[];
  hours: HourPrice[];
  acKw: number;
  acKr: number;
  speedEff: SpeedEff;
  departHhmm: string;
  arriveHhmm?: string;
  legWhen?: LegWhen[];
  acceptCharge?: boolean[];
  chargeToSoc?: Array<number | null | undefined>;
  backupIds?: Array<string | null | undefined>;
  memberships?: Record<string, boolean>;
  waitCapMin?: number[];
  focuses?: ModeFocus[];
  preferIds?: Array<string | null | undefined>;
  avoid?: CheapAvoid;
}): PricedLeg[] {
  const { stops, modes, detours, routes, usableKwh, locations, hours, acKw, acKr, speedEff } =
    opts;
  const live = hours[0]?.krPerKwh ?? acKr;
  const now = dkNowDateTime();
  let soc = opts.soc;
  let plannedStart = asDateTime(opts.departHhmm || now);
  let readyAt = minutesBetweenDateTime(now, plannedStart) > 0 ? now : plannedStart;
  type Job = {
    from: PlanStop;
    to: PlanStop;
    mode: LegMode;
    focus: ModeFocus;
    detourKm: number;
    route: RoutedLeg;
    userIndex: number;
    via: boolean;
    depth: number;
  };
  const jobs: Job[] = routes.map((route, i) => ({
    from: stops[i],
    to: stops[i + 1],
    mode: modes[i] ?? "fastest",
    focus: opts.focuses?.[i] ?? defaultFocus(modes[i] ?? "fastest"),
    detourKm: detours[i] ?? DEFAULT_DETOUR_KM,
    route,
    userIndex: i,
    via: false,
    depth: 0,
  }));
  const usedVias = new Set<string>(stops.map((s) => s.id));
  const out: PricedLeg[] = [];
  while (jobs.length && out.length < 32) {
    const job = jobs.shift()!;
    const { mode, route, userIndex, via } = job;
    const focus = job.focus;
    const kwh = driveKwh(route.miles, route.seconds, speedEff);
    const packSoc = soc < REQUIRE_SOC ? Math.max(soc, TARGET_SOC) : soc;
    const floorKwh = Math.max(4, ((packSoc - FLOOR_SOC) / 100) * usableKwh);
    const bandKwh = Math.max(0, ((packSoc - REQUIRE_SOC) / 100) * usableKwh);
    if (kwh > floorKwh * 0.98 && job.depth < 8) {
      const viaOpts = {
        path: route.path,
        locations,
        budgetKwh: floorKwh,
        minKwh: bandKwh,
        totalKwh: kwh,
        mode,
        focus,
        detourKm: mode === "cheapest" ? CHEAP_STALL_KM : job.detourKm,
        excludeIds: usedVias,
        memberships: opts.memberships,
      };
      const viaLoc =
        pickViaAtRange(viaOpts) ??
        pickViaAtRange({
          ...viaOpts,
          detourKm: Math.max(viaOpts.detourKm, 50),
        });
      const split = viaLoc ? splitRoutedLeg(route, viaLoc.lat, viaLoc.lng) : null;
      if (viaLoc && split) {
        usedVias.add(viaLoc.id);
        const viaStop: PlanStop = {
          id: `via-${viaLoc.id}`,
          name: viaLoc.short || viaLoc.name || viaLoc.id,
          lat: viaLoc.lat,
          lng: viaLoc.lng,
        };
        jobs.unshift({
          from: viaStop,
          to: job.to,
          mode,
          focus,
          detourKm: job.detourKm,
          route: split.after,
          userIndex,
          via: job.via,
          depth: job.depth + 1,
        });
        jobs.unshift({
          from: job.from,
          to: viaStop,
          mode,
          focus,
          detourKm: job.detourKm,
          route: split.before,
          userIndex,
          via: true,
          depth: job.depth + 1,
        });
        continue;
      }
    }
    const when = opts.legWhen?.[userIndex];
    const whenAt = when && when.kind !== "auto" ? asDateTime(when.at || when.hhmm) : "";
    if (when?.kind === "depart" && whenAt) plannedStart = whenAt;
    if (when?.kind === "arrive" && whenAt) {
      plannedStart = addMinutesDateTime(whenAt, -route.seconds / 60);
    }
    const socAfter = soc - (kwh / usableKwh) * 100;
    const minArrive = FLOOR_SOC;
    const required =
      socAfter < FLOOR_SOC ||
      (soc < REQUIRE_SOC && (jobs.length > 0 || kwh > floorKwh * 0.5));
    const searchHours = hoursFrom(hours, readyAt);
    const cheap = cheapestHour(searchHours);
    const goodPrice = Boolean(cheap && cheap.krPerKwh <= live * CHEAP_VS_LIVE);
    const inSuggestBand = soc >= SUGGEST_SOC_MIN && soc <= SUGGEST_SOC_MAX;
    const suggested = !required && goodPrice && inSuggestBand;
    const needForHop = minArrive + (kwh / usableKwh) * 100;
    const autoTarget = Math.min(
      TARGET_SOC,
      Math.max(
        Math.min(TARGET_SOC, soc + MIN_ADD_SOC),
        required ? Math.max(TARGET_SOC, Math.min(TARGET_SOC, needForHop)) : 0,
      ),
    );
    const minTarget = Math.min(TARGET_SOC, soc + MIN_ADD_SOC);
    const atViaFrom = job.from.id.startsWith("via-");
    const rawTarget = atViaFrom || !via ? opts.chargeToSoc?.[userIndex] : null;
    const userTarget =
      rawTarget != null && Number.isFinite(rawTarget)
        ? Math.min(TARGET_SOC, Math.max(minTarget, rawTarget))
        : null;
    const target = userTarget ?? autoTarget;
    const wantCharge = required || suggested || userTarget != null;
    const kwhNeed = Math.max((target - soc) / 100, 0) * usableKwh;
    const autoKwh = Math.max((autoTarget - soc) / 100, 0) * usableKwh;
    const chargeMinEst = (Math.max(kwhNeed, 5) / 150) * 60;
    const restDriveMin =
      route.seconds / 60 + jobs.reduce((n, j) => n + j.route.seconds / 60, 0);
    const slack = minutesBetweenDateTime(readyAt, plannedStart);
    const maxNoDelay = Math.max(0, slack - chargeMinEst);
    const cheapestCap = Math.max(0, opts.waitCapMin?.[userIndex] ?? 120);
    const arriveCap = opts.arriveHhmm
      ? Math.max(
          0,
          minutesBetweenDateTime(readyAt, asDateTime(opts.arriveHhmm)) - chargeMinEst - restDriveMin,
        )
      : null;
    const maxWaitMin =
      arriveCap != null
        ? Math.min(arriveCap, focus === "pris" ? cheapestCap : arriveCap)
        : focus === "pris"
          ? Math.max(maxNoDelay, cheapestCap)
          : suggested
            ? maxNoDelay
            : 0;
    const pick = wantCharge
      ? pickCharges({
          kwhNeed: Math.max(kwhNeed, 5),
          path: route.path,
          detourKm: mode === "cheapest" ? CHEAP_STALL_KM : job.detourKm,
          mode,
          focus,
          locations,
          acKr: searchHours[0]?.krPerKwh ?? acKr,
          hours: searchHours,
          acKw,
          speedEff,
          clockHhmm: readyAt,
          maxWaitMin,
          backupId: job.to.id.startsWith("via-")
            ? job.to.id.replace(/^via-/, "")
            : opts.backupIds?.[userIndex] ?? null,
          preferId: atViaFrom && mode !== "cheapest"
            ? job.from.id.replace(/^via-/, "")
            : opts.preferIds?.[userIndex] ?? null,
          memberships: opts.memberships,
          routeSeconds: route.seconds,
        })
      : null;
    const charge = pick?.primary ?? null;
    const backup = pick?.backup ?? null;
    const advice: ChargeAdvice = required ? "required" : suggested ? "suggested" : null;
    const accepted =
      required ||
      Boolean(userTarget != null) ||
      (suggested && Boolean(opts.acceptCharge?.[userIndex]));
    const billed = accepted && charge !== null;
    const chargeMin = billed && charge ? (charge.kwh / stallKw(charge.kind, acKw)) * 60 : 0;
    const rawWait = billed && charge && charge.cheapWindow ? charge.waitMin : 0;
    const windowStart = addMinutesDateTime(readyAt, rawWait);
    const waitMin =
      billed && charge && charge.cheapWindow
        ? waitDelayMin({ readyAt, plannedStart, windowStart, chargeMin })
        : 0;
    const chargeDone = billed ? addMinutesDateTime(windowStart, chargeMin) : readyAt;
    const departAt = maxDateTime(plannedStart, billed ? chargeDone : readyAt);
    const arriveAt = addMinutesDateTime(departAt, route.seconds / 60);
    const packKwh = billed ? kwhNeed : 0;
    const startSoc = billed && charge ? Math.min(TARGET_SOC, soc + (packKwh / usableKwh) * 100) : soc;
    const arriveSoc = Math.max(minArrive, startSoc - (kwh / usableKwh) * 100);
    const extraKr =
      billed && charge && userTarget != null
        ? Math.max(0, userTarget - autoTarget) * 0.01 * usableKwh * charge.rateKr
        : 0;
    const pricedCharge =
      charge && waitMin === 0 && charge.waitMin > 0
        ? { ...charge, waitMin: 0, windowLabel: charge.windowLabel.replace(/ · wait .+$/, "") }
        : charge
          ? { ...charge, waitMin }
          : null;
    const toll = estimateTolls(
      route.path,
      route.miles,
      Boolean(route.hasToll),
      mode,
    );
    out.push({
      from: job.from,
      to: job.to,
      mode,
      detourKm: job.detourKm,
      route,
      kwh,
      arriveSoc,
      needed: required,
      suggested,
      advice,
      departAt,
      arriveAt,
      chargeMin,
      waitMin,
      startSoc,
      charge: pricedCharge,
      backup,
      kr: (billed ? (charge?.kr ?? 0) : 0) + toll.kr,
      accepted,
      autoStartSoc: autoTarget,
      extraKr,
      chargeOptions: pick?.options ?? [],
      userIndex,
      via,
      tollKr: toll.kr,
      tollLabel: toll.label,
    });
    soc = arriveSoc;
    readyAt = arriveAt;
    plannedStart = arriveAt;
  }
  return out;
}

export function planTotals(legs: PricedLeg[]) {
  return legs.reduce(
    (acc, leg) => {
      acc.mi += leg.route.miles;
      acc.kwh += leg.kwh;
      acc.kr += leg.kr;
      acc.tollKr += leg.tollKr;
      acc.driveMin += leg.route.seconds / 60;
      acc.chargeMin += leg.chargeMin;
      acc.waitMin += leg.waitMin;
      acc.min += leg.route.seconds / 60 + leg.chargeMin + leg.waitMin;
      acc.chargeKwh += leg.accepted && leg.charge ? (leg.charge.kwh ?? 0) : 0;
      acc.requiredKwh += leg.needed ? (leg.charge?.kwh ?? 0) : 0;
      acc.charges += leg.accepted && leg.charge ? 1 : 0;
      return acc;
    },
    {
      mi: 0,
      kwh: 0,
      kr: 0,
      tollKr: 0,
      min: 0,
      driveMin: 0,
      chargeMin: 0,
      waitMin: 0,
      chargeKwh: 0,
      requiredKwh: 0,
      charges: 0,
    },
  );
}

export function minutesToHm(min: number) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (!h) return `${r} min`;
  return `${h} h ${r} min`;
}

export function formatDetour(km: number, units: Units) {
  if (units === "km") return `${km} km`;
  const mi = km / 1.609344;
  return mi < 10 ? `${mi.toFixed(0)} mi` : `${Math.round(mi)} mi`;
}
