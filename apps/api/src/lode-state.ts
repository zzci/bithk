import type { Logger } from "./shared/lib/logger";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

interface LodeRuntimeEnv {
  readonly LODE_DATA_DIR?: string;
  readonly LODE_INSTANCE?: string;
}

function statePath(env: LodeRuntimeEnv): string | null {
  if (!env.LODE_DATA_DIR || !env.LODE_INSTANCE)
    return null;
  return join(env.LODE_DATA_DIR, "state.json");
}

function readState(path: string): Record<string, unknown> {
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

function currentLodeEnv(): LodeRuntimeEnv {
  return {
    ...(process.env.LODE_DATA_DIR ? { LODE_DATA_DIR: process.env.LODE_DATA_DIR } : {}),
    ...(process.env.LODE_INSTANCE ? { LODE_INSTANCE: process.env.LODE_INSTANCE } : {}),
  };
}

export function markLodeReady(logger?: Pick<Logger, "info">, env: LodeRuntimeEnv = currentLodeEnv()): boolean {
  const path = statePath(env);
  if (!path)
    return false;

  const next = {
    ...readState(path),
    ready: env.LODE_INSTANCE,
  };
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, path);
  logger?.info({ lodeInstance: env.LODE_INSTANCE }, "lode readiness reported");
  return true;
}
