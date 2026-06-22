import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { and, eq, inArray } from "drizzle-orm";
import { files } from "./schema";
import { getActiveDriver } from "./storage/registry";

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_TTL_HOURS = 24;

/**
 * S3 orphan sweep (FEAT-044, Part B). Lists objects in the active object-store
 * backend and deletes those with no `files` row — a presigned direct upload
 * that was never confirmed (e.g. the client aborted, or `confirm` rejected an
 * oversized object with 413 and left the bytes behind). DB-driven sweeps cannot
 * see these because the object exists only in storage, not in the database.
 *
 * Objects newer than the grace TTL are skipped so a confirm still in flight is
 * never raced. No-op unless the active driver implements `list`.
 */
export async function runS3OrphanSweepOnce(
  db: AppDatabase,
  opts: { readonly ttlHours?: number | undefined; readonly nowMs: number },
  logger?: Logger,
): Promise<number> {
  const driver = getActiveDriver();
  if (!driver.list)
    return 0;

  const objects = await driver.list("");
  if (objects.length === 0)
    return 0;

  const keys = objects.map(o => o.key);
  const registered = new Set(
    (await db
      .select({ storageKey: files.storageKey })
      .from(files)
      .where(and(eq(files.storageDriver, driver.name), inArray(files.storageKey, keys)))
      .all())
      .map(r => r.storageKey),
  );

  const cutoff = opts.nowMs - (opts.ttlHours ?? DEFAULT_TTL_HOURS) * HOUR_MS;
  let deleted = 0;
  for (const o of objects) {
    if (registered.has(o.key))
      continue;
    // Skip objects of unknown age or younger than the TTL — a confirm may still
    // be in flight.
    if (o.lastModified <= 0 || o.lastModified >= cutoff)
      continue;
    await driver.delete(o.key);
    deleted++;
    logger?.info({ key: o.key, size: o.size }, "s3 orphan object swept");
  }
  return deleted;
}
