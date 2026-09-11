import { haversineM, minDistToPathM } from "./insert.ts";

/** Google encoded polyline (precision 5), as used by OpenChargeMap `polyline`. */

function encodeSigned(value: number) {
  let n = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  out += String.fromCharCode(n + 63);
  return out;
}

export function encodePolyline(path: [number, number][], precision = 5) {
  const factor = 10 ** precision;
  let lat = 0;
  let lng = 0;
  let out = "";
  for (const [plat, plng] of path) {
    const ilat = Math.round(plat * factor);
    const ilng = Math.round(plng * factor);
    out += encodeSigned(ilat - lat);
    out += encodeSigned(ilng - lng);
    lat = ilat;
    lng = ilng;
  }
  return out;
}

function decodeSigned(str: string, i: { at: number }) {
  let result = 0;
  let shift = 0;
  let b = 0;
  do {
    b = str.charCodeAt(i.at++) - 63;
    result |= (b & 0x1f) << shift;
    shift += 5;
  } while (b >= 0x20);
  return result & 1 ? ~(result >> 1) : result >> 1;
}

export function decodePolyline(encoded: string, precision = 5): [number, number][] {
  const factor = 10 ** precision;
  const path: [number, number][] = [];
  const i = { at: 0 };
  let lat = 0;
  let lng = 0;
  while (i.at < encoded.length) {
    lat += decodeSigned(encoded, i);
    lng += decodeSigned(encoded, i);
    path.push([lat / factor, lng / factor]);
  }
  return path;
}

export function pathLengthKm(path: [number, number][]) {
  let m = 0;
  for (let i = 1; i < path.length; i++) {
    m += haversineM({ lat: path[i - 1][0], lng: path[i - 1][1] }, { lat: path[i][0], lng: path[i][1] });
  }
  return m / 1000;
}

/**
 * OCM `distance` is half the corridor width. Motorway HPC sits 1–8 km off
 * the carriageway; 28 km was pulling in town AC. Tight first, widen if sparse.
 */
export function polylineBufferKm(path: [number, number][]) {
  const km = pathLengthKm(path);
  const tight = km < 30 ? 6 : km < 100 ? 8 : km < 300 ? 10 : 12;
  const wide = Math.min(18, Math.round(tight * 1.7));
  return { tight, wide, pathKm: Math.round(km * 10) / 10 };
}

export function chargersOnPath<T extends { lat: number; lng: number }>(
  chargers: T[],
  path: [number, number][],
  radiusKm: number,
) {
  const band = Math.max(4_000, radiusKm * 1000);
  return chargers.filter((c) => minDistToPathM(c.lat, c.lng, path) <= band);
}

/** Keep shape, drop dense GPS points so Leaflet/OCM stay cheap. */
export function simplifyPath(path: [number, number][], maxPts = 160): [number, number][] {
  if (path.length <= maxPts) return path;
  const totalM = pathLengthKm(path) * 1000;
  const every = Math.max(60, totalM / Math.max(8, maxPts - 1));
  const out: [number, number][] = [path[0]];
  let acc = 0;
  for (let i = 1; i < path.length - 1; i++) {
    acc += haversineM(
      { lat: path[i - 1][0], lng: path[i - 1][1] },
      { lat: path[i][0], lng: path[i][1] },
    );
    if (acc >= every) {
      out.push(path[i]);
      acc = 0;
      if (out.length >= maxPts - 1) break;
    }
  }
  const last = path[path.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}