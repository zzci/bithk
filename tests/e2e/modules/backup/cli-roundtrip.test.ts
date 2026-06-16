// Offline backup CLI export → import round-trip.
//
// The `backup:export` / `backup:import` subcommands run the archive
// service against a minimal offline runtime (open + migrated DB, file
// driver, no workers, no HTTP server — see `wireRuntime` in app.ts).
// This test walks the full offline cycle end-to-end:
//
//   1. spin up an isolated API instance against a SOURCE data dir —
//      plaintext DB and single-user mode keep this independent from the
//      orchestrator's dex (the fixture dex hard-codes the OAuth callback
//      to port 3010, so a test on another port must bypass OIDC).
//   2. log in via /api/account/auth/login-local to seed a real admin
//      user row; `seedSettingsFromEnv` already populated the settings
//      table at boot, so the source DB now has >=1 user and >=1 setting.
//   3. STOP the source API so the offline CLI owns the DB exclusively.
//   4. `bun src/index.ts backup:export <out>` against the SOURCE DB.
//   5. `bun src/index.ts backup:import <out> --include-users` against a
//      FRESH (empty) DB — merge mode (default) inserts every row, and
//      the CLI prints `inserted=<n>`.
//   6. open the FRESH DB directly and assert the admin user + settings
//      rows landed.
//
// Like restore.test.ts, this uses its own API subprocess on a DISTINCT
// port so it never touches the shared phase-B API session/users.

import type { Subprocess } from "bun";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ApiClient } from "../../lib/api";

const ROOT = resolve(import.meta.dir, "../../../..");
// Distinct from restore.test.ts (3413) so the two backup suites never
// collide if bun schedules them concurrently.
const API_PORT = 3414;
const BASE = `http://127.0.0.1:${API_PORT}/app`;
const USERNAME = "admin";
const PASSWORD = "backup-restore-e2e-password";
// `bun run hash-password backup-restore-e2e-password`. Same portable
// PBKDF2-SHA256 hash as restore.test.ts (identical password).
const PASSWORD_HASH = "pbkdf2-sha256$600000$bE2wkiPrapKItd2afr4+pg==$P38Ezm8djwdHI75CtieRYgDHRuSr38ESVZISCRBnY60=";

// Scrub anything the parent shell / orchestrator might have left in
// process.env that would override the explicit values below (mirrors
// restore.test.ts so orchestrator env can't leak into the subprocesses).
const SCRUB = new Set([
  "PORT",
  "DB_PATH",
  "DATA_DIR",
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

let api: Subprocess | null = null;
let sourceDir: string;
let targetDir: string;
let archiveDir: string;

const sourceDbPath = () => join(sourceDir, "app.db");
const targetDbPath = () => join(targetDir, "app.db");
const archivePath = () => join(archiveDir, "backup.archive");

// Minimal env that lets config.loadConfig() succeed offline: dev mode
// (no production sentinel/network guards), an absolute DB_PATH (key var
// per command), and DATA_DIR so file storage + backup staging stay in
// the temp dir. No PORT/HOST/APP_URL — those are server-only.
function cliEnv(dbPath: string, dataDir: string): Record<string, string> {
  return {
    ...cleanEnv,
    NODE_ENV: "development",
    BASE_PATH: "",
    DB_PATH: dbPath,
    DATA_DIR: dataDir,
    LOG_LEVEL: "warn",
    LOG_TO_STDOUT: "true",
  };
}

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCli(args: readonly string[], env: Record<string, string>): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "--env-file=/dev/null", "src/index.ts", ...args], {
    cwd: join(ROOT, "apps/api"),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  // consola routes success→stdout / error→stderr; capture both so the
  // assertion is robust to routing and failures are diagnosable.
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

// Build a rich source DB from the real seed dataset (same script as
// `bun run seed`), isolated to a temp dir. Lets the round-trip exercise every
// module's data — not just an admin + settings — so a backup-coverage gap shows
// up as lost rows.
async function runSeed(dbPath: string, dataDir: string): Promise<CliResult> {
  const proc = Bun.spawn(["bun", "--env-file=/dev/null", "scripts/seed/seed.ts"], {
    cwd: join(ROOT, "apps/api"),
    env: cliEnv(dbPath, dataDir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

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
  throw new Error(`cli-roundtrip API never came up at ${BASE}`);
}

beforeAll(async () => {
  sourceDir = mkdtempSync(join(tmpdir(), "cli-roundtrip-src-"));
  targetDir = mkdtempSync(join(tmpdir(), "cli-roundtrip-dst-"));
  archiveDir = mkdtempSync(join(tmpdir(), "cli-roundtrip-arc-"));
  api = Bun.spawn(["bun", "--env-file=/dev/null", "src/index.ts"], {
    cwd: join(ROOT, "apps/api"),
    env: {
      ...cleanEnv,
      NODE_ENV: "development",
      PORT: String(API_PORT),
      HOST: "127.0.0.1",
      BASE_PATH: "/app",
      DB_PATH: sourceDbPath(),
      DATA_DIR: sourceDir,
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
    try { await api.exited; }
    catch {}
    api = null;
  }
  for (const dir of [sourceDir, targetDir, archiveDir]) {
    if (dir)
      rmSync(dir, { recursive: true, force: true });
  }
});

describe("backup CLI export → import round-trip", () => {
  it("exports the source DB and imports it into a fresh DB via the offline CLI", async () => {
    // 1. Seed a real admin user into the SOURCE DB. Settings rows are
    //    already populated by seedSettingsFromEnv at boot.
    const admin = new ApiClient(BASE);
    const login = await admin.raw("/api/account/auth/login-local", {
      method: "POST",
      body: { username: USERNAME, password: PASSWORD },
    });
    expect(login.status).toBe(200);
    expect(admin.cookies.has("session_id")).toBe(true);

    // 2. Stop the source API so the offline CLI owns the DB exclusively
    //    (the running server holds the file).
    if (api) {
      api.kill();
      try { await api.exited; }
      catch {}
      api = null;
    }

    // 2b. Seed a ROOT drive entry whose `parent_entry_id` is the empty-string
    //     "no parent" sentinel. This locks FIX-041: the import id-shape
    //     validator used to reject "" on `*Id` fields, so any backup with a
    //     root drive entry failed to import. `created_by` FKs the seeded admin.
    const srcDb = new Database(sourceDbPath());
    try {
      const adminId = (srcDb.query("SELECT id FROM users WHERE username = ?").get(USERNAME) as { id: string }).id;
      const now = "2026-01-01T00:00:00.000Z";
      srcDb.run(
        "INSERT INTO drive_entries (id, owner_type, owner_id, parent_entry_id, entry_type, name, favorite, status, created_by, created_at, updated_at) "
        + "VALUES ('e2erootfolder', 'user', ?, '', 'folder', 'E2E Root', 0, 'normal', ?, ?, ?)",
        [adminId, adminId, now, now],
      );
    }
    finally {
      srcDb.close();
    }

    // 3. EXPORT the full source DB to an archive.
    const exportRes = await runCli(["backup:export", archivePath()], cliEnv(sourceDbPath(), sourceDir));
    expect(exportRes.exitCode, `export failed:\n${exportRes.stdout}\n${exportRes.stderr}`).toBe(0);
    expect(statSync(archivePath()).size).toBeGreaterThan(0);

    // 4. IMPORT the archive into a FRESH empty DB. The CLI calls createDb
    //    (migrates) for us — the target DB must not pre-exist. Default
    //    mode is merge, so every row inserts into the empty DB.
    const importRes = await runCli(
      ["backup:import", archivePath(), "--include-users"],
      cliEnv(targetDbPath(), targetDir),
    );
    expect(importRes.exitCode, `import failed:\n${importRes.stdout}\n${importRes.stderr}`).toBe(0);
    const out = `${importRes.stdout}\n${importRes.stderr}`;
    const inserted = /inserted=(\d+)/.exec(out);
    expect(inserted, `no inserted=<n> in CLI output:\n${out}`).not.toBeNull();
    expect(Number(inserted![1])).toBeGreaterThan(0);

    // 5. Open the FRESH DB directly and confirm the admin user + settings
    //    rows survived the round-trip.
    const db = new Database(targetDbPath(), { readonly: true });
    try {
      const userRow = db.query("SELECT count(*) AS c FROM users WHERE username = ?").get(USERNAME) as { c: number };
      const settingsRow = db.query("SELECT count(*) AS c FROM settings").get() as { c: number };
      expect(userRow.c).toBeGreaterThan(0);
      expect(settingsRow.c).toBeGreaterThan(0);
      // The root drive entry round-tripped with its empty-string sentinel intact (FIX-041).
      const driveRow = db.query("SELECT parent_entry_id AS p FROM drive_entries WHERE id = 'e2erootfolder'").get() as { p: string } | null;
      expect(driveRow, "root drive entry did not round-trip").not.toBeNull();
      expect(driveRow!.p).toBe("");
    }
    finally {
      db.close();
    }
  }, 60_000);

  it("round-trips the full seed dataset with no data loss across backed-up tables", async () => {
    const seedSrcDir = mkdtempSync(join(tmpdir(), "cli-rt-seed-src-"));
    const seedDstDir = mkdtempSync(join(tmpdir(), "cli-rt-seed-dst-"));
    const seedArchive = join(archiveDir, "seed-backup.archive");
    const srcDb = join(seedSrcDir, "app.db");
    const dstDb = join(seedDstDir, "app.db");
    try {
      // 1. Build a rich source DB from the real seed dataset (every module).
      const seeded = await runSeed(srcDb, seedSrcDir);
      expect(seeded.exitCode, `seed failed:\n${seeded.stdout}\n${seeded.stderr}`).toBe(0);

      // 2. EXPORT, then 3. IMPORT into a fresh empty DB.
      const exp = await runCli(["backup:export", seedArchive], cliEnv(srcDb, seedSrcDir));
      expect(exp.exitCode, `export failed:\n${exp.stdout}\n${exp.stderr}`).toBe(0);
      const imp = await runCli(["backup:import", seedArchive, "--include-users"], cliEnv(dstDb, seedDstDir));
      expect(imp.exitCode, `import failed:\n${imp.stdout}\n${imp.stderr}`).toBe(0);

      // 4. Every backed-up table must round-trip with identical row counts.
      //    These six carry logs / transient / security state and are
      //    deliberately excluded from a backup (audit history is not restored;
      //    the import writes its own audit row, and sessions/challenges/lockouts
      //    are runtime-only). Any OTHER table losing rows is a coverage gap.
      const EXCLUDED = new Set([
        "audit_events",
        "sessions",
        "auth_lockouts",
        "pkce_challenges",
        "totp_challenges",
        "user_totp_devices",
      ]);
      const src = new Database(srcDb, { readonly: true });
      const dst = new Database(dstDb, { readonly: true });
      try {
        const tables = (src
          .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name")
          .all() as { name: string }[]).map(r => r.name);
        const mismatches: string[] = [];
        let backedUp = 0;
        for (const name of tables) {
          if (EXCLUDED.has(name))
            continue;
          backedUp++;
          const a = (src.query(`SELECT count(*) AS c FROM "${name}"`).get() as { c: number }).c;
          const b = (dst.query(`SELECT count(*) AS c FROM "${name}"`).get() as { c: number }).c;
          if (a !== b)
            mismatches.push(`${name}: src=${a} dst=${b}`);
        }
        expect(mismatches, `tables lost data on round-trip:\n${mismatches.join("\n")}`).toEqual([]);
        // The dataset was genuinely rich, and the two formerly-uncovered tables
        // (global reference vocab + per-user pins) are now preserved.
        expect(backedUp).toBeGreaterThan(30);
        expect((dst.query("SELECT count(*) AS c FROM global_procurement_categories").get() as { c: number }).c).toBeGreaterThan(0);
        expect((dst.query("SELECT count(*) AS c FROM document_pins").get() as { c: number }).c).toBeGreaterThan(0);
      }
      finally {
        src.close();
        dst.close();
      }
    }
    finally {
      rmSync(seedSrcDir, { recursive: true, force: true });
      rmSync(seedDstDir, { recursive: true, force: true });
    }
  }, 120_000);
});
