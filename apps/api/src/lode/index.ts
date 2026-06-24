// Lode upgrade integration — the app's side of the lode supervisor contract,
// built on the official single-file SDK (./sdk.ts, vendored from dotns/lode).
//
// The SDK owns the state.json protocol (atomic, flock-serialised RMW; readiness
// and prepare handshake; restart/update/rollback/hold requests). This module is
// the thin app glue: a read-only summary for /system/version, the operator
// actions the admin UI calls, and the boot-time readiness/prepare wiring.

import type { State } from "./sdk";
import type { Logger } from "@/shared/lib/logger";
import { activeVersion, isSupervised, Lode, readConfig, readiness } from "./sdk";

// ─── Types ───

export interface LodeHistoryEntry {
  readonly version: string;
  readonly at: string;
  readonly result: "good" | "bad";
}

/** Safe, display-only slice of lode.toml's `[update]` (no secrets/URLs). */
export interface LodeUpdateConfig {
  readonly policy?: "off" | "check" | "auto";
  readonly channel?: string;
  readonly asset?: string;
  readonly sourceType?: "github" | "manifest";
  readonly source?: string;
}

export interface LodeSummary {
  /** Running under the lode supervisor (LODE_DIR set). */
  readonly supervised: boolean;
  /** This launch can report readiness (LODE_INSTANCE present). */
  readonly active: boolean;
  /** state.json was present and readable. */
  readonly stateAvailable: boolean;
  readonly status?: string;
  readonly current?: string;
  readonly lastGood?: string;
  readonly available?: string;
  readonly channel?: string;
  readonly activeVersion?: string;
  readonly readinessMode?: "none" | "state";
  /** Has this instance signalled serving (any phase)? Null when not applicable. */
  readonly ready: boolean | null;
  readonly hold: boolean;
  readonly configGeneration?: number;
  /** lode bumped config_generation since this instance started — restart to apply. */
  readonly configChanged: boolean;
  readonly lastCheckAt?: string;
  readonly lastError?: string;
  readonly history: readonly LodeHistoryEntry[];
  /** lode advertises a version different from the running one. */
  readonly updateAvailable: boolean;
  /** The version a rollback would target (last_good, when it differs from current). */
  readonly rollbackTarget?: string;
  /** Safe update config read from lode.toml (via LODE_CONFIG), when present. */
  readonly updateConfig?: LodeUpdateConfig;
}

export type LodeActionStatus = "ok" | "not_active" | "no_target";

export interface LodeActionResult {
  readonly status: LodeActionStatus;
  readonly restartNonce?: number;
  readonly target?: string;
  readonly hold?: boolean;
}

type ActionLogger = Pick<Logger, "info" | "warn" | "error">;

// ─── Internals ───

function clientOrNull(): Lode | null {
  if (!isSupervised())
    return null;
  try {
    return Lode.fromEnv();
  }
  catch {
    return null;
  }
}

// ─── Readiness / prepare (boot wiring in index.ts) ───

export interface ReportServingOptions {
  // Optional readiness gate. The serving signal is written only if this
  // resolves truthy (e.g. the DB answers), so `ready` reflects real readiness.
  // A throw or falsy result means "not ready": nothing is written.
  readonly probe?: () => boolean | Promise<boolean>;
  readonly logger?: ActionLogger;
}

/**
 * Report serving to lode (phase-0 token, opting into the staged-update prepare
 * handshake). No-op when not supervised or without an instance id. Returns true
 * if the serving signal was written.
 */
export async function reportLodeServing(options: ReportServingOptions = {}): Promise<boolean> {
  const lode = clientOrNull();
  if (!lode || !lode.instance)
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

  lode.markServing();
  options.logger?.info?.({ lodeInstance: lode.instance }, "lode readiness reported (phase 0)");
  return true;
}

export interface LodePrepareWatcher {
  readonly stop: () => void;
}

export interface PrepareWatcherOptions {
  // Pre-cut-over work on lode's staged-update prompt: drain, checkpoint, flush.
  readonly onPrepare: () => void | Promise<void>;
  readonly intervalMs?: number;
  readonly logger?: ActionLogger;
}

/**
 * Watch state.json for lode's prepare prompt and run `onPrepare`, then ack the
 * cut-over. Delegates to the SDK's `watch`. No-op when not supervised.
 */
export function startLodePrepareWatcher(options: PrepareWatcherOptions): LodePrepareWatcher {
  const lode = clientOrNull();
  if (!lode || !lode.instance)
    return { stop() {} };

  const stop = lode.watch({
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
    onPrepare: async () => {
      try {
        await options.onPrepare();
        lode.ackPrepared();
        options.logger?.info?.({ lodeInstance: lode.instance }, "lode prepare ack written (phase 2)");
      }
      catch (err) {
        // Leave it un-acked; lode's prepare_timeout is the backstop.
        options.logger?.error?.({ err }, "lode prepare handling failed");
      }
    },
  });
  return { stop };
}

// ─── Config-change baseline ───

// config_generation captured at this instance's start; a later value means the
// operator edited lode.toml while we run (surface "restart to apply").
let configBaseline: number | null = null;

export function captureLodeConfigBaseline(): void {
  const lode = clientOrNull();
  configBaseline = lode ? (lode.read()?.configGeneration ?? null) : null;
}

// ─── Read-only summary (/system/version) ───

function toHistory(entries: State["history"]): LodeHistoryEntry[] {
  if (!Array.isArray(entries))
    return [];
  return entries
    .filter((e): e is LodeHistoryEntry => !!e && typeof e.version === "string" && typeof e.at === "string")
    .map(e => ({ version: e.version, at: e.at, result: e.result === "bad" ? "bad" : "good" }));
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function safeConfigString(value: unknown, maxLength = 200): string | undefined {
  if (typeof value !== "string")
    return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : undefined;
}

// lode.toml is the operator's file; the SDK reads it as raw text (LODE_CONFIG)
// and we expose only a safe whitelist. The manifest URL and any auth headers may
// carry secrets, so a manifest source surfaces its *type* only, never the URL.
function readUpdateConfig(): LodeUpdateConfig | undefined {
  const raw = readConfig();
  if (!raw)
    return undefined;
  let parsed: unknown;
  try {
    parsed = Bun.TOML.parse(raw);
  }
  catch {
    return undefined;
  }
  const update = objectRecord(objectRecord(parsed)?.update);
  if (!update)
    return undefined;

  const result: {
    policy?: "off" | "check" | "auto";
    channel?: string;
    asset?: string;
    sourceType?: "github" | "manifest";
    source?: string;
  } = {};
  const policy = safeConfigString(update.policy);
  if (policy === "off" || policy === "check" || policy === "auto")
    result.policy = policy;
  const channel = safeConfigString(update.channel);
  if (channel)
    result.channel = channel;
  // Reject path-like asset names so a crafted config can't leak a filesystem path.
  const asset = safeConfigString(update.asset);
  if (asset && !asset.includes("/") && !asset.includes("\\"))
    result.asset = asset;
  const github = safeConfigString(update.github);
  if (github && /^[\w.-]+\/[\w.-]+$/.test(github)) {
    result.sourceType = "github";
    result.source = github;
  }
  else if (safeConfigString(update.manifest)) {
    result.sourceType = "manifest";
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function getLodeSummary(): LodeSummary {
  const supervised = isSupervised();
  const lode = clientOrNull();
  const state = lode ? lode.read() : null;
  const updateConfig = readUpdateConfig();

  const current = state?.current;
  const available = state?.available;
  const lastGood = state?.lastGood;
  const configGeneration = state?.configGeneration;
  const configChanged = configBaseline !== null
    && configGeneration !== undefined
    && configGeneration > configBaseline;
  // Capture the env-derived helpers so they narrow under exactOptionalPropertyTypes.
  const launched = activeVersion();
  const readinessMode = readiness();

  return {
    supervised,
    active: !!(supervised && lode?.instance),
    stateAvailable: state !== null,
    ...(state?.status ? { status: state.status } : {}),
    ...(current ? { current } : {}),
    ...(lastGood ? { lastGood } : {}),
    ...(available ? { available } : {}),
    ...(state?.channel ? { channel: state.channel } : {}),
    ...(launched ? { activeVersion: launched } : {}),
    ...(readinessMode ? { readinessMode } : {}),
    ready: state?.ready ? true : (state ? false : null),
    hold: state?.hold ?? false,
    ...(configGeneration !== undefined ? { configGeneration } : {}),
    configChanged,
    ...(state?.lastCheck ? { lastCheckAt: state.lastCheck } : {}),
    ...(state?.lastError ? { lastError: state.lastError } : {}),
    history: toHistory(state?.history ?? []),
    updateAvailable: !!available && available !== current,
    ...(lastGood && lastGood !== current ? { rollbackTarget: lastGood } : {}),
    ...(updateConfig ? { updateConfig } : {}),
  };
}

// ─── Operator actions (admin routes) ───

/** Restart the current version (also applies a pending lode.toml edit). */
export function requestLodeRestart(): LodeActionResult {
  const lode = clientOrNull();
  if (!lode)
    return { status: "not_active" };
  return { status: "ok", restartNonce: lode.reboot() };
}

/** Request an up/down-grade by version or "latest". */
export function requestLodeUpdate(target: string): LodeActionResult {
  const lode = clientOrNull();
  if (!lode)
    return { status: "not_active" };
  lode.requestUpdate(target);
  return { status: "ok", target };
}

/** Roll back to a version, else to the recorded last_good. */
export function requestLodeRollback(version?: string): LodeActionResult {
  const lode = clientOrNull();
  if (!lode)
    return { status: "not_active" };
  try {
    return { status: "ok", target: lode.rollback(version) };
  }
  catch {
    // No version given and no last_good recorded yet.
    return { status: "no_target" };
  }
}

/** Set or clear the maintenance hold (lode won't (re)start the process). */
export function setLodeHold(held: boolean): LodeActionResult {
  const lode = clientOrNull();
  if (!lode)
    return { status: "not_active" };
  if (held)
    lode.hold();
  else
    lode.release();
  return { status: "ok", hold: held };
}
