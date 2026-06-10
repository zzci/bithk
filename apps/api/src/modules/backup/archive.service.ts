/**
 * Backup v2 ARCHIVE WRITER (PLAN-075 R1, R7).
 *
 * Produces a staged `.tar.gz` whose layout is:
 *
 *     manifest.json                  # ALWAYS the first tar entry
 *     data/<table>.ndjson            # one file per table, dependency order
 *     blobs/<ab>/<cd>/<sha256>       # raw bytes from the active storage driver
 *
 * Blob placement is governed by `blobsMode` (R7): `embedded` packs blobs
 * into the data archive (pre-R7 behavior), `none` skips blob bytes, and
 * `separate` writes a SECOND artifact `blobs.tar.gz` in the same staging
 * dir holding ONLY `blobs/` entries (no manifest inside) while the data
 * archive carries manifest + NDJSON only.
 *
 * Table NDJSON is staged to `<stagingDir>/tmp/` first because the tar header
 * needs each entry's size up front; blob sizes are known from `files.size`,
 * so blobs stream from the driver straight into the tar without temp copies.
 * Gzip uses Bun's built-in `CompressionStream("gzip")`; tar packing uses
 * `tar-stream`. Each artifact is written to `<name>.partial` and renamed
 * on success, so a `.partial` file is never downloadable.
 */
import type { AnyColumn, Table } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Pack } from "tar-stream";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { once } from "node:events";
import { existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { asc, getTableColumns, getTableName, gt, sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { pack as tarPack } from "tar-stream";
import { BUILD_INFO } from "@/build-info";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { getActiveDriver } from "@/modules/file/storage/registry";
import { ROOT_DIR } from "@/root";
import { getDataModules, getTablesForModules, resolveModulesWithDeps } from "./registry";
import { redactSecretFields } from "./secret-fields";

export const BACKUP_FORMAT = "bithk-backup";
export const BACKUP_FORMAT_VERSION = 2;

const STREAM_BATCH_SIZE = 1000;

/** Thrown when the caller's abort flag flips mid-export. */
export class ExportCancelledError extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ExportCancelledError";
  }
}

/** R7 blob placement: embedded in the data archive, a separate artifact, or skipped. */
export type BlobsMode = "embedded" | "separate" | "none";

/** A blob a `files` row references — listed in the manifest in EVERY mode. */
export interface ExpectedBlob {
  readonly sha256: string;
  readonly size: number;
  readonly storageKey: string;
  readonly storageDriver: string;
}

export interface ManifestColumn {
  readonly name: string;
  readonly type: string;
  readonly notNull: boolean;
  readonly hasDefault?: boolean;
  readonly references?: string;
}

export interface ManifestTable {
  readonly name: string;
  readonly module: string;
  readonly file: string;
  readonly rowCount: number;
  readonly primaryKey: readonly string[];
  readonly columns: readonly ManifestColumn[];
}

export interface BackupManifestV2 {
  readonly format: typeof BACKUP_FORMAT;
  readonly formatVersion: typeof BACKUP_FORMAT_VERSION;
  readonly exportedAt: string;
  readonly app: { readonly name: string; readonly version: string; readonly commit: string };
  readonly schema: {
    readonly dialect: "sqlite";
    readonly journal: { readonly lastIdx: number; readonly lastTag: string; readonly entryCount: number };
  };
  readonly redacted: boolean;
  /** Deprecated alias of `blobsMode !== "none"` — kept for older readers. */
  readonly includeBlobs: boolean;
  /**
   * R7 field — ALWAYS written by this exporter and first-class on the
   * import side (Phase 3): legacy pre-R7 archives lack it, so the import
   * parser derives it from the `includeBlobs` alias (`true → embedded`,
   * `false → none`).
   */
  readonly blobsMode: BlobsMode;
  /**
   * EVERY blob referenced by exported `files` rows, on any driver, in any
   * mode (R7). Optional only because legacy pre-R7 archives lack the list —
   * `undefined` means "unknown expected set" on import (the blob stage
   * falls back to reconcile for missing-blob detection).
   */
  readonly expectedBlobs?: readonly ExpectedBlob[];
  readonly modules: readonly { readonly name: string; readonly deps: readonly string[] }[];
  readonly tables: readonly ManifestTable[];
  /** Blobs whose bytes this export actually wrote (active driver only). */
  readonly blobs: { readonly count: number; readonly totalBytes: number };
  readonly warnings: readonly string[];
}

export interface ArchiveProgress {
  readonly tablesDone: number;
  readonly tablesTotal: number;
  readonly blobBytesDone: number;
  readonly blobBytesTotal: number;
}

export interface WriteArchiveV2Options {
  readonly db: AppDatabase;
  /** Module selection; transitive deps are resolved here. */
  readonly modules: readonly string[];
  /** R7 blob placement; defaults to `embedded` (or via the alias below). */
  readonly blobsMode?: BlobsMode;
  /** Deprecated alias: `true→embedded`, `false→none`; `blobsMode` wins. */
  readonly includeBlobs?: boolean;
  /** Job staging directory; `tmp/` and the artifact(s) land inside it. */
  readonly stagingDir: string;
  /** `APP_NAME` — recorded in `manifest.app.name`. */
  readonly appName: string;
  /**
   * Scrub secret-typed fields (`SECRET_FIELD_NAMES`) from every NDJSON row
   * and set `manifest.redacted: true` — the token-route export policy (R6).
   * Admin exports stay unredacted (the restore-complete path).
   */
  readonly redacted?: boolean;
  /** Abort flag, checked between row batches and between tar entries. */
  readonly isCancelled?: () => boolean;
  readonly onProgress?: (progress: ArchiveProgress) => void;
}

export interface WriteArchiveV2Result {
  readonly manifest: BackupManifestV2;
  readonly archivePath: string;
  readonly archiveSize: number;
  /** Set only in `separate` mode — the second artifact. */
  readonly blobsArchivePath?: string;
  readonly blobsArchiveSize?: number;
}

/**
 * Read the drizzle migration journal that produced the running schema.
 * Mirrors `resolveMigrationsFolder` in `@/db`: packaged releases ship
 * `drizzle/` at the artifact root, dev runs read `apps/api/drizzle/`.
 */
function readSchemaJournal(): BackupManifestV2["schema"]["journal"] {
  const packaged = resolve(ROOT_DIR, "drizzle/meta/_journal.json");
  const journalPath = existsSync(packaged) ? packaged : resolve(ROOT_DIR, "apps/api/drizzle/meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number; tag: string }[] };
  const last = journal.entries[journal.entries.length - 1];
  return {
    lastIdx: last?.idx ?? -1,
    lastTag: last?.tag ?? "",
    entryCount: journal.entries.length,
  };
}

/** Find the drizzle property name for a column object on its table. */
function propertyNameOf(table: Table, column: AnyColumn): string {
  for (const [prop, col] of Object.entries(getTableColumns(table) as Record<string, AnyColumn>)) {
    if (col === column || col.name === column.name)
      return prop;
  }
  return column.name;
}

/**
 * Describe a table for the manifest via drizzle runtime introspection —
 * no hand-maintained schema copy. Column names are drizzle property names
 * (camelCase), identical to the row keys the NDJSON writer emits.
 */
function describeTable(table: SQLiteTable): { columns: ManifestColumn[]; primaryKey: string[] } {
  const cols = getTableColumns(table) as Record<string, AnyColumn>;
  const config = getTableConfig(table);

  // FK lookup keyed by the local column's DB name.
  const references = new Map<string, string>();
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    for (let i = 0; i < ref.columns.length; i++) {
      const local = ref.columns[i]!;
      const foreign = ref.foreignColumns[i]!;
      references.set(local.name, `${getTableName(ref.foreignTable)}.${propertyNameOf(ref.foreignTable, foreign)}`);
    }
  }

  const columns: ManifestColumn[] = [];
  const primaryKey: string[] = [];
  for (const [prop, col] of Object.entries(cols)) {
    columns.push({
      name: prop,
      type: col.getSQLType(),
      notNull: col.notNull,
      ...(col.hasDefault ? { hasDefault: true } : {}),
      ...(references.has(col.name) ? { references: references.get(col.name)! } : {}),
    });
    if (col.primary)
      primaryKey.push(prop);
  }
  // Composite primary keys are declared at table level, not on the column.
  if (primaryKey.length === 0) {
    for (const pk of config.primaryKeys)
      primaryKey.push(...pk.columns.map(c => propertyNameOf(table, c)));
  }
  return { columns, primaryKey };
}

function throwIfCancelled(isCancelled: () => boolean): void {
  if (isCancelled())
    throw new ExportCancelledError();
}

/**
 * Stream every row of `table` with the v1 exporter's keyset pagination
 * (LIMIT/OFFSET fallback for keyless tables) — same queries, so NDJSON rows
 * are key-for-key identical to what the v1 JSON exporter emits.
 */
async function* streamTableRows(
  db: AppDatabase,
  table: SQLiteTable,
  isCancelled: () => boolean,
): AsyncGenerator<Record<string, unknown>> {
  const columns = getTableColumns(table) as Record<string, AnyColumn>;
  const idColumn: AnyColumn | undefined = columns.id;
  if (idColumn) {
    let cursor: string | undefined;
    while (true) {
      throwIfCancelled(isCancelled);
      const baseQuery = db.select().from(table).$dynamic();
      const filtered = cursor === undefined ? baseQuery : baseQuery.where(gt(idColumn, cursor));
      const rows = await filtered.orderBy(asc(idColumn)).limit(STREAM_BATCH_SIZE).all() as Record<string, unknown>[];
      if (rows.length === 0)
        break;
      yield* rows;
      if (rows.length < STREAM_BATCH_SIZE)
        break;
      cursor = String(rows[rows.length - 1]!.id);
    }
  }
  else {
    let offset = 0;
    while (true) {
      throwIfCancelled(isCancelled);
      const rows = await db.select().from(table).limit(STREAM_BATCH_SIZE).offset(offset).all() as Record<string, unknown>[];
      if (rows.length === 0)
        break;
      yield* rows;
      if (rows.length < STREAM_BATCH_SIZE)
        break;
      offset += STREAM_BATCH_SIZE;
    }
  }
}

/**
 * Bridge a node-style readable (tar-stream's pack) to a web ReadableStream
 * with pull-based backpressure. Bun 1.3's `Readable.toWeb` rejects
 * tar-stream's streamx readable (`QueuingStrategyInit.highWaterMark`
 * member is required); the async-iterator path works on every release.
 */
function nodeReadableToWeb(readable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = readable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await iterator.next();
        if (done)
          controller.close();
        else
          controller.enqueue(value);
      }
      catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** Pack one tar entry from a web stream, honouring tar-stream backpressure. */
function packEntryFromStream(
  pack: Pack,
  header: { name: string; size: number },
  source: ReadableStream<Uint8Array>,
  onBytes?: (n: number) => void,
): Promise<void> {
  return new Promise((resolveEntry, rejectEntry) => {
    const entry = pack.entry(header, err => err ? rejectEntry(err) : resolveEntry());
    void (async () => {
      try {
        for await (const chunk of source) {
          onBytes?.(chunk.byteLength);
          const buf = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
          if (!entry.write(buf))
            await once(entry, "drain");
        }
        entry.end();
      }
      catch (err) {
        entry.destroy(err instanceof Error ? err : new Error(String(err)));
        rejectEntry(err);
      }
    })();
  });
}

interface BlobRef {
  readonly sha256: string;
  readonly storageKey: string;
  readonly size: number;
}

/**
 * Pack one tar.gz artifact: `fill` writes the entries, the stream commits
 * via `<fileName>.partial` → rename so a partial file is never served.
 */
async function packGzippedTar(
  stagingDir: string,
  fileName: string,
  fill: (pack: Pack) => Promise<void>,
): Promise<{ path: string; size: number }> {
  const partialPath = resolve(stagingDir, `${fileName}.partial`);
  const finalPath = resolve(stagingDir, fileName);
  const pack = tarPack();
  const sink = Bun.file(partialPath).writer();
  const consumed = (async () => {
    try {
      // Cast: lib.dom types CompressionStream's writable as
      // WritableStream<BufferSource>, which pipeThrough's Uint8Array
      // generic rejects; the runtime accepts Uint8Array chunks fine.
      const gzip = new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
      const gzipped = nodeReadableToWeb(pack).pipeThrough(gzip);
      for await (const chunk of gzipped)
        sink.write(chunk);
    }
    finally {
      await sink.end();
    }
  })();

  try {
    await fill(pack);
    pack.finalize();
    await consumed;
  }
  catch (err) {
    pack.destroy(err instanceof Error ? err : new Error(String(err)));
    await consumed.catch(() => {});
    throw err;
  }

  renameSync(partialPath, finalPath);
  return { path: finalPath, size: statSync(finalPath).size };
}

export async function writeArchiveV2(opts: WriteArchiveV2Options): Promise<WriteArchiveV2Result> {
  const { db, stagingDir } = opts;
  const blobsMode: BlobsMode = opts.blobsMode ?? (opts.includeBlobs === false ? "none" : "embedded");
  const redacted = opts.redacted === true;
  const isCancelled = opts.isCancelled ?? (() => false);

  const modules = resolveModulesWithDeps(opts.modules);
  const registry = getDataModules();
  const tables = getTablesForModules(modules);

  const tmpDir = resolve(stagingDir, "tmp");
  await mkdir(tmpDir, { recursive: true });

  let tablesDone = 0;
  let blobBytesDone = 0;
  let blobBytesTotal = 0;
  const report = (): void => {
    opts.onProgress?.({ tablesDone, tablesTotal: tables.length, blobBytesDone, blobBytesTotal });
  };
  report();

  // Owning module per table — first module (dependency order) that lists it.
  const tableModule = new Map<string, string>();
  for (const modName of modules) {
    for (const table of registry[modName]?.tables ?? []) {
      const name = getTableName(table);
      if (!tableModule.has(name))
        tableModule.set(name, modName);
    }
  }

  // 1. Stage per-table NDJSON to tmp files (tar headers need sizes up front).
  const manifestTables: ManifestTable[] = [];
  for (const table of tables) {
    throwIfCancelled(isCancelled);
    const tableName = getTableName(table);
    const sink = Bun.file(resolve(tmpDir, `${tableName}.ndjson`)).writer();
    let rowCount = 0;
    try {
      for await (const row of streamTableRows(db, table, isCancelled)) {
        sink.write(`${JSON.stringify(redacted ? redactSecretFields(row) : row)}\n`);
        rowCount++;
      }
    }
    finally {
      await sink.end();
    }
    const { columns, primaryKey } = describeTable(table);
    manifestTables.push({
      name: tableName,
      module: tableModule.get(tableName)!,
      file: `data/${tableName}.ndjson`,
      rowCount,
      primaryKey,
      columns,
    });
    tablesDone++;
    report();
  }

  // 2. Blob selection: DISTINCT sha256 of exported `files` rows. The full
  //    list lands in `manifest.expectedBlobs` in EVERY mode (so import can
  //    report exactly which blobs are expected/missing). Bytes are only
  //    exported in embedded/separate mode and only from the active driver;
  //    quarantined rows (sentinel driver) and rows on inactive drivers are
  //    listed in `warnings` — their bytes cannot be read.
  const warnings: string[] = [];
  const blobs: BlobRef[] = [];
  const expectedBlobs: ExpectedBlob[] = [];
  let activeDriver: ReturnType<typeof getActiveDriver> | undefined;
  if (manifestTables.some(t => t.name === "files")) {
    const rows = await db.all<{ sha256: string; storage_key: string; size: number; storage_driver: string }>(
      sql`SELECT DISTINCT sha256, storage_key, size, storage_driver FROM files`,
    );
    for (const row of rows)
      expectedBlobs.push({ sha256: row.sha256, size: row.size, storageKey: row.storage_key, storageDriver: row.storage_driver });
    if (blobsMode !== "none") {
      try {
        activeDriver = getActiveDriver();
      }
      catch {
        activeDriver = undefined;
      }
      for (const row of rows) {
        if (activeDriver && row.storage_driver === activeDriver.name)
          blobs.push({ sha256: row.sha256, storageKey: row.storage_key, size: row.size });
        else
          warnings.push(`blob not exported (storage driver '${row.storage_driver}' is not the active driver): sha256=${row.sha256}`);
      }
      blobBytesTotal = blobs.reduce((sum, b) => sum + b.size, 0);
      report();
    }
  }

  // 3. Manifest — always the first tar entry, so the importer can validate
  //    format/version/caps before reading any data.
  const manifest: BackupManifestV2 = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    app: { name: opts.appName, version: BUILD_INFO.version, commit: BUILD_INFO.commit },
    schema: { dialect: "sqlite", journal: readSchemaJournal() },
    redacted,
    includeBlobs: blobsMode !== "none",
    blobsMode,
    expectedBlobs,
    modules: modules.map(name => ({ name, deps: [...(registry[name]?.deps ?? [])] })),
    tables: manifestTables,
    blobs: { count: blobs.length, totalBytes: blobBytesTotal },
    warnings,
  };

  // 4. Pack the artifact(s): the data archive always carries manifest +
  //    tables (+ blobs when embedded); separate mode adds a second
  //    blobs-only artifact. Each commits via `.partial` → rename.
  const packBlobEntries = async (pack: Pack): Promise<void> => {
    if (!activeDriver)
      return;
    for (const blob of blobs) {
      throwIfCancelled(isCancelled);
      const source = await activeDriver.getStream(blob.storageKey);
      await packEntryFromStream(
        pack,
        { name: `blobs/${deriveStorageKey(blob.sha256)}`, size: blob.size },
        source,
        (n) => {
          blobBytesDone += n;
          report();
        },
      );
    }
  };

  const data = await packGzippedTar(stagingDir, "archive.tar.gz", async (pack) => {
    pack.entry({ name: "manifest.json" }, JSON.stringify(manifest, null, 2));
    for (const t of manifestTables) {
      throwIfCancelled(isCancelled);
      const staged = resolve(tmpDir, `${t.name}.ndjson`);
      await packEntryFromStream(pack, { name: t.file, size: statSync(staged).size }, Bun.file(staged).stream());
    }
    if (blobsMode === "embedded")
      await packBlobEntries(pack);
  });

  let blobsArtifact: { path: string; size: number } | undefined;
  if (blobsMode === "separate")
    blobsArtifact = await packGzippedTar(stagingDir, "blobs.tar.gz", packBlobEntries);

  rmSync(tmpDir, { recursive: true, force: true });
  return {
    manifest,
    archivePath: data.path,
    archiveSize: data.size,
    ...(blobsArtifact ? { blobsArchivePath: blobsArtifact.path, blobsArchiveSize: blobsArtifact.size } : {}),
  };
}
