/** Shared + CDN cache headers. Browsers use max-age; edges use s-maxage / CDN-Cache-Control. */

export function publicCache(seconds: number, swr = seconds * 4) {
  const browser = Math.min(60, seconds);
  return {
    "Cache-Control": `public, max-age=${browser}, s-maxage=${seconds}, stale-while-revalidate=${swr}, stale-if-error=${Math.max(swr, 3600)}`,
    "CDN-Cache-Control": `public, max-age=${seconds}, stale-while-revalidate=${swr}`,
    Vary: "Accept",
  };
}

export const noStore = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
};
