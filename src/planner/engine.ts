import { type ChargeLocation } from "@/lib/charge-locations";
import { type HourPrice } from "@/lib/elpris";
import { type Units } from "@/lib/vehicle";
import {
  type LegMode,
  type SpeedEff,
  addDaysYmd,
  addMinutesDateTime,
  addMinutesHhmm,
  asDateTime,
  chargeSearchKm,
  dkNowDateTime,
  dkNowParts,
  driveKwhAtSpeed,
  hoursFrom,
  minutesBetweenDateTime,
  splitDateTime,
  waitMinUntil,
  waitMinUntilDated,
} from "./modes";

export {
  DETOUR_KM,
  LEG_MODES,
  SPEED_KMH,
  addMinutesDateTime,
  addMinutesHhmm,
  asDateTime,
  chargeSearchKm,
  defaultSpeedEff,
  dkNowDateTime,
  driveKwhAtSpeed,
  epaWhPerMi,
  formatDateTime,
  hoursFrom,
  interpolateWhPerMi,
  avgSpeedKmh,
  modeColor,
  modeHint,
  modeLabel,
  type DetourKm,
  type LegMode,
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
};

export const DKK_PER_USD = 6.85;
const RESERVE_SOC = 15;
const TARGET_SOC = 70;
const SUGGEST_SOC = 45;
const CHEAP_VS_LIVE = 0.85;

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function airRoute(from: PlanStop, to: PlanStop): RoutedLeg {
  const m = haversineM(from, to) * 1.22;
  const miles = m / 1609.344;
  return {
    miles,
    seconds: (miles / 42) * 3600,
    path: [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ],
    source: "air",
  };
}

export async function fetchRoute(from: PlanStop, to: PlanStop, mode: LegMode): Promise<RoutedLeg> {
  try {
    const res = await fetch("/api/drive", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        from: { lat: from.lat, lng: from.lng },
        to: { lat: to.lat, lng: to.lng },
        mode,
      }),
    });
    if (!res.ok) return airRoute(from, to);
    const body = (await res.json()) as RoutedLeg;
    if (!body.path?.length || !Number.isFinite(body.miles)) return airRoute(from, to);
    return body;
  } catch {
    return airRoute(from, to);
  }
}

export function driveKwh(miles: number, seconds: number, speedEff: SpeedEff) {
  return driveKwhAtSpeed(miles, seconds, speedEff);
}

export function dkNowHhmm() {
  return dkNowParts().hhmm;
}

export type DatedHour = HourPrice & { ymd: string; estimated?: boolean };

export function minDistToPathM(lat: number, lng: number, path: [number, number][]) {
  if (path.length === 0) return Infinity;
  const step = Math.max(1, Math.floor(path.length / 40));
  let best = Infinity;
  for (let i = 0; i < path.length; i += step) {
    const d = haversineM({ lat, lng }, { lat: path[i][0], lng: path[i][1] });
    if (d < best) best = d;
  }
  const last = path[path.length - 1];
  best = Math.min(best, haversineM({ lat, lng }, { lat: last[0], lng: last[1] }));
  return best;
}

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

function chargerLabel(loc: ChargeLocation) {
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
): PricedCharge {
  if (loc.kind === "supercharger") {
    const rate = usdToKr(loc.usdPerKwh);
    return {
      locationId: loc.id,
      name: loc.short || loc.name,
      kind: loc.kind,
      kwh: kwhNeed,
      kr: kwhNeed * rate,
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
    ? cheapestWindow(hours, kwhNeed, acKw, clockHhmm, maxWaitMin)
    : nowWindow(hours, kwhNeed, acKw);
  const kr = win?.kr ?? kwhNeed * acKr;
  const waitMin = win?.waitMin ?? 0;
  const windowLabel =
    waitMin > 0 && win ? `${win.label} · wait ${minutesToHm(waitMin)}` : (win?.label ?? "live");
  return {
    locationId: loc.id,
    name: loc.short || loc.name,
    kind: loc.kind,
    kwh: kwhNeed,
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
  locations: ChargeLocation[];
  acKr: number;
  hours: HourPrice[];
  acKw: number;
  speedEff: SpeedEff;
  clockHhmm: string;
  maxWaitMin: number;
}): { primary: PricedCharge; backup: PricedCharge | null } | null {
  const { kwhNeed, path, detourKm, mode, locations, acKr, hours, acKw, speedEff, clockHhmm, maxWaitMin } = opts;
  if (kwhNeed <= 0.05 || !locations.length) return null;
  const preferCheap = mode === "cheapest";
  const userBand = Math.max(detourKm * 1000, 80);
  const searchBand = Math.max(chargeSearchKm(mode, detourKm) * 1000, userBand);

  const scored = locations.map((loc) => {
    const distM = minDistToPathM(loc.lat, loc.lng, path);
    const priced = toPriced(
      loc,
      kwhNeed,
      acKr,
      hours,
      acKw,
      distM,
      distM <= userBand,
      preferCheap,
      clockHhmm,
      maxWaitMin,
    );
    return { loc, distM, priced };
  });

  const extraDriveKr = (distM: number) => {
    const miles = distM / 1609.344;
    const seconds = (miles * 1.609344) / 80 * 3600;
    return driveKwh(miles, seconds, speedEff) * acKr;
  };

  const byRank = (a: (typeof scored)[0], b: (typeof scored)[0]) => {
    if (preferCheap) {
      const aCost = a.priced.kr + extraDriveKr(a.distM) * 0.4;
      const bCost = b.priced.kr + extraDriveKr(b.distM) * 0.4;
      return aCost - bCost || a.distM - b.distM;
    }
    const dc = Number(b.loc.kind === "supercharger") - Number(a.loc.kind === "supercharger");
    if (dc) return dc;
    return a.distM - b.distM;
  };

  const inSearch = scored.filter((s) => s.distM <= searchBand).sort(byRank);
  const outside = scored.filter((s) => s.distM > searchBand).sort(byRank);
  const primarySrc = inSearch[0] ?? outside[0];
  if (!primarySrc) return null;

  const backupSrc =
    inSearch.find((s) => s.loc.id !== primarySrc.loc.id) ??
    outside.find((s) => s.loc.id !== primarySrc.loc.id) ??
    null;

  return {
    primary: primarySrc.priced,
    backup: backupSrc
      ? { ...backupSrc.priced, label: backupSrc.priced.inBand ? backupSrc.priced.label : `${backupSrc.priced.label} · farther` }
      : null,
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
}): PricedLeg[] {
  const { stops, modes, detours, routes, usableKwh, locations, hours, acKw, acKr, speedEff } =
    opts;
  const live = hours[0]?.krPerKwh ?? acKr;
  let soc = opts.soc;
  let clock = asDateTime(opts.departHhmm || dkNowDateTime());
  const out: PricedLeg[] = [];
  for (let i = 0; i < routes.length; i++) {
    const mode = modes[i] ?? "standard";
    const route = routes[i];
    const when = opts.legWhen?.[i];
    const whenAt = when && when.kind !== "auto" ? asDateTime(when.at || when.hhmm) : "";
    if (when?.kind === "depart" && whenAt) clock = whenAt;
    if (when?.kind === "arrive" && whenAt) {
      clock = addMinutesDateTime(whenAt, -route.seconds / 60);
    }
    const kwh = driveKwh(route.miles, route.seconds, speedEff);
    const socAfter = soc - (kwh / usableKwh) * 100;
    const required = socAfter < RESERVE_SOC;
    const legHours = hoursFrom(hours, clock);
    const cheap = cheapestHour(legHours);
    const goodPrice = Boolean(cheap && cheap.krPerKwh <= live * CHEAP_VS_LIVE);
    const lowEnough = soc < 55 || socAfter < SUGGEST_SOC;
    const suggested = !required && goodPrice && lowEnough;
    const wantCharge = required || suggested || mode === "cheapest";
    const needSoc = required
      ? Math.max(TARGET_SOC - soc, RESERVE_SOC + (kwh / usableKwh) * 100 - soc)
      : Math.min(TARGET_SOC - soc, Math.max((kwh / usableKwh) * 100, 12));
    const kwhNeed = Math.max(needSoc / 100, 0) * usableKwh;
    const chargeMinEst = (Math.max(kwhNeed, 5) / Math.max(acKw, 1)) * 60;
    const restDriveMin = routes.slice(i).reduce((n, r) => n + r.seconds / 60, 0);
    const maxWaitMin = opts.arriveHhmm
      ? Math.max(0, minutesBetweenDateTime(clock, asDateTime(opts.arriveHhmm)) - chargeMinEst - restDriveMin)
      : 3 * 24 * 60;
    const pick = wantCharge
      ? pickCharges({
          kwhNeed: Math.max(kwhNeed, 5),
          path: route.path,
          detourKm: detours[i] ?? 10,
          mode,
          locations,
          acKr: legHours[0]?.krPerKwh ?? acKr,
          hours: legHours,
          acKw,
          speedEff,
          clockHhmm: clock,
          maxWaitMin,
        })
      : null;
    const charge = pick?.primary ?? null;
    const backup = pick?.backup ?? null;
    const advice: ChargeAdvice = required
      ? "required"
      : suggested || (mode === "cheapest" && charge)
        ? "suggested"
        : null;
    const billed = advice !== null && charge !== null;
    const waitMin = billed && charge && charge.cheapWindow ? charge.waitMin : 0;
    const chargeMin = billed && charge ? (charge.kwh / Math.max(acKw, 1)) * 60 : 0;
    const departAt = clock;
    if (waitMin > 0) clock = addMinutesDateTime(clock, waitMin);
    if (chargeMin > 0) clock = addMinutesDateTime(clock, chargeMin);
    clock = addMinutesDateTime(clock, route.seconds / 60);
    const startSoc = billed && charge ? Math.min(100, soc + (charge.kwh / usableKwh) * 100) : soc;
    const arriveSoc = Math.max(1, startSoc - (kwh / usableKwh) * 100);
    out.push({
      from: stops[i],
      to: stops[i + 1],
      mode,
      detourKm: detours[i] ?? 10,
      route,
      kwh,
      arriveSoc,
      needed: required,
      suggested,
      advice,
      departAt,
      arriveAt: clock,
      chargeMin,
      waitMin,
      startSoc,
      charge,
      backup,
      kr: billed ? (charge?.kr ?? 0) : 0,
    });
    soc = arriveSoc;
  }
  return out;
}

export function planTotals(legs: PricedLeg[]) {
  return legs.reduce(
    (acc, leg) => {
      acc.mi += leg.route.miles;
      acc.kwh += leg.kwh;
      acc.kr += leg.kr;
      acc.driveMin += leg.route.seconds / 60;
      acc.chargeMin += leg.chargeMin;
      acc.waitMin += leg.waitMin;
      acc.min += leg.route.seconds / 60 + leg.chargeMin + leg.waitMin;
      acc.chargeKwh += leg.advice ? (leg.charge?.kwh ?? 0) : 0;
      acc.requiredKwh += leg.needed ? (leg.charge?.kwh ?? 0) : 0;
      acc.charges += leg.advice && leg.charge ? 1 : 0;
      return acc;
    },
    {
      mi: 0,
      kwh: 0,
      kr: 0,
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
