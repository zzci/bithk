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
import { setDbDriverDatabase } from "@/modules/file/storage/db";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { shares } from "@/modules/share/schema";
import { AppError } from "@/shared/lib/errors";
import {
  __setPurgeFailpointForTests,
  buildDriveEntryDownloadResponse,
  createDriveFolder,
  createDriveSpreadsheet,
  createDriveTextFile,
  emptyDriveTrash,
  getDriveEntry,
  getDriveEntryById,
  getEntryOwner,
  listDriveEntries,
  listFavoriteDriveEntries,
  listRecentDriveEntries,
  restoreDriveEntry,
  searchDriveEntriesByOwners,
  throwDuplicateName,
  trashDriveEntry,
  updateDriveEntry,
  uploadDriveFile,
} from "./drive.service";
import { createTeamDirectory } from "./drive.team-directory.service";
import { driveEntries, UNIVER_SHEET_MIME } from "./schema";

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
  // Created files (text/spreadsheet) store bytes in the DB via the `db` driver.
  setDbDriverDatabase(db);
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

describe("creator exposure on the entry view", () => {
  test("createdBy + createdByName are populated and resolved across list / single / recent / by-id paths", async () => {
    const owner = await seedUser("Grace Hopper");
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("c.txt") });

    // single path (uploadDriveFile returns via getDriveEntry)
    expect(file.createdBy).toBe(owner);
    expect(file.createdByName).toBe("Grace Hopper");

    // list path
    const [listed] = await listDriveEntries(db, { ...personal(owner), parentEntryId: null });
    expect(listed?.createdBy).toBe(owner);
    expect(listed?.createdByName).toBe("Grace Hopper");

    // recent path
    const [recent] = await listRecentDriveEntries(db, owner);
    expect(recent?.createdBy).toBe(owner);
    expect(recent?.createdByName).toBe("Grace Hopper");

    // by-id (owner-agnostic) path
    const byId = await getDriveEntryById(db, file.id);
    expect(byId?.createdBy).toBe(owner);
    expect(byId?.createdByName).toBe("Grace Hopper");
  });

  test("createdByName falls back to the username when the creator has a blank display name", async () => {
    const id = nanoid();
    await db.insert(users).values({
      id,
      oauthSub: `sub-${id}`,
      username: "nodisplay",
      name: "",
      email: `${id}@test.com`,
      role: "user",
      status: "active",
    }).run();
    const file = await uploadDriveFile(db, config, { ...personal(id), createdBy: id, file: textFile("blank-name.txt") });
    expect(file.createdBy).toBe(id);
    expect(file.createdByName).toBe("nodisplay");
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

  test("allows empty content (new-document flow fills it in later)", async () => {
    const owner = await seedUser("Owner");
    const entry = await createDriveTextFile(db, config, { ...personal(owner), createdBy: owner, name: "blank.txt", content: "" });
    expect(entry.type).toBe("file");
    expect(entry.file?.size).toBe(0);
  });

  test("rejects illegal names", async () => {
    const owner = await seedUser("Owner");
    const create = (name: string) =>
      createDriveTextFile(db, config, { ...personal(owner), createdBy: owner, name, content: "x" });
    await expect(create("   ")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(create("a/b.txt")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(create("a\\b.txt")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(create("bad\nname.txt")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(create("nul\x00.txt")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(create(".")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(create("..")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(create(`${"a".repeat(256)}.txt`)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("createDriveSpreadsheet", () => {
  test("persists an application/x-univer-sheet file entry with v1 and the snapshot verbatim", async () => {
    const owner = await seedUser("Owner");
    const snapshot = JSON.stringify({ id: "wb1", sheets: {} });
    const entry = await createDriveSpreadsheet(db, config, { ...personal(owner), createdBy: owner, name: "Plan", content: snapshot });
    expect(entry.type).toBe("file");
    expect(entry.file?.mimetype).toBe(UNIVER_SHEET_MIME);
    expect(entry.file?.size).toBe(snapshot.length);
  });

  test("rejects a duplicate name in the same folder", async () => {
    const owner = await seedUser("Owner");
    await createDriveSpreadsheet(db, config, { ...personal(owner), createdBy: owner, name: "Plan", content: "{}" });
    await expect(
      createDriveSpreadsheet(db, config, { ...personal(owner), createdBy: owner, name: "Plan", content: "{}" }),
    ).rejects.toThrow(/already exists/i);
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

describe("purge atomicity (REFACTOR-034)", () => {
  test("a mid-transaction failure leaves no partial state (entries, shares, references all intact)", async () => {
    const owner = await seedUser("Owner");
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("a.txt", "aaa") });
    await db.insert(shares).values({
      id: nanoid(),
      resourceType: "drive_entry",
      resourceId: file.id,
      token: nanoid(),
      createdBy: owner,
    }).run();
    await trashDriveEntry(db, personal(owner), file.id);

    __setPurgeFailpointForTests(() => {
      throw new Error("boom");
    });
    try {
      await expect(emptyDriveTrash(db, config, personal(owner))).rejects.toThrow("boom");
    }
    finally {
      __setPurgeFailpointForTests(null);
    }

    // Nothing committed: entry, share and reference all survive the rollback.
    expect((await db.select({ value: count() }).from(driveEntries).get())?.value).toBe(1);
    expect((await db.select({ value: count() }).from(shares).get())?.value).toBe(1);
    expect((await db.select({ value: count() }).from(fileReferences).get())?.value).toBe(1);

    // With the failpoint cleared the same purge drains everything at once.
    expect(await emptyDriveTrash(db, config, personal(owner))).toBe(1);
    expect((await db.select({ value: count() }).from(driveEntries).get())?.value).toBe(0);
    expect((await db.select({ value: count() }).from(shares).get())?.value).toBe(0);
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

describe("searchDriveEntriesByOwners", () => {
  test("matches files by name across the owner set, files only", async () => {
    const owner = await seedUser("Owner");
    // A matching folder must be excluded — search returns files only.
    await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "report-folder" });
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("quarterly-report.txt") });
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("report-summary.txt") });
    // A non-matching file must not appear.
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("invoice.txt") });

    const results = await searchDriveEntriesByOwners(db, [personal(owner)], "report", 50);
    expect(results.every(r => r.type === "file")).toBe(true);
    expect(results.map(r => r.name).sort()).toEqual(["quarterly-report.txt", "report-summary.txt"]);
  });

  test("treats % and _ in the term as literals, not LIKE wildcards", async () => {
    const owner = await seedUser("Owner");
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("50%off.txt") });
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("50Xoff.txt") });
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("a_b.txt") });
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("aXb.txt") });

    // Literal "%" must match only the file that actually contains it.
    const pct = await searchDriveEntriesByOwners(db, [personal(owner)], "50%off", 50);
    expect(pct.map(r => r.name)).toEqual(["50%off.txt"]);

    // Literal "_" must not behave as the single-char wildcard.
    const underscore = await searchDriveEntriesByOwners(db, [personal(owner)], "a_b", 50);
    expect(underscore.map(r => r.name)).toEqual(["a_b.txt"]);
  });

  test("scopes results to the supplied owners and returns nothing for outsiders", async () => {
    const owner = await seedUser("Owner");
    const other = await seedUser("Other");
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("secret-plan.txt") });

    expect(await searchDriveEntriesByOwners(db, [personal(other)], "secret", 50)).toEqual([]);
    expect((await searchDriveEntriesByOwners(db, [personal(owner)], "secret", 50)).map(r => r.name)).toEqual(["secret-plan.txt"]);
  });

  test("returns [] for an empty owner set or a blank term", async () => {
    const owner = await seedUser("Owner");
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("doc.txt") });
    expect(await searchDriveEntriesByOwners(db, [], "doc", 50)).toEqual([]);
    expect(await searchDriveEntriesByOwners(db, [personal(owner)], "   ", 50)).toEqual([]);
  });
});

describe("validateParent guards", () => {
  test("rejects parenting under a file (not a folder)", async () => {
    const owner = await seedUser("Owner");
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("doc.txt") });
    await expect(createDriveFolder(db, { ...personal(owner), createdBy: owner, parentEntryId: file.id, name: "sub" }))
      .rejects
      .toMatchObject({ code: "INVALID_PARENT" });
  });

  test("rejects parenting under a trashed folder", async () => {
    const owner = await seedUser("Owner");
    const folder = await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "F" });
    await trashDriveEntry(db, personal(owner), folder.id);
    await expect(createDriveFolder(db, { ...personal(owner), createdBy: owner, parentEntryId: folder.id, name: "sub" }))
      .rejects
      .toMatchObject({ code: "INVALID_PARENT" });
  });

  test("rejects moving an entry into itself", async () => {
    const owner = await seedUser("Owner");
    const folder = await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "F" });
    await expect(updateDriveEntry(db, { ...personal(owner), id: folder.id, parentEntryId: folder.id }))
      .rejects
      .toMatchObject({ code: "INVALID_PARENT" });
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

describe("throwDuplicateName matches the specific name constraint (FIX-AUDIT-019)", () => {
  // SQLite reports a UNIQUE violation by its column list. The name guard is the
  // `(owner_type, owner_id, parent_entry_id, name, status)` index.
  const nameViolation = "UNIQUE constraint failed: drive_entries.owner_type, drive_entries.owner_id, drive_entries.parent_entry_id, drive_entries.name, drive_entries.status";
  // A wholly unrelated index (e.g. a drive_file_versions version race).
  const versionViolation = "UNIQUE constraint failed: drive_file_versions.drive_entry_id, drive_file_versions.version_no";

  test("maps a name-index violation to a 409 DUPLICATE_NAME AppError", () => {
    expect(() => throwDuplicateName(new Error(nameViolation))).toThrow(AppError);
    try {
      throwDuplicateName(new Error(nameViolation));
    }
    catch (err) {
      expect(err).toMatchObject({ statusCode: 409, code: "DUPLICATE_NAME" });
    }
  });

  test("does NOT mislabel an unrelated UNIQUE violation as a name clash", () => {
    // Falls through (returns void) so the caller rethrows the real error.
    expect(throwDuplicateName(new Error(versionViolation))).toBeUndefined();
    expect(throwDuplicateName(new Error("some other failure"))).toBeUndefined();
  });

  test("walks the cause chain to find a nested name violation", () => {
    const wrapped = new Error("Failed query: insert into drive_entries", { cause: new Error(nameViolation) });
    expect(() => throwDuplicateName(wrapped)).toThrow(AppError);
  });
});
