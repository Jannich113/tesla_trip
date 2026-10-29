export type AddressHit = {
  label: string;
  lat: number;
  lng: number;
};

const NOMINATIM = "https://nominatim.openstreetmap.org";

/**
 * "55.4038, 10.4024", "55.4038 10.4024" or "55.4038;10.4024" (lat first, dot decimals).
 * Returns null for anything else, including out-of-range values.
 */
export function parseCoordinates(input: string): { lat: number; lng: number } | null {
  const m = input.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function formatCoordinates(lat: number, lng: number) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

type ReverseRow = {
  name?: string;
  display_name?: string;
  address?: Record<string, string | undefined>;
};

/** A short "Vestergade 12, Odense" style label from a Nominatim reverse result. */
export function labelFromReverse(row: ReverseRow): string {
  const a = row.address ?? {};
  const street = a.road ? [a.road, a.house_number].filter(Boolean).join(" ") : "";
  const town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb ?? a.municipality ?? "";
  const first = row.name || street || town;
  if (!first) return row.display_name ?? "";
  return [first, town && town !== first ? town : "", a.country].filter(Boolean).join(", ");
}

/** The nearest address for a point, or the coordinates themselves when none is found. */
export async function reverseAddress(lat: number, lng: number): Promise<AddressHit> {
  const fallback = { label: formatCoordinates(lat, lng), lat, lng };
  try {
    const url = new URL(`${NOMINATIM}/reverse`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("zoom", "18");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lng));
    const res = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!res.ok) return fallback;
    const row = (await res.json()) as ReverseRow & { error?: string };
    if (row.error) return fallback;
    const label = labelFromReverse(row);
    // Keep the exact point that was picked, not Nominatim's snapped one.
    return label ? { label, lat, lng } : fallback;
  } catch {
    return fallback;
  }
}

/** Planner-only Nominatim search (worldwide). Coordinates are looked up in reverse. */
export async function searchAddress(query: string): Promise<AddressHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const coords = parseCoordinates(q);
  if (coords) {
    const hit = await reverseAddress(coords.lat, coords.lng);
    const exact = formatCoordinates(coords.lat, coords.lng);
    return [hit.label === exact ? hit : { ...hit, label: `${hit.label} (${exact})` }];
  }
  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("q", q);
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{ display_name?: string; lat?: string; lon?: string }>;
  return rows
    .map((row) => ({
      label: row.display_name ?? "",
      lat: Number(row.lat),
      lng: Number(row.lon),
    }))
    .filter((hit) => hit.label && Number.isFinite(hit.lat) && Number.isFinite(hit.lng));
}
