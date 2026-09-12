import { createFileRoute } from "@tanstack/react-router";
import { noStore } from "@/lib/http-cache";
import { env } from "@/lib/env.server";
import { haversineM } from "@/planner/insert";
import { isDcStation, networkFromOperator, networkFromOsmTags } from "@/planner/osm-operator";
import { rateForNetwork } from "@/planner/networks";
import { seedsAlongPath } from "@/planner/seed-chargers";
import { encodePolyline, polylineBufferKm, chargersOnPath } from "@/planner/polyline";

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
  usdPerKwh: number;
  operator: string;
  preset: false;
  radiusM: number;
};

function samplePath(path: [number, number][], everyM = 40_000, maxPts = 10) {
  if (path.length < 2) return path.slice(0, 2);
  const out: [number, number][] = [path[0]];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    acc += haversineM(
      { lat: path[i - 1][0], lng: path[i - 1][1] },
      { lat: path[i][0], lng: path[i][1] },
    );
    if (acc >= everyM) {
      out.push(path[i]);
      acc = 0;
      if (out.length >= maxPts - 1) break;
    }
  }
  const last = path[path.length - 1];
  const prev = out[out.length - 1];
  if (haversineM({ lat: prev[0], lng: prev[1] }, { lat: last[0], lng: last[1] }) > 8_000) out.push(last);
  return out.slice(0, maxPts);
}

function downsample(path: [number, number][], max = 80) {
  if (path.length <= max) return path;
  const step = Math.ceil(path.length / max);
  const out = path.filter((_, i) => i % step === 0);
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function overpassQuery(samples: [number, number][], radiusM: number) {
  const around = samples
    .map(([lat, lng]) => `  nwr["amenity"="charging_station"](around:${Math.round(radiusM)},${lat.toFixed(5)},${lng.toFixed(5)});`)
    .join("\n");
  return `[out:json][timeout:12];\n(\n${around}\n);\nout center tags;`;
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
  const rate = networkId ? rateForNetwork(networkId, false) : null;
  return {
    id: `osm-${el.type}-${el.id}`,
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

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
];

async function fetchOneOverpass(url: string, query: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: `data=${encodeURIComponent(query)}`,
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { elements?: OsmEl[] };
    const byId = new Map<string, RouteCharger>();
    for (const el of body.elements ?? []) {
      const c = toCharger(el);
      if (c) byId.set(c.id, c);
    }
    return [...byId.values()];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpass(samples: [number, number][], radiusM: number) {
  const query = overpassQuery(samples, radiusM);
  for (const url of OVERPASS) {
    const rows = await fetchOneOverpass(url, query);
    if (rows.length) return rows;
  }
  return [];
}

type OcmPoi = {
  ID?: number;
  UUID?: string;
  AddressInfo?: { Title?: string; Latitude?: number; Longitude?: number };
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
  if (!networkId && kw < 50) return null;
  const rate = networkId ? rateForNetwork(networkId, false) : null;
  return {
    id: `ocm-${poi.ID ?? poi.UUID ?? `${lat},${lng}`}`,
    name,
    short: (poi.OperatorInfo?.Title || name).split(/[,(/]/)[0].trim().slice(0, 22),
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

async function fetchOcmPolyline(path: [number, number][], radiusKm: number): Promise<RouteCharger[]> {
  const encoded = encodePolyline(path);
  const dist = Math.max(5, Math.min(18, Math.round(radiusKm)));
  const base =
    `https://api.openchargemap.io/v3/poi/?output=json&compact=false&verbose=false` +
    `&client=tesla-trip` +
    `&key=${encodeURIComponent(OCM_KEY)}` +
    `&polyline=${encodeURIComponent(encoded)}` +
    `&distance=${dist}&distanceunit=KM` +
    `&minpowerkw=50&levelid=3&statustypeid=50` +
    `&maxresults=200`;
  const urls = [
    `${base}&connectiontypeid=33,30`,
    base,
  ];
  for (const url of urls) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "X-API-Key": OCM_KEY },
        signal: ctrl.signal,
      });
      if (!res.ok) continue;
      const body = (await res.json()) as OcmPoi[];
      if (!Array.isArray(body) || !body.length) continue;
      const rows = body.map(ocmToCharger).filter((c): c is RouteCharger => Boolean(c));
      if (rows.length) return rows;
    } catch {
      /* try looser filters */
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

async function fetchOcmAt(lat: number, lng: number, radiusKm: number): Promise<RouteCharger[]> {
  const url =
    `https://api.openchargemap.io/v3/poi/?output=json&compact=false&verbose=false` +
    `&key=${encodeURIComponent(OCM_KEY)}` +
    `&latitude=${lat.toFixed(5)}&longitude=${lng.toFixed(5)}` +
    `&distance=${Math.round(radiusKm)}&distanceunit=KM&maxresults=40&minpowerkw=50`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", "X-API-Key": OCM_KEY }, signal: ctrl.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as OcmPoi[];
    if (!Array.isArray(body)) return [];
    return body.map(ocmToCharger).filter((c): c is RouteCharger => Boolean(c));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOcm(path: [number, number][], samples: [number, number][], tightKm: number, wideKm: number) {
  const tightHits = chargersOnPath(await fetchOcmPolyline(path, tightKm), path, wideKm);
  if (wideKm <= tightKm + 1 && tightHits.length >= 8) return tightHits;
  const wideHits = chargersOnPath(await fetchOcmPolyline(path, wideKm), path, wideKm);
  if (wideHits.length) return wideHits.length >= tightHits.length ? wideHits : tightHits;
  if (tightHits.length) return tightHits;
  const chunks = await Promise.all(samples.slice(0, 4).map(([lat, lng]) => fetchOcmAt(lat, lng, wideKm)));
  const byId = new Map<string, RouteCharger>();
  for (const row of chunks.flat()) byId.set(row.id, row);
  return chargersOnPath([...byId.values()], path, wideKm);
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

async function searchCorridor(path: [number, number][], asked: number) {
  const buf = polylineBufferKm(path);
  const tightKm = buf.tight;
  const wideKm = Math.min(
    40,
    Math.max(buf.wide, tightKm, Number.isFinite(asked) && asked > 0 ? asked : 0),
  );
  const radiusM = wideKm * 1000;
  const seed = seedsAlongPath(path, radiusM);
  const samples = samplePath(path, 40_000, 8);
  const [ocm, osmRaw] = await Promise.all([
    fetchOcm(path, samples, tightKm, wideKm),
    fetchOverpass(samples, radiusM),
  ]);
  const osm = chargersOnPath(osmRaw, path, wideKm);
  return {
    chargers: mergeChargers(seed, [...ocm, ...osm]),
    source: [ocm.length && "ocm", osm.length && "osm", seed.length && "seed"].filter(Boolean).join("+") || "none",
    seed: seed.length,
    live: ocm.length + osm.length,
    ocm: ocm.length,
    samples: samples.length,
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
          const chunks = await Promise.all(rawPaths.map((path) => searchCorridor(path, asked)));
          let chargers: RouteCharger[] = [];
          let seed = 0;
          let ocm = 0;
          let live = 0;
          let samples = 0;
          let source = "none";
          let bufferKm = chunks[0]?.bufferKm;
          for (const chunk of chunks) {
            chargers = mergeChargers(chargers, chunk.chargers);
            seed += chunk.seed;
            ocm += chunk.ocm;
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
