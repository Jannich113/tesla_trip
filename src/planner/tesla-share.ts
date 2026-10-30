/**
 * What "Send to Tesla" shares. The Tesla phone app takes a shared place from the phone's share
 * menu and sends it to the car as the destination; it takes one place at a time, and the car
 * plans its own Supercharger stops. So we share a single place: its name, its coordinates and
 * a Google Maps link to the point (Google's documented search URL), which the app can read.
 */

export type ShareTarget = { title: string; text: string; url: string };

export function teslaShareTarget(stop: { name: string; lat: number; lng: number }): ShareTarget {
  if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng) || Math.abs(stop.lat) > 90 || Math.abs(stop.lng) > 180) {
    throw new Error("This stop has no valid coordinates");
  }
  const at = `${Number(stop.lat.toFixed(6))},${Number(stop.lng.toFixed(6))}`;
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", at);
  const name = stop.name.trim() || at;
  return { title: name, text: name === at ? at : `${name} (${at})`, url: url.toString() };
}

/** True where the browser has a share menu (phones; some desktops). */
export function canShare() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}
