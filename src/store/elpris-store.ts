import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { type PriceArea, SPOT_ONLY_ID, providerById } from "@/lib/el-providers";

type ElprisPrefs = {
  area: PriceArea;
  providerId: string;
  setArea: (area: PriceArea) => void;
  setProviderId: (id: string) => void;
};

export const useElprisStore = create<ElprisPrefs>()(
  persist(
    (set, get) => ({
      area: "DK1",
      providerId: "energi-fyn",
      setArea: (area) => {
        const cur = providerById(get().providerId);
        const nextId = cur.areas.includes(area) ? cur.id : SPOT_ONLY_ID;
        set({ area, providerId: nextId });
      },
      setProviderId: (providerId) => set({ providerId }),
    }),
    {
      name: "juniper-elpris-prefs",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ area: s.area, providerId: s.providerId }),
    },
  ),
);
