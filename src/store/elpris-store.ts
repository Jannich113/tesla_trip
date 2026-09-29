import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { type PriceArea, SPOT_ONLY_ID, providerById } from "@/lib/el-providers";
import {
  countryOf,
  defaultArea,
  isPriceArea,
  isPriceCountry,
  areasForCountry,
  type PriceCountry,
} from "@/lib/price-areas";

type ElprisPrefs = {
  country: PriceCountry;
  area: PriceArea;
  providerId: string;
  setCountry: (country: PriceCountry) => void;
  setArea: (area: PriceArea) => void;
  setProviderId: (id: string) => void;
};

type SavedPrefs = {
  country: PriceCountry;
  area: PriceArea;
  providerId: string;
};

function providerFor(area: PriceArea, providerId: string) {
  const current = providerById(providerId);
  return current.areas.includes(area) ? current.id : SPOT_ONLY_ID;
}

function normalizePrefs(raw: { area?: string; country?: string; providerId?: string }): SavedPrefs {
  const area = isPriceArea(raw.area) ? raw.area : "DK1";
  const country = isPriceCountry(raw.country) ? raw.country : countryOf(area);
  const alignedArea = countryOf(area) === country ? area : defaultArea(country);
  return {
    area: alignedArea,
    country: countryOf(alignedArea),
    providerId: raw.providerId ?? "energi-fyn",
  };
}

export const useElprisStore = create<ElprisPrefs>()(
  persist(
    (set, get) => ({
      country: "DK",
      area: "DK1",
      providerId: "energi-fyn",
      setCountry: (country) => {
        const options = areasForCountry(country);
        const area = options.some((a) => a.id === get().area) ? get().area : options[0].id;
        set({ country, area, providerId: providerFor(area, get().providerId) });
      },
      setArea: (area) => {
        set({
          area,
          country: countryOf(area),
          providerId: providerFor(area, get().providerId),
        });
      },
      setProviderId: (providerId) => set({ providerId }),
    }),
    {
      name: "juniper-elpris-prefs",
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (s) => ({ area: s.area, country: s.country, providerId: s.providerId }),
      migrate: (persisted) => normalizePrefs((persisted ?? {}) as SavedPrefs),
    },
  ),
);
