import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { AppEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { fileReferences, files } from "@/modules/file/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { policyMiddleware } from "@/modules/policy";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { driveRoutes } from "./drive.routes";
import {
  createDriveFolder,
  deleteDriveEntryPermanently,
  listDriveEntries,
  restoreDriveEntry,
  trashDriveEntry,
  updateDriveEntry,
  uploadDriveFile,
} from "./drive.service";
import { addTeamMember, createTeamDirectory } from "./drive.team-directory.service";
import { driveEntries } from "./schema";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;
let storageRoot: string;

type DriveTestConfig = Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES" | "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS">;

const config: DriveTestConfig = {
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  MAX_ATTACHMENTS_PER_RESOURCE: 20,
  UPLOADS_TOTAL_BYTES: 0,
  FILE_GC_MODE: "sync",
  FILE_PRESIGN_ENABLED: false,
  FILE_PRESIGN_TTL_SECONDS: 300,
};

async function seedUser(name = "Alice") {
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

function textFile(name: string, body = "hello"): File {
  return new File([body], name, { type: "text/plain" });
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-drive-${Date.now()}-${nanoid()}`);
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

function personal(userId: string) {
  return { ownerType: "user" as const, ownerId: userId };
}

describe("drive folders", () => {
  test("creates and lists root folders", async () => {
    const userId = await seedUser();
    const folder = await createDriveFolder(db, {
      ...personal(userId),
      createdBy: userId,
      name: "Projects",
    });

    expect(folder.id).toHaveLength(8);
    expect(folder.type).toBe("folder");
    expect(folder.parentEntryId).toBeNull();

    const entries = await listDriveEntries(db, { ...personal(userId) });
    expect(entries.map(entry => entry.name)).toEqual(["Projects"]);
  });

  test("rejects duplicate names in the same folder", async () => {
    const userId = await seedUser();
    await createDriveFolder(db, { ...personal(userId), createdBy: userId, name: "Projects" });
    await expect(createDriveFolder(db, {
      ...personal(userId),
      createdBy: userId,
      name: "Projects",
    })).rejects.toThrow(/already exists/i);
  });

  test("prevents moving a folder into its descendant", async () => {
    const userId = await seedUser();
    const parent = await createDriveFolder(db, { ...personal(userId), createdBy: userId, name: "Parent" });
    const child = await createDriveFolder(db, {
      ...personal(userId),
      createdBy: userId,
      parentEntryId: parent.id,
      name: "Child",
    });

    await expect(updateDriveEntry(db, {
      ...personal(userId),
      id: parent.id,
      parentEntryId: child.id,
    })).rejects.toThrow(/descendant/i);
  });
});

describe("drive files", () => {
  test("uploads a file entry and releases its blob on permanent delete", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, {
      ...personal(userId),
      createdBy: userId,
      file: textFile("note.txt", "body"),
    });

    expect(entry.type).toBe("file");
    expect(entry.file?.filename).toBe("note.txt");
    expect(entry.file?.size).toBe(4);

    await deleteDriveEntryPermanently(db, config, personal(userId), entry.id);

    const entryCount = await db.select({ value: count() }).from(driveEntries).get();
    const refCount = await db.select({ value: count() }).from(fileReferences).get();
    const fileCount = await db.select({ value: count() }).from(files).get();
    expect(entryCount?.value).toBe(0);
    expect(refCount?.value).toBe(0);
    expect(fileCount?.value).toBe(0);
  });

  test("trashes folder trees recursively", async () => {
    const userId = await seedUser();
    const folder = await createDriveFolder(db, { ...personal(userId), createdBy: userId, name: "Folder" });
    await uploadDriveFile(db, config, {
      ...personal(userId),
      createdBy: userId,
      parentEntryId: folder.id,
      file: textFile("child.txt"),
    });

    await trashDriveEntry(db, personal(userId), folder.id);

    const normal = await listDriveEntries(db, { ...personal(userId) });
    const trash = await listDriveEntries(db, { ...personal(userId), status: "trash" });
    expect(normal).toHaveLength(0);
    expect(trash).toHaveLength(1);
    expect(trash[0]?.name).toBe("Folder");
  });

  test("restore rolls back when moving out of a trashed parent would duplicate a root name", async () => {
    const userId = await seedUser();
    await createDriveFolder(db, { ...personal(userId), createdBy: userId, name: "Child" });
    const parent = await createDriveFolder(db, { ...personal(userId), createdBy: userId, name: "Parent" });
    const child = await createDriveFolder(db, {
      ...personal(userId),
      createdBy: userId,
      parentEntryId: parent.id,
      name: "Child",
    });
    await trashDriveEntry(db, personal(userId), parent.id);

    await expect(restoreDriveEntry(db, personal(userId), child.id)).rejects.toThrow(/already exists/i);

    const trashRoot = await listDriveEntries(db, { ...personal(userId), status: "trash" });
    expect(trashRoot.map(entry => entry.name)).toEqual(["Parent"]);
    const normalRoot = await listDriveEntries(db, { ...personal(userId) });
    expect(normalRoot.map(entry => entry.name)).toEqual(["Child"]);
  });
});

describe("GET /drive/entries owner scope", () => {
  // Pre-set `user` from an `x-uid` header so the route's `authRequired` and
  // the global `policyMiddleware` both short-circuit on `c.get("user")` —
  // this avoids mutating the process-global auth provider (which would leak
  // into other test files).
  function buildApp() {
    const noopLogger = { error() {}, warn() {}, info() {}, debug() {} } as unknown as AppEnv["Variables"]["logger"];
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      c.set("logger", noopLogger);
      c.set("requestId", "t");
      const uid = c.req.header("x-uid");
      if (uid) {
        const u = await db.select().from(users).where(eq(users.id, uid)).get();
        if (u)
          c.set("user", u);
      }
      await next();
    });
    app.use("*", policyMiddleware({ basePath: "" }));
    app.route("/", driveRoutes());
    app.onError((err, c) => {
      const status = (err as { statusCode?: number }).statusCode ?? 500;
      return c.json({ success: false }, status as 400);
    });
    return app;
  }

  test("a directory member can list the directory's entries; a non-member is denied", async () => {
    const ownerId = await seedUser("Owner");
    const memberId = await seedUser("Member");
    const strangerId = await seedUser("Stranger");

    const dir = await createTeamDirectory(db, { name: "Team", createdBy: ownerId });
    await addTeamMember(db, dir.id, ownerId, { userId: memberId, role: "viewer" });
    await createDriveFolder(db, {
      ownerType: "team_directory",
      ownerId: dir.id,
      createdBy: ownerId,
      name: "Shared",
    });

    const app = buildApp();
    const path = `/drive/entries?ownerType=team_directory&ownerId=${dir.id}`;

    const memberRes = await app.request(path, { headers: { "x-uid": memberId } });
    expect(memberRes.status).toBe(200);
    expect((await memberRes.json()).data.map((e: { name: string }) => e.name)).toEqual(["Shared"]);

    const strangerRes = await app.request(path, { headers: { "x-uid": strangerId } });
    expect(strangerRes.status).toBe(403);
  });

  test("ownerType=user ignores a foreign ownerId and stays scoped to the caller", async () => {
    const callerId = await seedUser("Caller");
    const otherId = await seedUser("Other");

    await createDriveFolder(db, { ...personal(callerId), createdBy: callerId, name: "Mine" });
    const app = buildApp();

    const own = await app.request("/drive/entries", { headers: { "x-uid": callerId } });
    expect(own.status).toBe(200);
    expect((await own.json()).data.map((e: { name: string }) => e.name)).toEqual(["Mine"]);

    const foreign = await app.request(`/drive/entries?ownerId=${otherId}`, { headers: { "x-uid": callerId } });
    expect(foreign.status).toBe(403);
  });
});
