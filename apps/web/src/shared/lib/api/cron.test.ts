import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCronJob,
  deleteCronJob,
  listCronActions,
  listCronJobLogs,
  listCronJobs,
  pauseCronJob,
  resumeCronJob,
  triggerCronJob,
} from "./cron";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

function call(index = 0): [string, RequestInit | undefined] {
  const [url, init] = fetchMock.mock.calls[index]!;
  return [String(url), init];
}

describe("listCronJobs", () => {
  it("defaults to limit=100 with no filters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { jobs: [], hasMore: false, nextCursor: null } }));
    const jobs = await listCronJobs();
    expect(jobs).toEqual([]);
    const [url] = call();
    expect(url).toContain("/cron/jobs?");
    expect(url).toContain("limit=100");
    expect(url).not.toContain("deleted=");
    expect(url).not.toContain("lastStatus=");
    expect(url).not.toContain("taskType=");
  });

  it("serialises the status-filter pair and task type", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { jobs: [], hasMore: false, nextCursor: null } }));
    await listCronJobs({ deleted: "false", lastStatus: "failed", taskType: "backup" });
    const [url] = call();
    expect(url).toContain("deleted=false");
    expect(url).toContain("lastStatus=failed");
    expect(url).toContain("taskType=backup");
  });
});

describe("listCronActions", () => {
  it("returns the action catalog payload", async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      success: true,
      data: { actions: [], cronFormats: ["@every_1h"], schedulerEnabled: false },
    }));
    const data = await listCronActions();
    expect(call()[0]).toBe("/api/cron/actions");
    expect(data.schedulerEnabled).toBe(false);
    expect(data.cronFormats).toEqual(["@every_1h"]);
  });
});

describe("job lifecycle requests", () => {
  it("creates a job and unwraps the created row", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { id: "c1", name: "nightly" } }));
    const created = await createCronJob({ name: "nightly", cron: "@daily" });
    expect(created.name).toBe("nightly");
    const [url, init] = call();
    expect(url).toBe("/api/cron/jobs");
    expect(init?.method).toBe("POST");
  });

  it("hits the delete/pause/resume endpoints", async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ success: true }));
    await deleteCronJob("c1");
    await pauseCronJob("c1");
    await resumeCronJob("c1");
    expect(fetchMock.mock.calls.map(c => [String(c[0]), c[1]?.method])).toEqual([
      ["/api/cron/jobs/c1", "DELETE"],
      ["/api/cron/jobs/c1/pause", "POST"],
      ["/api/cron/jobs/c1/resume", "POST"],
    ]);
  });

  it("triggers a job and unwraps the trigger result", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { triggered: true, log: { status: "success" } } }));
    const res = await triggerCronJob("c1");
    expect(call()[0]).toBe("/api/cron/jobs/c1/trigger");
    expect(res.log?.status).toBe("success");
  });
});

describe("listCronJobLogs", () => {
  it("omits the status filter by default and unwraps the log rows", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { logs: [{ id: "l1" }] } }));
    const logs = await listCronJobLogs("c1");
    expect(logs).toEqual([{ id: "l1" }]);
    const [url] = call();
    expect(url).toContain("/cron/jobs/c1/logs?");
    expect(url).toContain("limit=100");
    expect(url).not.toContain("status=");
  });

  it("serialises the status filter", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: { logs: [] } }));
    await listCronJobLogs("c1", { status: "failed" });
    expect(call()[0]).toContain("status=failed");
  });
});
