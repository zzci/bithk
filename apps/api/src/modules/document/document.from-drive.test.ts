// Route test for POST /documents/:id/attachments/from-drive — attaching an
// already-stored drive file to a document by reference (no blob re-upload).
// Mirrors the harness in document.test.ts but adds the local storage driver
// because `uploadDriveFile` writes a real blob.

import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import type { AppEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { createSession } from "@/modules/account/auth/auth.service";
import { users } from "@/modules/account/users/schema";
import { uploadDriveFile } from "@/modules/drive/drive.service";
import { fileReferences, files } from "@/modules/file/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { errorHandler } from "@/shared/middleware/error-handler";
import { documentRoutes } from "./document.routes";
import { createDocument } from "./document.service";
import "@/modules/account";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;
let storageRoot: string;

async function seedUser(name: string) {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `${name.toLowerCase()}-${id}`,
    name,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
} as unknown as Logger;

function baseConfig(): Config {
  return {
    NODE_ENV: "test",
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
    MAX_ATTACHMENTS_PER_RESOURCE: 20,
    UPLOADS_TOTAL_BYTES: 0,
    FILE_GC_MODE: "sync",
    FILE_PRESIGN_ENABLED: false,
    FILE_PRESIGN_TTL_SECONDS: 300,
  } as unknown as Config;
}

function buildDocumentApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("config", baseConfig());
    c.set("logger", noopLogger);
    await next();
  });
  app.route("/", documentRoutes());
  app.onError(errorHandler);
  return app;
}

async function sessionCookieFor(userId: string): Promise<string> {
  const sessionId = await createSession(db, userId, "test-access-token", undefined, 3600);
  return `session_id=${sessionId}`;
}

function textFile(name: string, body = "drive-body"): File {
  return new File([body], name, { type: "text/plain" });
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-document-fromdrive-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  storageRoot = resolve(dir, "blobs");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(storageRoot);
  setActiveDriver("local");
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("POST /documents/:id/attachments/from-drive", () => {
  test("attaches an owned drive file: 201, new reference, blob refcount bumped, no new blob", async () => {
    const actor = await seedUser("Alice");
    const doc = await createDocument(db, { title: "Spec", creatorId: actor });
    const entry = await uploadDriveFile(db, baseConfig(), {
      ownerType: "user",
      ownerId: actor,
      createdBy: actor,
      file: textFile("report.txt"),
    });
    const fileId = entry.file!.fileId;

    const blobsBefore = (await db.select({ value: count() }).from(files).get())!.value;
    const refsBefore = (await db.select({ value: count() }).from(fileReferences).get())!.value;
    const fileBefore = (await db.select().from(files).where(eq(files.id, fileId)).get())!;
    expect(fileBefore.refCount).toBe(1);

    const app = buildDocumentApp();
    const res = await app.request(`/documents/${doc.id}/attachments/from-drive`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": await sessionCookieFor(actor),
      },
      body: JSON.stringify({ entryId: entry.id }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { data: { id: string; fileId: string; ownerType: string; filename: string } };
    expect(body.data.fileId).toBe(fileId);
    expect(body.data.ownerType).toBe("item_attachment");
    expect(body.data.filename).toBe("report.txt");

    // No new blob row — the same content was referenced, not re-uploaded.
    const blobsAfter = (await db.select({ value: count() }).from(files).get())!.value;
    expect(blobsAfter).toBe(blobsBefore);

    // Exactly one new file_reference (the item_attachment), refcount bumped to 2.
    const refsAfter = (await db.select({ value: count() }).from(fileReferences).get())!.value;
    expect(refsAfter).toBe(refsBefore + 1);
    const fileAfter = (await db.select().from(files).where(eq(files.id, fileId)).get())!;
    expect(fileAfter.refCount).toBe(2);

    const attachmentRefs = (await db.select({ value: count() })
      .from(fileReferences)
      .where(and(eq(fileReferences.fileId, fileId), eq(fileReferences.ownerType, "item_attachment")))
      .get())!.value;
    expect(attachmentRefs).toBe(1);
  });

  test("entry the actor cannot read: 404/403 and no reference added", async () => {
    const actor = await seedUser("Alice");
    const stranger = await seedUser("Bob");
    const doc = await createDocument(db, { title: "Spec", creatorId: actor });
    // The drive entry is owned by Bob; Alice has no access relationship to it.
    const entry = await uploadDriveFile(db, baseConfig(), {
      ownerType: "user",
      ownerId: stranger,
      createdBy: stranger,
      file: textFile("secret.txt"),
    });

    const refsBefore = (await db.select({ value: count() }).from(fileReferences).get())!.value;

    const app = buildDocumentApp();
    const res = await app.request(`/documents/${doc.id}/attachments/from-drive`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cookie": await sessionCookieFor(actor),
      },
      body: JSON.stringify({ entryId: entry.id }),
    });

    expect([403, 404]).toContain(res.status);
    const refsAfter = (await db.select({ value: count() }).from(fileReferences).get())!.value;
    expect(refsAfter).toBe(refsBefore);
  });
});
