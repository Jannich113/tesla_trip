import type { EuRegion } from "./networks";

export type CountryProfile = {
  id: EuRegion;
  name: string;
  ccy: string;
  cpos: string[];
  note: string;
};

const p = (id: EuRegion, name: string, ccy: string, cpos: string[], note: string): CountryProfile => ({
  id,
  name,
  ccy,
  cpos,
  note,
});

/** Main public DC/HPC operators and how the market prices. */
export const COUNTRY_PROFILES: CountryProfile[] = [
  p("DK", "Denmark", "DKK", ["clever", "eon", "spirii", "tesla", "ionity", "shell"], "Clever One is unlimited on partners. E.ON and Spirii are the kWh apps. Tesla/IONITY on longer legs."),
  p("SE", "Sweden", "SEK", ["tesla", "recharge", "mer", "ionity", "circlek", "spirii"], "Tesla and Recharge on E4/E6. Mer in towns. Spot follows Nordic power more than DE HPC."),
  p("FI", "Finland", "EUR", ["tesla", "ionity", "recharge", "shell"], "IONITY ad-hoc is among the cheapest in Europe. K-Lataus sits outside this catalog."),
  p("NO", "Norway", "NOK", ["tesla", "eviny", "recharge", "circlek", "kople", "mer", "unox", "ionity"], "Tesla cheapest. Eviny #2 HPC (Vestland). Circle K leads 300 kW+. Kople wins the districts. Recharge Move and IONITY Power are the useful abos. Mer+Eviny are merging."),
  p("IS", "Iceland", "ISK", ["tesla", "shell"], "Thin highway HPC. On.roaming via European eMSPs. Tesla in the south-west."),
  p("FO", "Faroe Islands", "DKK", ["shell"], "SEV/local AC plus a few DC. Treat as roam from DK apps."),
  p("EE", "Estonia", "EUR", ["tesla", "elektrum", "shell"], "Elektrilevi/Enefit Volt locally. Tesla + Shell Recharge for visitors."),
  p("LV", "Latvia", "EUR", ["tesla", "elektrum", "shell"], "Elektrum Drive + sparse Tesla. Roam via Shell/Spirii."),
  p("LT", "Lithuania", "EUR", ["tesla", "ignitis", "shell"], "Ignitis ON plus Tesla on Via Baltica."),
  p("DE", "Germany", "EUR", ["enbw", "ionity", "aral", "tesla", "fastned", "allego", "shell"], "EnBW HyperNetz is the default. IONITY/Aral on Autobahn. Abo is cheap on-net, roam stays ~0.73–0.79 €."),
  p("AT", "Austria", "EUR", ["ionity", "enbw", "tesla", "shell"], "IONITY + SMATRICS locally. EnBW roam is dearer than DE own."),
  p("LI", "Liechtenstein", "CHF", ["enbw", "shell"], "Use CH/AT apps. No local HPC brand."),
  p("NL", "Netherlands", "EUR", ["fastned", "allego", "ionity", "tesla", "total"], "Fastned and Allego own the motorways. Plus/Gold pay off fast."),
  p("BE", "Belgium", "EUR", ["fastned", "allego", "electra", "ionity", "tesla", "total"], "Same Benelux trio. Electra in the south."),
  p("LU", "Luxembourg", "EUR", ["fastned", "ionity", "tesla", "total"], "Corridor market. Charge as NL/BE."),
  p("FR", "France", "EUR", ["electra", "ionity", "total", "tesla", "fastned", "allego"], "Electra and Total on aires. IONITY FR is cheaper than DE/UK. Electra+ helps ChargeLeague."),
  p("IE", "Ireland", "EUR", ["tesla", "ionity", "shell"], "ESB eCars is the local CPO. IONITY/Tesla on the M-roads."),
  p("AD", "Andorra", "EUR", ["tesla", "total"], "Mountain corridor. FR/ES roam."),
  p("MC", "Monaco", "EUR", ["electra", "total"], "Destination AC/DC. Use FR apps."),
  p("IT", "Italy", "EUR", ["electra", "ionity", "tesla", "enel", "shell"], "Free To X / Enel X Way locally. Electra and IONITY on autostrade."),
  p("ES", "Spain", "EUR", ["tesla", "ionity", "endesa", "repsol", "shell"], "Tesla and Iberdrola/Endesa. IONITY thinner than FR."),
  p("PT", "Portugal", "EUR", ["tesla", "ionity", "repsol", "shell"], "MOBI.E roaming layer on top of CPOs."),
  p("GR", "Greece", "EUR", ["tesla", "ppc", "shell"], "PPC blue + sparse Tesla. Roam is the visitor path."),
  p("MT", "Malta", "EUR", ["shell"], "Mostly AC. Few HPC."),
  p("CY", "Cyprus", "EUR", ["shell"], "Island AC. Plan as roam-only."),
  p("SM", "San Marino", "EUR", ["tesla", "electra"], "Use Italy."),
  p("PL", "Poland", "PLN", ["tesla", "orlen", "greenway", "ionity", "shell"], "Orlen Charge + GreenWay. Tesla growing on A2/A4. IONITY on TEN-T."),
  p("CZ", "Czechia", "CZK", ["tesla", "cez", "ionity", "shell"], "ČEZ and PRE locally. IONITY on D1."),
  p("SK", "Slovakia", "EUR", ["tesla", "zse", "ionity", "shell"], "ZSE Drive + IONITY toward AT/HU."),
  p("HU", "Hungary", "HUF", ["tesla", "mol", "ionity", "shell"], "MOL Plugee + Tesla on M1/M7."),
  p("RO", "Romania", "RON", ["tesla", "mol", "enel", "shell"], "Thin HPC. Tesla and e-charge parks on A1."),
  p("BG", "Bulgaria", "EUR", ["tesla", "shell"], "Eldrive locally. Tesla on the corridor south."),
  p("HR", "Croatia", "EUR", ["tesla", "ionity", "shell"], "Summer queues on A1. Tesla + HEP/IONITY."),
  p("SI", "Slovenia", "EUR", ["tesla", "ionity", "petrol", "shell"], "Petrol + IONITY, short transits."),
  p("AL", "Albania", "ALL", ["tesla", "shell"], "Very thin DC. Roam or Tesla where it exists."),
  p("BA", "Bosnia", "BAM", ["tesla", "shell"], "Corridor DC only. Plan extra reserve."),
  p("MK", "North Macedonia", "MKD", ["tesla", "shell"], "Few HPC. Treat as roam."),
  p("ME", "Montenegro", "EUR", ["tesla", "shell"], "Coastal seasonal DC."),
  p("RS", "Serbia", "RSD", ["tesla", "shell"], "Tesla on A1. EPS/local otherwise."),
  p("XK", "Kosovo", "EUR", ["shell"], "Minimal HPC. Transit reserve."),
  p("UA", "Ukraine", "UAH", ["tesla", "yo"], "YO and local DC in the west. Coverage is uneven."),
  p("MD", "Moldova", "MDL", ["shell"], "Sparse. Plan from RO."),
  p("BY", "Belarus", "BYN", [], "Public HPC for visitors is unreliable. Do not plan roam."),
  p("RU", "Russia", "RUB", ["tesla"], "Western apps do not roam. Catalog is presence-only."),
  p("TR", "Turkey", "TRY", ["tesla", "zes", "shell"], "ZES and Tesla on O-roads. European eMSPs rarely match TR tariffs."),
  p("UK", "United Kingdom", "GBP", ["tesla", "ionity", "fastned", "shell", "bp"], "IONITY ad-hoc is the dear outlier. Tesla and Gridserve/InstaVolt locally."),
  p("CH", "Switzerland", "CHF", ["tesla", "ionity", "enbw", "shell"], "IONITY + local GOFAST/Move. Roam-in from DE is marked up."),
];

export function countryProfile(id: EuRegion) {
  return COUNTRY_PROFILES.find((c) => c.id === id) ?? null;
}