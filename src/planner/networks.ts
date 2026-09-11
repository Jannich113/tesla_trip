/** EU public charging networks. Rates in DKK/kWh. Spot = ad-hoc, abo = membership. */
const EUR = 7.46;

function dkkFromEur(eur: number) {
  return Math.round(eur * EUR * 1000) / 1000;
}

export type ChargeNetwork = {
  id: string;
  name: string;
  region: string;
  spotKr: number;
  aboKr: number;
  aboMonthlyKr: number;
  aboName: string;
  unlimited?: boolean;
  note: string;
};

export const EU_NETWORKS: ChargeNetwork[] = [
  {
    id: "tesla",
    name: "Tesla Supercharger",
    region: "EU",
    spotKr: dkkFromEur(0.55),
    aboKr: dkkFromEur(0.42),
    aboMonthlyKr: 0,
    aboName: "Tesla vehicle",
    note: "Owner rate vs other brands. No monthly fee — flag if this car is Tesla.",
  },
  {
    id: "ionity",
    name: "IONITY",
    region: "EU highways",
    spotKr: dkkFromEur(0.79),
    aboKr: dkkFromEur(0.35),
    aboMonthlyKr: dkkFromEur(11.99),
    aboName: "IONITY Power",
    note: "Ad-hoc is among the dearest HPC in Europe. Power drops the kWh a lot.",
  },
  {
    id: "fastned",
    name: "Fastned",
    region: "NL · DE · BE · UK · FR",
    spotKr: dkkFromEur(0.69),
    aboKr: dkkFromEur(0.49),
    aboMonthlyKr: dkkFromEur(11.99),
    aboName: "Fastned Gold",
    note: "App is a bit under card. Gold is ~30% off.",
  },
  {
    id: "allego",
    name: "Allego",
    region: "NL · DE · BE · FR",
    spotKr: dkkFromEur(0.76),
    aboKr: dkkFromEur(0.52),
    aboMonthlyKr: dkkFromEur(9.99),
    aboName: "Allego Plus",
    note: "Ultra-fast ad-hoc vs Plus membership on own stalls.",
  },
  {
    id: "electra",
    name: "Electra",
    region: "FR · BE · DE · IT",
    spotKr: dkkFromEur(0.69),
    aboKr: dkkFromEur(0.34),
    aboMonthlyKr: dkkFromEur(4.99),
    aboName: "Electra+ Smart",
    note: "Card ad-hoc is higher. Smart also discounts ChargeLeague partners.",
  },
  {
    id: "enbw",
    name: "EnBW HyperNetz",
    region: "DE · AT · CH",
    spotKr: dkkFromEur(0.59),
    aboKr: dkkFromEur(0.44),
    aboMonthlyKr: dkkFromEur(5.99),
    aboName: "mobility+ M",
    note: "Big DE network. Tariff M is the usual abo vs ad-hoc app.",
  },
  {
    id: "clever",
    name: "Clever",
    region: "DK · SE",
    spotKr: 4.99,
    aboKr: 0,
    aboMonthlyKr: 799,
    aboName: "Clever One",
    unlimited: true,
    note: "One is unlimited kWh (incl. many partners). Trip kWh cost is 0; monthly fee is separate.",
  },
  {
    id: "eon",
    name: "E.ON Drive",
    region: "DK · DE · SE",
    spotKr: 3.95,
    aboKr: 3.45,
    aboMonthlyKr: 99,
    aboName: "E.ON abo",
    note: "Danish public AC/DC. Abo knocks a bit off the kWh.",
  },
  {
    id: "spirii",
    name: "Spirii",
    region: "DK · EU roaming",
    spotKr: 3.7,
    aboKr: 2.99,
    aboMonthlyKr: 49,
    aboName: "Spirii Plus",
    note: "App roaming. Plus is the cheaper kWh on partner stalls.",
  },
  {
    id: "shell",
    name: "Shell Recharge",
    region: "EU",
    spotKr: dkkFromEur(0.69),
    aboKr: dkkFromEur(0.55),
    aboMonthlyKr: dkkFromEur(7.99),
    aboName: "e-Deal / Electroverse",
    note: "Ad-hoc vs membership / tank card.",
  },
  {
    id: "aral",
    name: "Aral pulse",
    region: "DE",
    spotKr: dkkFromEur(0.79),
    aboKr: dkkFromEur(0.59),
    aboMonthlyKr: dkkFromEur(4.99),
    aboName: "pulse Extra",
    note: "Classic ad-hoc is steep. Extra and ADAC e-Charge cut it.",
  },
  {
    id: "total",
    name: "TotalEnergies",
    region: "FR · BE · NL · DE",
    spotKr: dkkFromEur(0.59),
    aboKr: dkkFromEur(0.49),
    aboMonthlyKr: dkkFromEur(3.9),
    aboName: "Option Zen",
    note: "Per-site rates vary. Zen is the light monthly cut.",
  },
];

export function networkById(id: string) {
  return EU_NETWORKS.find((n) => n.id === id) ?? null;
}

export function networkIdFor(kind: string, networkId?: string | null) {
  if (networkId) return networkId;
  if (kind === "supercharger") return "tesla";
  return null;
}

export function rateForNetwork(id: string, hasAbo: boolean) {
  const n = networkById(id);
  if (!n) return null;
  return hasAbo ? n.aboKr : n.spotKr;
}

export function networkLabel(id: string, hasAbo: boolean) {
  const n = networkById(id);
  if (!n) return "Network";
  return hasAbo ? n.aboName : `${n.name} ad-hoc`;
}
