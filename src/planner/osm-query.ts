/**
 * Overpass (OpenStreetMap) query for charging stations within `radiusM` of a road section.
 * Overpass's `around` filter takes a whole line (lat,lon,lat,lon,…), so one query covers
 * the road itself instead of a few sample points (#72). The section is thinned to at most
 * `maxPoints` points, ends kept, to keep the query small.
 */
export function overpassCorridorQuery(section: [number, number][], radiusM: number, maxPoints = 60): string {
  const pts = thin(section, maxPoints);
  const line = pts.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join(",");
  return `[out:json][timeout:25];\nnwr["amenity"="charging_station"](around:${Math.round(radiusM)},${line});\nout center tags;`;
}

function thin(path: [number, number][], max: number): [number, number][] {
  if (path.length <= max) return path;
  const out: [number, number][] = [];
  for (let i = 0; i < max - 1; i++) out.push(path[Math.round((i * (path.length - 1)) / (max - 1))]);
  out.push(path[path.length - 1]);
  return out;
}

/**
 * True when a road section has a stretch longer than `maxGapKm` without a known fast charger
 * (counting from the section's start and to its end), so OpenStreetMap should be asked too.
 * A count is not enough: Riga→Daugavpils has 9 chargers but they sit near Riga, leaving 200 km.
 * `positionsKm` are the chargers' distances along the section.
 */
export function sectionNeedsOsm(positionsKm: number[], sectionKm: number, maxGapKm = 60): boolean {
  const stops = [0, ...positionsKm.filter((km) => km >= 0 && km <= sectionKm).sort((a, b) => a - b), sectionKm];
  for (let i = 1; i < stops.length; i++) if (stops[i] - stops[i - 1] > maxGapKm) return true;
  return false;
}
