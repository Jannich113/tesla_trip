/**
 * Paste a Google or Apple Maps directions link and turn it into planner stops.
 * Build the same kind of link back out. Never calls Google or Apple — if the
 * URL has no coordinates, parsing fails instead of following a short link.
 */

export type MapShareStop = {
  name: string;
  lat: number;
  lng: number;
};

export type MapShareSource = "google" | "apple";

export type MapShareTrip = {
  source: MapShareSource;
  stops: MapShareStop[];
};

export class MapShareParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapShareParseError";
  }
}

export const MAP_SHARE_PARSE_ERROR =
  "Could not read origin, stops, and destination from that link. Paste a Google Maps or Apple Maps directions URL that includes coordinates.";

export const MAP_SHARE_SHORT_ERROR =
  "That share link doesn't include the route. Paste the full Google or Apple Maps directions URL with coordinates, not a short link.";

export const MAP_SHARE_NAMES_ERROR =
  "That link has place names but no coordinates, so it can't be placed on the map without looking them up. Paste a directions URL that includes latitudes and longitudes.";

type Slot = { name: string; lat: number | null; lng: number | null };

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " "));
  } catch {
    return value.replace(/\+/g, " ");
  }
}

function validCoord(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

function coordLabel(lat: number, lng: number) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function cleanName(raw: string) {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^(current location|your location|my location)$/i.test(text)) return "";
  const short = text.split(",")[0]?.trim() || text;
  return short.slice(0, 80);
}

function slotFromText(raw: string): Slot {
  const text = safeDecode(raw).trim();
  if (!text || /^place_id:/i.test(text)) return { name: "", lat: null, lng: null };
  const named = text.match(/^(.*?)@\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (named) {
    const lat = Number(named[2]);
    const lng = Number(named[3]);
    if (validCoord(lat, lng)) return { name: cleanName(named[1] ?? ""), lat, lng };
  }
  const pair = text.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (pair) {
    const lat = Number(pair[1]);
    const lng = Number(pair[2]);
    if (validCoord(lat, lng)) return { name: "", lat, lng };
  }
  return { name: cleanName(text), lat: null, lng: null };
}

function toStop(slot: Slot, fallback?: MapShareStop): MapShareStop | null {
  const lat = slot.lat ?? fallback?.lat;
  const lng = slot.lng ?? fallback?.lng;
  if (lat == null || lng == null || !validCoord(lat, lng)) return null;
  return { name: slot.name || fallback?.name || coordLabel(lat, lng), lat, lng };
}

function resolveSlots(slots: Slot[], embedded: MapShareStop[]): MapShareStop[] {
  const meaningful = slots.filter((s) => s.name || (s.lat != null && s.lng != null));
  if (meaningful.length >= 2 && meaningful.every((s) => s.lat != null && s.lng != null)) {
    return meaningful.map((s) => toStop(s)!);
  }
  if (meaningful.length >= 2 && embedded.length === meaningful.length) {
    const zipped = meaningful.map((s, i) => toStop(s, embedded[i]));
    if (zipped.every((s): s is MapShareStop => s != null)) return zipped;
  }
  if (embedded.length >= 2) return embedded;
  if (meaningful.some((s) => s.name && s.lat == null)) throw new MapShareParseError(MAP_SHARE_NAMES_ERROR);
  throw new MapShareParseError(MAP_SHARE_PARSE_ERROR);
}

function embeddedGooglePoints(href: string): MapShareStop[] {
  const text = safeDecode(href);
  const take = (re: RegExp, order: "lnglat" | "latlng") => {
    const out: MapShareStop[] = [];
    for (const match of text.matchAll(re)) {
      const a = Number(match[1]);
      const b = Number(match[2]);
      const lat = order === "latlng" ? a : b;
      const lng = order === "latlng" ? b : a;
      if (!validCoord(lat, lng)) continue;
      out.push({ name: coordLabel(lat, lng), lat, lng });
    }
    return out;
  };
  const primary = take(/!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g, "lnglat");
  if (primary.length >= 2) return primary;
  const alt = take(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g, "latlng");
  return alt.length >= 2 ? alt : primary;
}

function dirSlots(pathname: string): Slot[] {
  const path = safeDecode(pathname);
  const marker = "/maps/dir/";
  const at = path.indexOf(marker);
  if (at < 0) return [];
  const slots: Slot[] = [];
  for (const part of path.slice(at + marker.length).split("/")) {
    if (!part || part.startsWith("@") || part === "data" || part.startsWith("data")) break;
    slots.push(slotFromText(part));
  }
  return slots;
}

function queryChain(url: URL): Slot[] {
  const origin = url.searchParams.get("origin");
  const destination = url.searchParams.get("destination");
  if (origin || destination) {
    const waypoints = (url.searchParams.get("waypoints") ?? "")
      .split("|")
      .map((part) => part.trim())
      .filter(Boolean);
    return [origin, ...waypoints, destination].filter((part): part is string => Boolean(part)).map(slotFromText);
  }
  const slots: Slot[] = [];
  const saddr = url.searchParams.get("saddr");
  if (saddr?.trim()) slots.push(slotFromText(saddr));
  for (const daddr of url.searchParams.getAll("daddr")) {
    for (const part of daddr.split(/\s+to:/i)) {
      if (part.trim()) slots.push(slotFromText(part));
    }
  }
  return slots;
}

function isShortLink(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "maps.app.goo.gl" || host === "goo.gl" || host === "g.co" || host === "maps.apple") return true;
  if (host === "maps.apple.com" && /^\/p(\/|$)/.test(url.pathname)) return true;
  return false;
}

function isAppleHost(host: string) {
  return host === "maps.apple.com";
}

function isGoogleHost(host: string) {
  const bare = host.replace(/^www\./, "");
  return (
    bare === "google.com" ||
    bare.startsWith("google.") ||
    bare.endsWith(".google.com") ||
    bare === "maps.google.com" ||
    bare.startsWith("maps.google.")
  );
}

function extractUrl(input: string) {
  const trimmed = input.trim();
  const found = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  if (found) return found[0].replace(/[),.;]+$/, "");
  if (/^(maps\.apple\.com|maps\.google\.com|www\.google\.[a-z.]+|google\.[a-z.]+)\//i.test(trimmed)) {
    return `https://${trimmed.replace(/[),.;]+$/, "")}`;
  }
  return "";
}

function readGoogle(url: URL) {
  const embedded = embeddedGooglePoints(url.href);
  const fromQuery = queryChain(url);
  const slots = fromQuery.length ? fromQuery : dirSlots(url.pathname);
  return resolveSlots(slots, embedded);
}

function readApple(url: URL) {
  return resolveSlots(queryChain(url), []);
}

/** Origin, intermediate stops, and destination from a pasted share URL. */
export function parseMapShareUrl(input: string): MapShareTrip {
  const raw = extractUrl(input);
  if (!raw) throw new MapShareParseError(MAP_SHARE_PARSE_ERROR);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MapShareParseError(MAP_SHARE_PARSE_ERROR);
  }
  if (isShortLink(url)) throw new MapShareParseError(MAP_SHARE_SHORT_ERROR);
  const host = url.hostname.toLowerCase();
  if (isAppleHost(host)) return { source: "apple", stops: readApple(url) };
  if (isGoogleHost(host)) {
    const looksLikeMaps =
      url.pathname.includes("/maps") ||
      url.searchParams.has("origin") ||
      url.searchParams.has("destination") ||
      url.searchParams.has("saddr") ||
      url.searchParams.has("daddr");
    if (!looksLikeMaps) throw new MapShareParseError(MAP_SHARE_PARSE_ERROR);
    return { source: "google", stops: readGoogle(url) };
  }
  throw new MapShareParseError(MAP_SHARE_PARSE_ERROR);
}

function coordParam(stop: { lat: number; lng: number }) {
  if (!validCoord(stop.lat, stop.lng)) throw new Error("A stop is missing coordinates");
  return `${Number(stop.lat.toFixed(6))},${Number(stop.lng.toFixed(6))}`;
}

function assertRoute(stops: { lat: number; lng: number }[]) {
  if (stops.length < 2) throw new Error("Need an origin and a destination");
  for (const stop of stops) coordParam(stop);
}

/** Google Maps directions URL: origin, waypoints, destination. No API call. */
export function googleDirectionsUrl(stops: { lat: number; lng: number }[]) {
  assertRoute(stops);
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", coordParam(stops[0]));
  url.searchParams.set("destination", coordParam(stops[stops.length - 1]));
  const waypoints = stops.slice(1, -1).map(coordParam);
  if (waypoints.length) url.searchParams.set("waypoints", waypoints.join("|"));
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

/** Apple Maps directions URL on maps.apple.com. No API call. */
export function appleDirectionsUrl(stops: { lat: number; lng: number }[]) {
  assertRoute(stops);
  const url = new URL("https://maps.apple.com/");
  url.searchParams.set("saddr", coordParam(stops[0]));
  url.searchParams.set("daddr", stops.slice(1).map(coordParam).join(" to:"));
  url.searchParams.set("dirflg", "d");
  return url.toString();
}
