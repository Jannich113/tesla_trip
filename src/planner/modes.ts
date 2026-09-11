export const LEG_MODES = ["eco", "fastest", "cheapest"] as const;
export type LegMode = (typeof LEG_MODES)[number];

export function normalizeMode(mode: string | null | undefined): LegMode {
  if (mode === "eco" || mode === "cheapest" || mode === "fastest") return mode;
  return "fastest";
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
  top_speed?: number;
};

export function modeLabel(mode: LegMode) {
  if (mode === "eco") return "Eco";
  if (mode === "cheapest") return "Cheapest";
  return "Fastest";
}

export function modeHint(mode: LegMode) {
  if (mode === "eco") return "Most efficient path — shorter roads, fewer highways and tolls";
  if (mode === "cheapest") return "Uses the fastest roads, then hunts cheaper charging nearby";
  return "Highways and tolls for earliest arrival";
}

export function modeColor(mode: LegMode) {
  if (mode === "eco") return "#1ecf8a";
  if (mode === "cheapest") return "#e6b84d";
  return "#6ea8ff";
}

export const MODE_FOCUSES = ["distance", "pris", "time"] as const;
export type ModeFocus = (typeof MODE_FOCUSES)[number];

export function defaultFocus(mode: LegMode): ModeFocus {
  if (mode === "cheapest") return "time";
  if (mode === "fastest") return "pris";
  return "distance";
}

export function normalizeFocus(focus: string | null | undefined, mode?: LegMode): ModeFocus {
  if (focus === "kwh") return "pris";
  if (focus === "distance" || focus === "pris" || focus === "time") return focus;
  return defaultFocus(mode ?? "fastest");
}

export function focusLabel(focus: ModeFocus) {
  if (focus === "pris") return "Pris";
  if (focus === "time") return "Time";
  return "Distance";
}

export function focusHint(focus: ModeFocus) {
  if (focus === "pris") return "Lowest kr for the charge plus extra drive";
  if (focus === "time") return "Least extra minutes — highway DC, small detour";
  return "Closest stall on this road";
}

export const DEFAULT_MODE_FOCUS: Record<LegMode, ModeFocus> = {
  eco: "distance",
  fastest: "pris",
  cheapest: "time",
};

/** Pris may look a bit farther for a cheaper stall. */
export function chargeSearchKm(_mode: LegMode, detourKm: number, focus?: ModeFocus) {
  const km = Math.max(0, detourKm);
  if (focus === "pris") return Math.max(km, Math.round(km * 1.25));
  return km;
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
    const detourMin = distKm / 1.2;
    return detourMin + (opts.dc ? 0 : 12) + extra * 0.02;
  }
  if (focus === "pris") return kr + extra * 0.45 + distKm * 0.8;
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
/** Wh per mile at each posted speed. */
export type SpeedEff = Record<SpeedKmh, number>;

export function defaultSpeedEff(epaWhPerMi: number): SpeedEff {
  const base = epaWhPerMi > 0 ? epaWhPerMi : 240;
  return {
    50: Math.round(base * 0.78),
    80: Math.round(base * 0.95),
    110: Math.round(base * 1.18),
    130: Math.round(base * 1.42),
  };
}

export function avgSpeedKmh(miles: number, seconds: number) {
  if (!(miles > 0) || !(seconds > 0)) return 80;
  return (miles * 1.609344) / (seconds / 3600);
}

export function interpolateWhPerMi(eff: SpeedEff, kmh: number) {
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

export function driveKwhAtSpeed(miles: number, seconds: number, eff: SpeedEff) {
  const kmh = avgSpeedKmh(miles, seconds);
  return (miles * interpolateWhPerMi(eff, kmh)) / 1000;
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

/** Eco = efficient distance. Standard/cheapest = recommended time. Fastest = time on highways. */
export function costingFor(mode: LegMode): AutoCosting {
  if (mode === "eco") {
    return {
      shortest: true,
      use_highways: 0.1,
      use_tolls: 0,
      use_ferry: 0.25,
    };
  }
  return {
    shortest: false,
    use_highways: 1,
    use_tolls: 1,
    use_ferry: 0.15,
    top_speed: 140,
  };
}
