/** Versioned TTL cache. Stale-while-revalidate lives in the hooks; this only stores. */

type Entry<T> = { at: number; exp: number; value: T };

export const CACHE_VERSION = 1;

const memory = new Map<string, Entry<unknown>>();

function storeKey(ns: string) {
  return `juniper-cache:v${CACHE_VERSION}:${ns}`;
}

function memKey(ns: string, key: string) {
  return `${CACHE_VERSION}:${ns}:${key}`;
}

function expired(entry: Entry<unknown>, now = Date.now()) {
  return now >= entry.exp;
}

function readDisk<T>(ns: string, max = 12): Map<string, Entry<T>> {
  const out = new Map<string, Entry<T>>();
  if (typeof localStorage === "undefined") return out;
  try {
    const raw = localStorage.getItem(storeKey(ns));
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, Entry<T>>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (!entry || expired(entry, now)) continue;
      out.set(key, entry);
    }
    if (out.size > max) {
      const keep = [...out.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, max);
      out.clear();
      for (const [k, v] of keep) out.set(k, v);
    }
  } catch {
    /* ignore */
  }
  return out;
}

function writeDisk<T>(ns: string, entries: Map<string, Entry<T>>, max = 12) {
  if (typeof localStorage === "undefined") return;
  try {
    const keep = [...entries.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, max);
    const obj: Record<string, Entry<T>> = {};
    for (const [k, v] of keep) obj[k] = v;
    localStorage.setItem(storeKey(ns), JSON.stringify(obj));
  } catch {
    /* quota — drop this namespace rather than poison other app data */
    try {
      localStorage.removeItem(storeKey(ns));
    } catch {
      /* ignore */
    }
  }
}

export function cacheGet<T>(ns: string, key: string): T | undefined {
  const now = Date.now();
  const mk = memKey(ns, key);
  const mem = memory.get(mk) as Entry<T> | undefined;
  if (mem) {
    if (!expired(mem, now)) return mem.value;
    memory.delete(mk);
  }
  const disk = readDisk<T>(ns);
  const hit = disk.get(key);
  if (!hit || expired(hit, now)) return undefined;
  memory.set(mk, hit);
  return hit.value;
}

export function cacheSet<T>(ns: string, key: string, value: T, ttlMs: number, max = 12) {
  const now = Date.now();
  const entry: Entry<T> = { at: now, exp: now + Math.max(1, ttlMs), value };
  memory.set(memKey(ns, key), entry);
  const disk = readDisk<T>(ns, max);
  disk.set(key, entry);
  writeDisk(ns, disk, max);
}

export function cacheInvalidate(ns: string, key?: string) {
  if (key) {
    memory.delete(memKey(ns, key));
    const disk = readDisk<unknown>(ns);
    disk.delete(key);
    writeDisk(ns, disk);
    return;
  }
  for (const k of [...memory.keys()]) {
    if (k.startsWith(`${CACHE_VERSION}:${ns}:`)) memory.delete(k);
  }
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storeKey(ns));
  } catch {
    /* ignore */
  }
}

/** Elpris turns over on the hour; don't serve last hour's slot. */
export function elprisTtlMs(now = Date.now()) {
  const d = new Date(now);
  const next = new Date(d);
  next.setHours(d.getHours() + 1, 0, 5, 0);
  return Math.min(ELPRIS_TTL_MS, Math.max(15_000, next.getTime() - now));
}

export const ROUTE_TTL_MS = 12 * 60 * 60 * 1000;
export const CHARGER_TTL_MS = 45 * 60 * 1000;
export const ELPRIS_TTL_MS = 10 * 60 * 1000;
