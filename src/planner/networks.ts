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
    id: "mer",
    name: "Mer / Recharge",
    region: "NO · SE · FI",
    spotKr: dkkFromEur(0.4),
    aboKr: dkkFromEur(0.32),
    aboMonthlyKr: dkkFromEur(4.99),
    aboName: "Mer Plus",
    roamKr: dkkFromEur(0.55),
    roamAboKr: dkkFromEur(0.48),
    roamNote: "Own Nordic HPC is cheap. Roam-out on the continent sits nearer EU HPC.",
    note: "Biggest Norwegian CPO (ex Fortum Charge & Drive). Abo is Mer Plus.",
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

export type EuRegion =
  | "DK"
  | "SE"
  | "FI"
  | "EE"
  | "LV"
  | "LT"
  | "DE"
  | "AT"
  | "NL"
  | "BE"
  | "LU"
  | "FR"
  | "IE"
  | "IT"
  | "ES"
  | "PT"
  | "GR"
  | "MT"
  | "CY"
  | "PL"
  | "CZ"
  | "SK"
  | "HU"
  | "RO"
  | "BG"
  | "HR"
  | "SI"
  | "UK"
  | "NO"
  | "CH"
  | "IS"
  | "FO"
  | "LI"
  | "AD"
  | "MC"
  | "SM"
  | "AL"
  | "BA"
  | "MK"
  | "ME"
  | "RS"
  | "XK"
  | "UA"
  | "MD"
  | "BY"
  | "RU"
  | "TR";

export type EuBloc =
  | "nordic"
  | "baltics"
  | "dach"
  | "benelux"
  | "west"
  | "south"
  | "east"
  | "balkans"
  | "steppe"
  | "near";

export const EU_BLOCS: { id: EuBloc; label: string; ids: readonly EuRegion[] }[] = [
  { id: "nordic", label: "Nordics", ids: ["DK", "SE", "FI", "NO", "IS", "FO"] },
  { id: "baltics", label: "Baltics", ids: ["EE", "LV", "LT"] },
  { id: "dach", label: "DACH", ids: ["DE", "AT", "LI"] },
  { id: "benelux", label: "Benelux", ids: ["NL", "BE", "LU"] },
  { id: "west", label: "West", ids: ["FR", "IE", "AD", "MC"] },
  { id: "south", label: "South", ids: ["IT", "ES", "PT", "GR", "MT", "CY", "SM"] },
  { id: "east", label: "East EU", ids: ["PL", "CZ", "SK", "HU", "RO", "BG", "HR", "SI"] },
  { id: "balkans", label: "Balkans", ids: ["AL", "BA", "MK", "ME", "RS", "XK"] },
  { id: "steppe", label: "East", ids: ["UA", "MD", "BY", "RU", "TR"] },
  { id: "near", label: "Near", ids: ["UK", "CH"] },
];

export const EU_REGIONS: { id: EuRegion; label: EuRegion; bloc: EuBloc }[] = EU_BLOCS.flatMap((b) =>
  b.ids.map((id) => ({ id, label: id, bloc: b.id })),
);

type MarketCell = { own: number | null; roam: number | null };

function cell(own: number | null, roam: number | null): MarketCell {
  return { own, roam };
}

function spread(
  byBloc: Partial<Record<EuBloc, MarketCell>>,
  extra: Partial<Record<EuRegion, MarketCell>> = {},
): Partial<Record<EuRegion, MarketCell>> {
  const out: Partial<Record<EuRegion, MarketCell>> = {};
  for (const bloc of EU_BLOCS) {
    const g = byBloc[bloc.id];
    if (!g) continue;
    for (const id of bloc.ids) out[id] = g;
  }
  return { ...out, ...extra };
}

/** Typical DC kr/kWh by country. own = CPO stalls, roam = this contract at other CPOs. */
export const REGION_MARKETS: Record<string, Partial<Record<EuRegion, MarketCell>>> = {
  tesla: spread(
    {
      nordic: cell(dkkFromEur(0.42), null),
      baltics: cell(dkkFromEur(0.45), null),
      dach: cell(dkkFromEur(0.52), null),
      benelux: cell(dkkFromEur(0.5), null),
      west: cell(dkkFromEur(0.45), null),
      south: cell(dkkFromEur(0.48), null),
      east: cell(dkkFromEur(0.44), null),
      balkans: cell(dkkFromEur(0.42), null),
      steppe: cell(dkkFromEur(0.4), null),
      near: cell(dkkFromEur(0.55), null),
    },
    {
      DK: cell(dkkFromEur(0.48), null),
      UK: cell(dkkFromEur(0.62), null),
      NO: cell(dkkFromEur(0.38), null),
      IS: cell(dkkFromEur(0.45), null),
      FO: cell(null, null),
      BY: cell(null, null),
      LI: cell(null, null),
      AD: cell(null, null),
      MC: cell(null, null),
      SM: cell(null, null),
    },
  ),
  ionity: spread(
    {
      nordic: cell(dkkFromEur(0.55), null),
      dach: cell(dkkFromEur(0.79), null),
      benelux: cell(dkkFromEur(0.76), null),
      west: cell(dkkFromEur(0.59), null),
      south: cell(dkkFromEur(0.69), null),
      east: cell(dkkFromEur(0.62), null),
      balkans: cell(null, null),
      steppe: cell(null, null),
      near: cell(dkkFromEur(0.85), null),
      baltics: cell(null, null),
    },
    {
      DK: cell(dkkFromEur(0.79), null),
      SE: cell(dkkFromEur(0.5), null),
      FI: cell(dkkFromEur(0.42), null),
      FR: cell(dkkFromEur(0.59), null),
      IE: cell(dkkFromEur(0.72), null),
      UK: cell(dkkFromEur(0.93), null),
      CH: cell(dkkFromEur(0.79), null),
      NO: cell(dkkFromEur(0.45), null),
      IS: cell(null, null),
      FO: cell(null, null),
      LI: cell(null, null),
      AD: cell(null, null),
      MC: cell(null, null),
      SM: cell(null, null),
      MT: cell(null, null),
      CY: cell(null, null),
    },
  ),
  fastned: spread(
    {
      dach: cell(dkkFromEur(0.69), null),
      benelux: cell(dkkFromEur(0.69), null),
      west: cell(dkkFromEur(0.69), null),
      near: cell(dkkFromEur(0.69), null),
      nordic: cell(null, null),
      baltics: cell(null, null),
      south: cell(null, null),
      east: cell(null, null),
      balkans: cell(null, null),
      steppe: cell(null, null),
    },
    {
      AT: cell(null, null),
      LI: cell(null, null),
      IE: cell(null, null),
      AD: cell(null, null),
      MC: cell(null, null),
      CH: cell(null, null),
      NO: cell(null, null),
      LU: cell(dkkFromEur(0.69), null),
    },
  ),
  allego: spread(
    {
      dach: cell(dkkFromEur(0.762), dkkFromEur(0.79)),
      benelux: cell(dkkFromEur(0.79), dkkFromEur(0.79)),
      west: cell(dkkFromEur(0.59), dkkFromEur(0.69)),
      nordic: cell(null, dkkFromEur(0.79)),
      baltics: cell(null, dkkFromEur(0.79)),
      south: cell(null, dkkFromEur(0.75)),
      east: cell(null, dkkFromEur(0.72)),
      balkans: cell(null, dkkFromEur(0.7)),
      steppe: cell(null, dkkFromEur(0.65)),
      near: cell(null, dkkFromEur(0.85)),
    },
    {
      NL: cell(dkkFromEur(0.793), dkkFromEur(0.79)),
      AT: cell(null, dkkFromEur(0.79)),
      CH: cell(null, null),
      NO: cell(null, dkkFromEur(0.75)),
      IS: cell(null, null),
      FO: cell(null, null),
      BY: cell(null, null),
      RU: cell(null, null),
    },
  ),
  electra: spread(
    {
      west: cell(dkkFromEur(0.54), dkkFromEur(0.69)),
      dach: cell(dkkFromEur(0.54), dkkFromEur(0.79)),
      benelux: cell(null, dkkFromEur(0.75)),
      south: cell(null, dkkFromEur(0.72)),
      nordic: cell(null, dkkFromEur(0.79)),
      baltics: cell(null, dkkFromEur(0.79)),
      east: cell(null, dkkFromEur(0.75)),
      balkans: cell(null, dkkFromEur(0.7)),
      steppe: cell(null, null),
      near: cell(null, null),
    },
    {
      BE: cell(dkkFromEur(0.54), dkkFromEur(0.75)),
      IT: cell(dkkFromEur(0.54), dkkFromEur(0.72)),
      LU: cell(null, dkkFromEur(0.75)),
      IE: cell(null, null),
      IS: cell(null, null),
      FO: cell(null, null),
    },
  ),
  enbw: spread(
    {
      dach: cell(dkkFromEur(0.59), dkkFromEur(0.73)),
      nordic: cell(null, dkkFromEur(0.73)),
      baltics: cell(null, dkkFromEur(0.73)),
      benelux: cell(null, dkkFromEur(0.73)),
      west: cell(null, dkkFromEur(0.73)),
      south: cell(null, dkkFromEur(0.75)),
      east: cell(null, dkkFromEur(0.7)),
      balkans: cell(null, dkkFromEur(0.7)),
      steppe: cell(null, null),
      near: cell(null, dkkFromEur(0.8)),
    },
    {
      AT: cell(dkkFromEur(0.59), dkkFromEur(0.85)),
      LI: cell(null, dkkFromEur(0.8)),
      UK: cell(null, null),
      NO: cell(null, dkkFromEur(0.7)),
      CH: cell(dkkFromEur(0.59), dkkFromEur(0.8)),
      IS: cell(null, null),
      FO: cell(null, null),
    },
  ),
  clever: spread(
    {
      nordic: cell(4.99, 0),
      dach: cell(null, 5.49),
      benelux: cell(null, 5.49),
      west: cell(null, 5.49),
      south: cell(null, 5.49),
      east: cell(null, 5.49),
      baltics: cell(null, 5.49),
      balkans: cell(null, 5.49),
      steppe: cell(null, null),
      near: cell(null, null),
    },
    {
      FI: cell(null, 5.49),
      IS: cell(null, 5.49),
      FO: cell(null, 5.49),
      NO: cell(null, 5.49),
      CH: cell(null, 5.49),
    },
  ),
  eon: spread(
    {
      nordic: cell(3.95, 5.2),
      dach: cell(dkkFromEur(0.61), dkkFromEur(0.79)),
      benelux: cell(null, dkkFromEur(0.79)),
      west: cell(null, dkkFromEur(0.79)),
      south: cell(null, dkkFromEur(0.79)),
      east: cell(null, dkkFromEur(0.72)),
      baltics: cell(null, dkkFromEur(0.75)),
      balkans: cell(null, dkkFromEur(0.72)),
      steppe: cell(null, dkkFromEur(0.65)),
      near: cell(null, dkkFromEur(0.79)),
    },
    { FI: cell(null, 5.2), IS: cell(null, null), FO: cell(null, 5.2), UK: cell(null, null), CH: cell(null, dkkFromEur(0.79)), BY: cell(null, null), RU: cell(null, null) },
  ),
  spirii: spread({
    nordic: cell(null, 3.7),
    baltics: cell(null, dkkFromEur(0.72)),
    dach: cell(null, dkkFromEur(0.79)),
    benelux: cell(null, dkkFromEur(0.79)),
    west: cell(null, dkkFromEur(0.75)),
    south: cell(null, dkkFromEur(0.72)),
    east: cell(null, dkkFromEur(0.68)),
    balkans: cell(null, dkkFromEur(0.65)),
    steppe: cell(null, dkkFromEur(0.6)),
    near: cell(null, dkkFromEur(0.85)),
  }),
  mer: spread(
    {
      nordic: cell(dkkFromEur(0.38), dkkFromEur(0.5)),
      baltics: cell(null, dkkFromEur(0.55)),
      dach: cell(null, dkkFromEur(0.55)),
      benelux: cell(null, dkkFromEur(0.55)),
      west: cell(null, dkkFromEur(0.55)),
      south: cell(null, dkkFromEur(0.52)),
      east: cell(null, dkkFromEur(0.48)),
      balkans: cell(null, dkkFromEur(0.48)),
      steppe: cell(null, null),
      near: cell(null, dkkFromEur(0.6)),
    },
    {
      NO: cell(dkkFromEur(0.35), dkkFromEur(0.48)),
      SE: cell(dkkFromEur(0.38), dkkFromEur(0.5)),
      FI: cell(dkkFromEur(0.36), dkkFromEur(0.5)),
      DK: cell(null, dkkFromEur(0.5)),
      IS: cell(null, null),
      FO: cell(null, null),
      UK: cell(null, null),
      CH: cell(null, dkkFromEur(0.55)),
    },
  ),
  shell: spread(
    {
      nordic: cell(dkkFromEur(0.62), dkkFromEur(0.75)),
      baltics: cell(dkkFromEur(0.6), dkkFromEur(0.75)),
      dach: cell(dkkFromEur(0.69), dkkFromEur(0.79)),
      benelux: cell(dkkFromEur(0.69), dkkFromEur(0.79)),
      west: cell(dkkFromEur(0.65), dkkFromEur(0.75)),
      south: cell(dkkFromEur(0.62), dkkFromEur(0.72)),
      east: cell(dkkFromEur(0.58), dkkFromEur(0.7)),
      balkans: cell(null, dkkFromEur(0.65)),
      steppe: cell(null, dkkFromEur(0.6)),
      near: cell(dkkFromEur(0.7), dkkFromEur(0.82)),
    },
    {
      DK: cell(dkkFromEur(0.65), dkkFromEur(0.79)),
      UK: cell(dkkFromEur(0.72), dkkFromEur(0.85)),
      MT: cell(null, dkkFromEur(0.72)),
      CY: cell(null, dkkFromEur(0.72)),
      IS: cell(null, dkkFromEur(0.7)),
      FO: cell(null, dkkFromEur(0.7)),
      BY: cell(null, null),
      RU: cell(null, null),
    },
  ),
  aral: spread(
    {
      dach: cell(null, dkkFromEur(0.79)),
      nordic: cell(null, dkkFromEur(0.79)),
      baltics: cell(null, dkkFromEur(0.79)),
      benelux: cell(null, dkkFromEur(0.79)),
      west: cell(null, dkkFromEur(0.79)),
      south: cell(null, dkkFromEur(0.79)),
      east: cell(null, dkkFromEur(0.72)),
      balkans: cell(null, dkkFromEur(0.7)),
      steppe: cell(null, null),
      near: cell(null, null),
    },
    { DE: cell(dkkFromEur(0.79), dkkFromEur(0.79)), CH: cell(null, dkkFromEur(0.79)), IS: cell(null, null), FO: cell(null, null) },
  ),
  total: spread(
    {
      west: cell(dkkFromEur(0.59), dkkFromEur(0.69)),
      benelux: cell(dkkFromEur(0.59), dkkFromEur(0.69)),
      dach: cell(dkkFromEur(0.59), dkkFromEur(0.69)),
      south: cell(dkkFromEur(0.55), dkkFromEur(0.65)),
      nordic: cell(null, dkkFromEur(0.69)),
      baltics: cell(null, dkkFromEur(0.69)),
      east: cell(null, dkkFromEur(0.65)),
      balkans: cell(null, dkkFromEur(0.62)),
      steppe: cell(null, dkkFromEur(0.6)),
      near: cell(null, dkkFromEur(0.75)),
    },
    { IE: cell(null, dkkFromEur(0.69)), UK: cell(null, null), CH: cell(null, dkkFromEur(0.69)), IS: cell(null, null), FO: cell(null, null), BY: cell(null, null), RU: cell(null, null) },
  ),
};

export function regionalCell(n: ChargeNetwork, region: EuRegion): MarketCell | null {
  return REGION_MARKETS[n.id]?.[region] ?? null;
}

export function regionalOwn(n: ChargeNetwork, region: EuRegion, hasAbo: boolean) {
  const c = regionalCell(n, region);
  if (!c || c.own == null) return null;
  if (hasAbo && n.unlimited) return 0;
  if (hasAbo) {
    if (n.spotKr <= 0) return n.aboKr;
    return Math.round(c.own * (n.aboKr / n.spotKr) * 1000) / 1000;
  }
  return c.own;
}

export function regionalRoam(n: ChargeNetwork, region: EuRegion, hasAbo: boolean) {
  const c = regionalCell(n, region);
  if (!c || c.roam == null) return null;
  if (hasAbo && n.unlimited && region === "DK") return 0;
  if (hasAbo && n.unlimited && region === "SE") return 0;
  if (hasAbo && n.id === "clever") return 3.75;
  if (hasAbo && n.roamAboKr != null && c.roam === n.roamKr) return n.roamAboKr;
  if (hasAbo && n.roamAboKr != null && n.roamKr && n.roamKr > 0) {
    return Math.round(c.roam * (n.roamAboKr / n.roamKr) * 1000) / 1000;
  }
  return c.roam;
}

export function regionalExtra(n: ChargeNetwork, region: EuRegion, hasAbo: boolean) {
  const roam = regionalRoam(n, region, hasAbo);
  if (roam == null) return null;
  const own = regionalOwn(n, region, hasAbo);
  if (own == null) return roam;
  return roam - own;
}
