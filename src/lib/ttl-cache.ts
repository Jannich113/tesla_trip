/**
 * Small in-memory cache with expiry and a size cap (oldest entry evicted first).
 * Server-side use: one per process, lost on restart, which is fine for data that
 * is cheap to refetch but rate-limited (OpenChargeMap).
 */
export class TtlCache<V> {
  private readonly rows = new Map<string, { at: number; value: V }>();
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly now: () => number;

  // Plain fields, not parameter properties: Node's type stripping (tests) rejects those.
  constructor(ttlMs: number, max = 500, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.now = now;
  }

  get(key: string): V | undefined {
    const row = this.rows.get(key);
    if (!row) return undefined;
    if (this.now() - row.at > this.ttlMs) {
      this.rows.delete(key);
      return undefined;
    }
    return row.value;
  }

  set(key: string, value: V) {
    this.rows.delete(key);
    this.rows.set(key, { at: this.now(), value });
    while (this.rows.size > this.max) {
      const oldest = this.rows.keys().next().value;
      if (oldest === undefined) break;
      this.rows.delete(oldest);
    }
  }

  get size() {
    return this.rows.size;
  }
}
