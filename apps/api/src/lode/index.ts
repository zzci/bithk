// Lode upgrade integration — the app's side of the lode supervisor contract.
//
// Lode launches the packaged release, injects `LODE_DATA_DIR`/`LODE_INSTANCE`,
// and communicates through `$LODE_DATA_DIR/state.json`. This module owns only
// the lode protocol (the `state.ready` handshake and the read-only status
// summary); app behaviour — the readiness probe and the prepare work — is
// injected by the caller, so the module is reusable and free of app internals.
//
//   markLodeReady           report serving (`{INSTANCE}-0`), probe-gated
//   startLodePrepareWatcher staged-update handshake (`-1` -> onPrepare -> `-2`)
//   getLodeSummary          read-only state/config summary for /system/version

export { startLodePrepareWatcher } from "./prepare";
export type { LodePrepareWatcher, LodePrepareWatcherOptions } from "./prepare";
export { markLodeReady } from "./readiness";
export type { MarkLodeReadyOptions } from "./readiness";
export { getLodeSummary } from "./summary";
export type { LodeSummary } from "./types";
