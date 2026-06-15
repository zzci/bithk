import type { LodeRuntimeEnv } from "./types";
import type { Logger } from "@/shared/lib/logger";
import { composeReady, currentLodeEnv, patchState, statePath } from "./state";

export interface MarkLodeReadyOptions {
  // Optional readiness gate. When supplied, the serving signal is written only
  // if this resolves truthy, so `state.ready` reflects real readiness (e.g. the
  // database is reachable), not merely "the process is up". A throw or a falsy
  // result means "not ready": nothing is written and lode's `ready_timeout`
  // governs the outcome.
  readonly probe?: () => boolean | Promise<boolean>;
  readonly logger?: Pick<Logger, "info" | "warn">;
  readonly env?: LodeRuntimeEnv;
}

/**
 * Report serving readiness to lode by writing `state.ready = {INSTANCE}-0`
 * (phase 0 = serving, which opts into the staged-update prepare handshake; see
 * `startLodePrepareWatcher`). No-op when not running under lode. Returns true
 * if the ready signal was written.
 */
export async function markLodeReady(options: MarkLodeReadyOptions = {}): Promise<boolean> {
  const env = options.env ?? currentLodeEnv();
  const path = statePath(env);
  if (!path || !env.LODE_INSTANCE)
    return false;

  if (options.probe) {
    let ready = false;
    try {
      ready = await options.probe();
    }
    catch (err) {
      options.logger?.warn?.({ err }, "lode readiness probe failed; not reporting ready");
      return false;
    }
    if (!ready) {
      options.logger?.warn?.("lode readiness probe not ready; not reporting ready");
      return false;
    }
  }

  patchState(path, { ready: composeReady(env.LODE_INSTANCE, 0) });
  options.logger?.info?.({ lodeInstance: env.LODE_INSTANCE }, "lode readiness reported (phase 0)");
  return true;
}
