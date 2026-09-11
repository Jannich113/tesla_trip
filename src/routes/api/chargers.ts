import { createFileRoute } from "@tanstack/react-router";
import { haversineM } from "@/planner/insert";
import { isDcStation, networkFromOsmTags } from "@/planner/osm-operator";
import { rateForNetwork } from "@/planner/networks";

const DKK_PER_USD = 6.85;

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

function samplePath(path: [number, number][], everyM = 45_000, maxPts = 8) {
  if (path.length < 2) return path;
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

function overpassQuery(samples: [number, number][], radiusM: number) {
  const around = samples.map(([lat, lng]) => `  nwr["amenity"="charging_station"](around:${Math.round(radiusM)},${lat.toFixed(5)},${lng.toFixed(5)});`).join("\n");
  return `[out:json][timeout:22];\n(\n${around}\n);\nout center tags;`;
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

async function fetchOverpass(samples: [number, number][], radiusM: number) {
  const query = overpassQuery(samples, radiusM);
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const body = (await res.json()) as { elements?: OsmEl[] };
  const byId = new Map<string, RouteCharger>();
  for (const el of body.elements ?? []) {
    const c = toCharger(el);
    if (c) byId.set(c.id, c);
  }
  return [...byId.values()];
}

export const Route = createFileRoute("/api/chargers")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { path?: [number, number][]; radiusKm?: number };
          const path = (body.path ?? []).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
          if (path.length < 2) return Response.json({ chargers: [], source: "none" });
          const radiusM = Math.min(40_000, Math.max(8_000, (body.radiusKm ?? 22) * 1000));
          const samples = samplePath(path, 48_000, 8);
          const chargers = await fetchOverpass(samples, radiusM);
          return Response.json(
            { chargers, source: "overpass", samples: samples.length, updatedAt: new Date().toISOString() },
            { headers: { "Cache-Control": "public, max-age=300" } },
          );
        } catch (err) {
          return Response.json(
            { error: err instanceof Error ? err.message : "charger search failed", chargers: [] },
            { status: 502 },
          );
        }
      },
    },
  },
});
