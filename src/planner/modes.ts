export const LEG_MODES = ["eco", "fastest", "cheapest"] as const;
export type LegMode = (typeof LEG_MODES)[number];

export function normalizeMode(mode: string | null | undefined): LegMode {
  if (mode === "eco" || mode === "cheapest" || mode === "fastest") return mode;
  return "fastest";
}

export function stallKw(kind: "home" | "supercharger" | "custom", acKw: number) {
  if (kind === "home") return Math.max(1, acKw);
  if (kind === "supercharger") return 150;
  return 75;
}

export const DETOUR_KM = [8, 12, 18, 30] as const;
export type DetourKm = (typeof DETOUR_KM)[number];
export const DEFAULT_DETOUR_KM = 12;

export const WAIT_MIN = [0, 30, 60, 120, 240] as const;
export type WaitMin = (typeof WAIT_MIN)[number];
export const DEFAULT_WAIT_MIN = 120;

export type AutoCosting = {
  shortest: boolean;
  use_highways: number;
  use_tolls: number;
  use_ferry: number;
  use_tracks?: number;
  use_living_streets?: number;
  top_speed?: number;
};

export function modeLabel(mode: LegMode) {
  if (mode === "eco") return "Eco";
  if (mode === "cheapest") return "Cheapest";
  return "Fastest";
}

/** Do not redefine these.
 *  eco = avoid motorways, tolls, road fees as much as possible
 *  fastest = earliest arrival; motorways and tolls are fine
 *  cheapest = lowest charging cost; optional avoid motorways / toll gates / road fees
 */
export function modeHint(mode: LegMode) {
  if (mode === "eco") return "Avoids motorways and tolls. Picks a quieter road even when it is slower.";
  if (mode === "cheapest") return "Lowest charging cost. Max 15 km extra per leg; extra miles are subtracted from the save.";
  return "Motorways and tolls for earliest arrival.";
}

export function modeColor(mode: LegMode) {
  if (mode === "eco") return "#1ecf8a";
  if (mode === "cheapest") return "#e6b84d";
  return "#6ea8ff";
}

export const MODE_FOCUSES = ["distance", "pris", "time"] as const;
export type ModeFocus = (typeof MODE_FOCUSES)[number];

export function defaultFocus(mode: LegMode): ModeFocus {
  if (mode === "cheapest") return "pris";
  if (mode === "fastest") return "time";
  return "distance";
}

export function normalizeFocus(focus: string | null | undefined, mode?: LegMode): ModeFocus {
  if (focus === "kwh") return "pris";
  if (focus === "distance" || focus === "pris" || focus === "time") return focus;
  return defaultFocus(mode ?? "fastest");
}

export const DEFAULT_MODE_FOCUS: Record<LegMode, ModeFocus> = {
  eco: "distance",
  fastest: "time",
  cheapest: "pris",
};

export type CheapAvoid = {
  motorways?: boolean;
  tolls?: boolean;
  roadFees?: boolean;
};

export function asCheapAvoid(raw: boolean | CheapAvoid | null | undefined): Required<CheapAvoid> {
  if (raw === true) return { motorways: true, tolls: true, roadFees: true };
  if (!raw) return { motorways: false, tolls: false, roadFees: false };
  return {
    motorways: Boolean(raw.motorways),
    tolls: Boolean(raw.tolls),
    roadFees: Boolean(raw.roadFees),
  };
}

/** Eco: own corridor. Cheapest: fastest unless Avoid motorways (eco) or avoid gates/fees (own no-toll try). */
export function pathMode(mode: LegMode, avoid: boolean | CheapAvoid = false): LegMode {
  if (mode === "eco") return "eco";
  if (mode === "cheapest") {
    const a = asCheapAvoid(avoid);
    if (a.motorways) return "eco";
    if (a.tolls || a.roadFees) return "cheapest";
  }
  return "fastest";
}

/** Extra drive time cheapest may spend vs Fastest to skip a gate or road fee. */
export const CHEAP_AVOID_FRAC = 0.15;
/** Hard cap: cheapest will not add more than this many km per leg for a stall. */
export const CHEAP_STALL_KM = 15;
/** Extra drive time cheapest may spend vs Fastest to skip a gate or road fee (corridor). */
export const CHEAP_TIME_FRAC = 0.15;
/** Net save must be at least this many times the extra drive cost. */
export const SAVE_WEIGHT = 3;
export const MIN_SAVE_KR = 25;
/** Cheapest takes a stall if net save (after extra miles) is at least this. */
export const STALL_SAVE_KR = 1;
export const STALL_SAVE_WEIGHT = 1;
/** Wear / inconvenience of each extra km, added on top of energy. */
export const EXTRA_KM_KR = 0.6;

export function cheapDetourKm(routeSeconds: number) {
  const km = (Math.max(0, routeSeconds) / 3600) * CHEAP_TIME_FRAC * 80;
  return Math.min(100, Math.max(18, Math.round(km)));
}

/** Energy + km penalty for leaving the line. */
export function extraMileageKr(distM: number, opts?: { acKr?: number; kwh?: number }) {
  const km = Math.max(0, distM) / 1000;
  const acKr = opts?.acKr ?? 2.5;
  const kwh = opts?.kwh ?? km * 0.2;
  return kwh * Math.max(acKr, 1) + km * EXTRA_KM_KR;
}

/** Leave the motorway only if net save beats extra drive by SAVE_WEIGHT. */
export function detourPays(opts: {
  baseKr: number;
  stallKr: number;
  extraKr: number;
  distM: number;
  minSave?: number;
  weight?: number;
}) {
  if (opts.distM <= 5000) return true;
  const minSave = opts.minSave ?? MIN_SAVE_KR;
  const weight = opts.weight ?? SAVE_WEIGHT;
  const net = opts.baseKr - opts.stallKr - opts.extraKr;
  return net >= minSave && net >= opts.extraKr * weight;
}

export function detourSavings(base: { kr: number; tollKr: number; driveMin: number; mi: number }, alt: { kr: number; tollKr: number; driveMin: number; mi: number }) {
  const extraMin = Math.max(0, alt.driveMin - base.driveMin);
  const extraMi = Math.max(0, alt.mi - base.mi);
  const chargeSaved = Math.max(0, base.kr - base.tollKr) - Math.max(0, alt.kr - alt.tollKr);
  const tollSaved = base.tollKr - alt.tollKr;
  const net = base.kr - alt.kr;
  const extraKr = extraMin * 1.2;
  const significant = extraMin < 8 ? net > 0 : net >= MIN_SAVE_KR && net >= extraKr * SAVE_WEIGHT;
  return { extraMin, extraMi, chargeSaved, tollSaved, net, significant };
}

export type AbSide = "a" | "b" | "tie";

/** Eco (or any alt) is penalized when drive time is 2× the faster road. */
export const SLOW_TIME_FACTOR = 2;

export function timePenalized(fastMin: number, altMin: number) {
  return fastMin > 0 && altMin >= fastMin * SLOW_TIME_FACTOR;
}

export function routeAb(
  a: { kr: number; tollKr: number; driveMin: number; mi: number },
  b: { kr: number; tollKr: number; driveMin: number; mi: number },
) {
  const save = detourSavings(a, b);
  const bSlow = timePenalized(a.driveMin, b.driveMin);
  const aSlow = timePenalized(b.driveMin, a.driveMin);
  const time: AbSide =
    Math.abs(a.driveMin - b.driveMin) < 5 ? "tie" : a.driveMin < b.driveMin ? "a" : "b";
  const cost: AbSide = Math.abs(a.kr - b.kr) < MIN_SAVE_KR ? "tie" : a.kr < b.kr ? "a" : "b";
  let overall: AbSide =
    save.significant && b.kr < a.kr ? "b" : save.significant && a.kr < b.kr ? "a" : time === "tie" ? cost : cost === "tie" ? time : time;
  if (bSlow && !aSlow) overall = "a";
  if (aSlow && !bSlow) overall = "b";
  return { save, time, cost, overall, aSlow, bSlow };
}

/** Eco is off the motorway — look farther toward services. Cheapest hunts a wider band. */
export function chargeSearchKm(mode: LegMode, detourKm: number, focus?: ModeFocus, routeSeconds?: number) {
  const km = Math.max(8, detourKm);
  if (mode === "eco" || focus === "distance") return Math.max(30, Math.round(km * 2.2));
  if (mode === "cheapest" || focus === "pris") return CHEAP_STALL_KM;
  return Math.max(18, km);
}

/** Lower is a better fit for this focus. */
export function chargeFitScore(
  focus: ModeFocus,
  opts: { distM: number; kr: number; dc: boolean; extraDriveKr?: number; extraKwh?: number },
) {
  const distKm = Math.max(0, opts.distM) / 1000;
  const kr = Math.max(0, opts.kr);
  const extra = opts.extraDriveKr ?? 0;
  if (focus === "time") {
    const kmh = opts.dc ? 130 : 80;
    const detourMin = (distKm / kmh) * 60;
    return detourMin + (opts.dc ? 0 : 14);
  }
  if (focus === "pris") return kr + extra;
  return distKm * 14 + (opts.dc ? 1.5 : 0) + kr * 0.04;
}

export function formatWaitCap(min: number) {
  if (min <= 0) return "0";
  if (min < 60) return `${min}m`;
  const h = min / 60;
  return Number.isInteger(h) ? `${h}h` : `${min} min`;
}

export const SPEED_KMH = [50, 80, 110, 130] as const;
export type SpeedKmh = (typeof SPEED_KMH)[number];
/** kWh / 100 km at each posted speed. */
export type SpeedEff = Record<SpeedKmh, number>;

/** 1 kWh/100 km = 0.0161 kWh/mile */
export const KWH_100KM_TO_KWH_MI = 0.0161;

export function kwhPerMiFrom100km(kwhPer100km: number) {
  return Math.max(0, kwhPer100km) * KWH_100KM_TO_KWH_MI;
}

export function defaultSpeedEff(epaWhPerMi: number): SpeedEff {
  const kwhMi = (epaWhPerMi > 0 ? epaWhPerMi : 240) / 1000;
  const base = kwhMi / KWH_100KM_TO_KWH_MI;
  return {
    50: round1(base * 0.82),
    80: round1(base),
    110: round1(base * 1.18),
    130: round1(base * 1.38),
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** Old drafts stored Wh/mi (~180–340). New values are kWh/100 km (~8–30). */
export function normalizeSpeedEff(raw: SpeedEff | null | undefined, epaWhPerMi: number): SpeedEff {
  const fallback = defaultSpeedEff(epaWhPerMi);
  if (!raw) return fallback;
  const sample = raw[80] ?? raw[110] ?? 0;
  if (sample > 40) {
    return {
      50: round1((raw[50] / 1000) / KWH_100KM_TO_KWH_MI),
      80: round1((raw[80] / 1000) / KWH_100KM_TO_KWH_MI),
      110: round1((raw[110] / 1000) / KWH_100KM_TO_KWH_MI),
      130: round1((raw[130] / 1000) / KWH_100KM_TO_KWH_MI),
    };
  }
  return {
    50: raw[50] ?? fallback[50],
    80: raw[80] ?? fallback[80],
    110: raw[110] ?? fallback[110],
    130: raw[130] ?? fallback[130],
  };
}

export function avgSpeedKmh(miles: number, seconds: number) {
  if (!(miles > 0) || !(seconds > 0)) return 80;
  return (miles * 1.609344) / (seconds / 3600);
}

export function interpolateKwhPer100km(eff: SpeedEff, kmh: number) {
  const pts = SPEED_KMH.map((k) => [k, eff[k]] as const);
  if (kmh <= pts[0][0]) return pts[0][1];
  const last = pts[pts.length - 1];
  if (kmh >= last[0]) return last[1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [k0, w0] = pts[i];
    const [k1, w1] = pts[i + 1];
    if (kmh <= k1) {
      const t = (kmh - k0) / (k1 - k0);
      return w0 + t * (w1 - w0);
    }
  }
  return last[1];
}

export function interpolateWhPerMi(eff: SpeedEff, kmh: number) {
  return kwhPerMiFrom100km(interpolateKwhPer100km(eff, kmh)) * 1000;
}

export function driveKwhAtSpeed(miles: number, seconds: number, eff: SpeedEff) {
  const kmh = avgSpeedKmh(miles, seconds);
  return miles * kwhPerMiFrom100km(interpolateKwhPer100km(eff, kmh));
}

export function epaWhPerMi(usableKwh: number, epaRangeMi: number) {
  if (epaRangeMi <= 0) return 240;
  return (usableKwh / epaRangeMi) * 1000;
}

export function parseHhmm(hhmm: string) {
  const [h, m] = hhmm.split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return ((h % 24) * 60 + (m % 60) + 24 * 60) % (24 * 60);
}

export function formatHhmm(totalMin: number) {
  const wrapped = ((Math.round(totalMin) % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function addMinutesHhmm(hhmm: string, add: number) {
  return formatHhmm(parseHhmm(hhmm) + add);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function dkNowParts(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Copenhagen",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hourRaw = g("hour");
  const hour = hourRaw === "24" ? "00" : hourRaw;
  return {
    ymd: `${g("year")}-${g("month")}-${g("day")}`,
    hhmm: `${hour.padStart(2, "0")}:${g("minute").padStart(2, "0")}`,
  };
}

export function dkNowDateTime(at = new Date()) {
  const p = dkNowParts(at);
  return `${p.ymd}T${p.hhmm}`;
}

export function asDateTime(value: string, fallback = dkNowDateTime()) {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16);
  if (/^\d{2}:\d{2}$/.test(value)) return `${dkNowParts().ymd}T${value}`;
  return fallback;
}

export function splitDateTime(value: string) {
  const dt = asDateTime(value);
  const [ymd, hhmm] = dt.split("T");
  return { ymd: ymd || dkNowParts().ymd, hhmm: hhmm || "00:00" };
}

export function formatDateTime(value: string) {
  const { ymd, hhmm } = splitDateTime(value);
  const [, m, d] = ymd.split("-");
  return `${d}/${m} ${hhmm}`;
}

function ymdToUtc(ymd: string, min = 0) {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) + min * 60_000;
}

export function addDaysYmd(ymd: string, days: number) {
  const t = new Date(ymdToUtc(ymd) + days * 86_400_000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

export function addMinutesDateTime(value: string, add: number) {
  const { ymd, hhmm } = splitDateTime(value);
  const t = new Date(ymdToUtc(ymd, parseHhmm(hhmm)) + add * 60_000);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}T${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

export function minutesBetweenDateTime(from: string, to: string) {
  const a = splitDateTime(from);
  const b = splitDateTime(to);
  return Math.round((ymdToUtc(b.ymd, parseHhmm(b.hhmm)) - ymdToUtc(a.ymd, parseHhmm(a.hhmm))) / 60_000);
}

export function maxDateTime(a: string, b: string) {
  return minutesBetweenDateTime(a, b) >= 0 ? b : a;
}

/** Wait that actually pushes leave later vs charging as soon as the car is ready. */
export function waitDelayMin(opts: {
  readyAt: string;
  plannedStart: string;
  windowStart: string;
  chargeMin: number;
}) {
  const chargeNowDone = addMinutesDateTime(opts.readyAt, opts.chargeMin);
  const driveIfNow =
    minutesBetweenDateTime(opts.plannedStart, chargeNowDone) > 0 ? chargeNowDone : opts.plannedStart;
  const windowStart =
    minutesBetweenDateTime(opts.readyAt, opts.windowStart) > 0 ? opts.windowStart : opts.readyAt;
  const cheapDone = addMinutesDateTime(windowStart, opts.chargeMin);
  const driveIfCheap =
    minutesBetweenDateTime(opts.plannedStart, cheapDone) > 0 ? cheapDone : opts.plannedStart;
  return Math.max(0, minutesBetweenDateTime(driveIfNow, driveIfCheap));
}

/** Minutes to wait from clock until startHour:00. 0 if that hour is already in progress. */
export function waitMinUntil(clockHhmm: string, startHour: string) {
  const clock = parseHhmm(clockHhmm);
  const startH = Number(startHour);
  if (!Number.isFinite(startH)) return 0;
  const clockH = Math.floor(clock / 60);
  if (startH === clockH) return 0;
  const start = (((startH % 24) + 24) % 24) * 60;
  let diff = start - clock;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

export function waitMinUntilDated(clockDt: string, startYmd: string, startHour: string) {
  const start = `${startYmd}T${String(startHour).padStart(2, "0")}:00`;
  return Math.max(0, minutesBetweenDateTime(clockDt, start));
}

export function minutesAhead(fromHhmm: string, toHhmm: string) {
  let diff = parseHhmm(toHhmm) - parseHhmm(fromHhmm);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

export function hoursFrom<T extends { hour: string; ymd?: string }>(hours: T[], clock: string) {
  if (!hours.length) return [];
  const dt = asDateTime(clock);
  const { ymd, hhmm } = splitDateTime(dt);
  const hour = hhmm.slice(0, 2).padStart(2, "0");
  if (hours.some((h) => h.ymd)) {
    const idx = hours.findIndex((h) => (h.ymd ?? "") > ymd || (h.ymd === ymd && h.hour >= hour));
    return idx >= 0 ? hours.slice(idx) : hours.slice(-Math.min(24, hours.length));
  }
  const exact = hours.findIndex((h) => h.hour === hour);
  if (exact >= 0) return hours.slice(exact);
  const next = hours.findIndex((h) => h.hour > hour);
  return next >= 0 ? hours.slice(next) : hours;
}

/** Eco tries to skip motorways and tolls. Fastest takes the highway. Cheapest follows the avoid toggles. */
export function costingFor(mode: LegMode, avoid: boolean | CheapAvoid = false): AutoCosting {
  const a = asCheapAvoid(avoid);
  if (mode === "eco" || (mode === "cheapest" && a.motorways)) {
    return {
      shortest: false,
      use_highways: 0.25,
      use_tolls: mode === "eco" || a.tolls ? 0 : 1,
      use_ferry: 0.2,
    };
  }
  return {
    shortest: false,
    use_highways: 1,
    use_tolls: mode === "cheapest" && a.tolls ? 0 : 1,
    use_ferry: 0.1,
    use_tracks: 0,
    use_living_streets: 0,
    top_speed: 130,
  };
}
