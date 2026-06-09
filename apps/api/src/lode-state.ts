import type { Logger } from "./shared/lib/logger";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";

interface LodeRuntimeEnv {
  readonly LODE_DATA_DIR?: string;
  readonly LODE_INSTANCE?: string;
  readonly LODE_CONFIG?: string;
  readonly LODE_CONFIG_FILE?: string;
}

type LodeStateStatus = "not_configured" | "data_dir_missing" | "state_missing" | "state_unreadable" | "state_malformed" | "available";
type LodeConfigStatus = "not_configured" | "not_found" | "unreadable" | "malformed" | "available";
type LodeUpdatePolicy = "off" | "check" | "auto";
type LodeSourceType = "github" | "manifest";

export interface LodeSummary {
  readonly configured: boolean;
  readonly active: boolean;
  readonly status: LodeStateStatus;
  readonly current?: string;
  readonly stateStatus?: string;
  readonly readiness: {
    readonly ready: boolean | null;
  };
  readonly update: {
    readonly configStatus: LodeConfigStatus;
    readonly policy?: LodeUpdatePolicy;
    readonly channel?: string;
    readonly asset?: string;
    readonly sourceType?: LodeSourceType;
    readonly source?: string;
  };
  readonly manualOperations: {
    readonly check: false;
    readonly apply: false;
  };
}

function statePath(env: LodeRuntimeEnv): string | null {
  if (!env.LODE_DATA_DIR || !env.LODE_INSTANCE)
    return null;
  return join(env.LODE_DATA_DIR, "state.json");
}

function summaryStatePath(env: LodeRuntimeEnv): string | null {
  return env.LODE_DATA_DIR ? join(env.LODE_DATA_DIR, "state.json") : null;
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
    ...(process.env.LODE_CONFIG ? { LODE_CONFIG: process.env.LODE_CONFIG } : {}),
    ...(process.env.LODE_CONFIG_FILE ? { LODE_CONFIG_FILE: process.env.LODE_CONFIG_FILE } : {}),
  };
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeString(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== "string")
    return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength)
    return undefined;
  return trimmed;
}

function safeAsset(value: unknown): string | undefined {
  const asset = safeString(value);
  if (!asset || asset.includes("/") || asset.includes("\\"))
    return undefined;
  return asset;
}

function safePolicy(value: unknown): LodeUpdatePolicy | undefined {
  const policy = safeString(value);
  return policy === "off" || policy === "check" || policy === "auto" ? policy : undefined;
}

function safeGithubSource(value: unknown): string | undefined {
  const source = safeString(value);
  return source && /^[\w.-]+\/[\w.-]+$/.test(source) ? source : undefined;
}

function readLodeStateSummary(env: LodeRuntimeEnv): Pick<LodeSummary, "status" | "current" | "stateStatus" | "readiness"> {
  const path = summaryStatePath(env);
  if (!path || !env.LODE_DATA_DIR) {
    return { status: "not_configured", readiness: { ready: null } };
  }
  if (!existsSync(env.LODE_DATA_DIR)) {
    return { status: "data_dir_missing", readiness: { ready: null } };
  }
  if (!existsSync(path)) {
    return { status: "state_missing", readiness: { ready: null } };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = readState(path);
  }
  catch (err) {
    if (err instanceof SyntaxError)
      return { status: "state_malformed", readiness: { ready: null } };
    return { status: "state_unreadable", readiness: { ready: null } };
  }

  const ready = safeString(parsed.ready);
  const result: {
    status: LodeStateStatus;
    current?: string;
    stateStatus?: string;
    readiness: { ready: boolean | null };
  } = {
    status: "available",
    readiness: { ready: ready && env.LODE_INSTANCE ? ready === env.LODE_INSTANCE : null },
  };
  const current = safeString(parsed.current);
  if (current)
    result.current = current;
  const stateStatus = safeString(parsed.status);
  if (stateStatus)
    result.stateStatus = stateStatus;
  return result;
}

function lodeConfigCandidates(env: LodeRuntimeEnv): string[] {
  const paths = [
    env.LODE_CONFIG,
    env.LODE_CONFIG_FILE,
    env.LODE_DATA_DIR ? join(env.LODE_DATA_DIR, "lode.toml") : undefined,
    env.LODE_DATA_DIR ? join(env.LODE_DATA_DIR, "config.toml") : undefined,
  ];
  return [...new Set(paths.filter((path): path is string => !!path))];
}

function readLodeUpdateSummary(env: LodeRuntimeEnv): LodeSummary["update"] {
  const candidates = lodeConfigCandidates(env);
  if (candidates.length === 0)
    return { configStatus: "not_configured" };

  const path = candidates.find(candidate => existsSync(candidate));
  if (!path)
    return { configStatus: "not_found" };

  let config: Record<string, unknown> | null;
  try {
    config = objectRecord(Bun.TOML.parse(readFileSync(path, "utf-8")));
  }
  catch (err) {
    return { configStatus: err instanceof SyntaxError ? "malformed" : "unreadable" };
  }

  const update = objectRecord(config?.update);
  if (!update)
    return { configStatus: "available" };

  const githubSource = safeGithubSource(update.github);
  const hasManifestSource = !!safeString(update.manifest);
  const result: {
    configStatus: LodeConfigStatus;
    policy?: LodeUpdatePolicy;
    channel?: string;
    asset?: string;
    sourceType?: LodeSourceType;
    source?: string;
  } = {
    configStatus: "available",
  };
  const policy = safePolicy(update.policy);
  if (policy)
    result.policy = policy;
  const channel = safeString(update.channel);
  if (channel)
    result.channel = channel;
  const asset = safeAsset(update.asset);
  if (asset)
    result.asset = asset;
  if (githubSource) {
    result.sourceType = "github";
    result.source = githubSource;
  }
  else if (hasManifestSource) {
    result.sourceType = "manifest";
  }
  return result;
}

export function getLodeSummary(env: LodeRuntimeEnv = currentLodeEnv()): LodeSummary {
  const state = readLodeStateSummary(env);
  return {
    configured: !!(env.LODE_DATA_DIR || env.LODE_CONFIG || env.LODE_CONFIG_FILE),
    active: !!(env.LODE_DATA_DIR && env.LODE_INSTANCE),
    ...state,
    update: readLodeUpdateSummary(env),
    manualOperations: { check: false, apply: false },
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
