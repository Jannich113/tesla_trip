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