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
  /** DC at other CPOs with this contract. null = own network only. */
  roamKr: number | null;
  /** Roam rate when abo is on. Falls back to roamKr. */
  roamAboKr?: number | null;
  roamNote: string;
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
    roamKr: null,
    roamNote: "Own Superchargers only. No Hubject/OCPI roam.",
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
    roamKr: null,
    roamNote: "Passport is IONITY stalls only. Roaming in is via other eMSPs — usually +0.15–0.25 €/kWh.",
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
    roamKr: null,
    roamNote: "Gold and the app are Fastned sites only. No roam-out.",
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
    roamKr: dkkFromEur(0.79),
    roamAboKr: dkkFromEur(0.79),
    roamNote: "Plus is own Allego. Foreign CPO via app sits near ad-hoc HPC.",
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
    roamKr: dkkFromEur(0.79),
    roamAboKr: dkkFromEur(0.64),
    roamNote: "App at EnBW/Shell ~0.79 €. Smart ChargeLeague partners ~0.64 €.",
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
    roamKr: dkkFromEur(0.73),
    roamAboKr: dkkFromEur(0.73),
    roamNote: "Own HyperNetz drops with M/L. Roaming stays ~0.73 € even on abo.",
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
    roamKr: 5.49,
    roamAboKr: 3.75,
    roamNote: "One includes DK partners at 0. IONITY abroad 3.75 kr/kWh on One, 5.49 on other plans.",
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
    roamKr: dkkFromEur(0.79),
    roamAboKr: dkkFromEur(0.71),
    roamNote: "Own DK/DE is cheaper. Roam-out More ~0.71 €, Light ~0.79 €.",
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
    roamKr: 3.7,
    roamAboKr: 2.99,
    roamNote: "Spirii is an eMSP. The listed kWh is already roaming on partner stalls.",
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
    roamKr: dkkFromEur(0.79),
    roamAboKr: dkkFromEur(0.79),
    roamNote: "e-Deal cuts Shell-owned. Other CPOs stay ~0.79 € + sometimes a session fee.",
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
    roamKr: dkkFromEur(0.79),
    roamAboKr: dkkFromEur(0.79),
    roamNote: "Extra is Aral. Roam-out stays at the classic ~0.79 €.",
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
    roamKr: dkkFromEur(0.69),
    roamAboKr: dkkFromEur(0.69),
    roamNote: "Zen is Total sites. Roam-out is closer to ad-hoc HPC.",
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

export function roamRate(n: ChargeNetwork, hasAbo: boolean) {
  if (hasAbo && n.roamAboKr != null) return n.roamAboKr;
  return n.roamKr;
}

/** Extra kr/kWh vs own-network rate. null if this contract does not roam out. */
export function roamExtra(n: ChargeNetwork, hasAbo: boolean) {
  const roam = roamRate(n, hasAbo);
  if (roam == null) return null;
  const own = hasAbo ? n.aboKr : n.spotKr;
  return roam - own;
}

export function networkLabel(id: string, hasAbo: boolean) {
  const n = networkById(id);
  if (!n) return "Network";
  return hasAbo ? n.aboName : `${n.name} ad-hoc`;
}
