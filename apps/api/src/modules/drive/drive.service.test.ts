import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { count, eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { audit } from "@/modules/audit/audit.service";
import { auditEvents } from "@/modules/audit/schema";
import { fileReferences, files } from "@/modules/file/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import {
  buildDriveEntryDownloadResponse,
  createDriveFolder,
  createDriveTextFile,
  emptyDriveTrash,
  getDriveEntry,
  getDriveEntryById,
  getEntryOwner,
  listFavoriteDriveEntries,
  listRecentDriveEntries,
  restoreDriveEntry,
  trashDriveEntry,
  updateDriveEntry,
  uploadDriveFile,
} from "./drive.service";
import { createTeamDirectory } from "./drive.team-directory.service";
import { driveEntries } from "./schema";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

const config: Pick<Config, "MAX_UPLOAD_BYTES" | "MAX_ATTACHMENTS_PER_RESOURCE" | "UPLOADS_TOTAL_BYTES" | "FILE_GC_MODE" | "FILE_PRESIGN_ENABLED" | "FILE_PRESIGN_TTL_SECONDS"> = {
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

function personal(userId: string) {
  return { ownerType: "user" as const, ownerId: userId };
}

const stubLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  flush: () => {},
} as unknown as Logger;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-drive-service-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("getDriveEntry / getDriveEntryById / getEntryOwner", () => {
  test("scoped lookup respects owner; by-id is owner-agnostic; owner resolves", async () => {
    const owner = await seedUser("Owner");
    const other = await seedUser("Other");
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("a.txt", "body") });

    const scoped = await getDriveEntry(db, personal(owner), file.id);
    expect(scoped?.file?.filename).toBe("a.txt");
    expect(await getDriveEntry(db, personal(other), file.id)).toBeUndefined();

    const byId = await getDriveEntryById(db, file.id);
    expect(byId?.id).toBe(file.id);

    expect(await getEntryOwner(db, file.id)).toEqual(personal(owner));
    await expect(getEntryOwner(db, "missing")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("listRecentDriveEntries", () => {
  test("returns only files, newest-updated first", async () => {
    const owner = await seedUser("Owner");
    await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "folder" });
    const f1 = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("first.txt") });
    const f2 = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("second.txt") });
    // Bump f1 so it sorts ahead of f2.
    await updateDriveEntry(db, { ...personal(owner), id: f1.id, favorite: true });

    const recent = await listRecentDriveEntries(db, owner);
    expect(recent.every(e => e.type === "file")).toBe(true);
    expect(recent.map(e => e.id)).toEqual([f1.id, f2.id]);
  });
});

describe("listFavoriteDriveEntries", () => {
  test("returns only favorited, normal-status entries", async () => {
    const owner = await seedUser("Owner");
    const fav = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("fav.txt") });
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("plain.txt") });
    await updateDriveEntry(db, { ...personal(owner), id: fav.id, favorite: true });

    const favorites = await listFavoriteDriveEntries(db, owner);
    expect(favorites.map(e => e.id)).toEqual([fav.id]);
    expect(favorites[0]!.favorite).toBe(true);
  });
});

describe("updateDriveEntry", () => {
  test("renames and toggles favorite", async () => {
    const owner = await seedUser("Owner");
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("old.txt") });
    const renamed = await updateDriveEntry(db, { ...personal(owner), id: file.id, name: "new.txt", favorite: true });
    expect(renamed.name).toBe("new.txt");
    expect(renamed.favorite).toBe(true);
  });

  test("rejects renaming onto a sibling's name", async () => {
    const owner = await seedUser("Owner");
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("taken.txt") });
    const other = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("free.txt") });
    await expect(updateDriveEntry(db, { ...personal(owner), id: other.id, name: "taken.txt" })).rejects.toMatchObject({ code: "DUPLICATE_NAME" });
  });
});

describe("createDriveTextFile", () => {
  test("persists a text/plain file entry with v1", async () => {
    const owner = await seedUser("Owner");
    const entry = await createDriveTextFile(db, config, { ...personal(owner), createdBy: owner, name: "notes.txt", content: "line one\nline two" });
    expect(entry.type).toBe("file");
    expect(entry.file?.mimetype).toMatch(/^text\/plain/);
    expect(entry.file?.size).toBe("line one\nline two".length);
  });
});

describe("emptyDriveTrash", () => {
  test("purges every trashed entry and releases their blobs in bulk", async () => {
    const owner = await seedUser("Owner");
    const a = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("a.txt", "aaa") });
    const b = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("b.txt", "bbb") });
    await trashDriveEntry(db, personal(owner), a.id);
    await trashDriveEntry(db, personal(owner), b.id);

    const removed = await emptyDriveTrash(db, config, personal(owner));
    expect(removed).toBe(2);

    expect((await db.select({ value: count() }).from(driveEntries).get())?.value).toBe(0);
    expect((await db.select({ value: count() }).from(fileReferences).get())?.value).toBe(0);
    expect((await db.select({ value: count() }).from(files).get())?.value).toBe(0);
  });
});

describe("restoreDriveEntry", () => {
  test("moves a trashed entry back to normal", async () => {
    const owner = await seedUser("Owner");
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("doc.txt") });
    await trashDriveEntry(db, personal(owner), file.id);
    const restored = await restoreDriveEntry(db, personal(owner), file.id);
    expect(restored.status).toBe("normal");
  });
});

describe("owner-aware upload to a team directory", () => {
  test("a file can be uploaded under a team_directory owner", async () => {
    const creator = await seedUser("Creator");
    const dir = await createTeamDirectory(db, { name: "Team", createdBy: creator });
    const entry = await uploadDriveFile(db, config, { ownerType: "team_directory", ownerId: dir.id, createdBy: creator, file: textFile("shared.txt") });
    expect(entry.ownerType).toBe("team_directory");
    expect(entry.ownerId).toBe(dir.id);

    const row = await db.select().from(driveEntries).where(eq(driveEntries.id, entry.id)).get();
    expect(row?.ownerType).toBe("team_directory");
  });
});

describe("buildDriveEntryDownloadResponse", () => {
  test("streams the stored bytes for a file entry", async () => {
    const owner = await seedUser("Owner");
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("hello.txt", "download me") });
    const res = await buildDriveEntryDownloadResponse(db, config, personal(owner), file.id, false);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("download me");
  });

  test("rejects downloading a folder", async () => {
    const owner = await seedUser("Owner");
    const folder = await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "F" });
    await expect(buildDriveEntryDownloadResponse(db, config, personal(owner), folder.id, false)).rejects.toMatchObject({ code: "INVALID_ENTRY_TYPE" });
  });
});

describe("audit landing for a drive write", () => {
  test("an audit_events row is persisted with the drive action / actor / resource", async () => {
    const owner = await seedUser("Owner");
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("audited.txt") });
    await audit(db, stubLogger, {
      actorId: owner,
      actorName: "Owner",
      action: "drive.file.uploaded",
      resourceType: "drive_entry",
      resourceId: file.id,
      resourceName: file.name,
      ip: "127.0.0.1",
      userAgent: "bun-test",
      result: "success",
    });

    const row = await db.select().from(auditEvents).where(eq(auditEvents.resourceId, file.id)).get();
    expect(row?.action).toBe("drive.file.uploaded");
    expect(row?.actorId).toBe(owner);
    expect(row?.resourceType).toBe("drive_entry");
    expect(row?.result).toBe("success");
  });
});
