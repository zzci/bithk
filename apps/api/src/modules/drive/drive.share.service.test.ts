import type { DriveEntryRow } from "./drive.service";
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
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { createDriveFolder, uploadDriveFile } from "./drive.service";
import {
  accessPublicShare,
  createShare,
  getPublicShareMeta,
  listLinkShares,
  listReceivedShares,
  listSentShares,
  listSharesForEntry,
  revokeShare,
  updateShare,
} from "./drive.share.service";
import { driveEntries, driveFileShares } from "./schema";

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

async function fileEntryRow(ownerId: string): Promise<DriveEntryRow> {
  const view = await uploadDriveFile(db, config, { ...personal(ownerId), createdBy: ownerId, file: textFile(`f-${nanoid()}.txt`, "payload") });
  return (await db.select().from(driveEntries).where(eq(driveEntries.id, view.id)).get())!;
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

describe("createShare — direct", () => {
  test("creates a direct share to a real recipient", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "direct", permission: "download", sharedWithUserId: recipient });
    expect(share.shareType).toBe("direct");
    expect(share.sharedWithUserId).toBe(recipient);
    expect(share.permission).toBe("download");
    expect(share.hasPassword).toBe(false);
    expect(share.token).toHaveLength(64);
  });

  test("rejects a missing sharedWithUserId", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    await expect(createShare(db, { entry, createdBy: owner, shareType: "direct", permission: "view" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("rejects an unknown recipient", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    await expect(createShare(db, { entry, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: "ghost" })).rejects.toMatchObject({ statusCode: 404 });
  });

  test("rejects sharing with yourself", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    await expect(createShare(db, { entry, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: owner })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("rejects sharing a folder entry", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const folderView = await createDriveFolder(db, { ...personal(owner), createdBy: owner, name: "F" });
    const folder = (await db.select().from(driveEntries).where(eq(driveEntries.id, folderView.id)).get())!;
    await expect(createShare(db, { entry: folder, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient })).rejects.toMatchObject({ code: "INVALID_ENTRY_TYPE" });
  });
});

describe("createShare — public_link password hashing", () => {
  test("stores a hash that Bun.password.verify accepts for the right password and rejects the wrong one", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "download", password: "s3cret" });
    expect(share.hasPassword).toBe(true);

    const row = (await db.select().from(driveFileShares).where(eq(driveFileShares.id, share.id)).get())!;
    expect(row.password).not.toBe("s3cret"); // never stored in clear
    expect(await Bun.password.verify("s3cret", row.password!)).toBe(true);
    expect(await Bun.password.verify("wrong", row.password!)).toBe(false);
  });

  test("tokens are unique and unguessable across shares", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const a = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view" });
    const b = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view" });
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("getPublicShareMeta", () => {
  test("returns metadata, never bytes or hash, and flags password requirement", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view", password: "pw" });
    const meta = await getPublicShareMeta(db, share.token);
    expect(meta.requiresPassword).toBe(true);
    expect(meta.expired).toBe(false);
    expect(meta.exhausted).toBe(false);
    expect(meta).not.toHaveProperty("password");
  });

  test("a direct share token is not reachable as a public link", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient });
    await expect(getPublicShareMeta(db, share.token)).rejects.toMatchObject({ statusCode: 404 });
  });

  test("a revoked link is not reachable", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view" });
    await revokeShare(db, share.id, owner);
    await expect(getPublicShareMeta(db, share.token)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("accessPublicShare", () => {
  test("a view-only link returns metadata, never bytes", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view" });
    const result = await accessPublicShare(db, share.token, undefined);
    expect(result.kind).toBe("view");
  });

  test("a download link returns bytes and increments the counter", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "download" });
    const result = await accessPublicShare(db, share.token, undefined);
    expect(result.kind).toBe("download");
    const row = (await db.select().from(driveFileShares).where(eq(driveFileShares.id, share.id)).get())!;
    expect(row.downloadCount).toBe(1);
  });

  test("password gate: missing/wrong password is rejected, correct is accepted", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "download", password: "pw" });
    await expect(accessPublicShare(db, share.token, undefined)).rejects.toMatchObject({ statusCode: 403 });
    await expect(accessPublicShare(db, share.token, "nope")).rejects.toMatchObject({ statusCode: 403 });
    const ok = await accessPublicShare(db, share.token, "pw");
    expect(ok.kind).toBe("download");
  });

  test("an expired link is rejected with 410", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const past = new Date(Date.now() - 60_000).toISOString();
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "download", expiresAt: past });
    await expect(accessPublicShare(db, share.token, undefined)).rejects.toMatchObject({ statusCode: 410, code: "SHARE_EXPIRED" });
  });

  test("the exhausted boundary: the last allowed download succeeds, the next is 410", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "download", maxDownloads: 1 });
    const first = await accessPublicShare(db, share.token, undefined);
    expect(first.kind).toBe("download");
    await expect(accessPublicShare(db, share.token, undefined)).rejects.toMatchObject({ statusCode: 410, code: "SHARE_EXHAUSTED" });
  });

  test("an inactive link resolves to 404", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "download" });
    await revokeShare(db, share.id, owner);
    await expect(accessPublicShare(db, share.token, undefined)).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("updateShare", () => {
  test("updates permission, expiry, maxDownloads and isActive", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view" });
    const updated = await updateShare(db, share.id, owner, { permission: "download", maxDownloads: 5, expiresAt: "2030-01-01T00:00:00.000Z", isActive: false });
    expect(updated.permission).toBe("download");
    expect(updated.maxDownloads).toBe(5);
    expect(updated.expiresAt).toBe("2030-01-01T00:00:00.000Z");
    expect(updated.isActive).toBe(false);
  });

  test("sets then clears a password on a public link", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view" });
    const withPw = await updateShare(db, share.id, owner, { password: "pw" });
    expect(withPw.hasPassword).toBe(true);
    const cleared = await updateShare(db, share.id, owner, { password: null });
    expect(cleared.hasPassword).toBe(false);
  });

  test("rejects setting a password on a direct share", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient });
    await expect(updateShare(db, share.id, owner, { password: "pw" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  test("rejects an update from a non-owner", async () => {
    const owner = await seedUser("Owner");
    const stranger = await seedUser("Stranger");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view" });
    await expect(updateShare(db, share.id, stranger, { permission: "download" })).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("revokeShare", () => {
  test("flips isActive to false", async () => {
    const owner = await seedUser("Owner");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view" });
    await revokeShare(db, share.id, owner);
    const row = (await db.select().from(driveFileShares).where(eq(driveFileShares.id, share.id)).get())!;
    expect(row.isActive).toBe(0);
  });

  test("rejects a revoke from a non-owner", async () => {
    const owner = await seedUser("Owner");
    const stranger = await seedUser("Stranger");
    const entry = await fileEntryRow(owner);
    const share = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view" });
    await expect(revokeShare(db, share.id, stranger)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe("share listings", () => {
  test("received / sent / links partition direct vs public-link shares", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entry = await fileEntryRow(owner);
    const direct = await createShare(db, { entry, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient });
    const link = await createShare(db, { entry, createdBy: owner, shareType: "public_link", permission: "view" });

    const received = await listReceivedShares(db, recipient);
    expect(received.map(s => s.id)).toEqual([direct.id]);

    const sent = await listSentShares(db, owner);
    expect(sent.map(s => s.id)).toEqual([direct.id]);

    const links = await listLinkShares(db, owner);
    expect(links.map(s => s.id)).toEqual([link.id]);

    const forEntry = await listSharesForEntry(db, entry.id);
    expect(forEntry.map(s => s.id).sort()).toEqual([direct.id, link.id].sort());
  });
});
