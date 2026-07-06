import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { uploadDriveFile } from "@/modules/drive/drive.service";
import { uploadEntryVersion } from "@/modules/drive/drive.version.service";
import { driveEntries, UNIVER_SHEET_MIME } from "@/modules/drive/schema";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { uploadAndReference } from "./file.service";
import { repairEmptyFileMimetypes } from "./mime-repair";
import { fileReferences, files } from "./schema";
import { __setLocalDriverRootForTests } from "./storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "./storage/registry";

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

async function seedUser() {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `u-${id}`,
    name: "Alice",
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-mime-repair-${Date.now()}-${nanoid()}`);
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

async function blobOfEntry(entryId: string) {
  const entry = await db.select().from(driveEntries).where(eq(driveEntries.id, entryId)).get();
  const ref = await db.select().from(fileReferences).where(eq(fileReferences.id, entry!.fileReferenceId!)).get();
  return (await db.select().from(files).where(eq(files.id, ref!.fileId)).get())!;
}

describe("repairEmptyFileMimetypes (FIX-063)", () => {
  test("infers a broken version's mimetype from a sibling version of the same entry", async () => {
    const userId = await seedUser();
    const entry = await uploadDriveFile(db, config, {
      ownerType: "user",
      ownerId: userId,
      createdBy: userId,
      file: new File(["{\"rev\":0}"], "plan.sheet", { type: UNIVER_SHEET_MIME }),
    });
    const row = await db.select().from(driveEntries).where(eq(driveEntries.id, entry.id)).get();
    await uploadEntryVersion(db, config, {
      entry: row!,
      file: new File(["{\"rev\":1}"], "plan.sheet", { type: UNIVER_SHEET_MIME }),
      uploadedBy: userId,
    });
    // Blank the NEWER version's blob (the pre-fix loss) — the name carries no
    // extension the map knows, so only the sibling path can heal it.
    const current = await blobOfEntry(entry.id);
    await db.update(files).set({ mimetype: "" }).where(eq(files.id, current.id)).run();
    await db.update(fileReferences).set({ filename: "noext" }).where(eq(fileReferences.fileId, current.id)).run();

    const result = await repairEmptyFileMimetypes(db);
    expect(result).toEqual({ scanned: 1, repaired: 1 });
    const healed = await db.select().from(files).where(eq(files.id, current.id)).get();
    expect(healed?.mimetype).toBe(UNIVER_SHEET_MIME);
  });

  test("falls back to the reference filename's extension for non-drive blobs", async () => {
    const userId = await seedUser();
    const uploaded = await uploadAndReference(db, config, {
      file: new File(["pdf-ish"], "report.pdf", { type: "application/pdf" }),
      ownerType: "item_attachment",
      ownerId: "item-1",
      uploadedBy: userId,
    });
    await db.update(files).set({ mimetype: "" }).where(eq(files.id, uploaded.file.id)).run();

    const result = await repairEmptyFileMimetypes(db);
    expect(result).toEqual({ scanned: 1, repaired: 1 });
    const healed = await db.select().from(files).where(eq(files.id, uploaded.file.id)).get();
    expect(healed?.mimetype).toBe("application/pdf");
  });

  test("leaves unresolvable rows alone and is idempotent", async () => {
    const userId = await seedUser();
    const uploaded = await uploadAndReference(db, config, {
      file: new File([new Uint8Array([0x00, 0x01])], "mystery", { type: "application/octet-stream" }),
      ownerType: "item_attachment",
      ownerId: "item-2",
      uploadedBy: userId,
    });
    await db.update(files).set({ mimetype: "" }).where(eq(files.id, uploaded.file.id)).run();

    expect(await repairEmptyFileMimetypes(db)).toEqual({ scanned: 1, repaired: 0 });
    // Unchanged row is rescanned but never mangled; a healthy DB scans zero.
    expect(await repairEmptyFileMimetypes(db)).toEqual({ scanned: 1, repaired: 0 });
    await db.update(files).set({ mimetype: "application/octet-stream" }).where(eq(files.id, uploaded.file.id)).run();
    expect(await repairEmptyFileMimetypes(db)).toEqual({ scanned: 0, repaired: 0 });
  });
});
