/**
 * Storage key layout (REFACTOR-038): `<YYYYMMDDHH>/<ulid>` — the UTC upload
 * hour plus the blob's `files.id` ULID, e.g. `2026070609/01JZC9ZJ8W...`.
 * Hour-bucketed and human-manageable in a bucket browser, unique per blob.
 *
 * A key is minted ONCE when the blob is first stored and persisted in
 * `files.storage_key`; every later read/delete/restore resolves the stored
 * key — nothing re-derives a key from content anymore. Dedup is unaffected:
 * `UNIQUE(sha256, storage_driver)` still maps duplicate content onto the
 * existing row (and therefore its existing key/object).
 */
export function newStorageKey(id: string, nowMs: number): string {
  const d = new Date(nowMs);
  const pad = (n: number): string => String(n).padStart(2, "0");
  const hour = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
  return `${hour}/${id}`;
}

/**
 * The retired content-addressed layout (`ab/cd/<sha256>`). Kept ONLY for
 * legacy interop: blobs stored before REFACTOR-038 live under these keys
 * (until CHORE-004 migrates them), and pre-FIX-062 backup archives identify
 * embedded blobs by this shape. Do not use for new writes.
 */
export function legacyContentAddressedKey(sha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`Invalid sha256 for storage key: ${sha256}`);
  }
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}`;
}
