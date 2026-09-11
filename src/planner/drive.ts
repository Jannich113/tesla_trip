import { costingFor, type LegMode } from "./modes";
import { estimateTolls } from "./tolls";
import { simplifyPath } from "./polyline";

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
  mode: LegMode,
) {
  if (!trips.length) return null;
  if (mode === "eco") {
    return trips.reduce((best, trip) =>
      Number(trip.summary?.length ?? Infinity) < Number(best.summary?.length ?? Infinity) ? trip : best,
    );
  }
  if (mode === "fastest") {
    return trips.reduce((best, trip) =>
      Number(trip.summary?.time ?? Infinity) < Number(best.summary?.time ?? Infinity) ? trip : best,
    );
  }
  return trips[0];
}

function pathFromShape(shape: { coordinates?: [number, number][] } | string | undefined) {
  const path: [number, number][] = [];
  if (shape && typeof shape === "object" && Array.isArray(shape.coordinates)) {
    for (const [lng, lat] of shape.coordinates) {
      if (Number.isFinite(lat) && Number.isFinite(lng)) path.push([lat, lng]);
    }
  }
  return path;
}

async function valhalla(from: Stop, to: Stop, mode: LegMode): Promise<DriveRouteJson | null> {
  const costing = costingFor(mode);
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
      shape_format: "geojson",
      alternates: mode === "standard" || mode === "cheapest" ? 0 : 2,
    }),
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
  const trip = pickValhallaTrip(trips, mode);
  const summary = trip?.summary;
  const path = pathFromShape(trip?.legs?.[0]?.shape);
  if (!summary || path.length < 2) return null;
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
}

type OsrmRoute = {
  distance?: number;
  duration?: number;
  geometry?: { coordinates?: [number, number][] };
};

function pickOsrm(routes: OsrmRoute[], mode: LegMode) {
  if (!routes.length) return null;
  if (mode === "eco") {
    return routes.reduce((best, route) =>
      Number(route.distance ?? Infinity) < Number(best.distance ?? Infinity) ? route : best,
    );
  }
  if (mode === "fastest") {
    return routes.reduce((best, route) =>
      Number(route.duration ?? Infinity) < Number(best.duration ?? Infinity) ? route : best,
    );
  }
  return routes[0];
}

async function osrmOnce(from: Stop, to: Stop, mode: LegMode, extra: string): Promise<DriveRouteJson | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=full&geometries=geojson&alternatives=true${extra}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const body = (await res.json()) as { routes?: OsrmRoute[] };
  const route = pickOsrm(body.routes ?? [], mode);
  const path: [number, number][] = [];
  for (const pt of route?.geometry?.coordinates ?? []) {
    const [lng, lat] = pt;
    if (Number.isFinite(lat) && Number.isFinite(lng)) path.push([lat, lng]);
  }
  if (!route || path.length < 2) return null;
  return withTolls(
    {
      miles: (Number(route.distance) || 0) / 1609.344,
      seconds: Number(route.duration) || 0,
      path: simplifyPath(path, 160),
      source: "osrm",
    },
    mode,
    false,
  );
}

async function osrm(from: Stop, to: Stop, mode: LegMode): Promise<DriveRouteJson | null> {
  const extras = mode === "eco" ? ["&exclude=motorway", ""] : [""];
  for (const extra of extras) {
    const routed = await osrmOnce(from, to, mode, extra).catch(() => null);
    if (routed) return routed;
  }
  return null;
}

function pickRouted(mode: LegMode, routes: DriveRouteJson[]): DriveRouteJson | null {
  const list = routes.filter((r) => r.path.length >= 2 && r.miles > 0);
  if (!list.length) return null;
  if (mode === "eco") {
    return list.reduce((best, r) => (r.miles < best.miles ? r : best));
  }
  if (mode === "fastest") {
    return list.reduce((best, r) => (r.seconds < best.seconds ? r : best));
  }
  const valhalla = list.find((r) => r.source === "valhalla");
  return valhalla ?? list[0];
}

export async function handleDriveRequest(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as {
      from?: Stop;
      to?: Stop;
      mode?: LegMode;
    };
    const from = body.from;
    const to = body.to;
    const mode = body.mode ?? "standard";
    if (
      !from ||
      !to ||
      !Number.isFinite(from.lat) ||
      !Number.isFinite(from.lng) ||
      !Number.isFinite(to.lat) ||
      !Number.isFinite(to.lng)
    ) {
      return Response.json({ error: "Need two points" }, { status: 400 });
    }
    const [v, o] = await Promise.all([
      valhalla(from, to, mode).catch(() => null),
      osrm(from, to, mode).catch(() => null),
    ]);
    const routed = pickRouted(mode, [v, o].filter((r): r is DriveRouteJson => Boolean(r)));
    if (!routed) {
      return Response.json({ error: "No route" }, { status: 502 });
    }
    return Response.json(routed);
  } catch {
    return Response.json({ error: "Routing failed" }, { status: 500 });
  }
}
