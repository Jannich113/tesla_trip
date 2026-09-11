export const PERIODS = ["day", "week", "month", "year", "total"] as const;
export type Period = (typeof PERIODS)[number];

export const HOME_USD_PER_KWH = 0.289;
export const SC_USD_PER_KWH = 0.448;
export const DELIVERED_DAY = "2025-03-18";
export const TZ = "America/Los_Angeles";

export type Trip = {
  id: string;
  day: string;
  hour: number;
  minute: number;
  from: string;
  to: string;
  mi: number;
  kwh: number;
  min: number;
};

export type ChargeSession = {
  id: string;
  day: string;
  hour: number;
  minute: number;
  where: string;
  kwh: number;
  min: number;
  peakKw: number;
  addedMi: number;
  kind: "home" | "supercharger" | "custom";
  usd: number;
};

export type TripTotals = {
  count: number;
  mi: number;
  kwh: number;
  min: number;
};

export type ChargeTotals = {
  count: number;
  kwh: number;
  usd: number;
  homeKwh: number;
  homeUsd: number;
  scKwh: number;
  scUsd: number;
  otherKwh: number;
  otherUsd: number;
  addedMi: number;
};

const WEEKEND: { to: string; from: string; mi: number; kwh: number; min: number }[] = [
  { from: "Home", to: "Whole Foods, Los Altos", mi: 4.2, kwh: 0.98, min: 12 },
  { from: "Home", to: "Stanford Dish", mi: 8.6, kwh: 2.02, min: 18 },
  { from: "Home", to: "Costco, Mountain View", mi: 6.8, kwh: 1.61, min: 16 },
  { from: "Home", to: "Palo Alto", mi: 5.4, kwh: 1.28, min: 14 },
  { from: "Home", to: "Half Moon Bay", mi: 34.7, kwh: 8.92, min: 48 },
  { from: "Home", to: "SF Embarcadero", mi: 38.6, kwh: 10.8, min: 54 },
  { from: "Home", to: "Santa Cruz", mi: 48.2, kwh: 13.4, min: 62 },
  { from: "Home", to: "Gilroy Outlets", mi: 52.4, kwh: 14.1, min: 58 },
  { from: "Home", to: "Muir Woods", mi: 46.1, kwh: 12.6, min: 68 },
  { from: "Home", to: "Napa", mi: 78.4, kwh: 21.8, min: 95 },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function laDayString(ms = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function addDays(day: string, n: number) {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function weekday(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function isHoliday(day: string) {
  const md = day.slice(5);
  return md === "01-01" || md === "07-04" || md === "12-25" || md === "11-27" || md === "11-28";
}

export function periodStart(period: Period, today = laDayString()) {
  if (period === "day") return today;
  if (period === "week") return addDays(today, -6);
  if (period === "month") return `${today.slice(0, 7)}-01`;
  if (period === "year") return `${today.slice(0, 4)}-01-01`;
  return DELIVERED_DAY;
}

export function inPeriod(day: string, period: Period, today = laDayString()) {
  return day >= periodStart(period, today) && day <= today;
}

function formatClock(hour: number, minute: number) {
  const h = hour % 12 || 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${h}:${String(minute).padStart(2, "0")} ${ampm}`;
}

export function formatDayLabel(day: string, today = laDayString()) {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const thisYear = today.slice(0, 4) === day.slice(0, 4);
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: thisYear ? undefined : "numeric",
    timeZone: "UTC",
  });
}

export function formatWhen(day: string, hour: number, minute: number, today = laDayString()) {
  return `${formatDayLabel(day, today)} · ${formatClock(hour, minute)}`;
}

export function formatDayRange(first: string, last: string, today = laDayString()) {
  if (first === last) return formatDayLabel(first, today);
  return `${formatDayLabel(first, today)} – ${formatDayLabel(last, today)}`;
}

export function formatUsd(n: number, digits = 2) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCents(n: number) {
  return `${(n * 100).toFixed(1)}¢/kWh`;
}

function buildHistory() {
  const today = laDayString();
  const rand = rng(184273);
  const trips: Trip[] = [];
  const charges: ChargeSession[] = [];
  let tripN = 0;
  let chargeN = 0;
  let longTripCounter = 0;

  const pushTrip = (t: Omit<Trip, "id">) => {
    tripN += 1;
    trips.push({ id: `t${tripN}`, ...t });
  };
  const pushCharge = (c: Omit<ChargeSession, "id" | "usd" | "addedMi">) => {
    chargeN += 1;
    const rate = c.kind === "home" ? HOME_USD_PER_KWH : SC_USD_PER_KWH;
    charges.push({
      id: `c${chargeN}`,
      ...c,
      addedMi: Math.round(c.kwh / 0.241),
      usd: Math.round(c.kwh * rate * 100) / 100,
    });
  };

  for (let day = DELIVERED_DAY; day <= today; day = addDays(day, 1)) {
    const wd = weekday(day);
    const r = rand();

    if (day === today) {
      pushTrip({
        day,
        hour: 8,
        minute: 41,
        from: "Home",
        to: "Work · Mountain View",
        mi: 11.8,
        kwh: 2.84,
        min: 22,
      });
      pushTrip({
        day,
        hour: 18,
        minute: 14,
        from: "Home",
        to: "Whole Foods, Los Altos",
        mi: 4.2,
        kwh: 0.98,
        min: 12,
      });
      pushCharge({
        day,
        hour: 2,
        minute: 10,
        where: "Home Wall Connector",
        kwh: 28.4,
        min: 154,
        peakKw: 11.5,
        kind: "home",
      });
      continue;
    }

    if (wd >= 1 && wd <= 5 && !isHoliday(day)) {
      const amJitter = Math.floor(rand() * 18);
      const pmJitter = Math.floor(rand() * 28);
      const miOut = 11.4 + rand() * 1.3;
      const miIn = 11.5 + rand() * 1.4;
      pushTrip({
        day,
        hour: 8,
        minute: 22 + amJitter,
        from: "Home",
        to: "Work · Mountain View",
        mi: Math.round(miOut * 10) / 10,
        kwh: Math.round(miOut * 0.241 * 100) / 100,
        min: 18 + Math.floor(rand() * 10),
      });
      pushTrip({
        day,
        hour: 17,
        minute: 40 + (pmJitter % 20),
        from: "Work · Mountain View",
        to: "Home",
        mi: Math.round(miIn * 10) / 10,
        kwh: Math.round(miIn * 0.241 * 100) / 100,
        min: 19 + Math.floor(rand() * 12),
      });
      if (r > 0.82) {
        const extra = WEEKEND[Math.floor(rand() * 4)];
        pushTrip({
          day,
          hour: 19,
          minute: 10 + Math.floor(rand() * 40),
          from: extra.from,
          to: extra.to,
          mi: extra.mi,
          kwh: extra.kwh,
          min: extra.min,
        });
      }
    } else {
      const n = r > 0.35 ? (rand() > 0.55 ? 2 : 1) : 0;
      for (let i = 0; i < n; i++) {
        longTripCounter += 1;
        const useLong = longTripCounter % 5 === 0;
        const extra = WEEKEND[useLong ? 4 + Math.floor(rand() * 6) : Math.floor(rand() * 4)];
        pushTrip({
          day,
          hour: 10 + i * 4 + Math.floor(rand() * 2),
          minute: Math.floor(rand() * 50),
          from: extra.from,
          to: extra.to,
          mi: extra.mi,
          kwh: extra.kwh,
          min: extra.min,
        });
        if (extra.mi > 40) {
          pushCharge({
            day,
            hour: 15,
            minute: 20 + Math.floor(rand() * 25),
            where:
              extra.to.includes("Gilroy")
                ? "Gilroy Supercharger"
                : extra.to.includes("Cruz")
                  ? "Santa Cruz Supercharger"
                  : extra.to.includes("Napa")
                    ? "Napa Supercharger"
                    : extra.to.includes("SF")
                      ? "San Francisco Supercharger"
                      : "San Jose Supercharger",
            kwh: Math.round((18 + rand() * 28) * 10) / 10,
            min: 14 + Math.floor(rand() * 18),
            peakKw: 188 + Math.floor(rand() * 40),
            kind: "supercharger",
          });
        }
      }
    }

    if (wd !== 0 && rand() > 0.48) {
      pushCharge({
        day,
        hour: 1,
        minute: Math.floor(rand() * 40),
        where: "Home Wall Connector",
        kwh: Math.round((8 + rand() * 10) * 10) / 10,
        min: 70 + Math.floor(rand() * 70),
        peakKw: 11.5,
        kind: "home",
      });
    }
  }

  trips.sort((a, b) => (a.day === b.day ? b.hour - a.hour : a.day < b.day ? 1 : -1));
  charges.sort((a, b) => (a.day === b.day ? b.hour - a.hour : a.day < b.day ? 1 : -1));
  return { trips, charges };
}

const HISTORY = buildHistory();
export const TRIPS = HISTORY.trips;
export const CHARGES = HISTORY.charges;

export function tripsIn(period: Period, today = laDayString()) {
  return TRIPS.filter((t) => inPeriod(t.day, period, today));
}

export function tripsInRange(start: string, end: string) {
  const a = start <= end ? start : end;
  const b = start <= end ? end : start;
  return TRIPS.filter((t) => t.day >= a && t.day <= b);
}

export type EnergyDay = {
  key: string;
  label: string;
  driveKwh: number;
  chargeKwh: number;
  chargeUsd: number;
  mi: number;
  trips: number;
};

function emptyEnergy(key: string, label: string): EnergyDay {
  return { key, label, driveKwh: 0, chargeKwh: 0, chargeUsd: 0, mi: 0, trips: 0 };
}

export function dailyEnergy(
  trips: Trip[],
  sessions: ChargeSession[],
  today = laDayString(),
  range?: { start: string; end: string; fill?: boolean },
): EnergyDay[] {
  const map = new Map<string, EnergyDay>();
  const ensure = (day: string) => {
    let row = map.get(day);
    if (!row) {
      row = emptyEnergy(day, formatDayLabel(day, today));
      map.set(day, row);
    }
    return row;
  };
  const start = range ? (range.start <= range.end ? range.start : range.end) : undefined;
  const end = range ? (range.start <= range.end ? range.end : range.start) : undefined;
  if (start && end && range?.fill) {
    for (let day = start; day <= end; day = addDays(day, 1)) ensure(day);
  }
  for (const t of trips) {
    if (start && end && (t.day < start || t.day > end)) continue;
    const row = ensure(t.day);
    row.driveKwh += t.kwh;
    row.mi += t.mi;
    row.trips += 1;
  }
  for (const c of sessions) {
    if (start && end && (c.day < start || c.day > end)) continue;
    const row = ensure(c.day);
    row.chargeKwh += c.kwh;
    row.chargeUsd += c.usd;
  }
  return [...map.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
}

export function periodEnergy(
  period: Period,
  sessions: ChargeSession[],
  today = laDayString(),
): EnergyDay[] {
  if (period === "year" || period === "total") {
    const map = emptyBuckets(period, today);
    const out = new Map<string, EnergyDay>();
    for (const b of map.values()) out.set(b.key, emptyEnergy(b.key, b.label));
    for (const t of tripsIn(period, today)) {
      const row = out.get(labelFor(t.day, period).key);
      if (!row) continue;
      row.driveKwh += t.kwh;
      row.mi += t.mi;
      row.trips += 1;
    }
    for (const c of chargesInFrom(sessions, period, today)) {
      const row = out.get(labelFor(c.day, period).key);
      if (!row) continue;
      row.chargeKwh += c.kwh;
      row.chargeUsd += c.usd;
    }
    return [...out.values()];
  }
  const start = periodStart(period, today);
  return dailyEnergy(tripsIn(period, today), chargesInFrom(sessions, period, today), today, {
    start,
    end: today,
    fill: true,
  });
}

export function chargesInFrom(sessions: ChargeSession[], period: Period, today = laDayString()) {
  return sessions.filter((c) => inPeriod(c.day, period, today));
}

export function chargesIn(period: Period, today = laDayString()) {
  return chargesInFrom(CHARGES, period, today);
}

export function emptyChargeTotals(): ChargeTotals {
  return {
    count: 0,
    kwh: 0,
    usd: 0,
    homeKwh: 0,
    homeUsd: 0,
    scKwh: 0,
    scUsd: 0,
    otherKwh: 0,
    otherUsd: 0,
    addedMi: 0,
  };
}

export function chargeTotalsFrom(sessions: ChargeSession[], period: Period, today = laDayString()): ChargeTotals {
  return chargesInFrom(sessions, period, today).reduce((acc, c) => {
    acc.count += 1;
    acc.kwh += c.kwh;
    acc.usd += c.usd;
    acc.addedMi += c.addedMi;
    if (c.kind === "home") {
      acc.homeKwh += c.kwh;
      acc.homeUsd += c.usd;
    } else if (c.kind === "supercharger") {
      acc.scKwh += c.kwh;
      acc.scUsd += c.usd;
    } else {
      acc.otherKwh += c.kwh;
      acc.otherUsd += c.usd;
    }
    return acc;
  }, emptyChargeTotals());
}

export function chargeTotals(period: Period, today = laDayString()): ChargeTotals {
  return chargeTotalsFrom(CHARGES, period, today);
}

export function tripTotals(period: Period, today = laDayString()): TripTotals {
  return tripsIn(period, today).reduce(
    (acc, t) => {
      acc.count += 1;
      acc.mi += t.mi;
      acc.kwh += t.kwh;
      acc.min += t.min;
      return acc;
    },
    { count: 0, mi: 0, kwh: 0, min: 0 },
  );
}

export type Bucket = { label: string; key: string; mi: number; kwh: number; usd: number };

function labelFor(day: string, period: Period) {
  if (period === "year" || period === "total") {
    const [y, m] = day.split("-");
    const dt = new Date(Date.UTC(Number(y), Number(m) - 1, 1));
    return {
      key: day.slice(0, 7),
      label: dt.toLocaleDateString("en-US", {
        month: "short",
        year: period === "total" ? "2-digit" : undefined,
        timeZone: "UTC",
      }),
    };
  }
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    key: day,
    label: dt.toLocaleDateString("en-US", {
      weekday: period === "week" || period === "day" ? "short" : undefined,
      day: "numeric",
      timeZone: "UTC",
    }),
  };
}

function emptyBuckets(period: Period, today: string) {
  const start = periodStart(period, today);
  const map = new Map<string, Bucket>();
  for (let day = start; day <= today; day = addDays(day, 1)) {
    const { key, label } = labelFor(day, period);
    if (!map.has(key)) map.set(key, { label, key, mi: 0, kwh: 0, usd: 0 });
  }
  return map;
}

export function chargeBuckets(period: Period, today = laDayString()): Bucket[] {
  const map = emptyBuckets(period, today);
  for (const c of chargesIn(period, today)) {
    const b = map.get(labelFor(c.day, period).key);
    if (b) {
      b.kwh += c.kwh;
      b.usd += c.usd;
      b.mi += c.addedMi;
    }
  }
  return [...map.values()];
}

export function tripBuckets(period: Period, today = laDayString()): Bucket[] {
  const map = emptyBuckets(period, today);
  for (const t of tripsIn(period, today)) {
    const b = map.get(labelFor(t.day, period).key);
    if (b) {
      b.mi += t.mi;
      b.kwh += t.kwh;
    }
  }
  return [...map.values()];
}

export function groupTrips(period: Period, today = laDayString()) {
  const list = tripsIn(period, today);
  const groups: { day: string; label: string; items: Trip[] }[] = [];
  for (const t of list) {
    const last = groups[groups.length - 1];
    if (last && last.day === t.day) last.items.push(t);
    else groups.push({ day: t.day, label: formatDayLabel(t.day, today), items: [t] });
  }
  return groups;
}

export function periodCaption(period: Period, today = laDayString()) {
  if (period === "day") return formatDayLabel(today, today);
  if (period === "week") return `${formatDayLabel(periodStart(period, today), today)} – today`;
  if (period === "month") {
    const [y, m] = today.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  if (period === "year") return today.slice(0, 4);
  return `Since ${formatDayLabel(DELIVERED_DAY, today)}`;
}

export type Corridor = {
  key: string;
  from: string;
  to: string;
  count: number;
  mi: number;
  kwh: number;
  last: Trip;
};

export function tripCorridors(period: Period, today = laDayString()): Corridor[] {
  const map = new Map<string, Corridor>();
  for (const t of tripsIn(period, today)) {
    const key = `${t.from}→${t.to}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { key, from: t.from, to: t.to, count: 1, mi: t.mi, kwh: t.kwh, last: t });
    } else {
      prev.count += 1;
      prev.mi += t.mi;
      prev.kwh += t.kwh;
      if (t.day > prev.last.day || (t.day === prev.last.day && t.hour >= prev.last.hour)) {
        prev.last = t;
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.mi - a.mi);
}

export type ChargeRank = {
  where: string;
  kind: "home" | "supercharger" | "custom";
  count: number;
  kwh: number;
  usd: number;
  lastDay: string;
};

export function chargeRanksFrom(sessions: ChargeSession[], period: Period, today = laDayString()): ChargeRank[] {
  const map = new Map<string, ChargeRank>();
  for (const c of chargesInFrom(sessions, period, today)) {
    const prev = map.get(c.where);
    if (!prev) {
      map.set(c.where, {
        where: c.where,
        kind: c.kind,
        count: 1,
        kwh: c.kwh,
        usd: c.usd,
        lastDay: c.day,
      });
    } else {
      prev.count += 1;
      prev.kwh += c.kwh;
      prev.usd += c.usd;
      if (c.day > prev.lastDay) prev.lastDay = c.day;
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.kwh - a.kwh);
}

export function chargeRanks(period: Period, today = laDayString()): ChargeRank[] {
  return chargeRanksFrom(CHARGES, period, today);
}

