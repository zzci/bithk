import type { LodeConfigStatus, LodeRuntimeEnv, LodeSourceType, LodeStateStatus, LodeSummary, LodeUpdatePolicy } from "./types";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { currentLodeEnv, parseReadyPhase, readState, summaryStatePath } from "./state";

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
    return { status: "not_configured", readiness: { ready: null, phase: null } };
  }
  if (!existsSync(env.LODE_DATA_DIR)) {
    return { status: "data_dir_missing", readiness: { ready: null, phase: null } };
  }
  if (!existsSync(path)) {
    return { status: "state_missing", readiness: { ready: null, phase: null } };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = readState(path);
  }
  catch (err) {
    if (err instanceof SyntaxError)
      return { status: "state_malformed", readiness: { ready: null, phase: null } };
    return { status: "state_unreadable", readiness: { ready: null, phase: null } };
  }

  // Readiness is derived from the phased `{LODE_INSTANCE}-{phase}` token (also
  // accepts the bare legacy token). A token addressed to this instance with a
  // valid phase means the app has reported serving.
  let ready: boolean | null = null;
  let phase: number | null = null;
  if (env.LODE_INSTANCE) {
    const token = safeString(parsed.ready);
    if (token) {
      phase = parseReadyPhase(token, env.LODE_INSTANCE);
      ready = phase !== null;
    }
  }

  const result: {
    status: LodeStateStatus;
    current?: string;
    stateStatus?: string;
    readiness: { ready: boolean | null; phase: number | null };
  } = {
    status: "available",
    readiness: { ready, phase },
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
