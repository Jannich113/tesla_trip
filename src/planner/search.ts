export type AddressHit = {
  label: string;
  lat: number;
  lng: number;
  /** The place's own name, e.g. "Odense" or "Vestergade 12". */
  name?: string;
  /** OSM kind from Photon, e.g. "city", "house", "restaurant". */
  kind?: string;
  /** True when the name does not match what was typed, i.e. a spelling fix. */
  corrected?: boolean;
};

const NOMINATIM = "https://nominatim.openstreetmap.org";
const PHOTON = "https://photon.komoot.io/api/";
/** Centre of Denmark: suggestions lean towards places near here unless a stop gives a better hint. */
export const DEFAULT_BIAS = { lat: 56.0, lng: 10.4 };

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

// --- Spelling-tolerant ranking -------------------------------------------------

/** Lowercase, Danish letters spelled out, accents dropped: "Køge Å" → "koege aa". */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Optimal string alignment distance: edits, with a swapped letter pair counting as one. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** 1 for an exact or prefix match, falling with each spelling edit. */
function wordSimilarity(typed: string, word: string): number {
  if (word.startsWith(typed)) return 1;
  // Compare against the same-length start of the word so partial typing isn't punished.
  const head = word.slice(0, Math.max(typed.length, Math.min(word.length, typed.length + 1)));
  const dist = Math.min(editDistance(typed, head), editDistance(typed, word));
  return Math.max(0, 1 - dist / Math.max(typed.length, 3));
}

/** How well the typed words match a candidate's name and label (0–1). */
export function matchScore(query: string, name: string, label = name): { score: number; exactName: boolean } {
  const typed = normalize(query).split(" ").filter(Boolean);
  if (!typed.length) return { score: 0, exactName: false };
  const words = normalize(`${name} ${label}`).split(" ").filter(Boolean);
  const nameWords = normalize(name).split(" ").filter(Boolean);
  let total = 0;
  for (const t of typed) {
    if (/^\d+$/.test(t)) {
      total += words.includes(t) ? 1 : 0.4;
      continue;
    }
    total += Math.max(0, ...words.map((w) => wordSimilarity(t, w)));
  }
  const exactName = typed.some((t) => !/^\d+$/.test(t) && nameWords.some((w) => w.startsWith(t)));
  return { score: total / typed.length, exactName };
}

/** Cities before villages before streets before shops and rivers. */
export function kindWeight(kind: string | undefined): number {
  switch (kind) {
    case "city":
    case "town":
      return 1;
    case "house":
    case "village":
    case "municipality":
      return 0.85;
    case "suburb":
    case "quarter":
    case "neighbourhood":
    case "borough":
    case "residential":
    case "street":
    case "primary":
    case "secondary":
    case "tertiary":
    case "unclassified":
    case "living_street":
      return 0.75;
    case "charging_station":
    case "fuel":
    case "parking":
    case "station":
      return 0.6;
    case "hamlet":
    case "locality":
      return 0.5;
    case "farm":
    case "isolated_dwelling":
    case "farmyard":
      return 0.3;
    default:
      return 0.4;
  }
}

/**
 * Re-rank suggestions so spelling-close, important places come first.
 * The service's own order (which already weighs distance) breaks ties.
 */
export function rankHits(query: string, hits: AddressHit[]): AddressHit[] {
  return hits
    .map((hit, i) => {
      const m = matchScore(query, hit.name ?? hit.label, hit.label);
      const order = 1 - i / Math.max(hits.length, 1);
      return {
        hit: { ...hit, corrected: !m.exactName },
        score: 0.5 * m.score + 0.35 * kindWeight(hit.kind) + 0.15 * order,
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((r) => r.hit);
}

/** Drop near-identical suggestions (same name within ~100 m). */
export function dedupeHits(hits: AddressHit[]): AddressHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => {
    const key = `${normalize(h.name ?? h.label)}@${h.lat.toFixed(3)},${h.lng.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// --- Services -------------------------------------------------------------------

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    district?: string;
    county?: string;
    country?: string;
    osm_value?: string;
  };
};

export function hitFromPhoton(f: PhotonFeature): AddressHit | null {
  const p = f.properties ?? {};
  const [lng, lat] = f.geometry?.coordinates ?? [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : "";
  const name = p.name || street;
  if (!name) return null;
  const place = p.city ?? p.district ?? p.county ?? "";
  const label = [name, street && street !== name ? street : "", place !== name ? place : "", p.country]
    .filter(Boolean)
    .join(", ");
  return { label, name, lat: lat as number, lng: lng as number, kind: p.osm_value };
}

const cache = new Map<string, AddressHit[]>();

/**
 * As-you-type suggestions from Photon (built for autocomplete; Nominatim's terms forbid it).
 * Asks for extra results and re-ranks them, which fixes most typos. Cached per query.
 */
export async function suggestAddress(
  query: string,
  opts: { bias?: { lat: number; lng: number }; signal?: AbortSignal } = {},
): Promise<AddressHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const coords = parseCoordinates(q);
  if (coords) {
    const hit = await reverseAddress(coords.lat, coords.lng);
    const exact = formatCoordinates(coords.lat, coords.lng);
    return [hit.label === exact ? hit : { ...hit, label: `${hit.label} (${exact})` }];
  }
  const bias = opts.bias ?? DEFAULT_BIAS;
  const key = `${normalize(q)}@${bias.lat.toFixed(1)},${bias.lng.toFixed(1)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const url = new URL(PHOTON);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "10");
  url.searchParams.set("lat", String(bias.lat));
  url.searchParams.set("lon", String(bias.lng));
  const res = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: opts.signal });
  if (!res.ok) return [];
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const hits = rankHits(
    q,
    dedupeHits((json.features ?? []).map(hitFromPhoton).filter((h): h is AddressHit => h !== null)),
  ).slice(0, 6);
  if (cache.size > 200) cache.clear();
  cache.set(key, hits);
  return hits;
}

/**
 * One full search for when the user presses Enter and there were no suggestions.
 * Nominatim knows Danish names for foreign places ("Hamborg" → Hamburg).
 */
export async function searchAddress(query: string): Promise<AddressHit[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  const coords = parseCoordinates(q);
  if (coords) return suggestAddress(q);
  const url = new URL(`${NOMINATIM}/search`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("accept-language", "da,en");
  url.searchParams.set("q", q);
  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as Array<{ display_name?: string; lat?: string; lon?: string; name?: string }>;
  return rows
    .map((row) => ({
      label: row.display_name ?? "",
      name: row.name,
      lat: Number(row.lat),
      lng: Number(row.lon),
    }))
    .filter((hit) => hit.label && Number.isFinite(hit.lat) && Number.isFinite(hit.lng));
}
