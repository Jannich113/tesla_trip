/**
 * Which charger list to show when a lookup answers. A complete answer replaces the list.
 * A partial one (the lookup was throttled or failed for some stretches) never shrinks
 * what is already known: it is merged in, not cached, and asked for again later.
 */
export function nextChargerList<T extends { id: string }>(
  known: T[] | undefined,
  fresh: T[],
  partial: boolean,
): { rows: T[]; cache: boolean; retry: boolean } {
  if (!partial) return { rows: fresh, cache: true, retry: false };
  const byId = new Map((known ?? []).map((row) => [row.id, row]));
  for (const row of fresh) byId.set(row.id, row);
  return { rows: [...byId.values()], cache: false, retry: true };
}

/** Seconds to wait before asking again after a partial answer (attempt 0, 1, 2…); null = stop. */
export function partialRetryDelayMs(attempt: number): number | null {
  const delays = [20_000, 60_000, 180_000];
  return attempt < delays.length ? delays[attempt] : null;
}
