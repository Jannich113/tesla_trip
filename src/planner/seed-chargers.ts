import { minDistToPathM } from "./insert.ts";
import { rateForNetwork } from "./networks.ts";

const DKK_PER_USD = 6.85;

export type SeedCharger = {
  id: string;
  name: string;
  short: string;
  lat: number;
  lng: number;
  networkId: string;
  kind: "supercharger" | "custom";
};

function s(
  id: string,
  name: string,
  short: string,
  lat: number,
  lng: number,
  networkId: string,
): SeedCharger {
  return {
    id,
    name,
    short,
    lat,
    lng,
    networkId,
    kind: networkId === "tesla" ? "supercharger" : "custom",
  };
}

/** Highway / city HPC the planner can use when live OSM is down. */
export const SEED_CHARGERS: SeedCharger[] = [
  s("seed-tesla-koege", "Tesla Køge Nord", "Køge", 55.4642, 12.1817, "tesla"),
  s("seed-tesla-orestad", "Tesla Ørestad", "Ørestad", 55.6308, 12.5792, "tesla"),
  s("seed-tesla-hilleroed", "Tesla Hillerød", "Hillerød", 55.927, 12.3007, "tesla"),
  s("seed-tesla-ringsted", "Tesla Ringsted", "Ringsted", 55.4428, 11.798, "tesla"),
  s("seed-tesla-odense", "Tesla Odense", "Odense", 55.3986, 10.4152, "tesla"),
  s("seed-tesla-kolding", "Tesla Kolding", "Kolding", 55.5324, 9.4918, "tesla"),
  s("seed-tesla-horsens", "Tesla Horsens", "Horsens", 55.8627, 9.8506, "tesla"),
  s("seed-tesla-aarhus", "Tesla Aarhus N", "Aarhus", 56.227, 10.145, "tesla"),
  s("seed-tesla-randers", "Tesla Randers", "Randers", 56.4605, 10.036, "tesla"),
  s("seed-tesla-aalborg", "Tesla Aalborg", "Aalborg", 57.0131, 9.8917, "tesla"),
  s("seed-tesla-esbjerg", "Tesla Esbjerg", "Esbjerg", 55.506, 8.451, "tesla"),
  s("seed-tesla-herning", "Tesla Herning", "Herning", 56.138, 8.97, "tesla"),
  s("seed-tesla-holstebro", "Tesla Holstebro", "Holstebro", 56.359, 8.616, "tesla"),
  s("seed-ionity-padborg", "IONITY Padborg", "Padborg", 54.8236, 9.3594, "ionity"),
  s("seed-ionity-taulov", "IONITY Taulov", "Taulov", 55.5455, 9.575, "ionity"),
  s("seed-ionity-naerum", "IONITY Nørre Alslev", "Nørre Alslev", 54.9078, 11.906, "ionity"),
  s("seed-ionity-lasby", "IONITY Låsby", "Låsby", 56.156, 9.816, "ionity"),
  s("seed-clever-fred", "Clever Fredericia", "Fredericia", 55.565, 9.755, "clever"),
  s("seed-clever-kold", "Clever Kolding", "Kolding", 55.491, 9.473, "clever"),
  s("seed-eon-skaerup", "E.ON Skærup", "Skærup", 55.635, 9.505, "eon"),
  s("seed-tesla-malmo", "Tesla Malmö", "Malmö", 55.605, 13.021, "tesla"),
  s("seed-tesla-helsingborg", "Tesla Helsingborg", "Helsingborg", 56.046, 12.694, "tesla"),
  s("seed-tesla-goteborg", "Tesla Göteborg", "Göteborg", 57.7089, 11.9746, "tesla"),
  s("seed-ionity-lödde", "IONITY Löddeköpinge", "Löddeköpinge", 55.766, 13.0, "ionity"),
  s("seed-tesla-oslo", "Tesla Oslo", "Oslo", 59.911, 10.752, "tesla"),
  s("seed-tesla-moss", "Tesla Moss", "Moss", 59.434, 10.657, "tesla"),
  s("seed-tesla-drammen", "Tesla Drammen", "Drammen", 59.744, 10.204, "tesla"),
  s("seed-tesla-kristiansand", "Tesla Kristiansand", "Kristiansand", 58.146, 7.996, "tesla"),
  s("seed-tesla-lillehammer", "Tesla Lillehammer", "Lillehammer", 61.115, 10.466, "tesla"),
  s("seed-tesla-trondheim", "Tesla Trondheim", "Trondheim", 63.43, 10.395, "tesla"),
  s("seed-tesla-bergen", "Tesla Bergen", "Bergen", 60.391, 5.322, "tesla"),
  s("seed-mer-svinesund", "Mer Svinesund", "Svinesund", 59.09, 11.27, "mer"),
  s("seed-recharge-oslo", "Recharge Oslo S", "Oslo S", 59.91, 10.753, "recharge"),
  s("seed-kople-sandvika", "Kople Sandvika", "Sandvika", 59.89, 10.525, "kople"),
  s("seed-eviny-bergen", "Eviny Bergen", "Bergen", 60.389, 5.332, "eviny"),
  s("seed-circlek-gardermoen", "Circle K Gardermoen", "Gardermoen", 60.193, 11.1, "circlek"),
  s("seed-ionity-harrislee", "IONITY Harrislee", "Harrislee", 54.803, 9.38, "ionity"),
  s("seed-tesla-flensburg", "Tesla Flensburg", "Flensburg", 54.782, 9.437, "tesla"),
  s("seed-ionity-neumunster", "IONITY Neumünster", "Neumünster", 54.071, 9.98, "ionity"),
  s("seed-tesla-hamburg", "Tesla Hamburg", "Hamburg", 53.55, 9.993, "tesla"),
  s("seed-ionity-hamburg", "IONITY Hamburg Stillhorn", "Stillhorn", 53.468, 10.0, "ionity"),
  s("seed-enbw-hamburg", "EnBW Hamburg", "Hamburg", 53.563, 10.02, "enbw"),
  s("seed-ionity-hanover", "IONITY Hannover", "Hannover", 52.375, 9.732, "ionity"),
  s("seed-tesla-lubeck", "Tesla Lübeck", "Lübeck", 53.869, 10.687, "tesla"),
  s("seed-fastned-breda", "Fastned Breda", "Breda", 51.571, 4.768, "fastned"),
  s("seed-tesla-amsterdam", "Tesla Amsterdam", "Amsterdam", 52.338, 4.889, "tesla"),
  s("seed-ionity-utrecht", "IONITY Utrecht", "Utrecht", 52.091, 5.122, "ionity"),
  s("seed-allego-arnhem", "Allego Arnhem", "Arnhem", 51.985, 5.899, "allego"),
  s("seed-tesla-paris", "Tesla Paris Sud", "Paris", 48.749, 2.366, "tesla"),
  s("seed-ionity-nemours", "IONITY Nemours", "Nemours", 48.268, 2.694, "ionity"),
  s("seed-tesla-auxerre", "Tesla Auxerre", "Auxerre", 47.798, 3.567, "tesla"),
  s("seed-ionity-beaune", "IONITY Beaune", "Beaune", 47.025, 4.848, "ionity"),
  s("seed-tesla-macon", "Tesla Mâcon", "Mâcon", 46.307, 4.831, "tesla"),
  s("seed-tesla-lyon", "Tesla Lyon", "Lyon", 45.748, 4.846, "tesla"),
  s("seed-ionity-lyon", "IONITY Lyon Sud", "Lyon", 45.641, 4.795, "ionity"),
  s("seed-tesla-chambery", "Tesla Chambéry", "Chambéry", 45.565, 5.976, "tesla"),
  s("seed-tesla-turin", "Tesla Torino", "Torino", 45.07, 7.686, "tesla"),
  s("seed-ionity-milano", "IONITY Milano Ovest", "Milano", 45.452, 8.98, "ionity"),
  s("seed-tesla-milan", "Tesla Milano", "Milano", 45.464, 9.19, "tesla"),
  s("seed-tesla-bologna", "Tesla Bologna", "Bologna", 44.494, 11.342, "tesla"),
  s("seed-ionity-bologna", "IONITY Bologna", "Bologna", 44.51, 11.29, "ionity"),
  s("seed-tesla-florence", "Tesla Firenze", "Firenze", 43.77, 11.254, "tesla"),
  s("seed-tesla-rome", "Tesla Roma", "Roma", 41.891, 12.503, "tesla"),
  s("seed-ionity-rome", "IONITY Roma Nord", "Roma", 42.05, 12.48, "ionity"),
  s("seed-electra-nemours", "Electra Nemours", "Nemours", 48.27, 2.7, "electra"),
  s("seed-total-auxerre", "TotalEnergies Auxerre", "Auxerre", 47.8, 3.57, "total"),
  s("seed-electra-beaune", "Electra Beaune", "Beaune", 47.03, 4.84, "electra"),
  s("seed-total-lyon", "TotalEnergies Lyon", "Lyon", 45.72, 4.84, "total"),
  s("seed-electra-turin", "Electra Torino", "Torino", 45.08, 7.68, "electra"),
  s("seed-total-milan", "TotalEnergies Milano", "Milano", 45.45, 9.17, "total"),
  s("seed-electra-bologna", "Electra Bologna", "Bologna", 44.5, 11.33, "electra"),
  s("seed-total-florence", "TotalEnergies Firenze", "Firenze", 43.78, 11.25, "total"),
  s("seed-tesla-sj", "Tesla San Jose", "San Jose", 37.3318, -121.8906, "tesla"),
  s("seed-tesla-gilroy", "Tesla Gilroy", "Gilroy", 37.0142, -121.5574, "tesla"),
  s("seed-tesla-cruz", "Tesla Santa Cruz", "Santa Cruz", 36.9749, -122.0263, "tesla"),
  s("seed-tesla-sf", "Tesla San Francisco", "San Francisco", 37.7841, -122.4075, "tesla"),
  s("seed-tesla-napa", "Tesla Napa", "Napa", 38.2991, -122.2852, "tesla"),
];

export function seedToLocation(c: SeedCharger) {
  const rate = rateForNetwork(c.networkId, false) ?? 4.2;
  return {
    id: c.id,
    name: c.name,
    short: c.short,
    lat: c.lat,
    lng: c.lng,
    kind: c.kind,
    usdPerKwh: rate / DKK_PER_USD,
    preset: false as const,
    radiusM: 250,
    networkId: c.networkId,
    operator: c.short,
  };
}

export function seedsAlongPath(path: [number, number][], radiusM = 28_000) {
  if (path.length < 2) return [];
  return SEED_CHARGERS.filter((c) => minDistToPathM(c.lat, c.lng, path) <= radiusM).map(seedToLocation);
}