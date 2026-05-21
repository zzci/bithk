import { create } from "zustand";
import { BASE_PATH } from "@/shared/lib/http";

export type SystemStatus = "loading" | "ready" | "db-error" | "error";

const POLL_INTERVAL = 30_000;

interface SystemState {
  readonly status: SystemStatus;
  readonly dbError: string | null;
  readonly fetchStatus: () => Promise<void>;
  readonly startPolling: () => void;
  readonly stopPolling: () => void;
}

interface ReadyResponse {
  status: string;
}

// Reference-counted polling. React 19 StrictMode mounts → unmounts → mounts
// the root once in dev; refcount the subscribers so the timer is alive iff
// at least one consumer still wants updates and stays idempotent across
// nested mounts.
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollRefCount = 0;

export const useSystemStore = create<SystemState>((set, get) => ({
  status: "loading",
  dbError: null,
  fetchStatus: async () => {
    try {
      const res = await fetch(`${BASE_PATH}/api/health/ready`, {
        credentials: "include",
      });
      const body = await res.clone().json().catch(() => null) as ReadyResponse | null;
      if (res.ok && body?.status === "ready") {
        set({ status: "ready", dbError: null });
        return;
      }
      if (res.status === 503) {
        set({ status: "db-error", dbError: body?.status ?? "db_unavailable" });
        return;
      }
      set({ status: "error", dbError: null });
    }
    catch {
      set({ status: "error", dbError: null });
    }
  },
  startPolling: () => {
    pollRefCount += 1;
    if (pollTimer)
      return;
    pollTimer = setInterval(() => void get().fetchStatus(), POLL_INTERVAL);
  },
  stopPolling: () => {
    if (pollRefCount > 0)
      pollRefCount -= 1;
    if (pollRefCount === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  },
}));

/**
 * Test-only: clear module-level polling state so vitest does not leak
 * timer/refcount across test files.
 */
export function __resetSystemPollingForTests(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  pollRefCount = 0;
}
