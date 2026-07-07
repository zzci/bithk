import type { S3Client as S3ClientType } from "bun";
import type { FileStorageDriver } from "./types";
import { S3Client } from "bun";
import { buildContentDisposition } from "@/shared/lib/content-disposition";
import { registerDriver } from "./registry";

let client: S3ClientType | undefined;
let keyPrefix = "";
let publicOrigin: string | null = null;

/** Apply the configured prefix (a folder within the bucket) to a storage key. */
export function s3ObjectKey(key: string): string {
  return keyPrefix ? `${keyPrefix}/${key}` : key;
}

/**
 * Origin presigned URLs point the BROWSER at (e.g. `https://<account>.r2.cloudflarestorage.com`),
 * or null while S3 is unconfigured. The CSP middleware adds it to
 * connect/img/media/frame sources so direct-upload PUTs and presigned-GET
 * previews are not blocked (FIX-065). Derived by probing a presign at
 * configure time — exact for every addressing style (path/virtual-host/R2)
 * and refreshed on every admin storage-config change.
 */
export function s3PublicOrigin(): string | null {
  return publicOrigin;
}

export interface S3DriverParams {
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region?: string | undefined;
  readonly endpoint?: string | undefined;
  readonly prefix?: string | undefined;
}

/**
 * (Re)build the S3 client from explicit params (FEAT-047: storage config now
 * lives in the DB, not env). Called by `applyStorageConfig` at boot and after
 * an admin config change so a new bucket/credentials take effect without a
 * restart. Fails fast when the required values are missing, mirroring the
 * former env `setup`.
 */
export function configureS3Driver(params: S3DriverParams): void {
  if (!params.bucket || !params.accessKeyId || !params.secretAccessKey) {
    const missing = ([
      ["bucket", params.bucket],
      ["accessKeyId", params.accessKeyId],
      ["secret", params.secretAccessKey],
    ] as const).filter(([, v]) => !v).map(([k]) => k);
    throw new Error(`S3 storage requires ${missing.join(", ")}.`);
  }
  client = new S3Client({
    bucket: params.bucket,
    accessKeyId: params.accessKeyId,
    secretAccessKey: params.secretAccessKey,
    // R2 convention; AWS callers set a real region.
    region: params.region ?? "auto",
    ...params.endpoint ? { endpoint: params.endpoint } : {},
  });
  keyPrefix = (params.prefix ?? "").replace(/^\/+|\/+$/g, "");
  try {
    publicOrigin = new URL(client.presign("csp-origin-probe", { method: "GET", expiresIn: 60 })).origin;
  }
  catch {
    publicOrigin = null;
  }
}

/** True once {@link configureS3Driver} has built the client. */
export function isS3Configured(): boolean {
  return client !== undefined;
}

function requireClient(): S3ClientType {
  if (!client) {
    throw new Error("S3 driver not initialised. Configure S3 storage in the admin Storage module (settings), then applyStorageConfig(db) builds the client.");
  }
  return client;
}

/**
 * S3-compatible storage driver (default target: Cloudflare R2). Backed by
 * Bun's native S3 client — no AWS SDK. Its client is built by
 * {@link configureS3Driver} from the DB storage settings (FEAT-047), not env.
 * Hour-bucketed keys (`YYYYMMDDHH/<ulid>`) are shared with the local driver,
 * optionally under the configured prefix.
 *
 * Downloads use `presignDownload` (a signed GET); the object is stored with its
 * MIME type via `put(..., { contentType })` so the presigned response carries
 * the right `Content-Type` for inline preview. Bun's presign cannot sign a
 * `Content-Disposition`, so attachment downloads stream through the API instead
 * (handled in `buildDownloadResponse`).
 */
export const s3Driver: FileStorageDriver = {
  name: "s3",

  async put(key, data, opts) {
    await requireClient().write(
      s3ObjectKey(key),
      data,
      opts?.contentType ? { type: opts.contentType } : undefined,
    );
  },

  async getStream(key) {
    return requireClient().file(s3ObjectKey(key)).stream();
  },

  async delete(key) {
    // S3 delete of a missing key is a success, matching the tolerant contract.
    await requireClient().delete(s3ObjectKey(key));
  },

  async exists(key) {
    return requireClient().exists(s3ObjectKey(key));
  },

  async presignDownload(key, opts) {
    // Signed GET (FEAT-052). Bun 1.3.14 signs `response-content-disposition`
    // and `response-content-type` into the URL, so attachment downloads — not
    // just inline previews — can stream straight from S3 with the right
    // filename and a download-forcing disposition. `attachment` +
    // octet-stream (set by the caller for non-inline-safe types) keeps a
    // hostile SVG/HTML from ever rendering inline.
    return requireClient().presign(s3ObjectKey(key), {
      method: "GET",
      expiresIn: opts.expiresSeconds,
      type: opts.contentType,
      contentDisposition: buildContentDisposition(opts.inline ? "inline" : "attachment", opts.filename),
    });
  },

  async presignUpload(key, opts) {
    // Signed PUT. `type` binds the Content-Type into the signature, so the
    // client MUST send the same Content-Type header on the PUT.
    const url = requireClient().presign(s3ObjectKey(key), {
      method: "PUT",
      expiresIn: opts.expiresSeconds,
      type: opts.contentType,
    });
    return { url, method: "PUT", headers: { "Content-Type": opts.contentType } };
  },

  async stat(key) {
    try {
      const meta = await requireClient().stat(s3ObjectKey(key));
      return { size: meta.size };
    }
    catch {
      // Absent object (or any HEAD failure) — treat as "not there".
      return null;
    }
  },

  async listPage(prefix, continuationToken) {
    // One ListObjectsV2 page (S3 caps a page at ~1000 keys). The sweep resumes
    // from `nextToken` until the listing is exhausted, so buckets larger than a
    // single page are fully considered.
    const res = await requireClient().list({
      prefix: s3ObjectKey(prefix),
      maxKeys: 1000,
      ...continuationToken ? { continuationToken } : {},
    });
    // Strip FILE_S3_PREFIX so callers get the driver-internal key,
    // the same form stored in `files.storage_key`.
    const strip = keyPrefix ? `${keyPrefix}/` : "";
    const objects = (res.contents ?? []).map(o => ({
      key: strip && o.key.startsWith(strip) ? o.key.slice(strip.length) : o.key,
      size: o.size ?? 0,
      lastModified: o.lastModified ? Date.parse(o.lastModified) : 0,
    }));
    // Advance only while S3 signals more pages; ignore any token echoed back on
    // the final (non-truncated) page so the sweep loop terminates.
    return res.isTruncated && res.nextContinuationToken
      ? { objects, nextToken: res.nextContinuationToken }
      : { objects };
  },
};

// Self-register at module load — importing this file is enough to make the
// driver selectable; `configureS3Driver` builds its client from DB settings.
registerDriver(s3Driver);

/** Test-only: drop the bound client so a later `setup` re-initialises it. */
export function __resetS3DriverForTests(): void {
  client = undefined;
  keyPrefix = "";
  publicOrigin = null;
}
