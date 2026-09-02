import type { AppDatabase } from "@/db";
import type { BackupManifestV2 } from "@/modules/backup/archive.service";
import type { ImportApplyReport } from "@/modules/backup/import-apply";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { writeArchiveV2 } from "@/modules/backup/archive.service";
import { __resetImportApplyForTests, startImportApply } from "@/modules/backup/import-apply";
import { prepareImport } from "@/modules/backup/import.service";
import { stubLogger, testConfig, testNanoid } from "./route-harness";

export interface BackupRoundTrip {
  readonly manifest: BackupManifestV2;
  /** Module names in dependency order, as the manifest records them. */
  readonly modules: readonly string[];
  /** Parsed archive rows per table (drizzle property names, like the NDJSON). */
  readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  /** The apply report (`totals.inserted`, per-table counts, warnings). */
  readonly result: ImportApplyReport;
}

/**
 * Export `modules` (deps resolved) from `sourceDb` as a v2 archive and merge
 * it into `targetDb` through the real staging + apply path — the harness
 * every module backup test uses to prove its contribution round-trips
 * (CHORE-013 replaced the retired v1 JSON exporter/importer here). Staging
 * lands under `baseDir`, which the caller removes.
 */
export async function roundTripBackupV2(
  sourceDb: AppDatabase,
  targetDb: AppDatabase,
  modules: readonly string[],
  baseDir: string,
  opts: { readonly wipeExisting?: boolean } = {},
): Promise<BackupRoundTrip> {
  const stagingDir = resolve(baseDir, `roundtrip-${testNanoid()}`);
  mkdirSync(stagingDir, { recursive: true });
  const { manifest, archivePath } = await writeArchiveV2({ db: sourceDb, modules: [...modules], stagingDir, appName: "app" });
  const file = new File([await Bun.file(archivePath).arrayBuffer()], "backup.tar.gz", { type: "application/gzip" });

  const config = testConfig({ DATA_DIR: resolve(baseDir, "import-data") });
  const job = await prepareImport(targetDb, config, file);
  __resetImportApplyForTests();
  await startImportApply(targetDb, job, {
    wipeExisting: opts.wipeExisting ?? false,
    actor: { id: "roundtrip", name: "Round Trip", ip: "127.0.0.1", userAgent: "test" },
  }, stubLogger);
  await job.done;
  if (job.state !== "completed" || !job.result)
    throw new Error(`backup round trip failed: ${job.error ?? job.state}`);
  return {
    manifest,
    modules: manifest.modules.map(m => m.name),
    tables: Object.fromEntries(job.tables),
    result: job.result,
  };
}
