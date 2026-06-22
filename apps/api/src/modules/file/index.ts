import type { Config } from "@/config";
import { registerBackupContribution } from "@/modules/backup/registry";
import { fileBackupContribution } from "./file.backup";
import { setFileUrlBasePath } from "./file.service";
import { getDriver, setActiveDriver } from "./storage/registry";
// Side-effect imports: each driver self-registers at module load. A single
// import here is enough to make it selectable; `initFileModule` only picks the
// active one (via FILE_STORAGE_DRIVER) and runs its `setup` hook.
import "./storage/local";
import "./storage/s3";

export { fileRoutes } from "./file.routes";
export type { DrainedBlob, FileServiceConfig, FileTypePolicy } from "./file.service";
export {
  ACCEPT_ANY,
  ACCEPT_IMAGES,
  addReference,
  buildDownloadResponse,
  directUploadAvailable,
  fileInlineContentUrl,
  finalizeReleasedBlob,
  findStoredBlob,
  getFileById,
  getReferenceById,
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
export type { FilePermissionHook } from "./permission";
export { registerFilePermissionHook } from "./permission";
export { parseThumbnailWidth, THUMBNAIL_WIDTHS } from "./preview-cache";

registerBackupContribution(fileBackupContribution);

/**
 * Activate the configured storage driver. Called once from
 * `app.ts::buildFullApp`. GC mode + presign settings are no longer
 * cached as module-level singletons here — `releaseReference`,
 * `releaseAllByOwner`, and `buildDownloadResponse` accept a narrow
 * `FileServiceConfig` parameter that callers thread through from
 * `c.get("config")`. Driver registration happens at module load
 * (side-effect imports above); this function only picks the active
 * driver and runs its optional `setup(config)` hook.
 */
export async function initFileModule(config: Config): Promise<void> {
  const driver = getDriver(config.FILE_STORAGE_DRIVER);
  await driver.setup?.(config);
  setActiveDriver(config.FILE_STORAGE_DRIVER);
  // Base path for server-built `<img>` URLs (cover images, avatars).
  setFileUrlBasePath(config.BASE_PATH);
}
