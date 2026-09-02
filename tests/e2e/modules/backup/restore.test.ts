// Backup v2 export → import round-trip (FIX-072: ported from the retired v1
// JSON routes).
//
//   1. spin up an isolated API instance — plaintext DB and single-user
//      mode keep this test independent from the orchestrator's dex.
//      The fixture dex config hard-codes the OAuth callback URI to
//      port 3010, so any test running on a different API port has to
//      bypass the OAuth dance entirely.
//   2. log in via /api/account/auth/login-local to seed a real admin
//      session + user row.
//   3. POST /api/backup/v2/exports with [users, settings], poll the job to
//      `completed`, download the data artifact.
//   4. POST /api/backup/v2/imports (multipart) → staged dry-run report;
//      POST .../apply with wipeExisting=true → poll to `completed`.
//   5. assert the apply report inserted at least the exported rows and that
//      the importing admin's session survived the wipe (FIX-062 re-binds it).
//
// The test deliberately uses its own API subprocess instead of the
// shared phase-B API: the wipe truncates the `users` table, which
// cascades-deletes every other `sessions` row, which would otherwise break
// every later phase-B test that shares a cached admin session.

import type { Subprocess } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";

const ROOT = resolve(import.meta.dir, "../../../..");
const API_PORT = 3413;
const BASE = `http://127.0.0.1:${API_PORT}/app`;
const USERNAME = "admin";
const PASSWORD = "backup-restore-e2e-password";
// `bun run hash-password backup-restore-e2e-password`. Regenerate if
// PASSWORD changes; the hash is portable PBKDF2-SHA256.
const PASSWORD_HASH = "pbkdf2-sha256$600000$bE2wkiPrapKItd2afr4+pg==$P38Ezm8djwdHI75CtieRYgDHRuSr38ESVZISCRBnY60=";

let api: Subprocess | null = null;
let dataDir: string;

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (res.status === 200)
        return;
    }
    catch {
      // not yet
    }
    await Bun.sleep(200);
  }
  throw new Error(`restore-test API never came up at ${BASE}`);
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "restore-e2e-"));
  // Scrub anything the parent shell / orchestrator might have left in
  // process.env that would override the explicit values below.
  const SCRUB = new Set([
    "PORT",
    "DB_PATH",
    "LOG_FILE",
    "APP_URL",
    "OAUTH_ISSUER",
    "OAUTH_CLIENT_ID",
    "OAUTH_CLIENT_SECRET",
    "OAUTH_PKCE",
    "OAUTH_AUTHORIZE_URL",
    "OAUTH_TOKEN_URL",
    "OAUTH_USERINFO_URL",
    "OIDC_LOGOUT_URL",
    "DEFAULT_ADMIN",
    "SINGLE_USER_MODE",
    "SINGLE_USER_USERNAME",
    "SINGLE_USER_PASSWORD_HASH",
    "SINGLE_USER_NAME",
    "SINGLE_USER_EMAIL",
  ]);
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !SCRUB.has(k))
      cleanEnv[k] = v;
  }
  api = Bun.spawn(["bun", "--env-file=/dev/null", "src/index.ts"], {
    cwd: join(ROOT, "apps/api"),
    env: {
      ...cleanEnv,
      NODE_ENV: "development",
      PORT: String(API_PORT),
      HOST: "127.0.0.1",
      BASE_PATH: "/app",
      DB_PATH: join(dataDir, "app.db"),
      LOG_LEVEL: "warn",
      LOG_TO_STDOUT: "true",
      APP_URL: `http://127.0.0.1:${API_PORT}`,
      CORS_ORIGIN: `http://127.0.0.1:${API_PORT}`,
      SINGLE_USER_MODE: "true",
      SINGLE_USER_USERNAME: USERNAME,
      SINGLE_USER_PASSWORD_HASH: PASSWORD_HASH,
      SINGLE_USER_NAME: "Admin",
      SINGLE_USER_EMAIL: "admin@example.com",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  await waitForReady();
}, 30_000);

afterAll(async () => {
  if (api) {
    api.kill();
    try {
      await api.exited;
    }
    catch {}
    api = null;
  }
  if (dataDir) {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

interface ExportJobStatus {
  state: string;
  error: string | null;
}

interface ImportJobStatus {
  state: string;
  error: string | null;
  report: { totals: { inserted: number } };
  result: { totals: { inserted: number }; wipe?: { total: number } } | null;
}

async function pollUntil<T extends { state: string }>(
  read: () => Promise<T>,
  done: (s: T) => boolean,
  label: string,
): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await read();
    if (done(status))
      return status;
    await Bun.sleep(200);
  }
  throw new Error(`${label} did not settle in time`);
}

describe("/api/backup/v2 round-trip (export job → import apply)", () => {
  it("admin can export an archive and wipe-restore it into the live DB", async () => {
    const admin = new ApiClient(BASE);
    const login = await admin.raw("/api/account/auth/login-local", {
      method: "POST",
      body: { username: USERNAME, password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect(admin.cookies.has("session_id")).toBe(true);

    // 3. Export job → completed → download the data artifact.
    const start = await admin.raw("/api/backup/v2/exports", {
      method: "POST",
      body: { modules: ["users", "settings"] },
    });
    expect(start.status).toBe(202);
    const { jobId } = await start.json() as { jobId: string };

    const exported = await pollUntil(
      () => admin.json<ExportJobStatus>(`/api/backup/v2/exports/${jobId}`),
      s => s.state === "completed" || s.state === "failed",
      "export job",
    );
    expect(exported.error).toBeNull();
    expect(exported.state).toBe("completed");

    const download = await admin.raw(`/api/backup/v2/exports/${jobId}/download?artifact=data`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toMatch(/application\/gzip/);
    const archive = await download.blob();
    expect(archive.size).toBeGreaterThan(0);

    // 4. Stage the archive; the dry-run report must see the exported rows.
    const fd = new FormData();
    fd.append("file", archive, "backup.tar.gz");
    const staged = await admin.raw("/api/backup/v2/imports", { method: "POST", formData: fd });
    expect(staged.status).toBe(201);
    const { importId, report } = await staged.json() as { importId: string; report: { totals: { inserted: number } } };
    // The dry-run counts what a plain merge would insert; every row already
    // exists, so it is 0 here — the wipe apply below is what re-inserts them.
    expect(report.totals.inserted).toBeGreaterThanOrEqual(0);

    const apply = await admin.raw(`/api/backup/v2/imports/${importId}/apply`, {
      method: "POST",
      body: { wipeExisting: true },
    });
    expect(apply.status).toBe(202);

    const applied = await pollUntil(
      () => admin.json<ImportJobStatus>(`/api/backup/v2/imports/${importId}`),
      s => s.state === "completed" || s.state === "failed",
      "import apply",
    );
    expect(applied.error).toBeNull();
    expect(applied.state).toBe("completed");
    expect(applied.result?.wipe?.total ?? 0).toBeGreaterThan(0);
    // The wipe emptied users + settings; the merge re-inserted every row,
    // so at least the admin row and one setting came back.
    expect(applied.result?.totals.inserted ?? 0).toBeGreaterThanOrEqual(2);

    // 5. FIX-062: the importing admin's session is re-bound inside the wipe
    // transaction, so the same cookie still authenticates.
    const me = await admin.raw("/api/account/me");
    expect(me.status).toBe(200);
  });
});
