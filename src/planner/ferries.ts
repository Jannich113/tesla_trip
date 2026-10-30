/**
 * Car ferries (#71). Valhalla routes over ferries (OSRM never does); this module reads the
 * crossings out of a Valhalla route and matches them to a small catalog of known crossings
 * for the operator, check-in time and where to book.
 *
 * Prices are ROUGH ESTIMATES (one way, car with passengers, DKK) and are shown as such:
 * fares change with season, departure and cabin, and have not been checked against the
 * operators. Crossing and check-in times are typical values.
 */

/** A ferry crossing found in a route. */
export type FerryCrossing = {
  /** Name the router gives, e.g. "Rødby (DK) - Puttgarden (D)". */
  name: string;
  from: [number, number];
  to: [number, number];
  miles: number;
  seconds: number;
};

export type FerryLine = {
  id: string;
  name: string;
  operators: string[];
  ports: [{ name: string; lat: number; lng: number }, { name: string; lat: number; lng: number }];
  crossingMin: number;
  checkInMin: number;
  /** Rough one-way fare for a car with passengers, DKK; an estimate, not a quote. */
  priceKr: { from: number; to: number };
  bookingUrl: string;
};

const line = (
  id: string,
  operators: string[],
  a: [string, number, number],
  b: [string, number, number],
  crossingMin: number,
  checkInMin: number,
  priceKr: [number, number],
  bookingUrl: string,
): FerryLine => ({
  id,
  name: `${a[0]} – ${b[0]}`,
  operators,
  ports: [
    { name: a[0], lat: a[1], lng: a[2] },
    { name: b[0], lat: b[1], lng: b[2] },
  ],
  crossingMin,
  checkInMin,
  priceKr: { from: priceKr[0], to: priceKr[1] },
  bookingUrl,
});

export const FERRY_LINES: FerryLine[] = [
  line("rodby-puttgarden", ["Scandlines"], ["Rødby", 54.656, 11.352], ["Puttgarden", 54.5, 11.226], 45, 15, [500, 900], "https://www.scandlines.dk"),
  line("gedser-rostock", ["Scandlines"], ["Gedser", 54.574, 11.929], ["Rostock", 54.15, 12.103], 120, 30, [700, 1300], "https://www.scandlines.dk"),
  line("helsingor-helsingborg", ["ForSea"], ["Helsingør", 56.036, 12.613], ["Helsingborg", 56.044, 12.693], 20, 10, [350, 500], "https://www.forsea.dk"),
  line("aarhus-odden", ["Molslinjen"], ["Aarhus", 56.15, 10.226], ["Odden", 55.972, 11.373], 75, 20, [400, 800], "https://www.molslinjen.dk"),
  line("ebeltoft-odden", ["Molslinjen"], ["Ebeltoft", 56.193, 10.677], ["Odden", 55.972, 11.373], 50, 20, [400, 800], "https://www.molslinjen.dk"),
  line("bojden-fynshav", ["Alslinjen"], ["Bøjden", 55.106, 10.105], ["Fynshav", 55.0, 9.988], 50, 15, [200, 350], "https://www.alslinjen.dk"),
  line("spodsbjerg-tars", ["Færgen"], ["Spodsbjerg", 54.93, 10.83], ["Tårs", 54.88, 11.03], 45, 15, [250, 400], "https://www.faergen.dk"),
  line("hirtshals-kristiansand", ["Color Line", "Fjord Line"], ["Hirtshals", 57.592, 9.966], ["Kristiansand", 58.145, 7.997], 195, 45, [600, 2000], "https://www.colorline.dk"),
  line("hirtshals-larvik", ["Color Line"], ["Hirtshals", 57.592, 9.966], ["Larvik", 59.049, 10.033], 225, 45, [700, 2000], "https://www.colorline.dk"),
  line("frederikshavn-goteborg", ["Stena Line"], ["Frederikshavn", 57.44, 10.55], ["Göteborg", 57.69, 11.9], 210, 45, [600, 1500], "https://www.stenaline.dk"),
  line("kobenhavn-oslo", ["DFDS"], ["København", 55.7, 12.6], ["Oslo", 59.9, 10.73], 1020, 60, [1500, 4000], "https://www.dfds.com"),
  line("kiel-oslo", ["Color Line"], ["Kiel", 54.33, 10.15], ["Oslo", 59.9, 10.73], 1200, 60, [2500, 6000], "https://www.colorline.dk"),
  line("trelleborg-rostock", ["TT-Line", "Stena Line"], ["Trelleborg", 55.37, 13.15], ["Rostock", 54.15, 12.103], 360, 45, [800, 1800], "https://www.ttline.com"),
  line("trelleborg-travemunde", ["TT-Line"], ["Trelleborg", 55.37, 13.15], ["Travemünde", 53.96, 10.87], 480, 45, [900, 2000], "https://www.ttline.com"),
  line("trelleborg-sassnitz", ["Stena Line"], ["Trelleborg", 55.37, 13.15], ["Sassnitz", 54.51, 13.64], 270, 45, [700, 1500], "https://www.stenaline.dk"),
  line("malmo-travemunde", ["Finnlines"], ["Malmö", 55.62, 12.98], ["Travemünde", 53.96, 10.87], 540, 60, [900, 2000], "https://www.finnlines.com"),
  line("ystad-ronne", ["Bornholmslinjen"], ["Ystad", 55.43, 13.82], ["Rønne", 55.1, 14.69], 80, 30, [700, 1500], "https://www.bornholmslinjen.dk"),
  line("stockholm-helsinki", ["Tallink Silja", "Viking Line"], ["Stockholm", 59.35, 18.11], ["Helsinki", 60.16, 24.95], 960, 60, [1000, 3500], "https://www.vikingline.com"),
  line("stockholm-turku", ["Viking Line", "Tallink Silja"], ["Stockholm", 59.32, 18.09], ["Turku", 60.43, 22.22], 660, 60, [600, 2000], "https://www.vikingline.com"),
  line("kapellskar-naantali", ["Finnlines"], ["Kapellskär", 59.72, 19.07], ["Naantali", 60.47, 22.03], 480, 60, [800, 2000], "https://www.finnlines.com"),
  line("helsinki-tallinn", ["Tallink", "Viking Line", "Eckerö Line"], ["Helsinki", 60.16, 24.95], ["Tallinn", 59.44, 24.77], 135, 30, [400, 1000], "https://www.tallink.com"),
];

/** Valhalla maneuver type for boarding a ferry. */
const FERRY_ENTER = 28;

type Maneuver = {
  type?: number;
  street_names?: string[];
  instruction?: string;
  length?: number;
  time?: number;
  begin_shape_index?: number;
  end_shape_index?: number;
};

/**
 * Ferry crossings in a Valhalla leg, from its maneuvers and its full (not simplified) shape.
 * `lengthInMiles` matches the request's units.
 */
export function ferriesFromManeuvers(maneuvers: Maneuver[], shape: [number, number][], lengthInMiles = true): FerryCrossing[] {
  const out: FerryCrossing[] = [];
  for (const m of maneuvers) {
    if (m.type !== FERRY_ENTER) continue;
    const a = shape[m.begin_shape_index ?? -1];
    const b = shape[m.end_shape_index ?? -1];
    if (!a || !b) continue;
    const length = Number(m.length) || 0;
    out.push({
      name: m.street_names?.[0] ?? m.instruction?.replace(/^Take the /, "").replace(/\.$/, "") ?? "Ferry",
      from: a,
      to: b,
      miles: lengthInMiles ? length : length / 1.609,
      seconds: Number(m.time) || 0,
    });
  }
  return out;
}

const kmBetween = (a: [number, number], b: { lat: number; lng: number }) => {
  const k = Math.cos(((a[0] + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(b.lat - a[0], (b.lng - a[1]) * k) * 111.2;
};

/** The catalog line for a crossing: both ends within `maxKm` of its ports, either direction. */
export function matchFerryLine(crossing: Pick<FerryCrossing, "from" | "to">, maxKm = 10): FerryLine | null {
  let best: FerryLine | null = null;
  let bestKm = Infinity;
  for (const l of FERRY_LINES) {
    const [p, q] = l.ports;
    const forward = Math.max(kmBetween(crossing.from, p), kmBetween(crossing.to, q));
    const back = Math.max(kmBetween(crossing.from, q), kmBetween(crossing.to, p));
    const km = Math.min(forward, back);
    if (km <= maxKm && km < bestKm) {
      best = l;
      bestKm = km;
    }
  }
  return best;
}

/** What the planner shows for a crossing: catalog data when known, the router's otherwise. */
export type FerryInfo = {
  name: string;
  operators: string[];
  crossingMin: number;
  checkInMin: number;
  priceKr: { from: number; to: number } | null;
  bookingUrl: string | null;
  known: boolean;
  /** Fare counted in the trip price: the middle of the catalog range, or a guess from the crossing time. */
  fareKr: number;
};

const DEFAULT_CHECK_IN_MIN = 30;

const roundTo50 = (kr: number) => Math.round(kr / 50) * 50;

/** Guess for a crossing not in the catalog: a base fare plus a little per minute on board. */
export function guessFareKr(crossingMin: number) {
  return roundTo50(300 + crossingMin * 6);
}

export function ferryInfo(crossing: FerryCrossing): FerryInfo {
  const l = matchFerryLine(crossing);
  if (!l) {
    const crossingMin = Math.max(1, Math.round(crossing.seconds / 60));
    return {
      name: crossing.name,
      operators: [],
      crossingMin,
      checkInMin: DEFAULT_CHECK_IN_MIN,
      priceKr: null,
      bookingUrl: null,
      known: false,
      fareKr: guessFareKr(crossingMin),
    };
  }
  return {
    name: l.name,
    operators: l.operators,
    crossingMin: l.crossingMin,
    checkInMin: l.checkInMin,
    priceKr: l.priceKr,
    bookingUrl: l.bookingUrl,
    known: true,
    fareKr: roundTo50((l.priceKr.from + l.priceKr.to) / 2),
  };
}

type SplitRoute = { miles: number; seconds: number; path: [number, number][]; source: "valhalla" | "osrm" | "air" };

/**
 * Cut a route at a ferry crossing: the drive to the port, the crossing, and the drive on.
 * The crossing keeps the router's ferry distance and time; the rest of the route's distance
 * and time is shared between the two drives by path length. `before`/`after` are null when
 * the route starts or ends at the port.
 */
export function splitAtFerry(
  route: SplitRoute,
  crossing: FerryCrossing,
): { before: SplitRoute | null; crossing: SplitRoute; after: SplitRoute | null } | null {
  const { path } = route;
  if (path.length < 2) return null;
  const nearest = (pt: [number, number], from = 0) => {
    let best = from;
    let bestD = Infinity;
    for (let i = from; i < path.length; i++) {
      const d = (path[i][0] - pt[0]) ** 2 + ((path[i][1] - pt[1]) * Math.cos((pt[0] * Math.PI) / 180)) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const ia = nearest(crossing.from);
  const ib = Math.max(ia, nearest(crossing.to, ia));
  const lengthKm = (pts: [number, number][]) => {
    let km = 0;
    for (let i = 1; i < pts.length; i++) {
      const k = Math.cos(((pts[i - 1][0] + pts[i][0]) / 2) * (Math.PI / 180));
      km += Math.hypot(pts[i][0] - pts[i - 1][0], (pts[i][1] - pts[i - 1][1]) * k) * 111.2;
    }
    return km;
  };
  const beforePath = path.slice(0, ia + 1);
  const afterPath = path.slice(ib);
  const kmBefore = lengthKm(beforePath);
  const kmAfter = lengthKm(afterPath);
  const driveMiles = Math.max(0, route.miles - crossing.miles);
  const driveSeconds = Math.max(0, route.seconds - crossing.seconds);
  const share = (km: number) => (kmBefore + kmAfter > 0 ? km / (kmBefore + kmAfter) : 0);
  const part = (pts: [number, number][], km: number): SplitRoute | null =>
    pts.length >= 2 && km > 0.5
      ? { miles: driveMiles * share(km), seconds: driveSeconds * share(km), path: pts, source: route.source }
      : null;
  const crossingPath = ib > ia ? path.slice(ia, ib + 1) : [crossing.from, crossing.to];
  return {
    before: part(beforePath, kmBefore),
    crossing: { miles: crossing.miles, seconds: crossing.seconds, path: crossingPath, source: route.source },
    after: part(afterPath, kmAfter),
  };
}

/** Port names for a crossing: the catalog's, else the router's "A - B" name. */
export function ferryPortNames(crossing: FerryCrossing): [string, string] {
  const l = matchFerryLine(crossing);
  if (l) {
    const [p, q] = l.ports;
    const forward = Math.hypot(crossing.from[0] - p.lat, crossing.from[1] - p.lng) <= Math.hypot(crossing.from[0] - q.lat, crossing.from[1] - q.lng);
    return forward ? [p.name, q.name] : [q.name, p.name];
  }
  const [a, b] = crossing.name.split(/\s+-\s+/);
  return [a?.trim() || "Ferry port", b?.trim() || "Ferry port"];
}
