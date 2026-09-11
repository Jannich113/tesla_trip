/** In-memory TTL cache plus an optional localStorage slice for instant reloads. */

type Entry<T> = { at: number; value: T };

const memory = new Map<string, Entry<unknown>>();

function storeKey(ns: string) {
  return `juniper-cache:${ns}`;
}

function readDisk<T>(ns: string, ttlMs: number, max = 12): Map<string, Entry<T>> {
  const out = new Map<string, Entry<T>>();
  if (typeof localStorage === "undefined") return out;
  try {
    const raw = localStorage.getItem(storeKey(ns));
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Record<string, Entry<T>>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (!entry || now - entry.at > ttlMs) continue;
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
    /* quota */
  }
}

export function cacheGet<T>(ns: string, key: string, ttlMs: number): T | undefined {
  const mem = memory.get(`${ns}:${key}`) as Entry<T> | undefined;
  if (mem && Date.now() - mem.at <= ttlMs) return mem.value;
  const disk = readDisk<T>(ns, ttlMs);
  const hit = disk.get(key);
  if (!hit) return undefined;
  memory.set(`${ns}:${key}`, hit);
  return hit.value;
}

export function cacheSet<T>(ns: string, key: string, value: T, ttlMs: number, max = 12) {
  const entry: Entry<T> = { at: Date.now(), value };
  memory.set(`${ns}:${key}`, entry);
  const disk = readDisk<T>(ns, ttlMs, max);
  disk.set(key, entry);
  writeDisk(ns, disk, max);
}

export const ROUTE_TTL_MS = 12 * 60 * 60 * 1000;
export const CHARGER_TTL_MS = 45 * 60 * 1000;
export const ELPRIS_TTL_MS = 10 * 60 * 1000;
