import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * ROOT_DIR resolution:
 * 1. ROOT_DIR env var — explicit override
 * 2. Flattened lode package root — directory containing dist/ or drizzle/
 * 3. Legacy Bun-compiled binary (/$bunfs) — process.cwd()
 * 4. Otherwise — 3 levels up from this file to monorepo root
 */
function detectRootDir(): string {
  if (process.env.ROOT_DIR) {
    return resolve(process.env.ROOT_DIR);
  }

  // import.meta.url is always available (works in Bun, Node, Vite)
  const thisDir = dirname(fileURLToPath(import.meta.url));

  if (existsSync(resolve(thisDir, "dist/index.html")) || existsSync(resolve(thisDir, "drizzle/meta/_journal.json"))) {
    return thisDir;
  }

  // Compiled binary: Bun virtual filesystem
  if (thisDir.startsWith("/$bunfs")) {
    return process.cwd();
  }

  // Dev or API dist: go up 3 levels from apps/api/src or apps/api/dist.
  return resolve(thisDir, "../../..");
}

export const ROOT_DIR = detectRootDir();
