import { createFileRoute } from "@tanstack/react-router";
import { noStore } from "@/lib/http-cache";
import { env } from "@/lib/env.server";
import { alongFraction, minDistToPathM } from "@/planner/insert";
import { isDcStation, networkFromOperator, networkFromOsmTags } from "@/planner/osm-operator";
import { rateAt } from "@/planner/networks";
import { seedsAlongPath } from "@/planner/seed-chargers";
import {
  encodePolyline,
  polylineBufferKm,
  chargersOnPath,
  pathCoveredBy,
  pathLengthKm,
  splitPathByKm,
} from "@/planner/polyline";
import { overpassCorridorQuery, sectionNeedsOsm } from "@/planner/osm-query";
import {
  inPathBox,
  SUPERCHARGE_INFO_URL,
  superchargerFromSite,
  type SuperchargeInfoSite,
} from "@/planner/supercharge-info";
import { TtlCache } from "@/lib/ttl-cache";

const DKK_PER_USD = 6.85;
const OCM_KEY = env("OPENCHARGEMAP_KEY") ?? "d670b729-7bd0-40dd-8a17-4b881edf1a68";

export type RouteCharger = {
  id: string;
  name: string;
  short: string;
  lat: number;
  lng: number;
  kind: "supercharger" | "custom";
  networkId: string | null;
  /** ISO 3166 alpha-2 when the source gives it. */
  country?: string | null;
  usdPerKwh: number;
  operator: string;
  preset: false;
  radiusM: number;
};

function downsample(path: [number, number][], max = 80) {
  if (path.length <= max) return path;
  const step = Math.ceil(path.length / max);
  const out = path.filter((_, i) => i % step === 0);
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}


type OsmEl = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

function toCharger(el: OsmEl): RouteCharger | null {
  const tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const networkId = networkFromOsmTags(tags);
  if (!networkId && !isDcStation(tags)) return null;
  const operator = tags.operator || tags.brand || tags.name || "Charger";
  const name = tags.name || operator;
  const short = (tags.brand || tags.operator || name).split(/[,(/]/)[0].trim().slice(0, 22);
  const country = tags["addr:country"]?.toUpperCase() || null;
  const rate = networkId ? rateAt(networkId, false, country) : null;
  return {
    id: `osm-${el.type}-${el.id}`,
    country,
    name,
    short,
    lat: lat as number,
    lng: lon as number,
    kind: networkId === "tesla" ? "supercharger" : "custom",
    networkId,
    usdPerKwh: (rate ?? 4.2) / DKK_PER_USD,
    operator,
    preset: false,
    radiusM: 250,
  };
}

// Not overpass.osm.ch: it only holds Swiss data, so elsewhere it answers "no chargers",
// and that wrong empty answer would be cached when the main mirrors are down (#72).
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

/** One Overpass mirror. null = no answer (try the next mirror), [] = no chargers there. */
async function fetchOneOverpass(url: string, query: string): Promise<RouteCharger[] | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `data=${encodeURIComponent(query)}`,
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { elements?: OsmEl[] };
    const byId = new Map<string, RouteCharger>();
    for (const el of body.elements ?? []) {
      const c = toCharger(el);
      if (c) byId.set(c.id, c);
    }
    return [...byId.values()];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** OpenStreetMap answers per road section, 12 h (Overpass is shared and rate-limited too). */
const osmCache = new TtlCache<RouteCharger[]>(12 * 60 * 60 * 1000, 400);

/**
 * After every mirror failed, OpenStreetMap is skipped for a while: the public servers can be
 * down for hours, and waiting on them would slow every lookup in sparse countries.
 */
const OSM_BACKOFF_MS = 15 * 60 * 1000;
let osmDownUntil = 0;

/** OpenStreetMap chargers along one road section (#72), first mirror that answers. */
async function fetchOsmSection(section: [number, number][], radiusM: number, stats: OcmStats): Promise<RouteCharger[]> {
  const query = overpassCorridorQuery(section, radiusM);
  const hit = osmCache.get(query);
  if (hit) {
    stats.osmCached++;
    return hit;
  }
  if (Date.now() < osmDownUntil) {
    stats.osmSkipped++;
    return [];
  }
  for (const url of OVERPASS) {
    stats.osmRequests++;
    const rows = await fetchOneOverpass(url, query);
    if (rows) {
      osmCache.set(query, rows);
      return rows;
    }
  }
  stats.osmFailed++;
  osmDownUntil = Date.now() + OSM_BACKOFF_MS;
  return [];
}

type OcmPoi = {
  ID?: number;
  UUID?: string;
  AddressInfo?: { Title?: string; Latitude?: number; Longitude?: number; Country?: { ISOCode?: string } };
  OperatorInfo?: { Title?: string };
  StatusType?: { IsOperational?: boolean };
  UsageType?: { Title?: string };
  Connections?: Array<{ PowerKW?: number | null }>;
};

function ocmToCharger(poi: OcmPoi): RouteCharger | null {
  const addr = poi.AddressInfo ?? {};
  const lat = addr.Latitude;
  const lng = addr.Longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (poi.StatusType?.IsOperational === false) return null;
  const usage = poi.UsageType?.Title ?? "";
  if (/private/i.test(usage) && !/public/i.test(usage)) return null;
  const kw = Math.max(0, ...(poi.Connections ?? []).map((c) => Number(c.PowerKW) || 0));
  if (kw > 0 && kw < 50) return null;
  const operator = poi.OperatorInfo?.Title || addr.Title || "Charger";
  const name = addr.Title || operator;
  const networkId = networkFromOperator(`${operator} ${name}`);
  // The query asks for DC fast chargers only (levelid=3); a missing power figure is a data
  // gap, common where OCM is thin (#72), not a slow charger. Known slow ones are dropped above.
  const country = addr.Country?.ISOCode?.toUpperCase() || null;
  const rate = networkId ? rateAt(networkId, false, country) : null;
  return {
    id: `ocm-${poi.ID ?? poi.UUID ?? `${lat},${lng}`}`,
    country,
    name,
    short: (addr.Title || name).split(/[,(/]/)[0].trim().slice(0, 28),
    lat: lat as number,
    lng: lng as number,
    kind: networkId === "tesla" ? "supercharger" : "custom",
    networkId,
    usdPerKwh: (rate ?? 4.2) / DKK_PER_USD,
    operator,
    preset: false,
    radiusM: 250,
  };
}

/** What one corridor search ran into; any trouble marks the answer as partial. */
type OcmStats = {
  requests: number;
  cached: number;
  throttled: number;
  failed: number;
  osmRequests: number;
  osmCached: number;
  osmFailed: number;
  osmSkipped: number;
};

const newStats = (): OcmStats => ({
  requests: 0,
  cached: 0,
  throttled: 0,
  failed: 0,
  osmRequests: 0,
  osmCached: 0,
  osmFailed: 0,
  osmSkipped: 0,
});

/**
 * OpenChargeMap answers by URL (minus the API key) for 12 hours. Chargers rarely move, and
 * OCM throttles hard (HTTP 429), so asking again for the same stretch is the main risk.
 */
const ocmCache = new TtlCache<OcmPoi[]>(12 * 60 * 60 * 1000, 800);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One OCM request: cached, retried once when throttled. null = no answer (not "no chargers"). */
async function ocmGet(url: string, stats: OcmStats, timeoutMs = 10_000): Promise<OcmPoi[] | null> {
  const key = url.replace(/&key=[^&]*/, "");
  const hit = ocmCache.get(key);
  if (hit) {
    stats.cached++;
    return hit;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      stats.requests++;
      const res = await fetch(url, { headers: { Accept: "application/json", "X-API-Key": OCM_KEY }, signal: ctrl.signal });
      if (res.status === 429) {
        stats.throttled++;
        const wait = Number(res.headers.get("retry-after"));
        await sleep(Math.min(3_000, Number.isFinite(wait) && wait > 0 ? wait * 1000 : 1_500));
        continue;
      }
      if (!res.ok) break;
      const body = (await res.json()) as OcmPoi[];
      if (!Array.isArray(body)) break;
      ocmCache.set(key, body);
      return body;
    } catch {
      break;
    } finally {
      clearTimeout(timer);
    }
  }
  stats.failed++;
  return null;
}

const toChargers = (rows: OcmPoi[]) => rows.map(ocmToCharger).filter((c): c is RouteCharger => Boolean(c));

/** Chargers along one section. null = OCM gave no answer, so the section is unknown. */
async function fetchOcmPolyline(path: [number, number][], radiusKm: number, stats: OcmStats): Promise<RouteCharger[] | null> {
  const dist = Math.max(5, Math.min(18, Math.round(radiusKm)));
  const base =
    `https://api.openchargemap.io/v3/poi/?output=json&compact=false&verbose=false` +
    `&client=tesla-trip` +
    `&key=${encodeURIComponent(OCM_KEY)}` +
    `&polyline=${encodeURIComponent(encodePolyline(path))}` +
    `&distance=${dist}&distanceunit=KM` +
    `&minpowerkw=50&levelid=3&statustypeid=50` +
    `&maxresults=200`;
  // CCS / Tesla first; the looser query only when that finds nothing.
  const strict = await ocmGet(`${base}&connectiontypeid=33,30`, stats);
  if (strict === null) return null;
  if (strict.length) return toChargers(strict);
  const loose = await ocmGet(base, stats);
  return loose === null ? null : toChargers(loose);
}

/** Route sections looked up separately; OCM returns at most 200 chargers per request. */
const OCM_SECTION_KM = 250;
const OCM_PARALLEL = 2;

/**
 * One OCM lookup per ~250 km section, skipping sections an earlier route already covered
 * (Eco and Fastest usually share most of the road).
 */
async function fetchSections(
  path: [number, number][],
  wideKm: number,
  searched: [number, number][][],
  stats: OcmStats,
): Promise<{ ocm: RouteCharger[]; osm: RouteCharger[] }> {
  const sections = splitPathByKm(path, OCM_SECTION_KM).filter(
    (part) => !pathCoveredBy(part, searched, Math.min(8_000, wideKm * 500)),
  );
  const ocm = new Map<string, RouteCharger>();
  const osm = new Map<string, RouteCharger>();
  // OSM is a narrower search (it also lists slow chargers, which are filtered out afterwards).
  const osmRadiusM = Math.min(wideKm, 15) * 1000;
  const lookUp = async (part: [number, number][]) => {
    const found = chargersOnPath((await fetchOcmPolyline(part, wideKm, stats)) ?? [], part, wideKm);
    for (const row of found) ocm.set(row.id, row);
    // Where OpenChargeMap leaves a long gap (#72), ask OpenStreetMap along the same stretch.
    const sectionKm = pathLengthKm(part);
    const positionsKm = found
      .filter((c) => minDistToPathM(c.lat, c.lng, part) <= 10_000)
      .map((c) => alongFraction(part, c.lat, c.lng) * sectionKm);
    if (sectionNeedsOsm(positionsKm, sectionKm)) {
      for (const row of chargersOnPath(await fetchOsmSection(part, osmRadiusM, stats), part, wideKm)) osm.set(row.id, row);
    }
  };
  for (let i = 0; i < sections.length; i += OCM_PARALLEL) {
    await Promise.all(sections.slice(i, i + OCM_PARALLEL).map(lookUp));
  }
  searched.push(path);
  return { ocm: [...ocm.values()], osm: [...osm.values()] };
}

/** All open Tesla Superchargers from supercharge.info, refreshed once a day (#72). */
const SC_TTL_MS = 24 * 60 * 60 * 1000;
let scRows: RouteCharger[] = [];
let scAt = 0;
let scLoading: Promise<void> | null = null;

async function superchargers(): Promise<RouteCharger[]> {
  if (scRows.length && Date.now() - scAt < SC_TTL_MS) return scRows;
  scLoading ??= (async () => {
    try {
      const res = await fetch(SUPERCHARGE_INFO_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return;
      const sites = (await res.json()) as SuperchargeInfoSite[];
      const rows: RouteCharger[] = [];
      for (const site of Array.isArray(sites) ? sites : []) {
        const row = superchargerFromSite(site);
        if (row) rows.push(row);
      }
      // Keep the last good list if a refresh comes back empty or broken.
      if (rows.length) {
        scRows = rows;
        scAt = Date.now();
      }
    } catch {
      /* keep the last good list */
    } finally {
      scLoading = null;
    }
  })();
  await scLoading;
  return scRows;
}

function mergeChargers(seed: RouteCharger[], live: RouteCharger[]) {
  const out = new Map<string, RouteCharger>();
  for (const c of seed) out.set(c.id, c);
  for (const c of live) {
    const near = [...out.values()].some(
      (s) => Math.abs(s.lat - c.lat) < 0.008 && Math.abs(s.lng - c.lng) < 0.012 && s.networkId === c.networkId,
    );
    if (!near) out.set(c.id, c);
  }
  return [...out.values()];
}

async function searchCorridor(path: [number, number][], asked: number, searched: [number, number][][], stats: OcmStats) {
  const buf = polylineBufferKm(path);
  const tightKm = buf.tight;
  const wideKm = Math.min(
    40,
    Math.max(buf.wide, tightKm, Number.isFinite(asked) && asked > 0 ? asked : 0),
  );
  const radiusM = wideKm * 1000;
  const seed = seedsAlongPath(path, radiusM);
  const [{ ocm, osm }, allSc] = await Promise.all([fetchSections(path, wideKm, searched, stats), superchargers()]);
  const sc = chargersOnPath(inPathBox(allSc, path, wideKm), path, wideKm);
  return {
    // Superchargers first: they win over an OCM entry for the same site (better names).
    chargers: mergeChargers([...sc, ...seed], [...ocm, ...osm]),
    source: [ocm.length && "ocm", osm.length && "osm", sc.length && "sci", seed.length && "seed"].filter(Boolean).join("+") || "none",
    seed: seed.length,
    live: ocm.length + osm.length + sc.length,
    ocm: ocm.length,
    osm: osm.length,
    superchargeInfo: sc.length,
    samples: 0,
    bufferKm: { tight: tightKm, wide: wideKm, pathKm: buf.pathKm },
  };
}

export const Route = createFileRoute("/api/chargers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            path?: [number, number][];
            paths?: [number, number][][];
            radiusKm?: number;
          };
          const rawPaths = (body.paths?.length ? body.paths : body.path ? [body.path] : [])
            .map((p) => downsample((p ?? []).filter((pt) => Number.isFinite(pt[0]) && Number.isFinite(pt[1]))))
            .filter((p) => p.length >= 2)
            .slice(0, 6);
          if (!rawPaths.length) return Response.json({ chargers: [], source: "none" }, { headers: noStore });
          const asked = Number(body.radiusKm);
          const searched: [number, number][][] = [];
          const stats = newStats();
          const chunks = [];
          for (const path of rawPaths) chunks.push(await searchCorridor(path, asked, searched, stats));
          let chargers: RouteCharger[] = [];
          let seed = 0;
          let ocm = 0;
          let superchargeInfo = 0;
          let live = 0;
          let samples = 0;
          let source = "none";
          const bufferKm = chunks[0]?.bufferKm;
          for (const chunk of chunks) {
            chargers = mergeChargers(chargers, chunk.chargers);
            seed += chunk.seed;
            ocm += chunk.ocm;
            superchargeInfo += chunk.superchargeInfo;
            live += chunk.live;
            samples += chunk.samples;
            if (chunk.source !== "none") source = chunk.source;
          }
          return Response.json({
            chargers,
            source,
            seed,
            live,
            ocm,
            samples,
            polyline: true,
            // Some sections got no answer (OCM throttled or failed): the list is incomplete.
            // OpenChargeMap gaps only: OpenStreetMap is a best-effort extra, and retrying the
            // whole lookup while its servers are down would only slow the app.
            partial: stats.failed > 0,
            osmSkipped: stats.osmSkipped,
            ocmRequests: stats.requests,
            ocmCached: stats.cached,
            ocmThrottled: stats.throttled,
            superchargeInfo,
            osmRequests: stats.osmRequests,
            osmCached: stats.osmCached,
            corridors: rawPaths.length,
            bufferKm,
            updatedAt: new Date().toISOString(),
          }, { headers: noStore });
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "charger search failed", chargers: [] },
            { status: 502, headers: noStore },
          );
        }
      },
    },
  },
});
