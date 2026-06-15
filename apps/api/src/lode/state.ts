import type { LodeRuntimeEnv } from "./types";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

// Lode communicates with the app through `$LODE_DATA_DIR/state.json`. The
// readiness/prepare handshake rides a single field, `ready`, whose value is
// `{LODE_INSTANCE}-{phase}`:
//   -0 = serving (opts into the staged-update prepare handshake)
//   -1 = lode's prepare prompt (lode writes this)
//   -2 = the app's "prepared" ack (the app writes this)
// A bare `{LODE_INSTANCE}` is the legacy serving signal (opts out of prepare).

export function currentLodeEnv(): LodeRuntimeEnv {
  return {
    ...(process.env.LODE_DATA_DIR ? { LODE_DATA_DIR: process.env.LODE_DATA_DIR } : {}),
    ...(process.env.LODE_INSTANCE ? { LODE_INSTANCE: process.env.LODE_INSTANCE } : {}),
    ...(process.env.LODE_CONFIG ? { LODE_CONFIG: process.env.LODE_CONFIG } : {}),
    ...(process.env.LODE_CONFIG_FILE ? { LODE_CONFIG_FILE: process.env.LODE_CONFIG_FILE } : {}),
  };
}

// Path used by writers (readiness/prepare): requires both data dir and the
// instance id, since a write is only meaningful for a launched instance.
export function statePath(env: LodeRuntimeEnv): string | null {
  if (!env.LODE_DATA_DIR || !env.LODE_INSTANCE)
    return null;
  return join(env.LODE_DATA_DIR, "state.json");
}

// Path used by the read-only summary: the data dir alone is enough to read.
export function summaryStatePath(env: LodeRuntimeEnv): string | null {
  return env.LODE_DATA_DIR ? join(env.LODE_DATA_DIR, "state.json") : null;
}

export function readState(path: string): Record<string, unknown> {
  if (!existsSync(path))
    return {};

  const raw = readFileSync(path, "utf-8").trim();
  if (!raw)
    return {};

  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

export function composeReady(instance: string, phase: number): string {
  return `${instance}-${phase}`;
}

// Parse the handshake phase out of a `ready` value for the given instance.
// `LODE_INSTANCE` itself contains a `-` (`{pid}-{nanoid}`), so we anchor on the
// full instance prefix rather than splitting on `-`. Returns:
//   0   for the bare legacy token or `{instance}-0`
//   1|2 for `{instance}-1` / `{instance}-2`
//   null for a value addressed to a different instance or malformed.
export function parseReadyPhase(ready: string | undefined, instance: string | undefined): number | null {
  if (!ready || !instance)
    return null;
  if (ready === instance)
    return 0;
  if (ready.startsWith(`${instance}-`)) {
    const suffix = ready.slice(instance.length + 1);
    if (/^[0-2]$/.test(suffix))
      return Number(suffix);
  }
  return null;
}

// Atomic read-merge-write of selected fields. Reads the current state, applies
// the patch on top, then writes via temp-file + rename so a concurrent reader
// never sees a torn file and lode's own fields are preserved. This is the
// mechanism the lode spec itself uses ("the file is the notification"); during
// the prepare handshake lode is waiting on our ack and is not concurrently
// mutating `ready`, so no extra lock is required.
export function patchState(path: string, patch: Record<string, unknown>): void {
  const next = { ...readState(path), ...patch };
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, path);
}
