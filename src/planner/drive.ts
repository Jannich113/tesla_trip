import { costingFor, type LegMode } from "./modes";
import { estimateTolls } from "./tolls";
import { decodePolyline, simplifyPath } from "./polyline";
import { haversineM } from "./insert";
import { pickEcoRoute, pickRouted } from "./pick-route";
import { noStore, publicCache } from "@/lib/http-cache";

type Stop = { lat: number; lng: number };

export type DriveRouteJson = {
  miles: number;
  seconds: number;
  path: [number, number][];
  source: "valhalla" | "osrm";
  hasToll?: boolean;
  tollKr?: number;
  tollLabel?: string;
};

function withTolls(route: DriveRouteJson, mode: LegMode, hasToll = false): DriveRouteJson {
  const toll = estimateTolls(route.path, route.miles, hasToll, mode);
  return { ...route, hasToll: toll.hasToll, tollKr: toll.kr, tollLabel: toll.label };
}

function pickValhallaTrip(
  trips: Array<{
    summary?: { length?: number; time?: number; has_toll?: boolean };
    legs?: Array<{ shape?: { coordinates?: [number, number][] } | string }>;
  }>,
) {
  if (!trips.length) return null;
  return trips.reduce((best, trip) =>
    Number(trip.summary?.time ?? Infinity) < Number(best.summary?.time ?? Infinity) ? trip : best,
  );
}

function pathFromShape(shape: { coordinates?: [number, number][] } | string | undefined) {
  if (typeof shape === "string" && shape.length > 4) {
    for (const prec of [6, 5]) {
      const decoded = decodePolyline(shape, prec);
      if (decoded.length >= 3) return simplifyPath(decoded, 160);
    }
    return [];
  }
  const path: [number, number][] = [];
  if (shape && typeof shape === "object" && Array.isArray(shape.coordinates)) {
    for (const [lng, lat] of shape.coordinates) {
      if (Number.isFinite(lat) && Number.isFinite(lng)) path.push([lat, lng]);
    }
  }
  return simplifyPath(path, 160);
}

function anchored(path: [number, number][], from: Stop, to: Stop) {
  if (path.length < 3) return false;
  const a = path[0];
  const b = path[path.length - 1];
  return (
    haversineM({ lat: a[0], lng: a[1] }, from) < 50_000 &&
    haversineM({ lat: b[0], lng: b[1] }, to) < 50_000
  );
}

async function valhalla(from: Stop, to: Stop, mode: LegMode): Promise<DriveRouteJson | null> {
  const costing = costingFor(mode);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 22_000);
  try {
    const res = await fetch("https://valhalla1.openstreetmap.de/route", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        locations: [
          { lat: from.lat, lon: from.lng },
          { lat: to.lat, lon: to.lng },
        ],
        costing: "auto",
        costing_options: { auto: costing },
        directions_options: { units: "miles" },
        shape_format: "polyline6",
        alternates: 0,
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      trip?: {
        summary?: { length?: number; time?: number; has_toll?: boolean };
        legs?: Array<{ shape?: { coordinates?: [number, number][] } | string }>;
      };
      alternates?: Array<{
        trip?: {
          summary?: { length?: number; time?: number; has_toll?: boolean };
          legs?: Array<{ shape?: { coordinates?: [number, number][] } | string }>;
        };
      }>;
    };
    const trips = [body.trip, ...(body.alternates ?? []).map((alt) => alt.trip)].filter(
      (trip): trip is NonNullable<typeof trip> => Boolean(trip),
    );
    const trip = pickValhallaTrip(trips);
    const summary = trip?.summary;
    const path = pathFromShape(trip?.legs?.[0]?.shape);
    if (!summary || path.length < 3) return null;
    return withTolls(
      {
        miles: Number(summary.length) || 0,
        seconds: Number(summary.time) || 0,
        path: simplifyPath(path, 160),
        source: "valhalla",
      },
      mode,
      Boolean(summary.has_toll),
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type OsrmRoute = {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: [number, number][] };
};

function pickOsrm(routes: OsrmRoute[]) {
  if (!routes.length) return null;
  return routes.reduce((best, route) =>
    Number(route.duration ?? Infinity) < Number(best.duration ?? Infinity) ? route : best,
  );
}

async function osrm(from: Stop, to: Stop, extra = ""): Promise<DriveRouteJson | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=simplified&geometries=geojson${extra}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { routes?: OsrmRoute[]; code?: string };
    if (body.code && body.code !== "Ok") return null;
    const route = pickOsrm(body.routes ?? []);
    const path: [number, number][] = [];
    for (const pt of route?.geometry?.coordinates ?? []) {
      const [lng, lat] = pt;
      if (Number.isFinite(lat) && Number.isFinite(lng)) path.push([lat, lng]);
    }
    if (!route || path.length < 3) return null;
    return withTolls(
      {
        miles: (Number(route.distance) || 0) / 1609.344,
        seconds: Number(route.duration) || 0,
        path: simplifyPath(path, 220),
        source: "osrm",
      },
      extra.includes("motorway") || extra.includes("toll") ? "eco" : "fastest",
      false,
    );
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function hopStops(from: Stop, to: Stop, maxKm = 900): Stop[] {
  const km = haversineM(from, to) / 1000;
  const n = Math.max(1, Math.ceil(km / maxKm));
  if (n <= 1) return [from, to];
  const out: Stop[] = [from];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    out.push({ lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t });
  }
  out.push(to);
  return out;
}

function stitch(parts: DriveRouteJson[], mode: LegMode): DriveRouteJson | null {
  const ok = parts.filter((p) => p.path.length >= 2 && p.miles > 0);
  if (!ok.length) return null;
  const path: [number, number][] = [];
  for (const part of ok) {
    for (const pt of part.path) {
      const last = path[path.length - 1];
      if (last && Math.abs(last[0] - pt[0]) < 1e-5 && Math.abs(last[1] - pt[1]) < 1e-5) continue;
      path.push(pt);
    }
  }
  if (path.length < 3) return null;
  return withTolls(
    {
      miles: ok.reduce((n, p) => n + p.miles, 0),
      seconds: ok.reduce((n, p) => n + p.seconds, 0),
      path: simplifyPath(path, 220),
      source: ok.some((p) => p.source === "osrm") ? "osrm" : "valhalla",
    },
    mode,
    ok.some((p) => p.hasToll),
  );
}

async function hop(from: Stop, to: Stop, mode: LegMode): Promise<DriveRouteJson | null> {
  if (mode === "eco") {
    const [v, o] = await Promise.all([
      valhalla(from, to, "eco").catch(() => null),
      osrm(from, to).catch(() => null),
    ]);
    const quiet = [v, o].filter((r): r is DriveRouteJson => Boolean(r && okRoute(r, from, to)));
    return pickEcoRoute(o && okRoute(o, from, to) ? o : null, quiet.filter((r) => r.source === "valhalla")) ?? (o && okRoute(o, from, to) ? o : v);
  }
  const [v, o] = await Promise.all([
    valhalla(from, to, "fastest").catch(() => null),
    osrm(from, to).catch(() => null),
  ]);
  return pickRouted(
    "fastest",
    [v, o].filter((r): r is DriveRouteJson => Boolean(r && okRoute(r, from, to))),
  );
}

async function routeChunked(from: Stop, to: Stop, mode: LegMode): Promise<DriveRouteJson | null> {
  const stops = hopStops(from, to, 900);
  if (stops.length === 2) return hop(from, to, mode);
  const parts = await Promise.all(
    stops.slice(0, -1).map((s, i) => hop(s, stops[i + 1], mode)),
  );
  if (parts.some((p) => !p)) return null;
  return stitch(parts as DriveRouteJson[], mode);
}

function okRoute(route: DriveRouteJson | null, from: Stop, to: Stop) {
  return Boolean(route && anchored(route.path, from, to) && route.seconds > 0);
}

export async function routeDrive(from: Stop, to: Stop, mode: LegMode): Promise<DriveRouteJson | null> {
  if (mode === "fastest" || mode === "cheapest") {
    const os = await osrm(from, to).catch(() => null);
    if (os && okRoute(os, from, to)) return withTolls(os, mode, Boolean(os.hasToll));
    const base = await hop(from, to, "fastest");
    return base ? withTolls(base, mode, Boolean(base.hasToll)) : null;
  }
  const km = haversineM(from, to) / 1000;
  if (km > 1300) {
    const long = await routeChunked(from, to, "eco");
    if (long) return withTolls(long, "eco", Boolean(long.hasToll));
  }
  const picked = await hop(from, to, "eco");
  if (picked) return withTolls(picked, "eco", Boolean(picked.hasToll));
  const fallback = await osrm(from, to).catch(() => null);
  return fallback && okRoute(fallback, from, to) ? withTolls(fallback, "eco", Boolean(fallback.hasToll)) : null;
}

function parsePoint(raw: string | null): Stop | null {
  if (!raw) return null;
  const [lat, lng] = raw.split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function parseMode(raw: string | null | undefined): LegMode {
  return raw === "eco" || raw === "cheapest" || raw === "fastest" ? raw : "fastest";
}

async function readDriveInput(request: Request): Promise<{ from: Stop; to: Stop; mode: LegMode } | { error: string }> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const from = parsePoint(url.searchParams.get("from"));
    const to = parsePoint(url.searchParams.get("to"));
    if (!from || !to) return { error: "Need two points" };
    return { from, to, mode: parseMode(url.searchParams.get("mode")) };
  }
  const body = (await request.json()) as { from?: Stop; to?: Stop; mode?: LegMode };
  const from = body.from;
  const to = body.to;
  if (
    !from ||
    !to ||
    !Number.isFinite(from.lat) ||
    !Number.isFinite(from.lng) ||
    !Number.isFinite(to.lat) ||
    !Number.isFinite(to.lng)
  ) {
    return { error: "Need two points" };
  }
  return { from, to, mode: parseMode(body.mode) };
}

export async function handleDriveRequest(request: Request): Promise<Response> {
  try {
    const input = await readDriveInput(request);
    if ("error" in input) {
      return Response.json({ error: input.error }, { status: 400, headers: noStore });
    }
    const { from, to, mode } = input;
    const routed = await routeDrive(from, to, mode);
    if (!routed) {
      return Response.json({ error: "No route" }, { status: 502, headers: noStore });
    }
    return Response.json(routed, { headers: publicCache(3600, 6 * 3600) });
  } catch {
    return Response.json({ error: "Routing failed" }, { status: 500, headers: noStore });
  }
}
