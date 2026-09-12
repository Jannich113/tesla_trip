import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { toast } from "sonner";
import {
  type ChargeKind,
  type ChargeLocation,
  HOME_LOCATION_ID,
  PRESET_LOCATIONS,
  clampRadius,
  defaultRadius,
  inferCoords,
  inferKind,
  inferRate,
  matchLocation,
  resolveChargeLocation,
  round2,
  round3,
  uniqueLocationId,
  withRadius,
} from "@/lib/charge-locations";
import {
  type ChargeSession,
  type Period,
  chargeRanksFrom,
  chargeTotalsFrom,
  formatCents,
  formatUsd,
  getCharges,
  laDayString,
} from "@/lib/history";
import { VEHICLE, energyKwh } from "@/lib/vehicle";
import { bindChargeBridge } from "@/store/vehicle-store";

export type LoggedSession = ChargeSession & { locationId: string };

type ChargeState = {
  locations: ChargeLocation[];
  logged: LoggedSession[];
  chargeAtId: string;
  chargeStartSoc: number | null;
  sessionSeq: number;
};

type ChargeStore = ChargeState & {
  setChargeAt: (id: string) => void;
  addLocation: (input: {
    name: string;
    usdPerKwh: number;
    lat: number;
    lng: number;
    kind?: ChargeKind;
    radiusM?: number;
  }) => ChargeLocation;
  updateLocation: (
    id: string,
    patch: Partial<Pick<ChargeLocation, "name" | "short" | "usdPerKwh" | "lat" | "lng" | "radiusM">>,
  ) => void;
  removeLocation: (id: string) => void;
  beginCharge: (soc: number) => void;
  endCharge: (soc: number, where?: string) => void;
  logFromCar: (
    kwh: number,
    peakKw: number,
    where?: string,
    at?: { lat: number; lng: number },
  ) => LoggedSession | null;
  clearOwnerData: () => void;
};

function mergePresets(saved: ChargeLocation[] | undefined): ChargeLocation[] {
  const list = saved?.length ? saved : PRESET_LOCATIONS;
  const byId = new Map(list.map((l) => [l.id, l]));
  for (const preset of PRESET_LOCATIONS) {
    if (!byId.has(preset.id)) byId.set(preset.id, preset);
  }
  return [...byId.values()].map((l) => {
    const loc = withRadius(l);
    if (!loc.preset && loc.kind === "home" && !/home|wall connector/i.test(loc.name)) {
      return { ...loc, kind: "custom" as const, radiusM: loc.radiusM || defaultRadius("custom") };
    }
    return loc;
  });
}

function priceSession(session: ChargeSession & { locationId?: string }, locations: ChargeLocation[]): ChargeSession {
  const byId = session.locationId ? locations.find((l) => l.id === session.locationId) : undefined;
  const loc = byId ?? resolveChargeLocation(locations, { where: session.where });
  if (!loc) return session;
  return {
    ...session,
    where: loc.name,
    usd: round2(session.kwh * loc.usdPerKwh),
    kind: loc.kind,
  };
}

let pricedCache: { locations: ChargeLocation[]; logged: LoggedSession[]; rows: ChargeSession[] } | null = null;

export function pricedSessions(locations: ChargeLocation[], logged: LoggedSession[]): ChargeSession[] {
  if (pricedCache && pricedCache.locations === locations && pricedCache.logged === logged) {
    return pricedCache.rows;
  }
  const extra = logged.map((s) => priceSession(s, locations));
  const hist = getCharges().map((s) => priceSession(s, locations));
  const rows = [...extra, ...hist].sort((a, b) => (a.day === b.day ? b.hour - a.hour : a.day < b.day ? 1 : -1));
  pricedCache = { locations, logged, rows };
  return rows;
}

export const useChargeStore = create<ChargeStore>()(
  persist(
    (set, get) => ({
      locations: PRESET_LOCATIONS,
      logged: [],
      chargeAtId: HOME_LOCATION_ID,
      chargeStartSoc: null,
      sessionSeq: 0,

      setChargeAt: (id) => set({ chargeAtId: id }),

      addLocation: (input) => {
        const name = input.name.trim();
        const existing = matchLocation(name, get().locations);
        if (existing) {
          const next = {
            ...existing,
            usdPerKwh: input.usdPerKwh,
            lat: input.lat,
            lng: input.lng,
            radiusM: clampRadius(input.radiusM ?? existing.radiusM),
          };
          set({
            locations: get().locations.map((l) => (l.id === existing.id ? next : l)),
            chargeAtId: existing.id,
          });
          return next;
        }
        const kind = input.kind ?? inferKind(name);
        const loc: ChargeLocation = {
          id: uniqueLocationId(name, get().locations),
          name,
          short: name.split(",")[0].split("·")[0].trim() || name,
          usdPerKwh: input.usdPerKwh,
          lat: input.lat,
          lng: input.lng,
          kind,
          preset: false,
          radiusM: clampRadius(input.radiusM ?? defaultRadius(kind)),
        };
        set({ locations: [...get().locations, loc], chargeAtId: loc.id });
        return loc;
      },

      updateLocation: (id, patch) => {
        set({
          locations: get().locations.map((l) => {
            if (l.id !== id) return l;
            const next = { ...l, ...patch };
            if (patch.radiusM != null) next.radiusM = clampRadius(patch.radiusM);
            return next;
          }),
        });
      },

      removeLocation: (id) => {
        const loc = get().locations.find((l) => l.id === id);
        if (!loc || loc.preset) return;
        set({
          locations: get().locations.filter((l) => l.id !== id),
          chargeAtId: get().chargeAtId === id ? HOME_LOCATION_ID : get().chargeAtId,
        });
      },

      beginCharge: (soc) => set({ chargeStartSoc: soc }),

      endCharge: (soc, where) => {
        const start = get().chargeStartSoc;
        if (start == null) return;
        const kwh = round3(energyKwh(soc) - energyKwh(start));
        set({ chargeStartSoc: null });
        if (kwh >= 0.01) {
          const selected = get().locations.find((l) => l.id === get().chargeAtId);
          const named = where ? inferCoords(where) : undefined;
          get().logFromCar(kwh, 11.5, where, {
            lat: named?.lat ?? selected?.lat ?? PRESET_LOCATIONS[0].lat,
            lng: named?.lng ?? selected?.lng ?? PRESET_LOCATIONS[0].lng,
          });
        }
      },

      logFromCar: (kwh, peakKw, where, at) => {
        const energy = round3(kwh);
        if (energy < 0.01) return null;
        const now = new Date();
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Los_Angeles",
          hour: "numeric",
          minute: "numeric",
          hour12: false,
        }).formatToParts(now);
        const hour = Number(parts.find((p) => p.type === "hour")?.value ?? now.getHours()) % 24;
        const minute = Number(parts.find((p) => p.type === "minute")?.value ?? now.getMinutes());

        let loc = resolveChargeLocation(get().locations, { where, lat: at?.lat, lng: at?.lng });

        if (!loc && where && where !== "On the road") {
          const coords = at ?? inferCoords(where);
          loc = get().addLocation({
            name: /supercharger|connector|charger/i.test(where) ? where : `${where} charger`,
            usdPerKwh: inferRate(inferKind(where)),
            lat: coords.lat,
            lng: coords.lng,
          });
        }

        if (!loc) loc = get().locations.find((l) => l.id === get().chargeAtId) ?? get().locations[0];
        if (!loc) return null;

        const seq = get().sessionSeq + 1;
        const session: LoggedSession = {
          id: `live-${seq}`,
          locationId: loc.id,
          day: laDayString(),
          hour,
          minute,
          where: loc.name,
          kwh: energy,
          min: Math.max(1, Math.round((energy / Math.max(peakKw, 1)) * 60)),
          peakKw,
          addedMi: Math.round(energy / 0.241),
          kind: loc.kind,
          usd: round2(energy * loc.usdPerKwh),
        };
        set({ logged: [session, ...get().logged], sessionSeq: seq, chargeAtId: loc.id });
        toast.success(`Logged ${energy >= 0.1 ? energy.toFixed(1) : energy.toFixed(2)} kWh at ${loc.short}`, {
          description: `${formatUsd(session.usd)} · ${formatCents(loc.usdPerKwh)}`,
        });
        return session;
      },

      clearOwnerData: () =>
        set({
          locations: PRESET_LOCATIONS,
          logged: [],
          chargeAtId: HOME_LOCATION_ID,
          chargeStartSoc: null,
        }),
    }),
    {
      name: "juniper-charge-locations",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      merge: (persisted, current) => {
        const saved = persisted as Partial<ChargeState> | undefined;
        return {
          ...current,
          ...saved,
          locations: mergePresets(saved?.locations),
          logged: saved?.logged ?? [],
          chargeAtId: saved?.chargeAtId ?? HOME_LOCATION_ID,
          chargeStartSoc: saved?.chargeStartSoc ?? null,
          sessionSeq: saved?.sessionSeq ?? 0,
        };
      },
      partialize: (s) => ({
        locations: s.locations,
        logged: s.logged,
        chargeAtId: s.chargeAtId,
        chargeStartSoc: s.chargeStartSoc,
        sessionSeq: s.sessionSeq,
      }),
    },
  ),
);

bindChargeBridge({
  beginCharge: (soc) => useChargeStore.getState().beginCharge(soc),
  endCharge: (soc, where) => useChargeStore.getState().endCharge(soc, where),
  siteLabel: () => {
    const s = useChargeStore.getState();
    return s.locations.find((l) => l.id === s.chargeAtId)?.short ?? VEHICLE.home.label;
  },
});

export function ranksFor(
  locations: ChargeLocation[],
  logged: LoggedSession[],
  period: Period,
  today = laDayString(),
) {
  const sessions = pricedSessions(locations, logged);
  const ranked = chargeRanksFrom(sessions, period, today);
  const byName = new Map(ranked.map((r) => [r.where, r]));
  return locations
    .map((loc) => {
      const row = byName.get(loc.name);
      return {
        id: loc.id,
        where: loc.name,
        short: loc.short,
        kind: loc.kind,
        count: row?.count ?? 0,
        kwh: row?.kwh ?? 0,
        usd: row?.usd ?? 0,
        lastDay: row?.lastDay ?? "",
        usdPerKwh: loc.usdPerKwh,
        lat: loc.lat,
        lng: loc.lng,
        radiusM: loc.radiusM,
        preset: loc.preset,
      };
    })
    .sort((a, b) => b.count - a.count || b.kwh - a.kwh || a.where.localeCompare(b.where))
    .filter((row) => row.count > 0 || !row.preset || row.kind === "home" || period === "total");
}

export function totalsFor(
  locations: ChargeLocation[],
  logged: LoggedSession[],
  period: Period,
  today = laDayString(),
) {
  return chargeTotalsFrom(pricedSessions(locations, logged), period, today);
}
