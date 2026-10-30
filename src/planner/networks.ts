/** EU public charging networks. Rates in DKK/kWh. Spot = ad-hoc, abo = membership. */
import { CATALOG_FX, NETWORK_NATIVE, toDkk } from "./charge-fx";

const EUR = CATALOG_FX.EUR;
const NOK = CATALOG_FX.NOK;

function dkkFromEur(eur: number) {
  return Math.round(eur * EUR * 1000) / 1000;
}

function dkkFromNok(nok: number) {
  return Math.round(nok * NOK * 1000) / 1000;
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
  /** When and where the prices were last checked; absent = an estimate nobody checked. */
  checked?: { on: string; source: string; scope: string };
};

const CATALOG: ChargeNetwork[] = [
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
    note: "Owner rate vs other brands. Others can buy a membership for the owner rate (85 kr/month in Denmark).",
    checked: { on: "2026-05-29", source: "https://mobilsiden.dk/?p=265272", scope: "Denmark (flat 2.60 / 3.60 kr)" },
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
    roamNote: "Power and Motion are IONITY stalls only. Roaming in is via other eMSPs — usually +0.15–0.25 €/kWh.",
    note: "Direct is the ad-hoc price; Power cuts it by about 40% for a monthly fee.",
    checked: { on: "2026-07-22", source: "https://ionity.eu/en/access-and-payment", scope: "Denmark, Germany" },
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
    note: "Tariff S (no fee) vs M (5.99 €/month). L is 0.39 € for 11.99 €/month.",
    checked: { on: "2026-10-30", source: "https://www.enbw.com/elektromobilitaet/produkte/ladetarife", scope: "Germany (tariffs S and M)" },
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
    note: "One is unlimited kWh (incl. many partners). Trip kWh cost is 0; monthly fee is separate. Clever Go prices vary by charger and hour; 4.99 kr is a typical fast-charging price.",
    checked: { on: "2026-08-18", source: "https://mobilsiden.dk/?p=287350", scope: "Clever One fee only" },
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
    roamNote: "Own DK/DE is cheaper. Roam-out costs more.",
    note: "Danish public AC/DC. 4.25 kr is the ad-hoc DC price; the Plus abo price is from 2024.",
    checked: { on: "2026-10-30", source: "https://www.edri.com/en-dk/tariffs", scope: "Denmark ad hoc" },
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
    name: "Mer",
    region: "NO · SE · DK",
    spotKr: dkkFromNok(6.29),
    aboKr: dkkFromNok(6.29),
    aboMonthlyKr: dkkFromNok(69),
    aboName: "Mer app",
    roamKr: null,
    roamNote: "Own network. Little roam-out. Merging with Eviny into Eviny Elektrifisering.",
    note: "Statkraft. Urban and E6/E18. DC drop-in = app. Coop members get a few øre off.",
  },
  {
    id: "recharge",
    name: "Recharge",
    region: "NO · SE · FI",
    spotKr: dkkFromNok(6.49),
    aboKr: dkkFromNok(4.79),
    aboMonthlyKr: dkkFromNok(69),
    aboName: "Recharge Move",
    roamKr: dkkFromNok(7.5),
    roamAboKr: dkkFromNok(6.2),
    roamNote: "Move is own Recharge. EU roam exists but is closer to continental HPC.",
    note: "Ex Fortum Charge & Drive. 3rd on Norwegian HPC. Flow/drop-in is the dear rate.",
  },
  {
    id: "kople",
    name: "Kople",
    region: "NO",
    spotKr: dkkFromNok(6.39),
    aboKr: dkkFromNok(5.49),
    aboMonthlyKr: dkkFromNok(49),
    aboName: "Kople app",
    roamKr: dkkFromNok(7.0),
    roamAboKr: dkkFromNok(6.5),
    roamNote: "Largest by all sockets in Norway. Roam-out is limited.",
    note: "Districts, Nord/Midt. App/RFID beats card. Night is cheaper.",
  },
  {
    id: "eviny",
    name: "Eviny",
    region: "NO Vestland",
    spotKr: dkkFromNok(5.89),
    aboKr: dkkFromNok(5.89),
    aboMonthlyKr: 0,
    aboName: "Eviny app",
    roamKr: null,
    roamNote: "Own network in Vestlandet. 2nd on 150 kW+ after Tesla. Merging with Mer.",
    note: "Ex BKK. No cheap DC abo — drop-in is the rate. AC at destinations is lower.",
  },
  {
    id: "circlek",
    name: "Circle K",
    region: "NO highways",
    spotKr: dkkFromNok(6.29),
    aboKr: dkkFromNok(5.99),
    aboMonthlyKr: dkkFromNok(49),
    aboName: "EXTRA",
    roamKr: null,
    roamNote: "Own highway hubs. No roam-out. Biggest 300 kW+ network in Norway.",
    note: "EXTRA club knocks 30–45 øre. NAF/OBOS stacks a bit more.",
  },
  {
    id: "unox",
    name: "Uno-X",
    region: "NO",
    spotKr: dkkFromNok(5.5),
    aboKr: dkkFromNok(5.5),
    aboMonthlyKr: 0,
    aboName: "Uno-X app",
    roamKr: null,
    roamNote: "Own stations. Some Ionity sites billed via Uno-X.",
    note: "South/East corridors. Price is on the stall — often under Mer/Recharge drop-in.",
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

/**
 * One source for the numbers: the native-currency tariffs in charge-fx.ts at the catalog
 * exchange rates (the API reconverts them at live rates). The catalog above adds names and notes.
 */
export const EU_NETWORKS: ChargeNetwork[] = CATALOG.map((n) => {
  const t = NETWORK_NATIVE[n.id];
  if (!t) return n;
  return {
    ...n,
    spotKr: toDkk(t.spot, t.ccy, CATALOG_FX),
    aboKr: toDkk(t.abo, t.ccy, CATALOG_FX),
    aboMonthlyKr: toDkk(t.monthly, t.ccy, CATALOG_FX),
    roamKr: t.roam == null ? null : toDkk(t.roam, t.ccy, CATALOG_FX),
    roamAboKr: t.roamAbo == null ? (n.roamAboKr ?? null) : toDkk(t.roamAbo, t.ccy, CATALOG_FX),
  };
});

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

/** own = ad-hoc at the network's stalls; ownAbo = with its membership when known; roam = at other CPOs. */
type MarketCell = { own: number | null; roam: number | null; ownAbo?: number; dkk?: true };

function cell(own: number | null, roam: number | null, ownAbo?: number): MarketCell {
  return ownAbo == null ? { own, roam } : { own, roam, ownAbo };
}

/** A price the operator publishes in DKK: exchange-rate moves must not shift it. */
function dkkCell(own: number | null, roam: number | null, ownAbo?: number): MarketCell {
  return { ...cell(own, roam, ownAbo), dkk: true };
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
      // Flat rate since May 2026: 3.60 kr, 2.60 kr for owners and members.
      DK: dkkCell(3.6, null, 2.6),
      DE: cell(dkkFromEur(0.6), null, dkkFromEur(0.46)),
      UK: cell(dkkFromEur(0.62), null),
      NO: cell(dkkFromNok(4.9), null),
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
      // ionity.eu, 22 Jul 2026: Direct and Power (monthly plan).
      DK: dkkCell(3.86, null, 2.29),
      DE: cell(dkkFromEur(0.72), null, dkkFromEur(0.42)),
      SE: cell(dkkFromEur(0.5), null),
      FI: cell(dkkFromEur(0.42), null),
      FR: cell(dkkFromEur(0.59), null),
      IE: cell(dkkFromEur(0.72), null),
      UK: cell(dkkFromEur(0.93), null),
      CH: cell(dkkFromEur(0.79), null),
      NO: cell(dkkFromNok(5.27), null),
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
      dach: cell(dkkFromEur(0.56), dkkFromEur(0.73), dkkFromEur(0.46)),
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
      nordic: cell(4.25, 5.2),
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
      nordic: cell(dkkFromNok(6.29), null),
      baltics: cell(null, null),
      dach: cell(null, dkkFromEur(0.7)),
      benelux: cell(null, null),
      west: cell(null, null),
      south: cell(null, null),
      east: cell(null, null),
      balkans: cell(null, null),
      steppe: cell(null, null),
      near: cell(null, null),
    },
    {
      NO: cell(dkkFromNok(6.29), null),
      SE: cell(dkkFromNok(6.29), null),
      DK: cell(dkkFromNok(6.5), null),
      FI: cell(null, null),
      IS: cell(null, null),
      FO: cell(null, null),
      DE: cell(null, dkkFromEur(0.7)),
    },
  ),
  recharge: spread(
    {
      nordic: cell(dkkFromNok(6.49), dkkFromNok(7.5)),
      baltics: cell(null, dkkFromNok(7.5)),
      dach: cell(null, dkkFromEur(0.69)),
      benelux: cell(null, dkkFromEur(0.69)),
      west: cell(null, dkkFromEur(0.69)),
      south: cell(null, dkkFromEur(0.65)),
      east: cell(null, dkkFromEur(0.62)),
      balkans: cell(null, null),
      steppe: cell(null, null),
      near: cell(null, dkkFromEur(0.75)),
    },
    {
      NO: cell(dkkFromNok(6.49), dkkFromNok(7.5)),
      SE: cell(dkkFromNok(6.49), dkkFromNok(7.5)),
      FI: cell(dkkFromNok(6.2), dkkFromNok(7.2)),
      DK: cell(null, dkkFromNok(7.5)),
      IS: cell(null, null),
      FO: cell(null, null),
    },
  ),
  kople: spread(
    {
      nordic: cell(null, null),
      baltics: cell(null, null),
      dach: cell(null, null),
      benelux: cell(null, null),
      west: cell(null, null),
      south: cell(null, null),
      east: cell(null, null),
      balkans: cell(null, null),
      steppe: cell(null, null),
      near: cell(null, null),
    },
    { NO: cell(dkkFromNok(6.39), dkkFromNok(7.0)), SE: cell(null, dkkFromNok(7.0)) },
  ),
  eviny: spread(
    {
      nordic: cell(null, null),
      baltics: cell(null, null),
      dach: cell(null, null),
      benelux: cell(null, null),
      west: cell(null, null),
      south: cell(null, null),
      east: cell(null, null),
      balkans: cell(null, null),
      steppe: cell(null, null),
      near: cell(null, null),
    },
    { NO: cell(dkkFromNok(5.89), null) },
  ),
  circlek: spread(
    {
      nordic: cell(null, null),
      baltics: cell(null, null),
      dach: cell(null, null),
      benelux: cell(null, null),
      west: cell(null, null),
      south: cell(null, null),
      east: cell(null, null),
      balkans: cell(null, null),
      steppe: cell(null, null),
      near: cell(null, null),
    },
    { NO: cell(dkkFromNok(6.29), null), SE: cell(dkkFromNok(6.4), null), DK: cell(null, null) },
  ),
  unox: spread(
    {
      nordic: cell(null, null),
      baltics: cell(null, null),
      dach: cell(null, null),
      benelux: cell(null, null),
      west: cell(null, null),
      south: cell(null, null),
      east: cell(null, null),
      balkans: cell(null, null),
      steppe: cell(null, null),
      near: cell(null, null),
    },
    { NO: cell(dkkFromNok(5.5), null) },
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

/** True when this country's prices are fixed in DKK and must not follow the exchange rate. */
export function regionalInDkk(n: ChargeNetwork, region: EuRegion) {
  return Boolean(regionalCell(n, region)?.dkk);
}

export function regionalOwn(n: ChargeNetwork, region: EuRegion, hasAbo: boolean) {
  const c = regionalCell(n, region);
  if (!c || c.own == null) return null;
  if (hasAbo && n.unlimited) return 0;
  if (hasAbo && c.ownAbo != null) return c.ownAbo;
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

/** kWh a month above which the membership is cheaper than paying ad hoc. */
export function breakEvenKwh(monthlyKr: number, adHocKr: number, memberKr: number) {
  const saving = adHocKr - memberKr;
  if (monthlyKr <= 0 || saving <= 0.05) return null;
  return Math.ceil(monthlyKr / saving);
}
