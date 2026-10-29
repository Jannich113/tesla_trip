/**
 * `node --import ./scripts/test-resolve.mjs --test …`
 *
 * Lets the Node test runner load app modules the way Vite does: the "@/…" alias
 * (src/) and relative imports written without a file extension. Without it,
 * modules such as src/planner/engine.ts cannot be imported by tests at all.
 */
import { register } from "node:module";

register("./test-resolve-hooks.mjs", import.meta.url);
