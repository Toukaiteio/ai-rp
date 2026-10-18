/**
 * 跑批脚本用的路径别名解析器。
 *
 * 项目里所有模块都用 `@/...` 引自己，Next 和 vitest 各自配了别名。
 * 这个脚本直接用 node 跑，所以要自己把 `@/` 映射回仓库根目录，
 * 并且补上省略的扩展名（`@/lib/prompt` → `lib/prompt/index.ts`）。
 *
 * 只给 scripts/ 下的跑批脚本用，不进应用运行时。
 */
import { statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const CANDIDATES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx", ".json"];

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = path.join(root, specifier.slice(2));
    const found = probe(base);
    if (found) return found;
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    // 项目里的相对引用也不写扩展名（`./types`），Node 的 ESM 解析器不认，
    // 这里补上 .ts / /index.ts 再试一次。
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
      const base = path.resolve(
        specifier.startsWith("/")
          ? root
          : path.dirname(new URL(context.parentURL).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
        specifier,
      );
      const found = probe(base);
      if (found) return found;
    }
    throw error;
  }
}

function probe(base) {
  for (const suffix of CANDIDATES) {
    const candidate = `${base}${suffix}`;
    if (!isFile(candidate)) continue;
    return {
      url: pathToFileURL(candidate).href,
      shortCircuit: true,
      ...(candidate.endsWith(".json") ? { importAttributes: { type: "json" } } : {}),
    };
  }
  return null;
}
