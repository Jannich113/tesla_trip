export const NETWORK_RETRY_DELAYS_MS = [250, 800] as const;

export function isRetryable(err: unknown) {
  if (err instanceof DOMException && err.name === "AbortError") return false;
  if (err instanceof Error && /cancel/i.test(err.message)) return false;
  return true;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    delaysMs?: readonly number[];
    retryOn?: (err: unknown) => boolean;
  },
): Promise<T> {
  const delays = opts?.delaysMs ?? NETWORK_RETRY_DELAYS_MS;
  const retryOn = opts?.retryOn ?? isRetryable;
  let last: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (attempt >= delays.length || !retryOn(err)) throw err;
      await wait(delays[attempt] ?? 0);
    }
  }
  throw last instanceof Error ? last : new Error("Retry failed");
}

function wait(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
