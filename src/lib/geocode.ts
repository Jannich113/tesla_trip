export type AddressHit = {
  label: string;
  lat: number;
  lng: number;
};

export async function searchAddress(query: string): Promise<AddressHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("q", q);
  url.searchParams.set("viewbox", "-123.0,38.4,-121.2,36.6");
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
