import { type LegMode } from "./engine";

type Stop = { lat: number; lng: number };

export type DriveRouteJson = {
  miles: number;
  seconds: number;
  path: [number, number][];
  source: "valhalla" | "osrm";
};

function highwayBias(mode: LegMode) {
  if (mode === "eco") return 0.15;
  if (mode === "fastest") return 1;
  return 0.55;
}

async function valhalla(from: Stop, to: Stop, mode: LegMode): Promise<DriveRouteJson | null> {
  const res = await fetch("https://valhalla1.openstreetmap.de/route", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      locations: [
        { lat: from.lat, lon: from.lng },
        { lat: to.lat, lon: to.lng },
      ],
      costing: "auto",
      costing_options: {
        auto: {
          shortest: mode === "eco",
          use_highways: highwayBias(mode),
          use_tolls: mode === "eco" ? 0.1 : 0.5,
        },
      },
      directions_options: { units: "miles" },
      shape_format: "geojson",
    }),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    trip?: {
      summary?: { length?: number; time?: number };
      legs?: Array<{ shape?: { coordinates?: [number, number][] } | string }>;
    };
  };
  const summary = body.trip?.summary;
  const coords = body.trip?.legs?.[0]?.shape;
  const path: [number, number][] = [];
  if (coords && typeof coords === "object" && "coordinates" in coords && Array.isArray(coords.coordinates)) {
    for (const [lng, lat] of coords.coordinates) {
      if (Number.isFinite(lat) && Number.isFinite(lng)) path.push([lat, lng]);
    }
  }
  if (!summary || path.length < 2) return null;
  return {
    miles: Number(summary.length) || 0,
    seconds: Number(summary.time) || 0,
    path,
    source: "valhalla",
  };
}

async function osrm(from: Stop, to: Stop): Promise<DriveRouteJson | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    routes?: Array<{
      distance?: number;
      duration?: number;
      geometry?: { coordinates?: [number, number][] };
    }>;
  };
  const route = body.routes?.[0];
  const path: [number, number][] = [];
  for (const pt of route?.geometry?.coordinates ?? []) {
    const [lng, lat] = pt;
    if (Number.isFinite(lat) && Number.isFinite(lng)) path.push([lat, lng]);
  }
  if (!route || path.length < 2) return null;
  return {
    miles: (Number(route.distance) || 0) / 1609.344,
    seconds: Number(route.duration) || 0,
    path,
    source: "osrm",
  };
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
    const routed =
      (await valhalla(from, to, mode).catch(() => null)) ??
      (await osrm(from, to).catch(() => null));
    if (!routed) {
      return Response.json({ error: "No route" }, { status: 502 });
    }
    return Response.json(routed);
  } catch {
    return Response.json({ error: "Routing failed" }, { status: 500 });
  }
}
