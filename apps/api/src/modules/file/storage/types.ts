import type { Config } from "@/config";

/**
 * Storage backend abstraction. Drivers implement this interface and call
 * `registerDriver(...)` at module-load time; consumers reach the active
 * driver through {@link getActiveDriver}, which resolves the driver by
 * name from `Config.FILE_STORAGE_DRIVER`.
 *
 * The interface is deliberately pure-TypeScript (no Bun-specific types) so
 * a downstream project can drop in S3 / Azure Blob / GCS by shipping their
 * own implementation, no fork of `mod-file` required.
 */
export interface FileStorageDriver {
  /** Unique driver name, e.g. `'local'`, `'s3'`. Used as the env-selector value. */
  readonly name: string;

  /**
   * Optional one-time setup hook called when this driver is selected
   * via `FILE_STORAGE_DRIVER`. Use to resolve config-derived state
   * (root paths, bucket names, credentials) without fanning that
   * branching out into `initFileModule`. Drivers that need no setup
   * (or self-initialise lazily on first call) omit the method.
   */
  setup?: (config: Config) => void | Promise<void>;

  /**
   * Persist `data` at `key`. `key` is driver-internal — for the local
   * driver it is a relative path under `FILE_STORAGE_LOCAL_ROOT`; for S3
   * it would be the object key under the configured bucket. Implementations
   * must be idempotent: writing the same `(key, data)` twice succeeds and
   * leaves a single object behind.
   *
   * `opts.contentType` lets a driver that serves bytes directly (e.g. S3 via
   * a presigned GET) store the blob's MIME type so the download response
   * carries it. Drivers that don't need it (the local filesystem) ignore it.
   */
  put: (key: string, data: ArrayBufferLike, opts?: { readonly contentType?: string }) => Promise<void>;

  /** Return the stored bytes as a `ReadableStream` (preferred for downloads). */
  getStream: (key: string) => Promise<ReadableStream<Uint8Array>>;

  /** Remove the object. Implementations must succeed on a missing key (no-op). */
  delete: (key: string) => Promise<void>;

  /** Return true iff the object exists. Used by the sweeper to surface orphan keys. */
  exists: (key: string) => Promise<boolean>;

  /**
   * Optional capability: return a short-lived signed URL the client can use
   * to download the object directly from the backend. Drivers that cannot
   * implement this (e.g. the local-filesystem driver) omit the method;
   * the file routes detect the absence and fall back to streaming through
   * the API process.
   */
  presignDownload?: (key: string, opts: PresignOptions) => Promise<string>;

  /**
   * Optional capability (FEAT-044, Part B): return a short-lived signed URL the
   * client uses to upload the object DIRECTLY to the backend (presigned PUT),
   * bypassing the API. `headers` must be sent verbatim on the PUT (at least the
   * Content-Type the URL was signed for). Drivers without it (local) force
   * uploads to stream through the API.
   */
  presignUpload?: (key: string, opts: PresignUploadOptions) => Promise<PresignedUpload>;

  /**
   * Optional capability: HEAD an object — used by the direct-upload confirm
   * step to read the authoritative size and prove the object landed. Returns
   * `null` when the object is absent.
   */
  stat?: (key: string) => Promise<{ readonly size: number } | null>;

  /**
   * Optional capability: list stored objects under `prefix` (one bounded page)
   * — used by the S3 orphan/oversize sweep to find objects with no `files` row.
   * This single-page form is the fallback for drivers whose listing never spans
   * more than one page; backends that paginate implement
   * {@link FileStorageDriver.listPage} so the sweep can walk every page.
   */
  list?: (prefix: string) => Promise<readonly StoredObject[]>;

  /**
   * Optional capability: list ONE bounded page of stored objects under `prefix`,
   * resuming after `continuationToken`. The returned {@link StoredObjectPage}
   * carries `nextToken` iff more pages remain; the S3 orphan sweep loops on it so
   * every object is considered on buckets larger than a single ListObjectsV2 page
   * (~1000 keys). Drivers that expose only {@link FileStorageDriver.list} are
   * still swept via that single-page fallback.
   */
  listPage?: (prefix: string, continuationToken?: string) => Promise<StoredObjectPage>;
}

export interface PresignUploadOptions {
  readonly expiresSeconds: number;
  /** Content-Type the URL is signed for; the client must send it on the PUT. */
  readonly contentType: string;
}

export interface PresignedUpload {
  readonly url: string;
  readonly method: "PUT";
  readonly headers: Record<string, string>;
}

export interface StoredObject {
  readonly key: string;
  readonly size: number;
  /** Last-modified epoch milliseconds, for TTL-gating sweeps. */
  readonly lastModified: number;
}

/**
 * One bounded page of a paginated object listing (see
 * {@link FileStorageDriver.listPage}).
 */
export interface StoredObjectPage {
  readonly objects: readonly StoredObject[];
  /**
   * Opaque continuation token for the next page. Absent once the listing is
   * exhausted; pass it back into `listPage` to fetch the following page.
   */
  readonly nextToken?: string;
}

export interface PresignOptions {
  readonly expiresSeconds: number;
  /** Display filename to encode in `Content-Disposition`. */
  readonly filename: string;
  /** When true, request `inline`; otherwise `attachment`. */
  readonly inline: boolean;
  /** Effective Content-Type to set on the signed response. */
  readonly contentType: string;
}
