#!/usr/bin/env bun
// Generate skills/bithk/references/api-spec.json (OpenAPI 3.1) for the bithk
// API. Routes are enumerated from the in-process Hono tables; per-module
// fragments under `api-spec/` supply curated parameters, and any uncurated
// route is auto-stubbed so coverage is always 100%.
//
// Usage:
//   bun scripts/gen-api-spec.ts          # write the spec
//   bun scripts/gen-api-spec.ts --check  # non-zero on drift or stale ops
/* eslint-disable no-console */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { buildSpec } from "./api-spec";

const { values: cli } = parseArgs({
  args: process.argv.slice(2),
  options: { check: { type: "boolean", default: false } },
  strict: true,
  allowPositionals: false,
});

const ROOT = resolve(import.meta.dir, "..", "..", "..");
const OUT_PATH = resolve(ROOT, "skills/bithk/references/api-spec.json");

const { doc, stale, uncovered, routeCount, curatedCount } = buildSpec();

if (stale.length > 0) {
  console.error(`[gen-api-spec] ${stale.length} curated operation(s) match no real route (fix the path/method):`);
  for (const k of stale)
    console.error(`  - ${k}`);
  process.exit(1);
}
if (uncovered.length > 0) {
  console.error(`[gen-api-spec] ${uncovered.length} route(s) have no operation:`);
  for (const k of uncovered)
    console.error(`  - ${k}`);
  process.exit(1);
}

const rendered = `${JSON.stringify(doc, null, 2)}\n`;

if (cli.check) {
  const existing = (() => {
    try {
      return readFileSync(OUT_PATH, "utf-8");
    }
    catch {
      return "";
    }
  })();
  if (existing.trim() !== rendered.trim()) {
    console.error(`[gen-api-spec] ${OUT_PATH} is stale. Run \`bun run gen:api-spec\` and commit.`);
    process.exit(1);
  }
  console.log(`[gen-api-spec] up to date (${routeCount} routes, ${curatedCount} curated)`);
}
else {
  writeFileSync(OUT_PATH, rendered);
  console.log(`[gen-api-spec] wrote ${OUT_PATH} (${routeCount} routes, ${curatedCount} curated)`);
}
