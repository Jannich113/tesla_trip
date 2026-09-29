import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function src(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("leaflet starts downloading without an idle wait", () => {
  const map = src("src/components/bay-map.tsx");
  const plan = src("src/routes/plan.tsx");
  const shell = src("src/components/shell.tsx");
  const root = src("src/routes/__root.tsx");
  const sw = src("public/sw.js");

  assert.match(map, /export function loadLeaflet/);
  assert.match(map, /leafletPromise \?\?= import\("leaflet"\)/);
  assert.match(map, /void loadLeaflet\(\)/);
  assert.match(map, /requestAnimationFrame\(\(\) =>/);
  assert.match(map, /basemaps\.cartocdn\.com\/light_all/);
  assert.doesNotMatch(map, /tile\.openstreetmap\.org/);
  assert.doesNotMatch(map, /scheduleIdle\([\s\S]{0,120},\s*600\)/);

  const beforePage = plan.split("function PlanPage")[0];
  assert.match(beforePage, /import\("@\/components\/bay-map"\)/);

  assert.match(shell, /import\("@\/components\/bay-map"\)/);
  assert.match(root, /rel: "preconnect", href: "https:\/\/a\.basemaps\.cartocdn\.com"/);
  assert.match(sw, /basemaps\.cartocdn\.com/);
});
