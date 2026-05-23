import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import type { ShareGateRow } from "@/modules/share/adapter";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { findShareAdapter } from "@/modules/share/adapter";
import { createDriveFolder, trashDriveEntry, uploadDriveFile } from "./drive.service";
// Side-effect import registers the drive_entry share adapter.
import "./drive.share-adapter";

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

const adapter = findShareAdapter("drive_entry")!;

async function seedUser(name = "Owner") {
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

function textFile(name: string, body = "data"): File {
  return new File([body], name, { type: "text/plain" });
}

function gate(resourceId: string, permission: "view" | "download" | "edit"): ShareGateRow {
  return { id: nanoid(), resourceType: "drive_entry", resourceId, permission };
}

function personal(userId: string) {
  return { ownerType: "user" as const, ownerId: userId };
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-drive-share-${Date.now()}-${nanoid()}`);
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

describe("adapter registration + capabilities", () => {
  test("drive_entry adapter is registered with direct + public_link support", () => {
    expect(adapter.resourceType).toBe("drive_entry");
    expect(adapter.capabilities.shareTypes).toEqual(["direct", "public_link"]);
    expect(adapter.capabilities.permissions).toEqual(["view", "download", "edit"]);
  });
});

describe("resolve / getContent", () => {
  test("resolves a single file with its blob metadata", async () => {
    const owner = await seedUser();
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("doc.txt", "hello") });
    const resolved = await adapter.resolve(db, file.id);
    expect(resolved).toMatchObject({ name: "doc.txt", isFolder: false });
    expect(resolved?.file).toMatchObject({ filename: "doc.txt", mimetype: expect.stringMatching(/^text\/plain/), size: 5 });
  });

  test("resolves a folder with no file payload", async () => {
    const owner = await seedUser();
    const folder = await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "F" });
    const resolved = await adapter.resolve(db, folder.id);
    expect(resolved).toMatchObject({ name: "F", isFolder: true, file: null });
  });

  test("returns null for a trashed or missing entry", async () => {
    const owner = await seedUser();
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("gone.txt") });
    await trashDriveEntry(db, personal(owner), file.id);
    expect(await adapter.resolve(db, file.id)).toBeNull();
    expect(await adapter.resolve(db, "missing")).toBeNull();
  });

  test("getContent echoes the share permission alongside the resolved descriptor", async () => {
    const owner = await seedUser();
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("doc.txt") });
    const content = await adapter.getContent!(db, gate(file.id, "download"), undefined);
    expect(content).toMatchObject({ name: "doc.txt", isFolder: false, permission: "download" });
  });
});

describe("listChildren (public folder browsing)", () => {
  async function folderTree() {
    const owner = await seedUser();
    const root = await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "Root" });
    const sub = await createDriveFolder(db, { ...personal(owner), createdBy: owner, parentEntryId: root.id, name: "Zebra" });
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, parentEntryId: root.id, file: textFile("banana.txt") });
    await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, parentEntryId: root.id, file: textFile("apple.txt") });
    const nested = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, parentEntryId: sub.id, file: textFile("nested.txt") });
    return { owner, root, sub, nested };
  }

  test("lists the shared root: folders first, then files alphabetically, with a one-hop breadcrumb", async () => {
    const { root } = await folderTree();
    const listing = await adapter.listChildren!(db, gate(root.id, "view"), undefined);
    expect(listing.breadcrumb).toEqual([{ id: root.id, name: "Root" }]);
    expect(listing.entries.map(e => e.name)).toEqual(["Zebra", "apple.txt", "banana.txt"]);
    expect(listing.entries[0]!.type).toBe("folder");
  });

  test("descends into a subfolder and builds the root→child breadcrumb", async () => {
    const { root, sub } = await folderTree();
    const listing = await adapter.listChildren!(db, gate(root.id, "view"), sub.id);
    expect(listing.breadcrumb.map(b => b.name)).toEqual(["Root", "Zebra"]);
    expect(listing.entries.map(e => e.name)).toEqual(["nested.txt"]);
  });

  test("rejects browsing when the share root is a single file", async () => {
    const owner = await seedUser();
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("solo.txt") });
    await expect(adapter.listChildren!(db, gate(file.id, "view"), undefined))
      .rejects
      .toMatchObject({ code: "INVALID_ENTRY_TYPE" });
  });

  test("rejects a parentId that is outside the shared subtree", async () => {
    const { root, owner } = await folderTree();
    // A sibling folder that is NOT under the shared root.
    const outside = await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "Outside" });
    await expect(adapter.listChildren!(db, gate(root.id, "view"), outside.id))
      .rejects
      .toMatchObject({ statusCode: 404 });
  });
});

describe("openFile (download gate)", () => {
  test("single-file share returns content for download/edit but forbids view-only", async () => {
    const owner = await seedUser();
    const file = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("doc.txt", "bytes") });

    await expect(adapter.openFile!(db, gate(file.id, "view"), undefined))
      .rejects
      .toMatchObject({ statusCode: 403 });

    const content = await adapter.openFile!(db, gate(file.id, "download"), undefined);
    expect(content.reference.filename).toBe("doc.txt");
    expect(content.file.size).toBe(5);
  });

  test("folder share opens a child that lives inside the subtree", async () => {
    const owner = await seedUser();
    const root = await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "Root" });
    const child = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, parentEntryId: root.id, file: textFile("inside.txt", "abc") });

    const content = await adapter.openFile!(db, gate(root.id, "download"), child.id);
    expect(content.reference.filename).toBe("inside.txt");
  });

  test("folder share refuses a child outside the shared subtree", async () => {
    const owner = await seedUser();
    const root = await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "Root" });
    const elsewhere = await uploadDriveFile(db, config, { ...personal(owner), createdBy: owner, file: textFile("elsewhere.txt") });
    await expect(adapter.openFile!(db, gate(root.id, "download"), elsewhere.id))
      .rejects
      .toMatchObject({ statusCode: 404 });
  });
});
