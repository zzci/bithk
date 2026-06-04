import type { DriveEntryRow } from "./drive.service";
import type { AppDatabase } from "@/db";
import { eq } from "drizzle-orm";
import { AppError } from "@/shared/lib/errors";
import { driveEntries } from "./schema";

/** How long an edit lock survives without a heartbeat before it is seizable. */
export const EDIT_LOCK_TTL_MS = 90_000;

/** Thrown when a fresh lock held by another edit session blocks acquisition. */
export class EditLockConflictError extends AppError {
  constructor(public readonly lockBy: string | null) {
    super("Drive entry is locked for editing", 409, "DRIVE_EDIT_LOCKED");
  }
}

async function requireEntry(db: AppDatabase, entryId: string): Promise<DriveEntryRow> {
  const row = await db.select().from(driveEntries).where(eq(driveEntries.id, entryId)).get();
  if (!row)
    throw new AppError("Drive entry not found", 404, "NOT_FOUND");
  return row;
}

/** A lock is expired (and thus seizable) once its last heartbeat is older than the TTL. */
export function isLockExpired(editLockAt: number | null, now: number): boolean {
  return editLockAt == null || now - editLockAt > EDIT_LOCK_TTL_MS;
}

export interface AcquireEditLockResult {
  readonly editId: string;
  readonly lockBy: string;
  readonly lockAt: number;
  /** True when we seized an expired lock previously held by a different session. */
  readonly takenOver: boolean;
}

/**
 * Claim the exclusive edit lock for `editId`. Succeeds when the entry is
 * unlocked, when its lock has expired, or when `editId` already holds it.
 * Throws {@link EditLockConflictError} when another session holds a fresh lock.
 */
export async function acquireEditLock(
  db: AppDatabase,
  entryId: string,
  editId: string,
  userId: string,
  now = Date.now(),
): Promise<AcquireEditLockResult> {
  const entry = await requireEntry(db, entryId);
  if (entry.editLockId != null && entry.editLockId !== editId && !isLockExpired(entry.editLockAt, now))
    throw new EditLockConflictError(entry.editLockBy);

  const takenOver = entry.editLockId != null && entry.editLockId !== editId;
  await db.update(driveEntries)
    .set({ editLockId: editId, editLockBy: userId, editLockAt: now })
    .where(eq(driveEntries.id, entryId))
    .run();

  return { editId, lockBy: userId, lockAt: now, takenOver };
}

export interface HeartbeatEditLockResult {
  readonly editId: string;
  readonly lockAt: number;
}

/** Renew the lock's heartbeat. Throws 409 when `editId` no longer holds a fresh lock. */
export async function heartbeatEditLock(
  db: AppDatabase,
  entryId: string,
  editId: string,
  now = Date.now(),
): Promise<HeartbeatEditLockResult> {
  const entry = await requireEntry(db, entryId);
  if (entry.editLockId !== editId || isLockExpired(entry.editLockAt, now))
    throw new AppError("Edit lock is no longer held", 409, "DRIVE_EDIT_LOCK_STALE");

  await db.update(driveEntries)
    .set({ editLockAt: now })
    .where(eq(driveEntries.id, entryId))
    .run();

  return { editId, lockAt: now };
}

export interface ReleaseEditLockResult {
  readonly released: boolean;
}

/** Release the lock if `editId` holds it. Idempotent: a non-holder is a no-op, never an error. */
export async function releaseEditLock(
  db: AppDatabase,
  entryId: string,
  editId: string,
): Promise<ReleaseEditLockResult> {
  const entry = await requireEntry(db, entryId);
  if (entry.editLockId !== editId)
    return { released: false };

  await db.update(driveEntries)
    .set({ editLockId: null, editLockBy: null, editLockAt: null })
    .where(eq(driveEntries.id, entryId))
    .run();

  return { released: true };
}

export interface UpdateEntryLiveContentResult {
  readonly id: string;
  readonly updatedAt: string;
}

/**
 * Autosave the live, mutable content body. Requires a fresh lock held by
 * `editId`; renews the heartbeat as a side effect. Never creates a version or
 * blob — the immutable file pipeline is untouched.
 */
export async function updateEntryLiveContent(
  db: AppDatabase,
  entryId: string,
  editId: string,
  content: string,
  now = Date.now(),
): Promise<UpdateEntryLiveContentResult> {
  const entry = await requireEntry(db, entryId);
  if (entry.editLockId !== editId || isLockExpired(entry.editLockAt, now))
    throw new AppError("Edit lock is no longer held", 409, "DRIVE_EDIT_LOCK_STALE");

  const updatedAt = new Date().toISOString();
  await db.update(driveEntries)
    .set({ currentContentBody: content, updatedAt, editLockAt: now })
    .where(eq(driveEntries.id, entryId))
    .run();

  return { id: entryId, updatedAt };
}
