/**
 * Backup v2 ARCHIVE WRITER (PLAN-075 R1, R7; FIX-062 blob retirement).
 *
 * Produces a staged `.tar.gz` whose layout is:
 *
 *     manifest.json                  # ALWAYS the first tar entry
 *     data/<table>.ndjson            # one file per table, dependency order
 *
 * Blob bytes are NEVER packed (FIX-062): backups are DB data only, marked
 * `blobsMode: "external"` in the manifest. File bytes are the operator's
 * responsibility — copy the storage tree (local) or the bucket (S3); restore
 * correctness comes from DB-row ↔ storage-path correspondence (keys are
 * content-addressed `ab/cd/<sha256>`). The manifest still lists EVERY
 * referenced blob in `expectedBlobs` so the import side can report exactly
 * which blobs are present/missing. The import path keeps reading legacy
 * blob-bearing archives (`embedded` / `separate`) unchanged.
 *
 * Table NDJSON is staged to `<stagingDir>/tmp/` first because the tar header
 * needs each entry's size up front. Gzip uses Bun's built-in
 * `CompressionStream("gzip")`; tar packing uses `tar-stream`. The artifact
 * is written to `<name>.partial` and renamed on success, so a `.partial`
 * file is never downloadable.
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
import { ROOT_DIR } from "@/root";
import { getDataModules, getTablesForModules, resolveModulesWithDeps } from "./registry";
import { redactSecretFields } from "./secret-fields";

export const BACKUP_FORMAT = "bithk-backup";
export const BACKUP_FORMAT_VERSION = 2;

const STREAM_BATCH_SIZE = 1000;
/** Tables carrying a blob-typed column batch smaller to bound row-buffer memory. */
const BLOB_STREAM_BATCH_SIZE = 50;

/** Thrown when the caller's abort flag flips mid-export. */
export class ExportCancelledError extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ExportCancelledError";
  }
}

/**
 * Blob placement marker. This exporter ALWAYS writes `external` (FIX-062:
 * backups are DB data only; file bytes live in the operator-copied storage
 * tree / bucket). The legacy R7 values (`embedded` / `separate` / `none`)
 * remain in the type because the import side still reads archives that
 * carry them.
 */
export type BlobsMode = "embedded" | "separate" | "none" | "external";

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
  /** Deprecated alias of `blobsMode !== "none"` — always `false` since FIX-062 (no bytes packed). */
  readonly includeBlobs: boolean;
  /**
   * ALWAYS `external` since FIX-062 — blob bytes live in the operator's
   * storage tree/bucket copy, never in the archive. Legacy archives carry
   * the R7 values; pre-R7 archives lack the field, so the import parser
   * derives it from the `includeBlobs` alias (`true → embedded`,
   * `false → none`).
   */
  readonly blobsMode: BlobsMode;
  /**
   * EVERY blob referenced by exported `files` rows, on any driver (R7).
   * Optional only because legacy pre-R7 archives lack the list —
   * `undefined` means "unknown expected set" on import (the blob stage
   * falls back to reconcile for missing-blob detection).
   */
  readonly expectedBlobs?: readonly ExpectedBlob[];
  readonly modules: readonly { readonly name: string; readonly deps: readonly string[] }[];
  readonly tables: readonly ManifestTable[];
  /** Blobs whose bytes the archive packs — always zero since FIX-062. */
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
  /** Job staging directory; `tmp/` and the artifact land inside it. */
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
 * The single-column primary key of `table`, or `undefined` for composite /
 * keyless tables. Column-level `.primaryKey()` and a one-column table-level
 * `primaryKey()` both qualify — either gives a total order for keyset
 * pagination.
 */
function singleColumnPrimaryKey(table: SQLiteTable): AnyColumn | undefined {
  const columnLevel = Object.values(getTableColumns(table) as Record<string, AnyColumn>).filter(c => c.primary);
  if (columnLevel.length === 1)
    return columnLevel[0];
  if (columnLevel.length > 1)
    return undefined;
  const composite = getTableConfig(table).primaryKeys;
  if (composite.length === 1 && composite[0]!.columns.length === 1)
    return composite[0]!.columns[0] as AnyColumn;
  return undefined;
}

/** Batch size for row streaming — small when a blob column can inflate rows. */
export function streamBatchSizeFor(table: SQLiteTable): number {
  const hasBlob = Object.values(getTableColumns(table) as Record<string, AnyColumn>)
    .some(col => col.getSQLType() === "blob");
  return hasBlob ? BLOB_STREAM_BATCH_SIZE : STREAM_BATCH_SIZE;
}

/**
 * Stream every row of `table` with the v1 exporter's pagination strategy,
 * generalised: keyset over ANY single-column primary key (`id`, a text
 * `key`, …), LIMIT/OFFSET fallback for composite-key / keyless tables.
 * Blob-carrying tables use a smaller batch to bound memory.
 */
export async function* streamTableRows(
  db: AppDatabase,
  table: SQLiteTable,
  isCancelled: () => boolean,
): AsyncGenerator<Record<string, unknown>> {
  const batchSize = streamBatchSizeFor(table);
  const keyColumn = singleColumnPrimaryKey(table);
  if (keyColumn) {
    const keyProp = propertyNameOf(table, keyColumn);
    let cursor: unknown;
    while (true) {
      throwIfCancelled(isCancelled);
      const baseQuery = db.select().from(table).$dynamic();
      const filtered = cursor === undefined ? baseQuery : baseQuery.where(gt(keyColumn, cursor));
      const rows = await filtered.orderBy(asc(keyColumn)).limit(batchSize).all() as Record<string, unknown>[];
      if (rows.length === 0)
        break;
      yield* rows;
      if (rows.length < batchSize)
        break;
      cursor = rows[rows.length - 1]![keyProp];
    }
  }
  else {
    let offset = 0;
    while (true) {
      throwIfCancelled(isCancelled);
      const rows = await db.select().from(table).limit(batchSize).offset(offset).all() as Record<string, unknown>[];
      if (rows.length === 0)
        break;
      yield* rows;
      if (rows.length < batchSize)
        break;
      offset += batchSize;
    }
  }
}

/**
 * NDJSON value codec: blob-typed values arrive from the driver as
 * `Uint8Array`/`Buffer`, which `JSON.stringify` would mangle into the
 * `{type:"Buffer",data:[...]}` shape bun:sqlite refuses to bind on import.
 * Serialise them as base64 strings instead; the import side decodes any
 * string hitting a blob-typed live column. Copies the row only when needed.
 */
function encodeRowForNdjson(row: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Uint8Array) {
      out ??= { ...row };
      out[key] = Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
    }
  }
  return out ?? row;
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
  const redacted = opts.redacted === true;
  const isCancelled = opts.isCancelled ?? (() => false);

  const modules = resolveModulesWithDeps(opts.modules);
  const registry = getDataModules();
  const tables = getTablesForModules(modules);

  const tmpDir = resolve(stagingDir, "tmp");
  await mkdir(tmpDir, { recursive: true });

  let tablesDone = 0;
  // Blob byte counters stay in the progress shape for API compatibility but
  // are always zero — no blob bytes are packed since FIX-062.
  const report = (): void => {
    opts.onProgress?.({ tablesDone, tablesTotal: tables.length, blobBytesDone: 0, blobBytesTotal: 0 });
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
        const encoded = encodeRowForNdjson(row);
        sink.write(`${JSON.stringify(redacted ? redactSecretFields(encoded) : encoded)}\n`);
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

  // 2. Blob listing: DISTINCT sha256 of exported `files` rows. The full
  //    list lands in `manifest.expectedBlobs` so the import side can report
  //    exactly which blobs are present/missing on its storage backend. No
  //    bytes are read or packed (FIX-062) — the operator copies the storage
  //    tree/bucket; content-addressed keys keep the paths corresponding.
  const warnings: string[] = [];
  const expectedBlobs: ExpectedBlob[] = [];
  if (manifestTables.some(t => t.name === "files")) {
    const rows = await db.all<{ sha256: string; storage_key: string; size: number; storage_driver: string }>(
      sql`SELECT DISTINCT sha256, storage_key, size, storage_driver FROM files`,
    );
    for (const row of rows)
      expectedBlobs.push({ sha256: row.sha256, size: row.size, storageKey: row.storage_key, storageDriver: row.storage_driver });
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
    includeBlobs: false,
    blobsMode: "external",
    expectedBlobs,
    modules: modules.map(name => ({ name, deps: [...(registry[name]?.deps ?? [])] })),
    tables: manifestTables,
    blobs: { count: 0, totalBytes: 0 },
    warnings,
  };

  // 4. Pack the artifact: manifest + tables, committed via `.partial` →
  //    rename.
  const data = await packGzippedTar(stagingDir, "archive.tar.gz", async (pack) => {
    pack.entry({ name: "manifest.json" }, JSON.stringify(manifest, null, 2));
    for (const t of manifestTables) {
      throwIfCancelled(isCancelled);
      const staged = resolve(tmpDir, `${t.name}.ndjson`);
      await packEntryFromStream(pack, { name: t.file, size: statSync(staged).size }, Bun.file(staged).stream());
    }
  });

  rmSync(tmpDir, { recursive: true, force: true });
  return {
    manifest,
    archivePath: data.path,
    archiveSize: data.size,
  };
}
