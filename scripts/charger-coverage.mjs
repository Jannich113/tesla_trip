#!/usr/bin/env node
/**
 * Charger coverage per European country (#72).
 *
 *   node scripts/charger-coverage.mjs [api-origin]     (default http://127.0.0.1:8080)
 *
 * Plans one city-to-city route per country with OSRM, sends it through the app's
 * /api/chargers like the planner does, and prints how many fast chargers sit within
 * 10 km of the road and the longest stretch without one ("gap"). Run it before and
 * after changing the charger lookup.
 */
const API = process.argv[2] ?? process.env.API ?? "http://127.0.0.1:8080";
const trips = [
  ["DK", "Aarhus", [56.1567, 10.2108], "Copenhagen", [55.6761, 12.5683]],
  ["SE", "Stockholm", [59.3293, 18.0686], "Jönköping", [57.7826, 14.1618]],
  ["NO", "Oslo", [59.9139, 10.7522], "Lillehammer", [61.1153, 10.4662]],
  ["FI", "Helsinki", [60.1699, 24.9384], "Tampere", [61.4978, 23.761]],
  ["IS", "Reykjavík", [64.1466, -21.9426], "Akureyri", [65.6885, -18.1262]],
  ["EE", "Tallinn", [59.437, 24.7536], "Tartu", [58.378, 26.729]],
  ["LV", "Riga", [56.9496, 24.1052], "Daugavpils", [55.8743, 26.5362]],
  ["LT", "Vilnius", [54.6872, 25.2797], "Klaipėda", [55.7033, 21.1443]],
  ["PL", "Warsaw", [52.2297, 21.0122], "Poznań", [52.4064, 16.9252]],
  ["DE", "Munich", [48.1351, 11.582], "Nuremberg", [49.4521, 11.0767]],
  ["NL", "Amsterdam", [52.3676, 4.9041], "Maastricht", [50.8514, 5.691]],
  ["BE", "Brussels", [50.8503, 4.3517], "Bruges", [51.2093, 3.2247]],
  ["LU", "Luxembourg", [49.6116, 6.1319], "Clervaux", [50.0547, 6.0313]],
  ["FR", "Paris", [48.8566, 2.3522], "Tours", [47.3941, 0.6848]],
  ["UK", "London", [51.5074, -0.1278], "Birmingham", [52.4862, -1.8904]],
  ["IE", "Dublin", [53.3498, -6.2603], "Cork", [51.8985, -8.4756]],
  ["ES", "Madrid", [40.4168, -3.7038], "Zaragoza", [41.6488, -0.8891]],
  ["PT", "Lisbon", [38.7223, -9.1393], "Porto", [41.1579, -8.6291]],
  ["IT", "Milan", [45.4642, 9.19], "Bologna", [44.4949, 11.3426]],
  ["CH", "Zürich", [47.3769, 8.5417], "Bern", [46.948, 7.4474]],
  ["AT", "Vienna", [48.2082, 16.3738], "Graz", [47.0707, 15.4395]],
  ["CZ", "Prague", [50.0755, 14.4378], "Brno", [49.1951, 16.6068]],
  ["SK", "Bratislava", [48.1486, 17.1077], "Žilina", [49.2231, 18.7394]],
  ["HU", "Budapest", [47.4979, 19.0402], "Szeged", [46.253, 20.1414]],
  ["SI", "Ljubljana", [46.0569, 14.5058], "Maribor", [46.5547, 15.6459]],
  ["HR", "Zagreb", [45.815, 15.9819], "Split", [43.5081, 16.4402]],
  ["RS", "Belgrade", [44.7866, 20.4489], "Niš", [43.3209, 21.8958]],
  ["BA", "Sarajevo", [43.8563, 18.4131], "Mostar", [43.3438, 17.8078]],
  ["ME", "Podgorica", [42.4304, 19.2594], "Budva", [42.2911, 18.84]],
  ["AL", "Tirana", [41.3275, 19.8187], "Vlorë", [40.4661, 19.4914]],
  ["MK", "Skopje", [41.9981, 21.4254], "Bitola", [41.0297, 21.3292]],
  ["GR", "Athens", [37.9838, 23.7275], "Lamia", [38.8997, 22.4337]],
  ["BG", "Sofia", [42.6977, 23.3219], "Plovdiv", [42.1354, 24.7453]],
  ["RO", "Bucharest", [44.4268, 26.1025], "Brașov", [45.6427, 25.5887]],
  ["MD", "Chișinău", [47.0105, 28.8638], "Bălți", [47.7615, 27.9293]],
  ["UA", "Lviv", [49.8397, 24.0297], "Rivne", [50.6199, 26.2516]],
  ["CY", "Nicosia", [35.1856, 33.3823], "Limassol", [34.7071, 33.0226]],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const km = (a, b) => {
  const k = Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  return Math.hypot(b[0] - a[0], (b[1] - a[1]) * k) * 111.2;
};

for (const [cc, fromName, from, toName, to] of trips) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson`;
    const r = await fetch(url).then((x) => x.json());
    const path = r.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const routeKm = r.routes[0].distance / 1000;
    const res = await fetch(`${API}/api/chargers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: [path], radiusKm: 12 }),
    }).then((x) => x.json());
    // Position of each charger along the route (km from start), only those within 10 km of it.
    const cum = [0];
    for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + km(path[i - 1], path[i]));
    const scale = routeKm / cum.at(-1);
    const step = Math.max(1, Math.floor(path.length / 4000));
    const along = [];
    for (const c of res.chargers ?? []) {
      let best = Infinity;
      let at = 0;
      for (let i = 0; i < path.length; i += step) {
        const d = km([c.lat, c.lng], path[i]);
        if (d < best) { best = d; at = cum[i] * scale; }
      }
      if (best <= 10) along.push(at);
    }
    along.sort((a, b) => a - b);
    const stops = [0, ...along, routeKm];
    let gap = 0;
    for (let i = 1; i < stops.length; i++) gap = Math.max(gap, stops[i] - stops[i - 1]);
    console.log(
      [cc, `${fromName}→${toName}`.padEnd(24), `${Math.round(routeKm)} km`.padStart(7), `${String((res.chargers ?? []).length).padStart(3)} found`, `${String(along.length).padStart(3)} ≤10 km`, `gap ${Math.round(gap)} km`.padStart(11), res.partial ? "PARTIAL" : "", `ocm ${res.ocm ?? 0} osm ${(res.live ?? 0) - (res.ocm ?? 0)} seed ${res.seed ?? 0}`].join("  "),
    );
  } catch (err) {
    console.log(cc, "ERROR", err?.message ?? err);
  }
  await sleep(1500);
}
