import type { AppDatabase } from "@/db";
import { getSetting } from "@/modules/settings/settings.service";
import { setDbDriverDatabase } from "./storage/db";
import { ensureLocalDriverRoot } from "./storage/local";
import { setActiveDriver, setActiveUploadDriver } from "./storage/registry";
import { configureS3Driver, isS3Configured } from "./storage/s3";

// Storage config now lives in the DB (settings), not env (FEAT-047). These are
// the setting keys; `storage.s3.secret` ends in `.secret` so the settings
// masking hides it on read.
export const STORAGE_SETTING_KEYS = {
  uploadDriver: "storage.uploadDriver",
  s3Bucket: "storage.s3.bucket",
  s3Region: "storage.s3.region",
  s3Endpoint: "storage.s3.endpoint",
  s3AccessKeyId: "storage.s3.accessKeyId",
  s3Secret: "storage.s3.secret",
  s3Prefix: "storage.s3.prefix",
} as const;

export type UploadDriverName = "s3" | "local";

export interface StorageS3Config {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secret: string;
  readonly prefix: string;
}

export interface StorageConfig {
  readonly uploadDriver: UploadDriverName;
  readonly s3: StorageS3Config;
}

/**
 * Read the effective storage config from the settings table (secret included —
 * for SERVER use only, never returned over the wire). Unset keys resolve to
 * their defaults; the upload driver defaults to `local` when unconfigured.
 */
export async function readStorageConfig(db: AppDatabase): Promise<StorageConfig> {
  const [uploadDriverRaw, bucket, region, endpoint, accessKeyId, secret, prefix] = await Promise.all([
    getSetting(db, STORAGE_SETTING_KEYS.uploadDriver),
    getSetting(db, STORAGE_SETTING_KEYS.s3Bucket),
    getSetting(db, STORAGE_SETTING_KEYS.s3Region),
    getSetting(db, STORAGE_SETTING_KEYS.s3Endpoint),
    getSetting(db, STORAGE_SETTING_KEYS.s3AccessKeyId),
    getSetting(db, STORAGE_SETTING_KEYS.s3Secret),
    getSetting(db, STORAGE_SETTING_KEYS.s3Prefix),
  ]);
  const uploadDriver: UploadDriverName = uploadDriverRaw === "s3" ? "s3" : "local";
  return {
    uploadDriver,
    s3: {
      bucket: bucket ?? "",
      region: region ?? "",
      endpoint: endpoint ?? "",
      accessKeyId: accessKeyId ?? "",
      secret: secret ?? "",
      prefix: prefix ?? "",
    },
  };
}

/**
 * Apply the DB storage config to the drivers: inject the db handle into the db
 * driver, (re)build the S3 client when its required params are present, ensure
 * the local root exists, and record the active upload driver. Called at boot
 * and after every admin config change (no restart needed).
 *
 * The S3 client is only built when the config is complete; if `uploadDriver=s3`
 * but S3 is not fully configured, the upload driver still points at `s3` (so a
 * later upload surfaces the "not initialised" error) — the admin route
 * validates completeness before persisting, so this is a defensive fallback.
 */
export async function applyStorageConfig(db: AppDatabase): Promise<void> {
  const cfg = await readStorageConfig(db);

  setDbDriverDatabase(db);
  ensureLocalDriverRoot();

  if (cfg.s3.bucket && cfg.s3.accessKeyId && cfg.s3.secret) {
    configureS3Driver({
      bucket: cfg.s3.bucket,
      accessKeyId: cfg.s3.accessKeyId,
      secretAccessKey: cfg.s3.secret,
      region: cfg.s3.region || undefined,
      endpoint: cfg.s3.endpoint || undefined,
      prefix: cfg.s3.prefix || undefined,
    });
  }

  setActiveUploadDriver(cfg.uploadDriver);
  // Keep the legacy "active driver" pointed at the upload driver: it is the
  // fallback used by paths that predate multi-driver (backup blob restore, the
  // S3 orphan sweep, the image preview cache), all of which operate on uploaded
  // blobs. Per-blob serving/deletion already resolves by `files.storage_driver`.
  setActiveDriver(cfg.uploadDriver);
}

/** Re-export so routes can check S3 readiness before a sync/upload. */
export { isS3Configured };
