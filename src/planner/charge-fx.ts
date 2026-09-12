export type PriceCcy = "EUR" | "DKK" | "NOK";

export type FxTable = {
  EUR: number;
  DKK: number;
  NOK: number;
};

export const CATALOG_FX: FxTable = {
  EUR: 7.46,
  DKK: 1,
  NOK: 0.64,
};

export type NativeTariff = {
  ccy: PriceCcy;
  spot: number;
  abo: number;
  monthly: number;
  roam: number | null;
  roamAbo?: number | null;
};

export const NETWORK_NATIVE: Record<string, NativeTariff> = {
  tesla: { ccy: "EUR", spot: 0.55, abo: 0.42, monthly: 0, roam: null },
  ionity: { ccy: "EUR", spot: 0.79, abo: 0.35, monthly: 11.99, roam: null },
  fastned: { ccy: "EUR", spot: 0.69, abo: 0.49, monthly: 11.99, roam: null },
  allego: { ccy: "EUR", spot: 0.76, abo: 0.52, monthly: 9.99, roam: 0.79, roamAbo: 0.79 },
  electra: { ccy: "EUR", spot: 0.69, abo: 0.34, monthly: 4.99, roam: 0.79, roamAbo: 0.64 },
  enbw: { ccy: "EUR", spot: 0.59, abo: 0.44, monthly: 5.99, roam: 0.73, roamAbo: 0.73 },
  clever: { ccy: "DKK", spot: 4.99, abo: 0, monthly: 799, roam: 5.49, roamAbo: 3.75 },
  eon: { ccy: "DKK", spot: 3.95, abo: 3.45, monthly: 99, roam: 5.89, roamAbo: 5.3 },
  spirii: { ccy: "DKK", spot: 3.7, abo: 2.99, monthly: 49, roam: 3.7, roamAbo: 2.99 },
  mer: { ccy: "NOK", spot: 6.29, abo: 6.29, monthly: 69, roam: null },
  recharge: { ccy: "NOK", spot: 6.49, abo: 4.79, monthly: 69, roam: 7.5, roamAbo: 6.2 },
  kople: { ccy: "NOK", spot: 6.39, abo: 5.49, monthly: 49, roam: 7, roamAbo: 6.5 },
  eviny: { ccy: "NOK", spot: 5.89, abo: 5.89, monthly: 0, roam: null },
  circlek: { ccy: "NOK", spot: 6.29, abo: 5.99, monthly: 49, roam: null },
  unox: { ccy: "NOK", spot: 5.5, abo: 5.5, monthly: 0, roam: null },
  shell: { ccy: "EUR", spot: 0.69, abo: 0.55, monthly: 7.99, roam: 0.79, roamAbo: 0.79 },
  aral: { ccy: "EUR", spot: 0.79, abo: 0.59, monthly: 4.99, roam: 0.79, roamAbo: 0.79 },
  total: { ccy: "EUR", spot: 0.59, abo: 0.49, monthly: 3.9, roam: 0.69, roamAbo: 0.69 },
};

export function toDkk(amount: number, ccy: PriceCcy, fx: FxTable) {
  return Math.round(amount * fx[ccy] * 1000) / 1000;
}

export function scaleCatalogKr(kr: number, ccy: PriceCcy, fx: FxTable) {
  const catalog = CATALOG_FX[ccy];
  if (!catalog) return kr;
  return Math.round(kr * (fx[ccy] / catalog) * 1000) / 1000;
}