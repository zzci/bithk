#!/usr/bin/env bun
/**
 * One-shot fold of a pre-PLAN-108 database into the section model (DATA-003).
 *
 * Copies every table of `--from` into a fresh `--to` built by the current
 * baseline, folds `ships` into `ship_profiles` + section mounts, and prints a
 * reconciliation report. The source is opened read-only and never written.
 * Exit 0 only when the fold committed, every source row is accounted for and
 * the post-fold self-check passed; on any failure the target file is removed.
 *
 * Usage:
 *   bun scripts/migrate/plan108-fold.ts --from <path> --to <path> [--force]
 *   bun run --filter @app/api db:fold -- --from <path> --to <path> [--force]
 */
/* eslint-disable no-console */
import process from "node:process";
import { parseArgs } from "node:util";
import { runFold } from "./plan108-fold.lib";
import { formatFoldReport } from "./plan108-fold.report";
import { FoldError } from "./plan108-fold.types";

const { values: cli } = parseArgs({
  args: process.argv.slice(2),
  options: {
    from: { type: "string" },
    to: { type: "string" },
    force: { type: "boolean", default: false },
  },
  strict: true,
});

if (!cli.from || !cli.to) {
  console.error("Usage: bun scripts/migrate/plan108-fold.ts --from <path> --to <path> [--force]");
  process.exit(2);
}

try {
  const report = await runFold({ from: cli.from, to: cli.to, force: cli.force });
  console.log(formatFoldReport(report));
}
catch (err) {
  if (err instanceof FoldError) {
    console.error(`FOLD FAILED: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
