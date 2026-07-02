// Shared UI types & constants for the cron admin page. The API view types
// (`CronJob`, the action catalog) and typed request functions moved to the
// shared data layer (`@/shared/lib/api/cron`); re-exported here for the
// sibling cron page files.

export type {
  ActionCatalogEntry,
  ActionInput,
  ActionsResponse,
  CronJob,
  JobOneResponse,
  JobsListResponse,
} from "@/shared/lib/api/cron";

// ─── Schedule presets ───
//
// Keyed by an i18n token under cron.presets.*; the value is the cron
// expression sent to the API. The API normalises shorthand forms
// (`@every_5m` → `@every_5_minutes`) so either is accepted.

interface SchedulePreset {
  readonly key: string;
  readonly value: string;
}

export const SCHEDULE_PRESETS: readonly SchedulePreset[] = [
  { key: "every_1m", value: "@every_minute" },
  { key: "every_5m", value: "@every_5m" },
  { key: "every_15m", value: "@every_15m" },
  { key: "every_30m", value: "@every_30m" },
  { key: "hourly", value: "@hourly" },
  { key: "every_1h", value: "@every_1h" },
  { key: "every_6h", value: "@every_6h" },
  { key: "every_12h", value: "@every_12h" },
  { key: "daily", value: "@daily" },
  { key: "weekly", value: "@weekly" },
  { key: "monthly", value: "@monthly" },
  { key: "yearly", value: "@yearly" },
];

// Quick check: does the entered cron string match one of our presets?
// Used to pre-select the preset tab when editing an existing job's
// schedule (future) or when a user types a value that happens to be a
// preset. Kept as a Set for O(1) lookup.
export const PRESET_VALUES = new Set(SCHEDULE_PRESETS.map(p => p.value));

// Status filter presets for the toolbar Select. Each entry maps to
// the pair of `deleted` + `lastStatus` query params the cron list
// route understands. The list is intentionally short — admins want
// quick triage views, not a permutation of every lifecycle bit.
export interface StatusFilter {
  readonly deleted?: "false" | "true" | "only";
  readonly lastStatus?: "success" | "failed" | "running";
}
export const STATUS_FILTERS = {
  // Live jobs (default). Hides tombstones; no run-status filter so
  // both successful + failed jobs appear.
  active: { deleted: "false" },
  // Jobs whose latest run failed — primary triage view.
  failed: { deleted: "false", lastStatus: "failed" },
  // Jobs whose latest run succeeded.
  success: { deleted: "false", lastStatus: "success" },
  // Soft-deleted rows.
  deleted: { deleted: "only" },
} as const satisfies Record<string, StatusFilter>;

export type StatusFilterKey = keyof typeof STATUS_FILTERS;
export const STATUS_FILTER_ORDER: readonly StatusFilterKey[] = ["active", "failed", "success", "deleted"];

export const NAME_REGEX = /^[\w-]+$/;

// Form state: schedule + name + retry policy are universal; per-action
// config lives in a free-form record indexed by each `ActionInput.key`.
// Switching action populates this record with the new action's
// defaults — no per-action React component needed.
export interface FormState {
  name: string;
  scheduleMode: "preset" | "custom";
  schedulePreset: string;
  scheduleCustom: string;
  action: string;
  /** Per-input values keyed by `ActionInput.key`. */
  config: Record<string, unknown>;
  /**
   * Retry budget. Stored as string so the input can be cleared cleanly;
   * empty = "send default" (server picks 3); explicit digits 0..100
   * ride the wire as a number.
   */
  maxConsecutiveFailures: string;
}

export const INITIAL_FORM: FormState = {
  name: "",
  scheduleMode: "preset",
  schedulePreset: "@every_1h",
  scheduleCustom: "0 0 3 * * *",
  action: "",
  config: {},
  maxConsecutiveFailures: "3",
};
