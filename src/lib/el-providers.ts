/**
 * Danish electricity retailers for Elpris.
 * Tillæg figures are approximate consumer quotes (~Sep 2026), often inkl. moms
 * on retailer sites. Nord Pool spot from EDS is ekskl. moms — we add tillæg as-is
 * for relative comparison and label that this is not full forbrugerpris.
 */

export type PriceArea = "DK1" | "DK2";

export type ElProvider = {
  id: string;
  name: string;
  product: string;
  /** Spot tillæg in øre/kWh (ca., often quoted inkl. moms). */
  tillægOre: number;
  /** Monthly subscription kr (ca., display only). */
  aboKr: number;
  areas: PriceArea[];
  note?: string;
};

export const PRICE_AREAS: { id: PriceArea; label: string; hint: string }[] = [
  { id: "DK1", label: "DK1", hint: "Vest · Jylland & Fyn" },
  { id: "DK2", label: "DK2", hint: "Øst · Sjælland & Bornholm" },
];

export const SPOT_ONLY_ID = "spot";

export const EL_PROVIDERS: ElProvider[] = [
  {
    id: SPOT_ONLY_ID,
    name: "Nord Pool spot",
    product: "Uden tillæg",
    tillægOre: 0,
    aboKr: 0,
    areas: ["DK1", "DK2"],
    note: "Ren day-ahead spot (ekskl. moms)",
  },
  {
    id: "energi-fyn",
    name: "Energi Fyn",
    product: "SpotEL",
    tillægOre: 8.75,
    aboKr: 15,
    areas: ["DK1", "DK2"],
  },
  {
    id: "ok",
    name: "OK",
    product: "OK El Højt Forbrug",
    tillægOre: 0,
    aboKr: 49,
    areas: ["DK1", "DK2"],
    note: "Lavt forbrug-aftale har højere tillæg",
  },
  {
    id: "norlys",
    name: "Norlys",
    product: "FlexEl",
    tillægOre: 9.7,
    aboKr: 29,
    areas: ["DK1", "DK2"],
  },
  {
    id: "andel",
    name: "Andel Energi",
    product: "FlexEnergi",
    tillægOre: 14.63,
    aboKr: 20,
    areas: ["DK1", "DK2"],
  },
  {
    id: "nrgi",
    name: "NRGi",
    product: "NRGi Time",
    tillægOre: 9.0,
    aboKr: 29,
    areas: ["DK1", "DK2"],
  },
  {
    id: "aura",
    name: "AURA Energi",
    product: "FlexEl",
    tillægOre: 10.0,
    aboKr: 21,
    areas: ["DK1", "DK2"],
  },
  {
    id: "aura-power",
    name: "AURA Energi",
    product: "POWER",
    tillægOre: 0,
    aboKr: 49,
    areas: ["DK1", "DK2"],
  },
  {
    id: "ewii",
    name: "EWII",
    product: "Plus El",
    tillægOre: 6.5,
    aboKr: 29,
    areas: ["DK1", "DK2"],
    note: "Grøn tillæg kan komme oveni",
  },
  {
    id: "sef",
    name: "SEF Energi",
    product: "BareEl",
    tillægOre: 0,
    aboKr: 39,
    areas: ["DK1", "DK2"],
  },
  {
    id: "clever",
    name: "Clever",
    product: "Clever Power",
    tillægOre: 0,
    aboKr: 59,
    areas: ["DK1", "DK2"],
    note: "Uden avance — abo. højere",
  },
  {
    id: "altid",
    name: "Altid Energi",
    product: "Spot",
    tillægOre: 0,
    aboKr: 18,
    areas: ["DK1", "DK2"],
  },
  {
    id: "vindstod",
    name: "Vindstød",
    product: "Vind",
    tillægOre: 5,
    aboKr: 0,
    areas: ["DK1", "DK2"],
    note: "Grøn profil — tillæg ca.",
  },
  {
    id: "nettopower",
    name: "Nettopower",
    product: "Spot",
    tillægOre: 4,
    aboKr: 0,
    areas: ["DK1", "DK2"],
  },
  {
    id: "modstrom",
    name: "Modstrøm",
    product: "Spot",
    tillægOre: 10,
    aboKr: 0,
    areas: ["DK1", "DK2"],
  },
];

export function providerById(id: string): ElProvider {
  return EL_PROVIDERS.find((p) => p.id === id) ?? EL_PROVIDERS[0];
}

export function providersForArea(area: PriceArea): ElProvider[] {
  return EL_PROVIDERS.filter((p) => p.areas.includes(area));
}

/** Apply retailer tillæg (øre → kr) onto spot kr/kWh. */
export function withTillæg(krPerKwh: number, tillægOre: number) {
  return krPerKwh + tillægOre / 100;
}

export function applyTillægToHours<T extends { krPerKwh: number; orePerKwh: number }>(
  hours: T[],
  tillægOre: number,
): T[] {
  return hours.map((h) => {
    const kr = withTillæg(h.krPerKwh, tillægOre);
    return { ...h, krPerKwh: kr, orePerKwh: kr * 100 };
  });
}
