import assert from "node:assert/strict";
import { test } from "node:test";
import { teslaShareTarget } from "./tesla-share.ts";

test("shares one place: its name, coordinates and a Google Maps link to the point", () => {
  const t = teslaShareTarget({ name: "Tesla Rødekro", lat: 55.0701234567, lng: 9.3312 });
  assert.equal(t.title, "Tesla Rødekro");
  assert.equal(t.text, "Tesla Rødekro (55.070123,9.3312)");
  const url = new URL(t.url);
  assert.equal(url.hostname, "www.google.com");
  assert.equal(url.pathname, "/maps/search/");
  assert.equal(url.searchParams.get("api"), "1");
  assert.equal(url.searchParams.get("query"), "55.070123,9.3312");
});

test("a stop without a name is shared by its coordinates", () => {
  assert.equal(teslaShareTarget({ name: " ", lat: 53.55, lng: 9.99 }).text, "53.55,9.99");
});

test("refuses a stop without valid coordinates", () => {
  assert.throws(() => teslaShareTarget({ name: "x", lat: Number.NaN, lng: 1 }), /valid coordinates/);
  assert.throws(() => teslaShareTarget({ name: "x", lat: 95, lng: 1 }), /valid coordinates/);
});
