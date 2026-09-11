import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isRetryable, withRetry } from "./retry.ts";

describe("retry", () => {
  it("returns on the first success", async () => {
    let n = 0;
    const out = await withRetry(async () => {
      n += 1;
      return "ok";
    });
    assert.equal(out, "ok");
    assert.equal(n, 1);
  });

  it("retries then succeeds", async () => {
    let n = 0;
    const out = await withRetry(
      async () => {
        n += 1;
        if (n < 3) throw new Error("flaky");
        return "ok";
      },
      { delaysMs: [0, 0] },
    );
    assert.equal(out, "ok");
    assert.equal(n, 3);
  });

  it("does not retry cancel", async () => {
    let n = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            n += 1;
            throw new Error("The user cancelled the share");
          },
          { delaysMs: [0, 0] },
        ),
      /cancelled/,
    );
    assert.equal(n, 1);
    assert.equal(isRetryable(new Error("The user cancelled the share")), false);
  });
});
