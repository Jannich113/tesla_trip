import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  CHARGES,
  HOME_USD_PER_KWH,
  TRIPS,
  type ChargeSession,
  type Trip,
  formatDayLabel,
} from "@/lib/history";
import { geo } from "@/lib/places";

export type TripAlbum = {
  id: string;
  name: string;
  tripIds: string[];
  startDay?: string;
  endDay?: string;
};

export type AlbumDay = {
  day: string;
  label: string;
  count: number;
  mi: number;
  kwh: number;
  min: number;
};

export type AlbumPlace = {
  name: string;
  short: string;
  count: number;
  mi: number;
  kwh: number;
};

export type AlbumCharge = {
  where: string;
  kind: ChargeSession["kind"];
  count: number;
  kwh: number;
  usd: number;
};

export type AlbumInsight = {
  count: number;
  mi: number;
  kwh: number;
  min: number;
  days: AlbumDay[];
  firstDay: string;
  lastDay: string;
  places: AlbumPlace[];
  farthest: Trip | null;
  charges: AlbumCharge[];
  chargeKwh: number;
  chargeUsd: number;
  chargeCount: number;
  driveUsd: number;
  rate: number;
};

type TripState = {
  albums: TripAlbum[];
  seq: number;
};

type TripStore = TripState & {
  addAlbum: (
    name: string,
    tripIds: string[],
    range?: { startDay: string; endDay: string },
  ) => TripAlbum | null;
  renameAlbum: (id: string, name: string) => void;
  removeAlbum: (id: string) => void;
  setAlbumTrips: (id: string, tripIds: string[]) => void;
  clearOwnerData: () => void;
};

function uniqueIds(ids: string[]) {
  return [...new Set(ids.filter((id) => TRIPS.some((t) => t.id === id)))];
}

function tokens(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2 && !["the", "and", "supercharger", "wall", "connector"].includes(w));
}

function linked(a: string, b: string) {
  const right = new Set(tokens(b));
  return tokens(a).some((t) => right.has(t));
}

export function albumTrips(album: TripAlbum): Trip[] {
  const set = new Set(album.tripIds);
  return TRIPS.filter((t) => set.has(t.id));
}

export function albumInsight(
  trips: Trip[],
  sessions: ChargeSession[] = CHARGES,
  today = trips[0]?.day ?? "",
): AlbumInsight | null {
  if (!trips.length) return null;

  const sorted = [...trips].sort((a, b) => (a.day === b.day ? a.hour - b.hour : a.day < b.day ? -1 : 1));
  const daysMap = new Map<string, AlbumDay>();
  const placeMap = new Map<string, AlbumPlace>();
  const placeNames: string[] = [];
  let farthest: Trip | null = null;
  let mi = 0;
  let kwh = 0;
  let min = 0;

  for (const t of sorted) {
    mi += t.mi;
    kwh += t.kwh;
    min += t.min;
    if (!farthest || t.mi > farthest.mi) farthest = t;
    const day = daysMap.get(t.day) ?? {
      day: t.day,
      label: formatDayLabel(t.day, today),
      count: 0,
      mi: 0,
      kwh: 0,
      min: 0,
    };
    day.count += 1;
    day.mi += t.mi;
    day.kwh += t.kwh;
    day.min += t.min;
    daysMap.set(t.day, day);
    placeNames.push(t.from, t.to);
    const prev = placeMap.get(t.to) ?? {
      name: t.to,
      short: geo(t.to)?.short ?? t.to.split(" · ")[0].split(",")[0],
      count: 0,
      mi: 0,
      kwh: 0,
    };
    prev.count += 1;
    prev.mi += t.mi;
    prev.kwh += t.kwh;
    placeMap.set(t.to, prev);
  }

  const daySet = new Set(daysMap.keys());
  const chargeMap = new Map<string, AlbumCharge>();
  for (const c of sessions) {
    if (!daySet.has(c.day)) continue;
    if (!placeNames.some((p) => linked(p, c.where))) continue;
    const prev = chargeMap.get(c.where) ?? {
      where: c.where,
      kind: c.kind,
      count: 0,
      kwh: 0,
      usd: 0,
    };
    prev.count += 1;
    prev.kwh += c.kwh;
    prev.usd += c.usd;
    chargeMap.set(c.where, prev);
  }
  const charges = [...chargeMap.values()].sort((a, b) => b.usd - a.usd || b.kwh - a.kwh);
  const chargeKwh = charges.reduce((n, c) => n + c.kwh, 0);
  const chargeUsd = charges.reduce((n, c) => n + c.usd, 0);
  const rate = chargeKwh > 0.05 ? chargeUsd / chargeKwh : HOME_USD_PER_KWH;

  return {
    count: trips.length,
    mi,
    kwh,
    min,
    days: [...daysMap.values()].sort((a, b) => (a.day < b.day ? -1 : 1)),
    firstDay: sorted[0].day,
    lastDay: sorted[sorted.length - 1].day,
    places: [...placeMap.values()].sort((a, b) => b.mi - a.mi || b.count - a.count),
    farthest,
    charges,
    chargeKwh,
    chargeUsd,
    chargeCount: charges.reduce((n, c) => n + c.count, 0),
    driveUsd: kwh * rate,
    rate,
  };
}

export function albumTotals(album: TripAlbum) {
  const insight = albumInsight(albumTrips(album), []);
  return insight ?? { count: 0, mi: 0, kwh: 0, min: 0 };
}

export function albumOfTrip(albums: TripAlbum[], tripId: string) {
  return albums.find((a) => a.tripIds.includes(tripId));
}

export const useTripStore = create<TripStore>()(
  persist(
    (set, get) => ({
      albums: [],
      seq: 0,

      addAlbum: (name, tripIds, range) => {
        const label = name.trim();
        const ids = uniqueIds(tripIds);
        if (!label || ids.length === 0) return null;
        const startDay = range ? (range.startDay <= range.endDay ? range.startDay : range.endDay) : undefined;
        const endDay = range ? (range.startDay <= range.endDay ? range.endDay : range.startDay) : undefined;
        const id = `alb-${get().seq + 1}`;
        const album: TripAlbum = { id, name: label, tripIds: ids, startDay, endDay };
        set({
          seq: get().seq + 1,
          albums: [
            album,
            ...get()
              .albums.map((a) => ({
                ...a,
                tripIds: a.tripIds.filter((t) => !ids.includes(t)),
              }))
              .filter((a) => a.tripIds.length > 0),
          ],
        });
        return album;
      },

      renameAlbum: (id, name) => {
        const label = name.trim();
        if (!label) return;
        set({
          albums: get().albums.map((a) => (a.id === id ? { ...a, name: label } : a)),
        });
      },

      removeAlbum: (id) => {
        set({ albums: get().albums.filter((a) => a.id !== id) });
      },

      clearOwnerData: () => set({ albums: [], seq: 0 }),

      setAlbumTrips: (id, tripIds) => {
        const ids = uniqueIds(tripIds);
        if (ids.length === 0) {
          get().removeAlbum(id);
          return;
        }
        set({
          albums: get()
            .albums.map((a) => {
              if (a.id === id) return { ...a, tripIds: ids };
              return { ...a, tripIds: a.tripIds.filter((t) => !ids.includes(t)) };
            })
            .filter((a) => a.tripIds.length > 0),
        });
      },
    }),
    {
      name: "juniper-trip-albums",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({ albums: s.albums, seq: s.seq }),
    },
  ),
);
