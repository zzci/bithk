import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { NOOP_POLICY_LOGGER } from "@/modules/policy";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { createTuple } from "@/modules/policy/policy.service";
import { check } from "@/modules/policy/zanzibar.engine";
import {
  assertContactCapability,
  canSeeConfidentialFields,
  contactAccess,
  loadContactCapabilityContext,
  resolveContactCapabilities,
  resolveContactCapabilitiesFromContext,
} from "./contact.permission";
import { contacts } from "./schema";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  loadNamespaces();
  const dir = resolve(tmpdir(), `test-contact-perm-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("contact namespace", () => {
  test("owner implies viewer", async () => {
    await seedUser("owner-a");
    await createTuple(db, {
      namespace: "contact",
      objectId: "contact-a",
      relation: "owner",
      subjectNamespace: "user",
      subjectId: "owner-a",
    }, "owner-a");

    const result = await check(db, "contact", "contact-a", "viewer", "user", "owner-a");
    expect(result.allowed).toBe(true);
  });
});

describe("contact permissions", () => {
  test("explicit user viewer tuple grants read", async () => {
    await seedUser("owner-a");
    const row = await seedContact({ ownerId: "owner-a", visibility: "private" });
    await createTuple(db, {
      namespace: "contact",
      objectId: row.id,
      relation: "viewer",
      subjectNamespace: "user",
      subjectId: "viewer-a",
    }, row.ownerId);

    const contact = await assertContactCapability(db, { id: "viewer-a", role: "user" }, row.id, "read");
    expect(contact.id).toBe(row.id);
    await expect(contactAccess.can(
      { db, logger: NOOP_POLICY_LOGGER, actor: { id: "viewer-a", type: "user", role: "user" } },
      "contact:read",
      row.id,
    )).resolves.toBe(true);
  });

  test("explicit group member viewer tuple grants read", async () => {
    await seedUser("owner-a");
    const row = await seedContact({ ownerId: "owner-a", visibility: "private" });
    await createTuple(db, {
      namespace: "group",
      objectId: "group-a",
      relation: "member",
      subjectNamespace: "user",
      subjectId: "member-a",
    }, row.ownerId);
    await createTuple(db, {
      namespace: "contact",
      objectId: row.id,
      relation: "viewer",
      subjectNamespace: "group",
      subjectId: "group-a",
      subjectRelation: "member",
    }, row.ownerId);

    const contact = await assertContactCapability(db, { id: "member-a", role: "user" }, row.id, "read");
    expect(contact.id).toBe(row.id);
  });

  test("public visibility grants implicit read to any authenticated user", async () => {
    const row = await seedContact({ ownerId: "owner-a", visibility: "public" });

    const contact = await assertContactCapability(db, { id: "stranger-a", role: "user" }, row.id, "read");
    expect(contact.id).toBe(row.id);
  });

  test("private contact without a grant hides existence", async () => {
    const row = await seedContact({ ownerId: "owner-a", visibility: "private" });

    await expect(assertContactCapability(db, { id: "stranger-a", role: "user" }, row.id, "read"))
      .rejects
      .toMatchObject({ statusCode: 404 });
  });

  test("public reader without owner capability gets forbidden for update", async () => {
    const row = await seedContact({ ownerId: "owner-a", visibility: "public" });

    await expect(assertContactCapability(db, { id: "stranger-a", role: "user" }, row.id, "update"))
      .rejects
      .toMatchObject({ statusCode: 403 });
  });

  test("admin holds every capability", async () => {
    const row = await seedContact({ ownerId: "owner-a", visibility: "private" });

    const caps = await resolveContactCapabilities(db, row, { id: "admin-a", role: "admin" });
    expect([...caps].sort()).toEqual(["delete", "read", "share", "update"]);
  });

  test("masking helper hides only confidential fields from public implicit viewers", () => {
    const actor = { id: "viewer-a", role: "user" };
    const publicConfidential = contactRow({ ownerId: "owner-a", visibility: "public", confidential: true });
    const publicOpen = contactRow({ ownerId: "owner-a", visibility: "public", confidential: false });
    const privateConfidential = contactRow({ ownerId: "owner-a", visibility: "private", confidential: true });

    expect(canSeeConfidentialFields(actor, publicConfidential, false)).toBe(false);
    expect(canSeeConfidentialFields(actor, publicOpen, false)).toBe(true);
    expect(canSeeConfidentialFields(actor, privateConfidential, false)).toBe(true);
    expect(canSeeConfidentialFields(actor, publicConfidential, true)).toBe(true);
    expect(canSeeConfidentialFields({ id: "owner-a", role: "user" }, publicConfidential, false)).toBe(true);
    expect(canSeeConfidentialFields({ id: "admin-a", role: "admin" }, publicConfidential, false)).toBe(true);
  });
});

describe("batched capability context", () => {
  test("context resolution matches per-row resolveContactCapabilities for every grant shape", async () => {
    await seedUser("owner-a");
    await seedUser("reader-a");
    await seedUser("admin-a", "admin");

    const owned = await seedContact({ ownerId: "reader-a", visibility: "private" });
    const ownerTuple = await seedContact({ ownerId: "owner-a", visibility: "private" });
    await createTuple(db, {
      namespace: "contact",
      objectId: ownerTuple.id,
      relation: "owner",
      subjectNamespace: "user",
      subjectId: "reader-a",
    }, "owner-a");
    const viewerTuple = await seedContact({ ownerId: "owner-a", visibility: "private" });
    await createTuple(db, {
      namespace: "contact",
      objectId: viewerTuple.id,
      relation: "viewer",
      subjectNamespace: "user",
      subjectId: "reader-a",
    }, "owner-a");
    const groupViewer = await seedContact({ ownerId: "owner-a", visibility: "private" });
    await createTuple(db, {
      namespace: "group",
      objectId: "group-a",
      relation: "member",
      subjectNamespace: "user",
      subjectId: "reader-a",
    }, "owner-a");
    await createTuple(db, {
      namespace: "contact",
      objectId: groupViewer.id,
      relation: "viewer",
      subjectNamespace: "group",
      subjectId: "group-a",
      subjectRelation: "member",
    }, "owner-a");
    const publicRow = await seedContact({ ownerId: "owner-a", visibility: "public" });
    const hidden = await seedContact({ ownerId: "owner-a", visibility: "private" });

    const rows = [owned, ownerTuple, viewerTuple, groupViewer, publicRow, hidden];
    const actors = [
      { id: "reader-a", role: "user" },
      { id: "owner-a", role: "user" },
      { id: "admin-a", role: "admin" },
    ];
    for (const actor of actors) {
      const ctx = await loadContactCapabilityContext(db, actor);
      for (const row of rows) {
        const batched = resolveContactCapabilitiesFromContext(row, actor, ctx);
        const perRow = await resolveContactCapabilities(db, row, actor);
        expect([...batched].sort()).toEqual([...perRow].sort());
      }
    }

    // Spot-check the grant tiers directly.
    const readerCtx = await loadContactCapabilityContext(db, { id: "reader-a", role: "user" });
    expect([...resolveContactCapabilitiesFromContext(ownerTuple, { id: "reader-a", role: "user" }, readerCtx)].sort())
      .toEqual(["delete", "read", "share", "update"]);
    expect([...resolveContactCapabilitiesFromContext(viewerTuple, { id: "reader-a", role: "user" }, readerCtx)])
      .toEqual(["read"]);
    expect(resolveContactCapabilitiesFromContext(hidden, { id: "reader-a", role: "user" }, readerCtx).size).toBe(0);
  });
});

async function seedUser(id: string, role: "admin" | "user" = "user") {
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: id,
    name: id,
    email: `${id}@test.local`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
}

async function seedContact(input: { ownerId: string; visibility: "private" | "public"; confidential?: boolean }) {
  const now = new Date().toISOString();
  const row = {
    id: nanoid(),
    kind: "organization" as const,
    ownerId: input.ownerId,
    name: `Contact ${nanoid()}`,
    phone: null,
    email: null,
    position: null,
    organizationId: null,
    taxId: null,
    address: null,
    avatarReferenceId: null,
    attributes: null,
    note: null,
    status: "active" as const,
    visibility: input.visibility,
    confidential: input.confidential ?? false,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(contacts).values(row).run();
  return row;
}

function contactRow(input: { ownerId: string; visibility: "private" | "public"; confidential: boolean }) {
  return input;
}
