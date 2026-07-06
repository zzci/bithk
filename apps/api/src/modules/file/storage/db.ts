import type { FileStorageDriver } from "./types";
import type { AppDatabase } from "@/db";
import { Buffer } from "node:buffer";
import { eq, sql } from "drizzle-orm";
import { fileBlobs } from "@/modules/file/schema";
import { registerDriver } from "./registry";

// The db driver needs the app database handle. Injected at boot via
// `setDbDriverDatabase` — mirroring the local driver's root setter — because
// the driver self-registers at module load (before any db exists) and a DEK
// rotation / test setup can swap the handle later.
let db: AppDatabase | undefined;

function requireDb(): AppDatabase {
  if (!db) {
    throw new Error("DB storage driver not initialised. Ensure applyStorageConfig(db) ran at boot (or setDbDriverDatabase(db) in tests).");
  }
  return db;
}

function toBuffer(data: ArrayBufferLike): Buffer {
  return Buffer.from(data as ArrayBuffer);
}

/**
 * Database-backed storage driver (FEAT-047). Persists blob bytes in the
 * `file_blob` table rather than on disk / an object store, so in-app created
 * files (text / markdown / spreadsheet) and their versions never leave the DB.
 * Always server-served: it implements no presign — downloads stream through the
 * API. Hour-bucketed keys (`YYYYMMDDHH/<ulid>`) are shared with the other
 * drivers, so a file's `storage_driver='db'` selects this backend.
 */
export const dbDriver: FileStorageDriver = {
  name: "db",

  async put(key, data) {
    const content = toBuffer(data);
    requireDb()
      .insert(fileBlobs)
      .values({ storageKey: key, content })
      .onConflictDoUpdate({ target: fileBlobs.storageKey, set: { content } })
      .run();
  },

  async getStream(key) {
    const row = requireDb()
      .select({ content: fileBlobs.content })
      .from(fileBlobs)
      .where(eq(fileBlobs.storageKey, key))
      .get();
    if (!row) {
      throw new Error(`Missing blob at ${key}`);
    }
    const bytes = new Uint8Array(row.content);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  },

  async delete(key) {
    requireDb().delete(fileBlobs).where(eq(fileBlobs.storageKey, key)).run();
  },

  async exists(key) {
    const row = requireDb()
      .select({ one: sql<number>`1` })
      .from(fileBlobs)
      .where(eq(fileBlobs.storageKey, key))
      .get();
    return row !== undefined && row !== null;
  },

  async stat(key) {
    const row = requireDb()
      .select({ content: fileBlobs.content })
      .from(fileBlobs)
      .where(eq(fileBlobs.storageKey, key))
      .get();
    return row ? { size: row.content.length } : null;
  },
};

/**
 * Bind the app database the db storage driver reads/writes. Called from
 * `applyStorageConfig` at boot (and from test setup, mirroring
 * `__setLocalDriverRootForTests`). Re-registers the driver so it is present
 * even after `__resetDriverRegistryForTests` cleared the registry.
 */
export function setDbDriverDatabase(database: AppDatabase): void {
  db = database;
  registerDriver(dbDriver);
}

// Self-register at module load — importing this file is enough to make the
// driver selectable. `applyStorageConfig` / `setDbDriverDatabase` inject the
// db handle (and re-register after a test registry reset).
registerDriver(dbDriver);
