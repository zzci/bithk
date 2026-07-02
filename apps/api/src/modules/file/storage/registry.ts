import type { FileStorageDriver } from "./types";

const drivers = new Map<string, FileStorageDriver>();
let activeDriverName: string | undefined;
// The driver new UPLOADS land on (FEAT-047). Configured from the DB settings
// (`storage.uploadDriver`) via `applyStorageConfig`; defaults to `local` so an
// unconfigured deployment (and every existing test) keeps uploading locally.
let activeUploadDriverName = "local";

/**
 * Register a storage driver. Last-write-wins: re-registering a driver
 * under the same name replaces the prior entry. Driver names are
 * case-sensitive and should be lowercase.
 *
 * Drivers register themselves at module load, e.g. from
 * `modules/file/storage/local.ts` via a top-level `registerDriver(...)`
 * call. Downstream projects add S3 / Azure / GCS drivers the same way
 * — no patch of mod-file required.
 */
export function registerDriver(driver: FileStorageDriver): void {
  drivers.set(driver.name, driver);
}

/** Test-only: clear the driver registry between cases. */
export function __resetDriverRegistryForTests(): void {
  drivers.clear();
  activeDriverName = undefined;
  activeUploadDriverName = "local";
}

/** Look up a registered driver by name. Throws if absent. */
export function getDriver(name: string): FileStorageDriver {
  const d = drivers.get(name);
  if (!d) {
    const known = [...drivers.keys()].sort().join(", ") || "(none registered)";
    throw new Error(`Unknown file storage driver: '${name}'. Registered: ${known}.`);
  }
  return d;
}

/** Set the active driver for the running process. Idempotent. */
export function setActiveDriver(name: string): void {
  // Resolve to surface unknown names early (boot-time, not first-upload-time).
  getDriver(name);
  activeDriverName = name;
}

/**
 * Return the currently-active driver. Throws if {@link setActiveDriver}
 * has not been called yet — callers should not reach this before boot
 * has resolved the storage config.
 */
export function getActiveDriver(): FileStorageDriver {
  if (!activeDriverName) {
    throw new Error("File storage driver not selected. Call setActiveDriver() during boot.");
  }
  return getDriver(activeDriverName);
}

/**
 * Record which driver new UPLOADS land on (FEAT-047). Set from the DB storage
 * config (`storage.uploadDriver`) at boot / after an admin config change.
 * Resolves the name eagerly to surface an unknown driver at config time.
 */
export function setActiveUploadDriver(name: string): void {
  getDriver(name);
  activeUploadDriverName = name;
}

/**
 * The driver new uploads land on. Defaults to `local` (never throws) so an
 * unconfigured deployment and existing tests upload locally without any boot
 * wiring; `applyStorageConfig` overrides it from the DB settings.
 */
export function getActiveUploadDriver(): FileStorageDriver {
  return getDriver(activeUploadDriverName);
}
