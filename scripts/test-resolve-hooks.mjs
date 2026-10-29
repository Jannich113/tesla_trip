/** Resolve hooks for scripts/test-resolve.mjs. */
import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const TRY = ["", ".ts", ".mjs", ".js", "/index.ts"];
const HAS_EXT = /\.(?:[cm]?[jt]s|json)$/;

function candidate(specifier, parentURL) {
  if (specifier.startsWith("@/")) return join(SRC, specifier.slice(2));
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  if (relative && parentURL?.startsWith("file:") && !HAS_EXT.test(specifier)) {
    return resolvePath(dirname(fileURLToPath(parentURL)), specifier);
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const base = candidate(specifier, context.parentURL);
  if (base) {
    for (const ext of TRY) {
      const file = base + ext;
      if (ext === "" ? HAS_EXT.test(file) && existsSync(file) : existsSync(file)) {
        return nextResolve(pathToFileURL(file).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
