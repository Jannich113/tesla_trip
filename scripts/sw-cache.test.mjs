import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("service worker versions caches and skips live routes", () => {
  assert.match(src, /juniper-sw-v2/);
  assert.match(src, /skipWaiting/);
  assert.match(src, /clients\.claim/);
  assert.match(src, /staleWhileRevalidate/);
  assert.match(src, /networkFirst/);
  assert.match(src, /tile\.openstreetmap\.org/);
  assert.match(src, /\/api\/elpris/);
  assert.match(src, /\/api\/chargers/);
  assert.match(src, /\/api\/charge-prices/);
  assert.match(src, /\/api\/drive/);
  assert.match(src, /\/auth\//);
  assert.match(src, /periodicsync/);
});

test("service worker does not intercept Vite / auth traffic", () => {
  assert.match(src, /\/@/);
  assert.match(src, /\/src\//);
  assert.match(src, /\/api\/tesla/);
});
