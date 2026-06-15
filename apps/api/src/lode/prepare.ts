import type { LodeRuntimeEnv } from "./types";
import type { Logger } from "@/shared/lib/logger";
import { composeReady, currentLodeEnv, parseReadyPhase, patchState, readState, statePath } from "./state";

export interface LodePrepareWatcherOptions {
  // Pre-cut-over work run when lode prompts a staged update: drain in-flight
  // work, checkpoint, warm caches. The app keeps serving throughout; lode only
  // cuts over after the ack. Injected so this module stays free of app
  // internals.
  readonly onPrepare: () => void | Promise<void>;
  readonly intervalMs?: number;
  readonly logger?: Pick<Logger, "info" | "error">;
  readonly env?: LodeRuntimeEnv;
}

export interface LodePrepareWatcher {
  readonly stop: () => void;
}

function readReadyToken(path: string): string | undefined {
  const value = readState(path).ready;
  return typeof value === "string" ? value : undefined;
}

/**
 * Watch `state.json` for lode's staged-update prepare prompt
 * (`state.ready == {INSTANCE}-1`). On the prompt, run `onPrepare`, then ack by
 * writing `{INSTANCE}-2`, which lets lode begin the cut-over.
 *
 * Detection is by polling: lode signals via the file (mtime), not a process
 * signal. Plain reads need no lock; the ack is an atomic read-merge-write that
 * preserves lode's other fields. No-op when not running under lode.
 */
export function startLodePrepareWatcher(options: LodePrepareWatcherOptions): LodePrepareWatcher {
  const env = options.env ?? currentLodeEnv();
  const maybePath = statePath(env);
  const instance = env.LODE_INSTANCE;
  if (!maybePath || !instance)
    return { stop() {} };
  // Bind narrowed locals so the nested tick closure keeps the non-null types.
  const path: string = maybePath;
  const instanceId: string = instance;

  const intervalMs = options.intervalMs ?? 1000;
  let busy = false;
  let acked = false;

  async function tick(): Promise<void> {
    if (busy || acked)
      return;

    let phase: number | null;
    try {
      phase = parseReadyPhase(readReadyToken(path), instanceId);
    }
    catch {
      // Malformed/unreadable state.json on this tick — skip; lode rewrites it.
      return;
    }
    if (phase !== 1)
      return;

    busy = true;
    try {
      await options.onPrepare();
      patchState(path, { ready: composeReady(instanceId, 2) });
      acked = true;
      options.logger?.info?.({ lodeInstance: instanceId }, "lode prepare ack written (phase 2)");
    }
    catch (err) {
      // Leave `acked` false so a later tick can retry; lode's prepare_timeout
      // is the backstop if onPrepare keeps failing.
      options.logger?.error?.({ err }, "lode prepare handling failed");
    }
    finally {
      busy = false;
    }
  }

  const timer = setInterval(() => void tick(), intervalMs);
  // Never let the watcher hold the process open at shutdown.
  timer.unref?.();
  return { stop() {
    clearInterval(timer);
  } };
}
