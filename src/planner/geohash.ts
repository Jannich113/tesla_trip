/** Base32 geohash. Precision 4 ≈ 39×20 km — right for 15–55 km corridor search. */
const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
const BITS = [16, 8, 4, 2, 1];

const NEIGHBORS: Record<string, { even: string; odd: string }> = {
  n: { even: "p0r21436x8zb9dcf5h7kjnmqesgutwvy", odd: "bc01fg45238967deuvhjyznpkmstqrwx" },
  s: { even: "14365h7k9dcfesgujnmqp0r2twvyx8zb", odd: "238967debc01fg45kmstqrwxuvhjyznp" },
  e: { even: "bc01fg45238967deuvhjyznpkmstqrwx", odd: "p0r21436x8zb9dcf5h7kjnmqesgutwvy" },
  w: { even: "238967debc01fg45kmstqrwxuvhjyznp", odd: "14365h7k9dcfesgujnmqp0r2twvyx8zb" },
};

const BORDERS: Record<string, { even: string; odd: string }> = {
  n: { even: "prxz", odd: "bcfguvyz" },
  s: { even: "028b", odd: "0145hjnp" },
  e: { even: "bcfguvyz", odd: "prxz" },
  w: { even: "0145hjnp", odd: "028b" },
};

export function encodeGeohash(lat: number, lng: number, precision = 4) {
  let minLat = -90;
  let maxLat = 90;
  let minLng = -180;
  let maxLng = 180;
  let hash = "";
  let bit = 0;
  let ch = 0;
  let even = true;
  while (hash.length < precision) {
    if (even) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) {
        ch |= BITS[bit];
        minLng = mid;
      } else maxLng = mid;
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) {
        ch |= BITS[bit];
        minLat = mid;
      } else maxLat = mid;
    }
    even = !even;
    if (bit < 4) bit += 1;
    else {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

function adjacent(hash: string, dir: "n" | "s" | "e" | "w"): string {
  if (!hash) return "";
  const last = hash[hash.length - 1];
  const parent = hash.slice(0, -1);
  const type = hash.length % 2 ? "odd" : "even";
  let prefix = parent;
  if (BORDERS[dir][type].includes(last) && parent) prefix = adjacent(parent, dir);
  return prefix + BASE32[NEIGHBORS[dir][type].indexOf(last)];
}

/** Cell plus its 8 neighbors — required so a stall on a cell edge is not missed. */
export function geohashNeighborhood(hash: string): string[] {
  const n = adjacent(hash, "n");
  const s = adjacent(hash, "s");
  return [
    hash,
    n,
    s,
    adjacent(hash, "e"),
    adjacent(hash, "w"),
    adjacent(n, "e"),
    adjacent(n, "w"),
    adjacent(s, "e"),
    adjacent(s, "w"),
  ].filter(Boolean);
}

/** Unique precision-4 cells covering a polyline, with neighbors. */
export function geohashesAlongPath(path: [number, number][], precision = 4): Set<string> {
  const cells = new Set<string>();
  if (path.length < 2) return cells;
  const step = Math.max(1, Math.floor(path.length / 48));
  for (let i = 0; i < path.length; i += step) {
    const hash = encodeGeohash(path[i][0], path[i][1], precision);
    for (const c of geohashNeighborhood(hash)) cells.add(c);
  }
  const last = path[path.length - 1];
  for (const c of geohashNeighborhood(encodeGeohash(last[0], last[1], precision))) cells.add(c);
  return cells;
}

export function inGeohashSet(lat: number, lng: number, cells: Set<string>, precision = 4) {
  return cells.has(encodeGeohash(lat, lng, precision));
}
