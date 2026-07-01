import type { FileStorageDriver, StoredObject } from "./storage/types";
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
 * never raced. No-op unless the active driver implements `listPage` or `list`.
 *
 * Listing is paginated: a single S3 `ListObjectsV2` page caps at ~1000 keys, so
 * the sweep walks every page via the continuation token (`listPage`). Each page
 * is cross-checked against `files` independently, so a registered blob is never
 * deleted regardless of which page it lands on, and only one page of keys is
 * ever held in memory / passed to a single `IN (…)` query.
 */
export async function runS3OrphanSweepOnce(
  db: AppDatabase,
  opts: { readonly ttlHours?: number | undefined; readonly nowMs: number },
  logger?: Logger,
): Promise<number> {
  const driver = getActiveDriver();
  if (!driver.listPage && !driver.list)
    return 0;

  const cutoff = opts.nowMs - (opts.ttlHours ?? DEFAULT_TTL_HOURS) * HOUR_MS;
  let deleted = 0;
  let token: string | undefined;

  do {
    // One bounded page per iteration keeps memory flat regardless of bucket
    // size. Drivers that only implement the single-page `list` yield exactly
    // one page (no continuation token).
    const page = driver.listPage
      ? await driver.listPage("", token)
      : { objects: await driver.list!(""), nextToken: undefined };

    if (page.objects.length > 0)
      deleted += await sweepPage(db, driver, page.objects, cutoff, logger);

    token = page.nextToken;
  } while (token);

  return deleted;
}

/**
 * Sweep one page of listed objects: delete those with no matching `files` row
 * that are older than the TTL. The registered-key lookup is scoped to this
 * page's keys — correct because deletion decisions are made only for this
 * page's objects, and bounded because the `IN (…)` never grows past one page.
 */
async function sweepPage(
  db: AppDatabase,
  driver: FileStorageDriver,
  objects: readonly StoredObject[],
  cutoff: number,
  logger?: Logger,
): Promise<number> {
  const registered = new Set(
    (await db
      .select({ storageKey: files.storageKey })
      .from(files)
      .where(and(eq(files.storageDriver, driver.name), inArray(files.storageKey, objects.map(o => o.key))))
      .all())
      .map(r => r.storageKey),
  );

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
