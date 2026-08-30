/**
 * Backup v2 IMPORT — upload staging, streaming archive reader/validator,
 * and the in-memory import-job lifecycle (PLAN-075 R2/R6, Phase 2).
 *
 * Import stage 1 (Validate) runs while the upload streams to staging:
 *
 * - compressed-size cap enforced on counted bytes (the route additionally
 *   pre-checks Content-Length — the header can lie, the count cannot);
 * - decompression-bomb defence: total decompressed cap, per-NDJSON-line cap,
 *   per-blob cap, tar entry-count cap;
 * - `manifest.json` MUST be the first tar entry; `format` / `formatVersion`
 *   checked before any data is read (newer → UNSUPPORTED_VERSION, v1 policy);
 * - strict entry-path allowlist grammar: exactly `manifest.json`,
 *   `data/<name>.ndjson`, or `blobs/<ab>/<cd>/<64-hex>` with the prefix
 *   bytes matching the hash. Absolute paths, `..`, symlink/hardlink/device
 *   entries, or anything else reject the whole archive;
 * - per-row sanity reuses v1: `assertSane` shape limits, `assertIdShape`,
 *   row-count caps.
 *
 * Table NDJSON is parsed into memory (bounded by the row caps); blob bytes —
 * the unbounded part — stay inside the staged archive untouched. Nothing
 * from the archive is ever written outside `backup-staging/imports/<id>/`.
 *
 * Stage 2 (dry-run) executes automatically after validation via the mapping
 * engine in `import-mapping.ts`. Job bookkeeping is in-memory, mirroring
 * `export-job.service.ts`; the staged archive is the durable part and the
 * existing TTL sweep reclaims orphans.
 *
 * State machine: `validated` → (`applying` → `completed` | `failed`, Phase 3).
 */
import type { BackupManifestV2 } from "./archive.service";
import type { ImportApplyReport } from "./import-apply";
import type { ImportDryRunReport } from "./import-mapping";
import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import { rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { extract as tarExtract } from "tar-stream";
import { z } from "zod";
import { legacyContentAddressedKey } from "@/modules/file/storage/key";
import { getActiveDriver } from "@/modules/file/storage/registry";
import { AppError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from "./archive.service";
import { getBackupStagingRoot } from "./export-job.service";
import { runImportDryRun } from "./import-mapping";
import { assertIdShape, assertSane, MAX_ROWS_PER_TABLE, MAX_TOTAL_ROWS } from "./restore.service";

// ─── Caps (R6) ───────────────────────────────────────────────────────────

/** Tar entry-count cap — bombs made of millions of tiny entries. */
const TAR_ENTRY_COUNT_CAP = 100_000;
/** One NDJSON line is one row; v1's `assertSane` caps strings at 1 MB. */
const MAX_NDJSON_LINE_BYTES = 4 * 1024 * 1024;
/**
 * Total decompressed cap as a multiple of the compressed cap. Legitimate
 * archives stay well below (blobs barely compress; NDJSON ~5–10×); bombs
 * aim for 1000×.
 */
const DECOMPRESSED_CAP_MULTIPLIER = 10;

export interface ImportLimits {
  readonly maxArchiveBytes: number;
  readonly maxBlobBytes: number;
  readonly maxEntries: number;
  readonly maxLineBytes: number;
  readonly maxDecompressedBytes: number;
  readonly maxRowsPerTable: number;
  readonly maxTotalRows: number;
}

export function importLimitsFor(config: Config, overrides: Partial<ImportLimits> = {}): ImportLimits {
  return {
    maxArchiveBytes: config.BACKUP_IMPORT_MAX_ARCHIVE_BYTES,
    maxBlobBytes: config.BACKUP_IMPORT_MAX_BLOB_BYTES,
    maxEntries: TAR_ENTRY_COUNT_CAP,
    maxLineBytes: MAX_NDJSON_LINE_BYTES,
    maxDecompressedBytes: config.BACKUP_IMPORT_MAX_ARCHIVE_BYTES * DECOMPRESSED_CAP_MULTIPLIER,
    maxRowsPerTable: MAX_ROWS_PER_TABLE,
    maxTotalRows: MAX_TOTAL_ROWS,
    ...overrides,
  };
}

// ─── Import job lifecycle ────────────────────────────────────────────────

export type ImportJobState = "validated" | "applying" | "completed" | "failed";

export interface ImportJob {
  readonly id: string;
  state: ImportJobState;
  readonly createdAt: string;
  readonly stagingDir: string;
  readonly archivePath: string;
  readonly manifest: BackupManifestV2;
  /** Parsed table rows (bounded by the row caps); blob bytes stay in the archive. */
  readonly tables: ReadonlyMap<string, readonly Record<string, unknown>[]>;
  /** Blob entries found in the archive: sha256 → byte size. */
  readonly blobs: ReadonlyMap<string, number>;
  report: ImportDryRunReport;
  /** Final apply report — set when the apply runner reaches `completed`. */
  result?: ImportApplyReport;
  error?: string;
  /** Settles when the background apply runner exits (success or failure). */
  done?: Promise<void>;
}

const importJobs = new Map<string, ImportJob>();

export function registerImportJob(job: ImportJob): void {
  importJobs.set(job.id, job);
}

export function getImportJob(id: string): ImportJob | undefined {
  return importJobs.get(id);
}

/**
 * Discard a staged import without applying: remove the staging directory
 * and forget the job. Refused while an apply is running (Phase 3 state).
 * Returns false for an unknown id.
 */
export function discardImportJob(id: string): boolean {
  const job = importJobs.get(id);
  if (!job)
    return false;
  if (job.state === "applying")
    throw new AppError("Import is currently being applied and cannot be discarded.", 409, "IMPORT_IN_PROGRESS");
  rmSync(job.stagingDir, { recursive: true, force: true });
  importJobs.delete(id);
  return true;
}

/** Test-only: clear the import-job map. */
export function __resetImportJobsForTests(): void {
  importJobs.clear();
}

/** Test-only: register a synthetic job (e.g. to pin state-machine guards). */
export function __setImportJobForTests(job: ImportJob): void {
  importJobs.set(job.id, job);
}

// ─── Manifest validation ─────────────────────────────────────────────────

const RE_TABLE_NAME = /^[\w-]+$/;

const manifestSchema = z.object({
  format: z.string(),
  formatVersion: z.number().int(),
  exportedAt: z.string(),
  app: z.object({ name: z.string(), version: z.string(), commit: z.string() }),
  schema: z.object({
    dialect: z.string(),
    journal: z.object({ lastIdx: z.number(), lastTag: z.string(), entryCount: z.number() }),
  }),
  redacted: z.boolean(),
  includeBlobs: z.boolean(),
  // R7 fields — first-class on import since Phase 3 (no longer stripped).
  // Both optional in the SCHEMA only for legacy pre-R7 archives: absent
  // `blobsMode` derives from the `includeBlobs` alias below; absent
  // `expectedBlobs` stays undefined = "unknown expected set" (the blob
  // stage then leaves missing-blob detection to reconcile).
  blobsMode: z.enum(["embedded", "separate", "none", "external"]).optional(),
  expectedBlobs: z.array(z.object({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().nonnegative(),
    storageKey: z.string(),
    storageDriver: z.string(),
  })).optional(),
  modules: z.array(z.object({ name: z.string().min(1), deps: z.array(z.string()) })),
  tables: z.array(z.object({
    name: z.string().regex(RE_TABLE_NAME),
    module: z.string(),
    file: z.string(),
    rowCount: z.number().int().nonnegative(),
    primaryKey: z.array(z.string()),
    columns: z.array(z.object({
      name: z.string(),
      type: z.string(),
      notNull: z.boolean(),
      hasDefault: z.boolean().optional(),
      references: z.string().optional(),
    })),
  })),
  blobs: z.object({ count: z.number(), totalBytes: z.number() }),
  warnings: z.array(z.string()).default([]),
});

function parseManifest(bytes: Buffer): BackupManifestV2 {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  }
  catch {
    throw new AppError("manifest.json is not valid JSON", 400, "MALFORMED_ARCHIVE");
  }
  const obj = raw as Record<string, unknown>;
  // Format/version gates come before the shape check so the error codes
  // stay specific (and match v1's UNSUPPORTED_VERSION policy).
  if (obj?.format !== BACKUP_FORMAT)
    throw new AppError("Archive is not a recognised backup", 400, "INVALID_FORMAT");
  const version = typeof obj.formatVersion === "number" ? obj.formatVersion : 0;
  if (version > BACKUP_FORMAT_VERSION) {
    throw new AppError(
      `Backup format version ${version} is newer than this build supports (max ${BACKUP_FORMAT_VERSION}). Upgrade the server before importing.`,
      400,
      "UNSUPPORTED_VERSION",
    );
  }
  // Below the current version: a pre-reset archive. PLAN-108 reset the schema
  // outright, so there is nothing to migrate onto — say so, and say what the
  // operator's only remaining option is, rather than a bare version number.
  if (version !== BACKUP_FORMAT_VERSION) {
    throw new AppError(
      `Backup format version ${version} predates the projects-as-sections schema reset (format ${BACKUP_FORMAT_VERSION}). `
      + "Pre-reset archives cannot be imported or migrated. "
      + "To recover data from one, run a pre-reset build of the server against a copy of this deployment and read it there.",
      400,
      "INVALID_FORMAT",
    );
  }

  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success)
    throw new AppError("manifest.json has an invalid shape", 400, "MALFORMED_ARCHIVE");
  if (parsed.data.modules.length === 0)
    throw new AppError("Backup archive contains no modules", 400, "NO_MODULES");
  for (const table of parsed.data.tables) {
    if (table.file !== `data/${table.name}.ndjson`)
      throw new AppError(`manifest table ${table.name} declares an invalid file path`, 400, "MALFORMED_ARCHIVE");
  }
  // Legacy default (pre-R7 archives): the deprecated `includeBlobs` alias is
  // the only blob-placement signal — `true → embedded`, `false → none`.
  const blobsMode = parsed.data.blobsMode ?? (parsed.data.includeBlobs ? "embedded" : "none");
  return { ...parsed.data, blobsMode } as BackupManifestV2;
}

// ─── Streaming archive reader / validator ────────────────────────────────

const RE_TABLE_ENTRY = /^data\/([\w-]+)\.ndjson$/i;
/** Strict blob entry grammar — shared with the standalone blob restore. */
export const RE_BLOB_ENTRY = /^blobs\/([0-9a-f]{2})\/([0-9a-f]{2})\/([0-9a-f]{64})$/;

interface ParsedArchive {
  readonly manifest: BackupManifestV2;
  readonly tables: Map<string, Record<string, unknown>[]>;
  readonly blobs: Map<string, number>;
}

export interface TarEntryHeader {
  readonly name: string;
  readonly type?: string;
  readonly size?: number;
}

export function malformedArchiveError(reason: string): AppError {
  return new AppError(`Invalid backup archive: ${reason}`, 400, "MALFORMED_ARCHIVE");
}

const malformed = malformedArchiveError;

/**
 * Gunzip + untar a staged archive, invoking `handleEntry` strictly in order
 * with backpressure (async-iterator bridge — Bun's `Readable.toWeb` rejects
 * tar-stream's streamx streams). An error thrown by `handleEntry` aborts the
 * walk and is rethrown; bytes that are not a readable gzipped tar surface as
 * `MALFORMED_ARCHIVE`. Shared by the validate stage, the apply-time blob
 * stage, and the standalone blob restore.
 */
export async function walkTarGzEntries(
  archivePath: string,
  handleEntry: (header: TarEntryHeader, stream: AsyncIterable<Buffer>) => Promise<void>,
): Promise<void> {
  const ex = tarExtract();
  let entryError: Error | undefined;
  const finished = new Promise<void>((res, rej) => {
    ex.on("finish", res);
    ex.on("error", rej);
  });
  // Swallow the post-destroy rejection; `entryError` is what we rethrow.
  finished.catch(() => {});
  ex.on("entry", (header, stream, next) => {
    handleEntry(header as TarEntryHeader, stream as unknown as AsyncIterable<Buffer>).then(
      () => next(),
      (err: unknown) => {
        entryError = err instanceof Error ? err : new Error(String(err));
        ex.destroy(entryError);
      },
    );
  });

  try {
    const gunzip = Bun.file(archivePath).stream().pipeThrough(new DecompressionStream("gzip"));
    for await (const chunk of gunzip) {
      if (entryError)
        break;
      if (!ex.write(Buffer.from(chunk)))
        await once(ex, "drain");
    }
    if (!entryError) {
      ex.end(undefined);
      await finished;
    }
  }
  catch (err) {
    if (entryError)
      throw entryError;
    if (err instanceof AppError)
      throw err;
    throw malformed("not a readable .tar.gz");
  }
  if (entryError)
    throw entryError;
}

/** Buffer one whole (small, capped) entry — used for manifest.json only. */
async function readEntryBytes(stream: AsyncIterable<Buffer>, cap: number, what: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > cap)
      throw malformed(`${what} exceeds its size cap`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Gunzip + untar the staged archive, enforcing every Validate-stage check.
 * Entries are processed strictly in order with backpressure (the same
 * async-iterator bridge as the writer — Bun's `Readable.toWeb` rejects
 * tar-stream's streamx streams).
 */
async function readAndValidateArchive(archivePath: string, limits: ImportLimits): Promise<ParsedArchive> {
  const seen = new Set<string>();
  const tables = new Map<string, Record<string, unknown>[]>();
  const blobs = new Map<string, number>();
  let manifest: BackupManifestV2 | undefined;
  let entryCount = 0;
  let decompressedBytes = 0;
  let totalRows = 0;

  const countBytes = (n: number): void => {
    decompressedBytes += n;
    if (decompressedBytes > limits.maxDecompressedBytes)
      throw new AppError("Archive decompresses past the total size cap", 400, "ARCHIVE_TOO_LARGE");
  };

  const handleEntry = async (header: TarEntryHeader, stream: AsyncIterable<Buffer>): Promise<void> => {
    entryCount++;
    if (entryCount > limits.maxEntries)
      throw new AppError(`Archive exceeds the ${limits.maxEntries}-entry cap`, 400, "ARCHIVE_TOO_LARGE");
    // Only plain file entries are legal — symlinks, hardlinks, devices and
    // directories are rejected outright (zip-slip / link-following defence).
    if (header.type !== undefined && header.type !== "file")
      throw malformed(`unsupported entry type '${header.type}' (${header.name})`);
    if (seen.has(header.name))
      throw malformed(`duplicate entry ${header.name}`);
    seen.add(header.name);

    if (entryCount === 1) {
      // Cross-endpoint hint: a blobs-only archive (R7 separate export)
      // carries no manifest — point the operator at the right endpoint.
      if (RE_BLOB_ENTRY.test(header.name))
        throw malformed("manifest.json is missing — a blobs-only archive must be uploaded to /api/backup/v2/blob-restores instead");
      if (header.name !== "manifest.json")
        throw malformed("manifest.json must be the first entry");
      const bytes = await readEntryBytes(stream, limits.maxLineBytes, "manifest.json");
      countBytes(bytes.length);
      manifest = parseManifest(bytes);
      return;
    }

    const tableMatch = RE_TABLE_ENTRY.exec(header.name);
    if (tableMatch) {
      const tableName = tableMatch[1]!;
      const declared = manifest!.tables.find(t => t.name === tableName);
      if (!declared)
        throw malformed(`data entry ${header.name} is not declared in the manifest`);
      const rows: Record<string, unknown>[] = [];
      let pending: Buffer = Buffer.alloc(0);
      const parseLine = (line: Buffer): void => {
        if (line.length === 0)
          return;
        if (line.length > limits.maxLineBytes)
          throw new AppError(`Row in ${header.name} exceeds the per-row size cap`, 400, "INVALID_BACKUP_ROW");
        let row: unknown;
        try {
          row = JSON.parse(line.toString("utf8"));
        }
        catch {
          throw malformed(`invalid NDJSON in ${header.name}`);
        }
        if (!row || typeof row !== "object" || Array.isArray(row))
          throw malformed(`invalid NDJSON row in ${header.name}`);
        // Per-row sanity reused from v1 (shape limits + id alphabet).
        assertSane(row);
        assertIdShape(row as Record<string, unknown>);
        rows.push(row as Record<string, unknown>);
        totalRows++;
        if (rows.length > limits.maxRowsPerTable)
          throw new AppError(`Table ${tableName} exceeds the ${limits.maxRowsPerTable}-row cap`, 400, "INVALID_BACKUP_ROW");
        if (totalRows > limits.maxTotalRows)
          throw new AppError(`Archive exceeds the ${limits.maxTotalRows}-row cap`, 400, "INVALID_BACKUP_ROW");
      };
      for await (const chunk of stream) {
        countBytes(chunk.length);
        pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
        let newline = pending.indexOf(0x0A);
        while (newline !== -1) {
          parseLine(pending.subarray(0, newline));
          pending = pending.subarray(newline + 1);
          newline = pending.indexOf(0x0A);
        }
        if (pending.length > limits.maxLineBytes)
          throw new AppError(`Row in ${header.name} exceeds the per-row size cap`, 400, "INVALID_BACKUP_ROW");
      }
      parseLine(pending);
      tables.set(tableName, rows);
      return;
    }

    const blobMatch = RE_BLOB_ENTRY.exec(header.name);
    if (blobMatch) {
      const [, ab, cd, sha] = blobMatch;
      if (sha!.slice(0, 2) !== ab || sha!.slice(2, 4) !== cd)
        throw malformed(`blob entry path prefix does not match its hash (${header.name})`);
      // Bytes stay in the archive — count and drain only.
      let size = 0;
      for await (const chunk of stream) {
        countBytes(chunk.length);
        size += chunk.length;
        if (size > limits.maxBlobBytes)
          throw new AppError(`Blob ${sha} exceeds the per-blob size cap`, 400, "ARCHIVE_TOO_LARGE");
      }
      blobs.set(sha!, size);
      return;
    }

    // Anything outside the allowlist grammar — absolute paths, `..`,
    // unexpected names — rejects the whole archive.
    throw malformed(`entry path outside the allowlist: ${header.name}`);
  };

  await walkTarGzEntries(archivePath, handleEntry);
  if (!manifest)
    throw malformed("archive is empty");

  // Every manifest-declared table must have shipped its data entry.
  for (const table of manifest.tables) {
    if (!tables.has(table.name))
      throw malformed(`manifest declares ${table.file} but the entry is missing`);
  }

  return { manifest, tables, blobs };
}

// ─── Staging + dry-run orchestration ─────────────────────────────────────

/** Stream an upload to staging under the counted-bytes compressed cap. */
export async function stageUpload(source: Blob, archivePath: string, maxArchiveBytes: number): Promise<void> {
  const sink = Bun.file(archivePath).writer();
  let written = 0;
  try {
    for await (const chunk of source.stream()) {
      written += chunk.byteLength;
      // Counted-bytes enforcement — Content-Length (checked by the route)
      // and Blob.size can lie; this count cannot.
      if (written > maxArchiveBytes)
        throw new AppError(`Backup archive exceeds the ${maxArchiveBytes}-byte upload cap`, 400, "ARCHIVE_TOO_LARGE");
      sink.write(chunk);
    }
  }
  finally {
    await sink.end();
  }
}

/** Blob existence-checks only — blobs are NEVER written in Phase 2. */
async function checkArchiveBlobs(
  blobs: ReadonlyMap<string, number>,
  warnings: string[],
): Promise<ImportDryRunReport["blobs"]> {
  if (blobs.size === 0)
    return { count: 0, existing: 0, missing: 0 };
  let driver: { exists: (key: string) => Promise<boolean> };
  try {
    driver = getActiveDriver();
  }
  catch {
    warnings.push("no active storage driver — blob existence was not verified");
    return { count: blobs.size, existing: 0, missing: blobs.size };
  }
  let existing = 0;
  for (const sha of blobs.keys()) {
    // Blob entries only occur in legacy embedded archives, whose rows all
    // carry content-addressed keys — probing that shape is exact for them.
    if (await driver.exists(legacyContentAddressedKey(sha)))
      existing++;
  }
  return { count: blobs.size, existing, missing: blobs.size - existing };
}

/**
 * Stage an uploaded archive, run the full Validate stage, then the rollback
 * dry-run, and return a `validated` job carrying the report. The job is NOT
 * registered — the route audits first, then calls {@link registerImportJob}.
 * Any failure removes the staging directory before rethrowing.
 */
export async function prepareImport(
  db: AppDatabase,
  config: Config,
  source: Blob,
  limitOverrides: Partial<ImportLimits> = {},
): Promise<ImportJob> {
  const limits = importLimitsFor(config, limitOverrides);
  if (source.size > limits.maxArchiveBytes)
    throw new AppError(`Backup archive exceeds the ${limits.maxArchiveBytes}-byte upload cap`, 400, "ARCHIVE_TOO_LARGE");

  const id = ulid();
  const stagingDir = resolve(getBackupStagingRoot(config), "imports", id);
  const archivePath = resolve(stagingDir, "archive.tar.gz");
  await mkdir(stagingDir, { recursive: true });

  try {
    await stageUpload(source, archivePath, limits.maxArchiveBytes);
    const { manifest, tables, blobs } = await readAndValidateArchive(archivePath, limits);
    const dryRun = runImportDryRun(db, manifest, tables);
    const warnings = [...dryRun.warnings];
    const blobCounts = await checkArchiveBlobs(blobs, warnings);
    const report: ImportDryRunReport = { ...dryRun, warnings, blobs: blobCounts };
    return {
      id,
      state: "validated",
      createdAt: new Date().toISOString(),
      stagingDir,
      archivePath,
      manifest,
      tables,
      blobs,
      report,
    };
  }
  catch (err) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw err;
  }
}
