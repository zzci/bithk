import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enSettings from "@/locales/en/settings.json";
import zhSettings from "@/locales/zh/settings.json";
import { renderWithProviders } from "@/test/utils";
import { BackupSettingsTab } from "./-settings-backup";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  fetchMock.mockReset();
});

// ─── Fixtures ─────────────────────────────────────────────────────────────

const MODULES = { modules: [{ name: "users", deps: [] }, { name: "files", deps: ["users"] }] };

const runningJob = {
  jobId: "job1",
  state: "running",
  blobsMode: "embedded",
  progress: { tablesDone: 1, tablesTotal: 4, blobBytesDone: 1024, blobBytesTotal: 4096 },
  error: null,
  archiveSize: null,
  artifacts: null,
};

const completedJob = {
  ...runningJob,
  state: "completed",
  progress: { tablesDone: 4, tablesTotal: 4, blobBytesDone: 4096, blobBytesTotal: 4096 },
  archiveSize: 2048,
  artifacts: { data: { size: 2048, downloaded: false } },
};

const completedSeparateJob = {
  ...completedJob,
  blobsMode: "separate",
  artifacts: {
    data: { size: 2048, downloaded: true },
    blobs: { size: 8192, downloaded: false },
  },
};

const dryRunReport = {
  dryRun: true,
  tables: {
    users: {
      inserted: 3,
      skippedDuplicate: 1,
      transformed: 0,
      droppedColumns: { legacy: 3 },
      defaultedColumns: {},
      failed: { total: 1, sample: [{ rowId: "u9", reason: "missing-parent" }] },
    },
  },
  skippedTables: ["old_table"],
  skippedModules: [],
  warnings: [],
  totals: { inserted: 3, skippedDuplicate: 1, failed: 1, transformed: 0 },
  blobs: { count: 2, existing: 1, missing: 1 },
};

const applyResult = {
  dryRun: false,
  mode: "merge",
  tables: dryRunReport.tables,
  skippedTables: [],
  skippedModules: [],
  warnings: [],
  totals: { inserted: 3, skippedDuplicate: 1, failed: 0, transformed: 0 },
  blobs: { written: 2, skippedExisting: 1, failed: 0, unreferenced: 0, missing: 1, expectedInSeparateArchive: 4 },
  reconcile: { checked: 5, quarantined: 0 },
};

const blobRestoreReport = {
  written: 6,
  skippedExisting: 2,
  failed: 0,
  unquarantined: 3,
  reconcile: { checked: 9, quarantined: 1 },
};

const validatedImportJob = { importId: "imp1", state: "validated", report: dryRunReport, result: null, error: null };

function routeFetch(opts: {
  exportJob?: () => unknown;
  importJob?: () => unknown;
  onApply?: () => void;
} = {}) {
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input).replace("/api", "");
    const method = init?.method ?? "GET";
    if (method === "GET" && path === "/backup/modules")
      return jsonResponse(MODULES);
    if (method === "POST" && path === "/backup/v2/exports")
      return jsonResponse({ jobId: "job1" }, { status: 202 });
    if (method === "GET" && path === "/backup/v2/exports/job1")
      return jsonResponse(opts.exportJob?.() ?? runningJob);
    if (method === "DELETE" && path === "/backup/v2/exports/job1")
      return jsonResponse({ success: true });
    if (method === "POST" && path === "/backup/v2/imports")
      return jsonResponse({ importId: "imp1", report: dryRunReport }, { status: 201 });
    if (method === "GET" && path === "/backup/v2/imports/imp1")
      return jsonResponse(opts.importJob?.() ?? validatedImportJob);
    if (method === "POST" && path === "/backup/v2/imports/imp1/apply") {
      opts.onApply?.();
      return jsonResponse({ importId: "imp1", state: "applying" }, { status: 202 });
    }
    if (method === "DELETE" && path === "/backup/v2/imports/imp1")
      return jsonResponse({ success: true });
    if (method === "POST" && path === "/backup/v2/blob-restores")
      return jsonResponse({ report: blobRestoreReport });
    return new Response("not found", { status: 404 });
  });
}

function fileInputs(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>("input[type=\"file\"]"));
}

function archiveFile(name = "backup.tar.gz"): File {
  return new File(["tar-gz-bytes"], name, { type: "application/gzip" });
}

let routeFetchDefault = () => routeFetch();

beforeEach(() => {
  routeFetchDefault = () => routeFetch();
});

async function uploadImportArchive() {
  routeFetchDefault();
  renderWithProviders(<BackupSettingsTab />);
  await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());
  await userEvent.upload(fileInputs()[0]!, archiveFile());
  await waitFor(() => expect(screen.getByText("Dry-run report (nothing has been written)")).toBeInTheDocument());
}

// ─── Export card ──────────────────────────────────────────────────────────

describe("backupSettingsTab — export", () => {
  it("renders the module list with dependency hints", async () => {
    routeFetch();

    renderWithProviders(<BackupSettingsTab />);

    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());
    expect(screen.getByText("files")).toBeInTheDocument();
    expect(screen.getByText("Depends on: users")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(c => String(c[0]) === "/api/backup/modules")).toBe(true);
  });

  it("starts an export job and shows polling progress with a cancel control", async () => {
    routeFetch({ exportJob: () => runningJob });

    renderWithProviders(<BackupSettingsTab />);
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Generate backup" }));

    const post = fetchMock.mock.calls.find(c => c[1]?.method === "POST" && String(c[0]) === "/api/backup/v2/exports");
    expect(post).toBeDefined();
    expect(JSON.parse(post![1]!.body as string)).toEqual({ modules: ["users", "files"], blobs: "embedded" });

    await waitFor(() => expect(screen.getByText("Generating backup…")).toBeInTheDocument());
    expect(screen.getByText("Tables: 1 / 4")).toBeInTheDocument();
    expect(screen.getByText(/Blob bytes:/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows the download link when the job completes", async () => {
    routeFetch({ exportJob: () => completedJob });

    renderWithProviders(<BackupSettingsTab />);
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Generate backup" }));

    const link = await screen.findByRole("link", { name: /Download archive/ });
    expect(link).toHaveAttribute("href", "/api/backup/v2/exports/job1/download?artifact=data");
    expect(screen.getByText("Backup ready")).toBeInTheDocument();
  });

  it("shows two download links with per-artifact state for a separate-mode job", async () => {
    routeFetch({ exportJob: () => completedSeparateJob });

    renderWithProviders(<BackupSettingsTab />);
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Generate backup" }));

    const dataLink = await screen.findByRole("link", { name: /Download data archive/ });
    expect(dataLink).toHaveAttribute("href", "/api/backup/v2/exports/job1/download?artifact=data");
    const blobsLink = screen.getByRole("link", { name: /Download blobs archive/ });
    expect(blobsLink).toHaveAttribute("href", "/api/backup/v2/exports/job1/download?artifact=blobs");
    // The data artifact has already been downloaded; the blobs one has not.
    expect(screen.getAllByText("Downloaded")).toHaveLength(1);
  });
});

// ─── Import card ──────────────────────────────────────────────────────────

describe("backupSettingsTab — import", () => {
  it("uploads an archive and renders the dry-run report with failures", async () => {
    await uploadImportArchive();

    expect(screen.getByText("Rows to insert")).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getByText("old_table")).toBeInTheDocument();
    expect(screen.getByText("In archive")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show detail" }));
    expect(screen.getByText("Missing parent row", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/legacy \(3\)/)).toBeInTheDocument();
  });

  it("gates apply behind the confirm dialog and renders the final result", async () => {
    let applied = false;
    routeFetchDefault = () => routeFetch({
      importJob: () => applied
        ? { ...validatedImportJob, state: "completed", result: applyResult }
        : validatedImportJob,
      onApply: () => { applied = true; },
    });
    await uploadImportArchive();

    await userEvent.click(screen.getByRole("button", { name: "Apply import" }));
    expect(screen.getByText("Apply this import?")).toBeInTheDocument();
    // No apply request before the explicit confirm.
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith("/apply"))).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      const apply = fetchMock.mock.calls.find(c => String(c[0]) === "/api/backup/v2/imports/imp1/apply");
      expect(apply).toBeDefined();
      expect(JSON.parse(apply![1]!.body as string)).toEqual({ mode: "merge" });
    });

    await waitFor(() => expect(screen.getByText("Import result")).toBeInTheDocument());
    // R7: expected-in-separate-archive is reported distinctly from missing.
    expect(screen.getByText("Expected in separate blobs archive")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("requires the destructive type-to-confirm for replace mode and sends includeUsers", async () => {
    await uploadImportArchive();

    await userEvent.click(screen.getByRole("button", { name: "Apply import" }));
    await userEvent.click(screen.getByRole("radio", { name: /Replace — delete live tables/ }));

    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(confirm).toBeDisabled();

    await userEvent.click(screen.getByRole("switch", { name: "Also replace users and groups" }));
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Type replace to confirm"), "replace");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => {
      const apply = fetchMock.mock.calls.find(c => String(c[0]) === "/api/backup/v2/imports/imp1/apply");
      expect(apply).toBeDefined();
      expect(JSON.parse(apply![1]!.body as string)).toEqual({ mode: "replace", includeUsers: true });
    });
  });

  it("restores a standalone blobs archive and renders its report", async () => {
    routeFetch();

    renderWithProviders(<BackupSettingsTab />);
    await waitFor(() => expect(screen.getByText("users")).toBeInTheDocument());

    const inputs = fileInputs();
    await userEvent.upload(inputs[inputs.length - 1]!, archiveFile("blobs.tar.gz"));

    await waitFor(() => expect(screen.getByText("Blob restore result")).toBeInTheDocument());
    expect(fetchMock.mock.calls.some(c => String(c[0]) === "/api/backup/v2/blob-restores")).toBe(true);
    expect(screen.getByText("Un-quarantined")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();
  });
});

// ─── i18n ─────────────────────────────────────────────────────────────────

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null)
    return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k));
}

describe("backupSettingsTab — i18n", () => {
  it("keeps settings:backup.* keys in parity between en and zh", () => {
    const en = (enSettings as Record<string, unknown>).backup;
    const zh = (zhSettings as Record<string, unknown>).backup;
    expect(en).toBeDefined();
    expect(zh).toBeDefined();
    expect(flattenKeys(zh).sort()).toEqual(flattenKeys(en).sort());
    expect((enSettings as { tabs: Record<string, string> }).tabs.backup).toBe("Backup");
    expect((zhSettings as { tabs: Record<string, string> }).tabs.backup).toBeDefined();
  });
});
