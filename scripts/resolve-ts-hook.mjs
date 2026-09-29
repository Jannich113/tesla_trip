import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

function withExt(file) {
  if (existsSync(file)) return file;
  if (existsSync(`${file}.ts`)) return `${file}.ts`;
  if (existsSync(`${file}.tsx`)) return `${file}.tsx`;
  return file;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const file = withExt(fileURLToPath(new URL(`../src/${specifier.slice(2)}`, import.meta.url)));
    return nextResolve(pathToFileURL(file).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      const file = withExt(fileURLToPath(new URL(specifier, context.parentURL)));
      if (file.endsWith(".ts") || file.endsWith(".tsx")) return nextResolve(pathToFileURL(file).href, context);
      throw err;
    }
  }
  return nextResolve(specifier, context);
}
