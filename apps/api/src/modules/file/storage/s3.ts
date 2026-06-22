import type { S3Client as S3ClientType } from "bun";
import type { FileStorageDriver } from "./types";
import { S3Client } from "bun";
import { registerDriver } from "./registry";

let client: S3ClientType | undefined;
let keyPrefix = "";

/** Apply the configured prefix (a folder within the bucket) to a storage key. */
export function s3ObjectKey(key: string): string {
  return keyPrefix ? `${keyPrefix}/${key}` : key;
}

function requireClient(): S3ClientType {
  if (!client) {
    throw new Error("S3 driver not initialised. Ensure FILE_STORAGE_DRIVER=s3 and initFileModule(config) ran at boot.");
  }
  return client;
}

/**
 * S3-compatible storage driver (default target: Cloudflare R2). Backed by
 * Bun's native S3 client — no AWS SDK. Activated by `FILE_STORAGE_DRIVER=s3`;
 * `setup` builds the client from `FILE_S3_*` config and fails fast when the
 * required values are missing. Content-addressed keys (`ab/cd/<sha256>`) are
 * shared with the local driver, optionally under `FILE_S3_PREFIX`.
 *
 * Downloads use `presignDownload` (a signed GET); the object is stored with its
 * MIME type via `put(..., { contentType })` so the presigned response carries
 * the right `Content-Type` for inline preview. Bun's presign cannot sign a
 * `Content-Disposition`, so attachment downloads stream through the API instead
 * (handled in `buildDownloadResponse`).
 */
export const s3Driver: FileStorageDriver = {
  name: "s3",

  setup(config) {
    if (!config.FILE_S3_BUCKET || !config.FILE_S3_ACCESS_KEY_ID || !config.FILE_S3_SECRET_ACCESS_KEY) {
      const missing = ([
        ["FILE_S3_BUCKET", config.FILE_S3_BUCKET],
        ["FILE_S3_ACCESS_KEY_ID", config.FILE_S3_ACCESS_KEY_ID],
        ["FILE_S3_SECRET_ACCESS_KEY", config.FILE_S3_SECRET_ACCESS_KEY],
      ] as const).filter(([, v]) => !v).map(([k]) => k);
      throw new Error(`FILE_STORAGE_DRIVER=s3 requires ${missing.join(", ")}.`);
    }
    client = new S3Client({
      bucket: config.FILE_S3_BUCKET,
      accessKeyId: config.FILE_S3_ACCESS_KEY_ID,
      secretAccessKey: config.FILE_S3_SECRET_ACCESS_KEY,
      // R2 convention; AWS callers set a real region.
      region: config.FILE_S3_REGION ?? "auto",
      ...config.FILE_S3_ENDPOINT ? { endpoint: config.FILE_S3_ENDPOINT } : {},
    });
    keyPrefix = (config.FILE_S3_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
  },

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
    // Signed GET. The object's stored Content-Type drives the response; Bun's
    // presign cannot add Content-Disposition, so this is used for inline
    // preview only (see buildDownloadResponse).
    return requireClient().presign(s3ObjectKey(key), {
      method: "GET",
      expiresIn: opts.expiresSeconds,
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

  async list(prefix) {
    const res = await requireClient().list({ prefix: s3ObjectKey(prefix), maxKeys: 1000 });
    // Strip FILE_S3_PREFIX so callers get the driver-internal key (`ab/cd/<sha>`),
    // the same form stored in `files.storage_key`.
    const strip = keyPrefix ? `${keyPrefix}/` : "";
    return (res.contents ?? []).map(o => ({
      key: strip && o.key.startsWith(strip) ? o.key.slice(strip.length) : o.key,
      size: o.size ?? 0,
      lastModified: o.lastModified ? Date.parse(o.lastModified) : 0,
    }));
  },
};

// Self-register at module load — importing this file is enough to make the
// driver selectable; `initFileModule` runs `setup` only for the active driver.
registerDriver(s3Driver);

/** Test-only: drop the bound client so a later `setup` re-initialises it. */
export function __resetS3DriverForTests(): void {
  client = undefined;
  keyPrefix = "";
}
