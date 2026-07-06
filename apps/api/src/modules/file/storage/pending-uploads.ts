import { ulid } from "@/shared/lib/id";
import { newStorageKey } from "./key";

/**
 * In-process registry bridging the two phases of a presigned direct upload
 * (REFACTOR-038). Keys are no longer derivable from content, so `presign`
 * mints `{id, key}` here and `confirm` reads it back to stat/register the
 * object. Entries are keyed by sha256 so concurrent uploads of identical
 * content share one object, and are NOT consumed on confirm (a second
 * confirm of the same content must still resolve the key) — they simply
 * expire.
 *
 * Deliberately in-memory: the presign TTL is minutes and this is a
 * single-process server. An API restart drops in-flight sessions; the
 * client's confirm then fails with 400 and the user re-uploads. Abandoned
 * objects are reclaimed by the S3 orphan sweep.
 */
export interface PendingUpload {
  /** Becomes `files.id` when the upload is confirmed. */
  readonly id: string;
  /** The storage key the presigned PUT targets — becomes `files.storage_key`. */
  readonly key: string;
  readonly expiresAt: number;
}

/** Generous vs the presign URL TTL: the PUT itself may run long after the
 * URL was signed, and confirm arrives only once the bytes are up. Matches
 * the orphan sweep's default grace window. */
const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;

const pending = new Map<string, PendingUpload>();

function sweep(nowMs: number): void {
  for (const [sha, entry] of pending) {
    if (entry.expiresAt <= nowMs)
      pending.delete(sha);
  }
}

/** Reuse the live entry for this content or mint a fresh `{id, key}`. */
export function trackPendingUpload(sha256: string, nowMs: number): PendingUpload {
  sweep(nowMs);
  const existing = pending.get(sha256);
  if (existing)
    return existing;
  const id = ulid();
  const entry: PendingUpload = { id, key: newStorageKey(id, nowMs), expiresAt: nowMs + PENDING_UPLOAD_TTL_MS };
  pending.set(sha256, entry);
  return entry;
}

/** The live entry for this content, or null when absent/expired. */
export function getPendingUpload(sha256: string, nowMs: number): PendingUpload | null {
  const entry = pending.get(sha256);
  if (!entry)
    return null;
  if (entry.expiresAt <= nowMs) {
    pending.delete(sha256);
    return null;
  }
  return entry;
}

/** Test-only: reset the registry between cases. */
export function __clearPendingUploadsForTests(): void {
  pending.clear();
}
