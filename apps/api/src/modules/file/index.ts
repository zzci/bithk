import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { registerBackupContribution } from "@/modules/backup/registry";
import { fileBackupContribution } from "./file.backup";
import { setFileUrlBasePath } from "./file.service";
import { applyStorageConfig } from "./storage-config";
// `localDriver` is imported for its `setup(config)` (blob-root resolution); the
// import also runs the module's `registerDriver` side-effect. The s3 / db
// drivers self-register the same way — importing them is enough to make them
// selectable. Storage config (upload driver + S3 params) is read from the DB
// at boot in `applyStorageConfig`.
import { localDriver } from "./storage/local";
import "./storage/s3";
import "./storage/db";

export { fileRoutes } from "./file.routes";
export type { DrainedBlob, FileServiceConfig, FileTypePolicy } from "./file.service";
export {
  ACCEPT_ANY,
  ACCEPT_IMAGES,
  addReference,
  buildDownloadResponse,
  directUploadAvailable,
  fileContentUnavailableError,
  fileInlineContentUrl,
  finalizeReleasedBlob,
  findStoredBlob,
  findStoredBlobByHash,
  getFileById,
  getReferenceById,
  isQuarantinedFile,
  listAttachmentsByOwner,
  makeAttachmentView,
  policyAllows,
  presignBlobUpload,
  registerUploadedBlob,
  releaseAllByOwner,
  releaseReference,
  releaseReferenceTx,
  setFileUrlBasePath,
  statStoredBlob,
  uploadAndReference,
} from "./file.service";
export { startFileGcSweep, stopFileGcSweep } from "./gc";
export type { MimeRepairResult } from "./mime-repair";
export { repairEmptyFileMimetypes } from "./mime-repair";
export type { FilePermissionHook } from "./permission";
export { registerFilePermissionHook } from "./permission";
export { parseThumbnailWidth, THUMBNAIL_WIDTHS } from "./preview-cache";
export { applyStorageConfig, readStorageConfig } from "./storage-config";
export { storageRoutes } from "./storage.routes";

registerBackupContribution(fileBackupContribution);

/**
 * Initialise the file module (FEAT-047). Storage is now MULTI-DRIVER and
 * DB-configured: `db`, `local`, and `s3` coexist and each blob is served /
 * deleted via its own `storage_driver`. This resolves the local blob root from
 * `FILE_STORAGE_LOCAL_ROOT`, then `applyStorageConfig(db)` reads the DB storage
 * settings — injecting the db handle into the `db` driver, building the S3
 * client from the stored params, and recording the active UPLOAD driver
 * (`storage.uploadDriver`, default `local`). Driver registration itself happens
 * at module load (side-effect imports above).
 */
export async function initFileModule(config: Config, db: AppDatabase): Promise<void> {
  // The local driver's on-disk root is still a filesystem path from config;
  // resolve it here so `applyStorageConfig` can mkdir it.
  await localDriver.setup?.(config);
  await applyStorageConfig(db);
  // Base path for server-built `<img>` URLs (cover images, avatars).
  setFileUrlBasePath(config.BASE_PATH);
}
