// Cron admin data layer: typed request functions over the backend cron module
// (apps/api/src/modules/cron). `CronJob` mirrors `serialize.ts`; the action
// catalog mirrors `actions/types.ts` — both small, documented public contracts
// (docs/modules/cron.md).
//
// The cron admin page manages its list state imperatively (manual refresh
// button, toast-on-error), so this module exposes typed functions rather than
// TanStack Query hooks; the page-level react-query adoption is tracked with
// the UI-029 god-component split.

import { http } from "../http";

// ── Types ──

export interface CronJob {
  readonly id: string;
  readonly name: string;
  readonly cron: string;
  readonly taskType: string;
  readonly taskConfig: Record<string, unknown>;
  readonly enabled: boolean;
  readonly status: string;
  readonly nextExecution: string | null;
  readonly lastRun: {
    readonly status: string;
    readonly startedAt: string;
    readonly durationMs: number | null;
    readonly result: string | null;
    readonly error: string | null;
  } | null;
  readonly maxConsecutiveFailures: number;
  readonly isDeleted: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JobsListResponse {
  success: true;
  data: { jobs: CronJob[]; hasMore: boolean; nextCursor: string | null };
}

export interface JobOneResponse {
  success: true;
  data: CronJob;
}

type ActionInputType
  = | "string"
    | "textarea"
    | "secret"
    | "number"
    | "boolean"
    | "select"
    | "json";

export interface ActionInput {
  readonly key: string;
  readonly label: string;
  readonly type: ActionInputType;
  readonly required?: boolean;
  readonly description?: string;
  readonly placeholder?: string;
  readonly default?: unknown;
  readonly options?: readonly { value: string; label: string }[];
  readonly min?: number;
  readonly max?: number;
  readonly group?: string;
}

export interface ActionCatalogEntry {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: string;
  readonly icon: string | null;
  readonly tags: readonly string[];
  readonly version: string | null;
  readonly dangerous: boolean;
  readonly defaultCron: string | null;
  readonly inputs: readonly ActionInput[];
  readonly requiredKeys: readonly string[];
}

export interface ActionsResponse {
  success: true;
  data: {
    actions: ActionCatalogEntry[];
    cronFormats: string[];
    // false when the API was started with CRON_ENABLED=false — admins
    // can still browse / write, but no scheduled ticks fire.
    schedulerEnabled: boolean;
  };
}

export interface CronJobLog {
  readonly id: string;
  readonly jobId: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly durationMs: number | null;
  readonly status: string;
  readonly result: string | null;
  readonly error: string | null;
}

interface LogsResponse {
  success: true;
  data: { logs: CronJobLog[] };
}

export interface TriggerResult {
  readonly triggered: boolean;
  readonly log: { readonly status: string } | null;
}

// ── Requests ──

export interface CronJobsQuery {
  readonly deleted?: "false" | "true" | "only" | undefined;
  readonly lastStatus?: "success" | "failed" | "running" | undefined;
  readonly taskType?: string | undefined;
  readonly limit?: number | undefined;
}

export async function listCronJobs(query: CronJobsQuery = {}): Promise<CronJob[]> {
  const params = new URLSearchParams({ limit: String(query.limit ?? 100) });
  if (query.deleted !== undefined)
    params.set("deleted", query.deleted);
  if (query.lastStatus !== undefined)
    params.set("lastStatus", query.lastStatus);
  if (query.taskType !== undefined)
    params.set("taskType", query.taskType);
  const res = await http<JobsListResponse>(`/cron/jobs?${params.toString()}`);
  return res.data.jobs;
}

export async function listCronActions(): Promise<ActionsResponse["data"]> {
  const res = await http<ActionsResponse>("/cron/actions");
  return res.data;
}

export async function createCronJob(body: Record<string, unknown>): Promise<CronJob> {
  const res = await http<JobOneResponse>("/cron/jobs", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res.data;
}

export async function deleteCronJob(id: string): Promise<void> {
  await http<{ success: true }>(`/cron/jobs/${id}`, { method: "DELETE" });
}

export async function pauseCronJob(id: string): Promise<void> {
  await http<{ success: true }>(`/cron/jobs/${id}/pause`, { method: "POST" });
}

export async function resumeCronJob(id: string): Promise<void> {
  await http<{ success: true }>(`/cron/jobs/${id}/resume`, { method: "POST" });
}

export async function triggerCronJob(id: string): Promise<TriggerResult> {
  const res = await http<{ data: TriggerResult }>(`/cron/jobs/${id}/trigger`, { method: "POST" });
  return res.data;
}

export async function listCronJobLogs(
  jobId: string,
  query: { readonly status?: string | undefined; readonly limit?: number | undefined } = {},
): Promise<CronJobLog[]> {
  const params = new URLSearchParams({ limit: String(query.limit ?? 100) });
  if (query.status !== undefined)
    params.set("status", query.status);
  const res = await http<LogsResponse>(`/cron/jobs/${jobId}/logs?${params.toString()}`);
  return res.data.logs;
}
