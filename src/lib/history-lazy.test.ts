import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tripsIn, chargesIn } from "./history.ts";

describe("on-demand history", () => {
  it("day slice is tiny vs year", () => {
    const today = "2026-03-18";
    const day = tripsIn("day", today);
    const year = tripsIn("year", today);
    assert.ok(day.length >= 1 && day.length <= 6);
    assert.ok(year.length > day.length * 10);
    assert.ok(day.every((t) => t.day === today));
  });

  it("same day is stable across calls", () => {
    const a = tripsIn("day", "2026-03-18");
    const b = tripsIn("day", "2026-03-18");
    assert.deepEqual(a, b);
  });

  it("charges follow the same period window", () => {
    const week = chargesIn("week", "2026-03-18");
    assert.ok(week.every((c) => c.day >= "2026-03-12" && c.day <= "2026-03-18"));
  });
});
