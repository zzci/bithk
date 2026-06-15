// Public types for the lode upgrade integration. See `state.ts` for the
// `state.ready` token convention and the rest of the module for behaviour.

export interface LodeRuntimeEnv {
  readonly LODE_DATA_DIR?: string;
  readonly LODE_INSTANCE?: string;
  readonly LODE_CONFIG?: string;
  readonly LODE_CONFIG_FILE?: string;
}

export type LodeStateStatus = "not_configured" | "data_dir_missing" | "state_missing" | "state_unreadable" | "state_malformed" | "available";
export type LodeConfigStatus = "not_configured" | "not_found" | "unreadable" | "malformed" | "available";
export type LodeUpdatePolicy = "off" | "check" | "auto";
export type LodeSourceType = "github" | "manifest";

export interface LodeSummary {
  readonly configured: boolean;
  readonly active: boolean;
  readonly status: LodeStateStatus;
  readonly current?: string;
  readonly stateStatus?: string;
  readonly readiness: {
    // True once this instance has signalled serving (any phase of the
    // handshake). Null when not under lode or no ready value is present.
    readonly ready: boolean | null;
    // Handshake phase parsed from `state.ready`: 0 = serving, 1 = lode's
    // staged-update prompt, 2 = the app's prepared ack. Null when absent or
    // not addressed to this instance.
    readonly phase: number | null;
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
