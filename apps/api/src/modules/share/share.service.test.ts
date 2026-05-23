import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { createDocument } from "@/modules/document/document.service";
import { createDriveFolder, uploadDriveFile } from "@/modules/drive/drive.service";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { findShareAdapter } from "./adapter";
import {
  createShare,
  deleteSharesForResource,
  gatePublicShare,
  getPublicShareMeta,
  listLinkShares,
  listReceivedShares,
  listSentShares,
  listSharesForResource,
  reserveDownload,
  revokeShare,
  toGateRow,
  updateShare,
} from "./share.service";
// Side-effect imports: register the drive + document share adapters.
import "@/modules/drive/drive.share-adapter";
import "@/modules/document/document.share-adapter";

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

function textFile(name: string, body = "hello"): File {
  return new File([body], name, { type: "text/plain" });
}

async function seedFile(owner: string, name = "doc.txt") {
  const file = await uploadDriveFile(db, config, { ownerType: "user", ownerId: owner, createdBy: owner, file: textFile(name) });
  return file.id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-share-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

/** Resolve a token through the gate, then invoke the registered adapter's content callback. */
async function gateThen<T>(token: string, password: string | undefined, fn: (adapter: NonNullable<ReturnType<typeof findShareAdapter>>, gate: ReturnType<typeof toGateRow>) => Promise<T>): Promise<T> {
  const share = await gatePublicShare(db, token, password);
  const adapter = findShareAdapter(share.resourceType)!;
  return fn(adapter, toGateRow(share));
}

describe("createShare — drive_entry public links", () => {
  test("creates a view-only link by default", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" });
    expect(view.shareType).toBe("public_link");
    expect(view.permission).toBe("view");
    expect(view.token).toHaveLength(10);
    expect(view.hasPassword).toBe(false);
    expect(view.file?.filename).toBe("doc.txt");
  });

  test("hashes the password and never returns it", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "download", password: "s3cret" });
    expect(view.hasPassword).toBe(true);
    expect(JSON.stringify(view)).not.toContain("s3cret");
  });

  test("rejects a second active public link for the same resource", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" });
    await expect(createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" }))
      .rejects
      .toThrow(/already exists/);
  });

  test("404 for a missing resource", async () => {
    const owner = await seedUser("Owner");
    await expect(createShare(db, { resourceType: "drive_entry", resourceId: "nope", createdBy: owner, shareType: "public_link", permission: "view" }))
      .rejects
      .toThrow();
  });
});

describe("createShare — drive_entry direct shares", () => {
  test("creates a direct grant to another user", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "edit", sharedWithUserId: recipient });
    expect(view.shareType).toBe("direct");
    expect(view.sharedWithUserId).toBe(recipient);
  });

  test("rejects sharing with yourself", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    await expect(createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: owner }))
      .rejects
      .toThrow(/yourself/);
  });

  test("404 for a missing recipient", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    await expect(createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: "ghost" }))
      .rejects
      .toThrow();
  });

  test("rejects a duplicate direct grant to the same recipient", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entryId = await seedFile(owner);
    await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient });
    await expect(createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient }))
      .rejects
      .toThrow(/already shared/);
  });
});

describe("createShare — document capability gating", () => {
  test("allows a view-only public link", async () => {
    const owner = await seedUser("Owner");
    const doc = await createDocument(db, { title: "Doc", creatorId: owner });
    const view = await createShare(db, { resourceType: "document", resourceId: doc.id, createdBy: owner, shareType: "public_link", permission: "view" });
    expect(view.resourceType).toBe("document");
    expect(view.resourceName).toBe("Doc");
    expect(view.isFolder).toBe(false);
  });

  test("rejects a direct share (documents support public_link only)", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const doc = await createDocument(db, { title: "Doc", creatorId: owner });
    await expect(createShare(db, { resourceType: "document", resourceId: doc.id, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient }))
      .rejects
      .toThrow(/does not support/);
  });

  test("rejects a download permission (documents are view-only)", async () => {
    const owner = await seedUser("Owner");
    const doc = await createDocument(db, { title: "Doc", creatorId: owner });
    await expect(createShare(db, { resourceType: "document", resourceId: doc.id, createdBy: owner, shareType: "public_link", permission: "download" }))
      .rejects
      .toThrow(/does not support/);
  });
});

describe("list / update / revoke", () => {
  test("lists shares per resource and across inboxes", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entryId = await seedFile(owner);
    await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" });
    await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient });

    expect((await listSharesForResource(db, "drive_entry", entryId)).length).toBe(2);
    expect((await listLinkShares(db, owner)).length).toBe(1);
    expect((await listSentShares(db, owner)).length).toBe(1);
    expect((await listReceivedShares(db, recipient)).length).toBe(1);
  });

  test("updates expiry / active flag and rotates the password", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" });
    const updated = await updateShare(db, view.id, owner, { isActive: false, expiresAt: "2020-01-01T00:00:00.000Z", password: "new" });
    expect(updated.isActive).toBe(false);
    expect(updated.expiresAt).toBe("2020-01-01T00:00:00.000Z");
    expect(updated.hasPassword).toBe(true);
  });

  test("rejects a password on a direct share", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient });
    await expect(updateShare(db, view.id, owner, { password: "x" })).rejects.toThrow(/public links/i);
  });

  test("enforces ownership on update and revoke", async () => {
    const owner = await seedUser("Owner");
    const other = await seedUser("Other");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" });
    await expect(updateShare(db, view.id, other, { isActive: false })).rejects.toThrow(/do not own/);
    await expect(revokeShare(db, view.id, other)).rejects.toThrow(/do not own/);
  });

  test("revoke flips the active flag off", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" });
    await revokeShare(db, view.id, owner);
    expect((await listSharesForResource(db, "drive_entry", entryId)).length).toBe(0);
  });

  test("deleteSharesForResource removes every share", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entryId = await seedFile(owner);
    await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "view" });
    await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient });
    await deleteSharesForResource(db, "drive_entry", entryId);
    expect((await listSharesForResource(db, "drive_entry", entryId)).length).toBe(0);
  });
});

describe("public gate", () => {
  test("meta exposes flags without the hash", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "download", password: "pw" });
    const meta = await getPublicShareMeta(db, view.token);
    expect(meta.requiresPassword).toBe(true);
    expect(meta.expired).toBe(false);
    expect(meta.exhausted).toBe(false);
    expect(meta.resourceType).toBe("drive_entry");
  });

  test("direct shares are not reachable by token", async () => {
    const owner = await seedUser("Owner");
    const recipient = await seedUser("Recipient");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "direct", permission: "view", sharedWithUserId: recipient });
    await expect(getPublicShareMeta(db, view.token)).rejects.toThrow();
  });

  test("gate enforces password, expiry and revocation", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "download", password: "pw" });
    await expect(gatePublicShare(db, view.token, undefined)).rejects.toThrow(/password/i);
    await expect(gatePublicShare(db, view.token, "wrong")).rejects.toThrow(/password/i);
    const gated = await gatePublicShare(db, view.token, "pw");
    expect(gated.id).toBe(view.id);

    await updateShare(db, view.id, owner, { expiresAt: "2000-01-01T00:00:00.000Z" });
    await expect(gatePublicShare(db, view.token, "pw")).rejects.toThrow(/expired/i);
  });
});

describe("download budget", () => {
  test("reserveDownload enforces maxDownloads atomically", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "download", maxDownloads: 2 });
    expect(reserveDownload(db, view.id)).toBe(true);
    expect(reserveDownload(db, view.id)).toBe(true);
    expect(reserveDownload(db, view.id)).toBe(false);
    const meta = await getPublicShareMeta(db, view.token);
    expect(meta.exhausted).toBe(true);
  });

  test("a null budget never blocks", async () => {
    const owner = await seedUser("Owner");
    const entryId = await seedFile(owner);
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: entryId, createdBy: owner, shareType: "public_link", permission: "download" });
    expect(reserveDownload(db, view.id)).toBe(true);
    expect(reserveDownload(db, view.id)).toBe(true);
  });
});

describe("folder share content (drive adapter)", () => {
  test("lists folder children and downloads a descendant file", async () => {
    const owner = await seedUser("Owner");
    const folder = await createDriveFolder(db, { ownerType: "user", ownerId: owner, createdBy: owner, name: "Box" });
    const child = await uploadDriveFile(db, config, { ownerType: "user", ownerId: owner, createdBy: owner, parentEntryId: folder.id, file: textFile("inside.txt") });
    const view = await createShare(db, { resourceType: "drive_entry", resourceId: folder.id, createdBy: owner, shareType: "public_link", permission: "download" });

    const meta = await getPublicShareMeta(db, view.token);
    expect(meta.isFolder).toBe(true);

    const listing = await gateThen(view.token, undefined, (a, g) => a.listChildren!(db, g, undefined));
    expect(listing.entries.map(e => e.name)).toContain("inside.txt");

    const content = await gateThen(view.token, undefined, (a, g) => a.openFile!(db, g, child.id));
    expect(content.reference.filename).toBe("inside.txt");
  });
});

describe("document share content (document adapter)", () => {
  test("returns document content and subtree", async () => {
    const owner = await seedUser("Owner");
    const parent = await createDocument(db, { title: "Root", creatorId: owner, content: "# hello" });
    await createDocument(db, { title: "Child", creatorId: owner, parentId: parent.id });
    const view = await createShare(db, { resourceType: "document", resourceId: parent.id, createdBy: owner, shareType: "public_link", permission: "view" });

    const content = await gateThen(view.token, undefined, (a, g) => a.getContent!(db, g, undefined)) as { document: { title: string }; subtree: unknown[] };
    expect(content.document.title).toBe("Root");
    expect(content.subtree.length).toBe(2);
  });
});
