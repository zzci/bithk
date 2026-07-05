import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "@/db";
import { driveEntryFilePermissionHook } from "@/modules/drive/drive.file-permission";
import { uploadDriveFile } from "@/modules/drive/drive.service";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { mountRoutes, sessionCookieFor, testConfig, testNanoid } from "@/shared/test/route-harness";
import { fileRoutes } from "./file.routes";
import { registerFilePermissionHook } from "./permission";
import { fileReferences } from "./schema";
import { __setLocalDriverRootForTests } from "./storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "./storage/registry";
// Side-effect import: register the auth provider so the session cookie
// resolves to an actor.
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

// Local driver streams bytes directly when presign is disabled, so the content
// route returns a 200 with real Content-Disposition / Content-Type headers we
// can assert on (a 302 redirect otherwise).
const config = testConfig({ FILE_PRESIGN_ENABLED: false });

function buildApp() {
  return mountRoutes(db, [fileRoutes], config);
}

/** Upload a personally-owned drive file for `userId`; return its file + ref ids. */
async function uploadOwnedFile(userId: string, file: File) {
  const entry = await uploadDriveFile(db, config, {
    ownerType: "user",
    ownerId: userId,
    createdBy: userId,
    file,
  });
  const ref = (await db
    .select()
    .from(fileReferences)
    .where(and(eq(fileReferences.ownerType, "drive_entry"), eq(fileReferences.ownerId, entry.id)))
    .get())!;
  return { fileId: ref.fileId, refId: ref.id };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-file-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
  loadNamespaces();
  // Re-register the drive_entry hook every time: other suites clear the
  // shared registry via `__resetFilePermissionHooksForTests`, so we cannot
  // rely on the module-load side-effect surviving across files.
  registerFilePermissionHook("drive_entry", driveEntryFilePermissionHook);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("GET /files/:id/metadata", () => {
  test("401 without a session", async () => {
    const res = await buildApp().request("/files/whatever/metadata?ref=whatever");
    expect(res.status).toBe(401);
  });

  test("owner gets the file metadata", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    const { fileId, refId } = await uploadOwnedFile(userId, new File(["hello"], "doc.txt", { type: "text/plain" }));
    const res = await buildApp().request(`/files/${fileId}/metadata?ref=${refId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { id: string; filename: string; ownerType: string } };
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(fileId);
    expect(body.data.filename).toBe("doc.txt");
    expect(body.data.ownerType).toBe("drive_entry");
  });

  test("non-owner is 404 (existence hidden)", async () => {
    const { userId } = await sessionCookieFor(db, "user");
    const { fileId, refId } = await uploadOwnedFile(userId, new File(["hello"], "doc.txt", { type: "text/plain" }));
    const stranger = await sessionCookieFor(db, "user");
    const res = await buildApp().request(`/files/${fileId}/metadata?ref=${refId}`, { headers: { Cookie: stranger.cookie } });
    expect(res.status).toBe(404);
  });

  test("404 when the ref query is missing", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request(`/files/some-id/metadata`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("404 when the ref points at a different file id", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    const { refId } = await uploadOwnedFile(userId, new File(["hello"], "doc.txt", { type: "text/plain" }));
    const res = await buildApp().request(`/files/not-the-right-file/metadata?ref=${refId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});

describe("GET /files/:id/content", () => {
  test("401 without a session", async () => {
    const res = await buildApp().request("/files/whatever/content?ref=whatever");
    expect(res.status).toBe(401);
  });

  test("owner downloads as an attachment by default", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    const { fileId, refId } = await uploadOwnedFile(userId, new File(["hello world"], "doc.txt", { type: "text/plain" }));
    const res = await buildApp().request(`/files/${fileId}/content?ref=${refId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    // text/* is never inlined — forced to a generic octet-stream download.
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    expect(await res.text()).toBe("hello world");
  });

  test("?inline=true serves an inline-safe image inline", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    const { fileId, refId } = await uploadOwnedFile(userId, new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], "pic.png", { type: "image/png" }));
    const res = await buildApp().request(`/files/${fileId}/content?ref=${refId}&inline=true`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Content-Disposition")).toContain("inline");
  });

  test("non-owner is 404 (existence hidden)", async () => {
    const { userId } = await sessionCookieFor(db, "user");
    const { fileId, refId } = await uploadOwnedFile(userId, new File(["secret"], "doc.txt", { type: "text/plain" }));
    const stranger = await sessionCookieFor(db, "user");
    const res = await buildApp().request(`/files/${fileId}/content?ref=${refId}`, { headers: { Cookie: stranger.cookie } });
    expect(res.status).toBe(404);
  });

  test("404 when the ref query is missing", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const res = await buildApp().request(`/files/some-id/content`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});

// ─── Quarantined rows (FIX-062) ───────────────────────────────────────────

describe("quarantined files serve 404 FILE_CONTENT_UNAVAILABLE, never 500", () => {
  async function quarantine(fileId: string): Promise<void> {
    await db.run(sql`
      UPDATE files SET storage_driver = 'quarantined:backup-restore-missing-blob' WHERE id = ${fileId}
    `);
  }

  test("content download", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    const { fileId, refId } = await uploadOwnedFile(userId, new File(["hello"], "doc.txt", { type: "text/plain" }));
    await quarantine(fileId);
    const res = await buildApp().request(`/files/${fileId}/content?ref=${refId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("FILE_CONTENT_UNAVAILABLE");
  });

  test("metadata", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    const { fileId, refId } = await uploadOwnedFile(userId, new File(["hello"], "doc.txt", { type: "text/plain" }));
    await quarantine(fileId);
    const res = await buildApp().request(`/files/${fileId}/metadata?ref=${refId}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("FILE_CONTENT_UNAVAILABLE");
  });

  test("inline thumbnail request", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    const { fileId, refId } = await uploadOwnedFile(userId, new File([new Uint8Array([0x89, 0x50, 0x4E, 0x47])], "pic.png", { type: "image/png" }));
    await quarantine(fileId);
    const res = await buildApp().request(`/files/${fileId}/content?ref=${refId}&inline=true&thumb=320`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
    expect((await res.json() as { error: { code: string } }).error.code).toBe("FILE_CONTENT_UNAVAILABLE");
  });
});
