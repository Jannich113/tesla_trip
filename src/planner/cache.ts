/** Versioned TTL cache. Memory is source of truth; disk is a debounced snapshot. */

type Entry<T> = { at: number; exp: number; value: T };

export const CACHE_VERSION = 2;
const WRITE_MS = 400;
const MAX_BYTES = 350_000;

const namespaces = new Map<string, Map<string, Entry<unknown>>>();
const loaded = new Set<string>();
const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

function storeKey(ns: string) {
  return `juniper-cache:v${CACHE_VERSION}:${ns}`;
}

function expired(entry: Entry<unknown>, now = Date.now()) {
  return now >= entry.exp;
}

function bytesOf(entries: Map<string, Entry<unknown>>) {
  let n = 2;
  for (const [k, v] of entries) n += k.length + 24 + JSON.stringify(v.value).length;
  return n;
}

function trim(entries: Map<string, Entry<unknown>>, max: number) {
  const now = Date.now();
  for (const [k, e] of entries) {
    if (expired(e, now)) entries.delete(k);
  }
  if (entries.size <= max && bytesOf(entries) <= MAX_BYTES) return;
  const ranked = [...entries.entries()].sort((a, b) => b[1].at - a[1].at);
  entries.clear();
  for (const [k, e] of ranked) {
    if (entries.size >= max) break;
    entries.set(k, e);
    if (bytesOf(entries) > MAX_BYTES) {
      entries.delete(k);
      break;
    }
  }
}

function loadNs(ns: string): Map<string, Entry<unknown>> {
  let map = namespaces.get(ns);
  if (!map) {
    map = new Map();
    namespaces.set(ns, map);
  }
  if (loaded.has(ns)) return map;
  loaded.add(ns);
  if (typeof localStorage === "undefined") return map;
  try {
    const raw = localStorage.getItem(storeKey(ns));
    if (!raw) return map;
    const parsed = JSON.parse(raw) as Record<string, Entry<unknown>>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (!entry || expired(entry, now)) continue;
      map.set(key, entry);
    }
  } catch {
    /* ignore */
  }
  return map;
}

function flushNs(ns: string) {
  writeTimers.delete(ns);
  if (typeof localStorage === "undefined") return;
  const map = namespaces.get(ns);
  if (!map) return;
  trim(map, 16);
  try {
    const obj: Record<string, Entry<unknown>> = {};
    for (const [k, v] of map) obj[k] = v;
    localStorage.setItem(storeKey(ns), JSON.stringify(obj));
  } catch {
    try {
      localStorage.removeItem(storeKey(ns));
    } catch {
      /* ignore */
    }
  }
}

function scheduleWrite(ns: string) {
  if (writeTimers.has(ns)) return;
  const t = setTimeout(() => flushNs(ns), WRITE_MS);
  writeTimers.set(ns, t);
}

export function cacheGet<T>(ns: string, key: string, opts?: { stale?: boolean }): T | undefined {
  const map = loadNs(ns);
  const hit = map.get(key) as Entry<T> | undefined;
  if (!hit) return undefined;
  if (expired(hit)) {
    if (!opts?.stale) {
      map.delete(key);
      return undefined;
    }
    return hit.value;
  }
  return hit.value;
}

export function cacheSet<T>(ns: string, key: string, value: T, ttlMs: number, max = 12) {
  const now = Date.now();
  const entry: Entry<T> = { at: now, exp: now + Math.max(1, ttlMs), value };
  const map = loadNs(ns);
  map.set(key, entry as Entry<unknown>);
  trim(map, max);
  scheduleWrite(ns);
}

export function cacheInvalidate(ns: string, key?: string) {
  const map = loadNs(ns);
  if (key) {
    map.delete(key);
    scheduleWrite(ns);
    return;
  }
  map.clear();
  const t = writeTimers.get(ns);
  if (t) clearTimeout(t);
  writeTimers.delete(ns);
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(storeKey(ns));
  } catch {
    /* ignore */
  }
}

/** Tests / shutdown: write pending namespaces now. */
export function cacheFlush() {
  for (const ns of [...writeTimers.keys()]) flushNs(ns);
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
