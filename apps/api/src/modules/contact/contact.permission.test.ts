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
  resolveContactCapabilities,
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
    ownerId: input.ownerId,
    name: `Contact ${nanoid()}`,
    contactPerson: null,
    phone: null,
    email: null,
    address: null,
    taxId: null,
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
