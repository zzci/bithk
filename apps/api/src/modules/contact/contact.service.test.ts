import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { createTuple } from "@/modules/policy/policy.service";
import { relationTuples } from "@/modules/policy/schema";
import { check } from "@/modules/policy/zanzibar.engine";
import { shares } from "@/modules/share/schema";
import { tagsRefs } from "@/modules/tag/schema";
import * as contactService from "./contact.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  loadNamespaces();
  const dir = resolvePath(tmpdir(), `test-contact-service-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolvePath(dir, "test.db");
  db = await createDb(dbPath);
});

afterEach(() => {
  db.close();
  const dir = resolvePath(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("contact service", () => {
  test("creator manages the contact, sees all fields, and gets an owner tuple", async () => {
    const owner = await seedUser("owner-a");

    const view = await contactService.create(db, actor(owner), {
      name: "Supplier Co",
      contactPerson: "Alice",
      phone: "123",
      email: "alice@example.test",
      address: "Dock 1",
      taxId: "TAX-1",
      note: "Preferred",
      status: "active",
      visibility: "private",
      confidential: true,
      tags: ["supplier", "priority"],
    });

    expect(view.ownerId).toBe(owner);
    expect(view.contactPerson).toBe("Alice");
    expect(view.phone).toBe("123");
    expect(view.email).toBe("alice@example.test");
    expect(view.address).toBe("Dock 1");
    expect(view.taxId).toBe("TAX-1");
    expect(view.note).toBe("Preferred");
    expect(view.status).toBe("active");
    expect(view.canManage).toBe(true);
    expect(view.tags.map(t => t.name).sort()).toEqual(["priority", "supplier"]);
    await expect(check(db, "contact", view.id, "owner", "user", owner)).resolves.toMatchObject({ allowed: true });
  });

  test("private contacts are invisible to strangers", async () => {
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const view = await contactService.create(db, actor(owner), { name: "Private Co", visibility: "private" });

    expect(await contactService.list(db, actor(stranger))).toEqual([]);
    await expect(contactService.get(db, actor(stranger), view.id))
      .rejects
      .toMatchObject({ statusCode: 404 });
  });

  test("public contacts are visible to any user without manage capability", async () => {
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const view = await contactService.create(db, actor(owner), {
      name: "Public Co",
      phone: "123",
      visibility: "public",
    });

    const fetched = await contactService.get(db, actor(stranger), view.id);
    expect(fetched.name).toBe("Public Co");
    expect(fetched.phone).toBe("123");
    expect(fetched.canManage).toBe(false);
    expect((await contactService.list(db, actor(stranger))).map(c => c.id)).toEqual([view.id]);
  });

  test("explicit per-user viewer grant allows a stranger to read", async () => {
    const owner = await seedUser("owner-a");
    const viewer = await seedUser("viewer-a");
    const view = await contactService.create(db, actor(owner), {
      name: "Granted Co",
      email: "granted@example.test",
      visibility: "private",
    });

    await contactService.grant(db, actor(owner), view.id, { type: "user", id: viewer });

    const fetched = await contactService.get(db, actor(viewer), view.id);
    expect(fetched.email).toBe("granted@example.test");
    expect(fetched.canManage).toBe(false);
  });

  test("explicit per-group viewer grant allows group members to read", async () => {
    const owner = await seedUser("owner-a");
    const member = await seedUser("member-a");
    const view = await contactService.create(db, actor(owner), {
      name: "Group Co",
      phone: "456",
      visibility: "private",
    });
    await createTuple(db, {
      namespace: "group",
      objectId: "group-a",
      relation: "member",
      subjectNamespace: "user",
      subjectId: member,
    }, owner);

    await contactService.grant(db, actor(owner), view.id, { type: "group", id: "group-a" });

    const fetched = await contactService.get(db, actor(member), view.id);
    expect(fetched.phone).toBe("456");
    expect((await contactService.list(db, actor(member))).map(c => c.id)).toEqual([view.id]);
  });

  test("confidential public contacts mask implicit readers but not explicit viewers, owners, or admins", async () => {
    const owner = await seedUser("owner-a");
    const stranger = await seedUser("stranger-a");
    const explicitViewer = await seedUser("viewer-a");
    const admin = await seedUser("admin-a", "admin");
    const view = await contactService.create(db, actor(owner), {
      name: "Secret Co",
      contactPerson: "Alice",
      phone: "123",
      email: "secret@example.test",
      address: "Hidden",
      taxId: "TAX-9",
      note: "Sensitive",
      status: "inactive",
      visibility: "public",
      confidential: true,
      tags: ["confidential"],
    });

    const masked = await contactService.get(db, actor(stranger), view.id);
    expect(masked.name).toBe("Secret Co");
    expect(masked.tags.map(t => t.name)).toEqual(["confidential"]);
    expect(masked.contactPerson).toBeNull();
    expect(masked.phone).toBeNull();
    expect(masked.email).toBeNull();
    expect(masked.address).toBeNull();
    expect(masked.taxId).toBeNull();
    expect(masked.note).toBeNull();
    expect(masked.status).toBeNull();

    await contactService.grant(db, actor(owner), view.id, { type: "user", id: explicitViewer });

    await expect(contactService.get(db, actor(explicitViewer), view.id)).resolves.toMatchObject({
      email: "secret@example.test",
      status: "inactive",
    });
    await expect(contactService.get(db, actor(owner), view.id)).resolves.toMatchObject({ email: "secret@example.test" });
    await expect(contactService.get(db, actor(admin, "admin"), view.id)).resolves.toMatchObject({ email: "secret@example.test" });
  });

  test("tags attach, resync on update, and list filters by tag", async () => {
    const owner = await seedUser("owner-a");
    const supplier = await contactService.create(db, actor(owner), { name: "Supplier", tags: ["supplier", "priority"] });
    const client = await contactService.create(db, actor(owner), { name: "Client", tags: ["client"] });

    expect((await contactService.list(db, actor(owner), { tag: "supplier" })).map(c => c.id)).toEqual([supplier.id]);
    expect((await contactService.list(db, actor(owner), { tag: "client" })).map(c => c.id)).toEqual([client.id]);

    const updated = await contactService.update(db, actor(owner), supplier.id, {
      name: "Supplier Updated",
      tags: ["client"],
    });
    expect(updated.name).toBe("Supplier Updated");
    expect(updated.tags.map(t => t.name)).toEqual(["client"]);
    expect((await contactService.list(db, actor(owner), { tag: "supplier" })).map(c => c.id)).toEqual([]);
    expect((await contactService.list(db, actor(owner), { tag: "client" })).map(c => c.id).sort()).toEqual([client.id, supplier.id].sort());
  });

  test("revoke removes explicit access", async () => {
    const owner = await seedUser("owner-a");
    const viewer = await seedUser("viewer-a");
    const view = await contactService.create(db, actor(owner), { name: "Revoked Co", visibility: "private" });
    await contactService.grant(db, actor(owner), view.id, { type: "user", id: viewer });

    await expect(contactService.get(db, actor(viewer), view.id)).resolves.toMatchObject({ id: view.id });
    expect(await contactService.revoke(db, actor(owner), view.id, { type: "user", id: viewer })).toBe(true);

    expect(await contactService.list(db, actor(viewer))).toEqual([]);
    await expect(contactService.get(db, actor(viewer), view.id))
      .rejects
      .toMatchObject({ statusCode: 404 });
  });

  test("delete removes the row, tag links, and policy tuples", async () => {
    const owner = await seedUser("owner-a");
    const viewer = await seedUser("viewer-a");
    const view = await contactService.create(db, actor(owner), { name: "Deleted Co", tags: ["supplier"] });
    await contactService.grant(db, actor(owner), view.id, { type: "user", id: viewer });

    await contactService.delete(db, actor(owner), view.id);

    await expect(contactService.resolve(db, view.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await db.select().from(tagsRefs).where(eq(tagsRefs.resourceId, view.id)).all()).toEqual([]);
    expect(await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "contact"),
      eq(relationTuples.objectId, view.id),
    )).all()).toEqual([]);
  });

  test("delete clears the row, tag links, tuples, and token-based shares in one atomic step", async () => {
    const owner = await seedUser("owner-a");
    const view = await contactService.create(db, actor(owner), { name: "Shared Co", tags: ["supplier"] });
    await contactService.grant(db, actor(owner), view.id, { type: "user", id: owner });
    // A polymorphic token-based share row (no FK on `resource_id`).
    await db.insert(shares).values({
      id: nanoid(),
      resourceType: "contact" as never,
      resourceId: view.id,
      token: `tok-${view.id}`,
      createdBy: owner,
    }).run();

    await contactService.delete(db, actor(owner), view.id);

    await expect(contactService.resolve(db, view.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await db.select().from(tagsRefs).where(eq(tagsRefs.resourceId, view.id)).all()).toEqual([]);
    expect(await db.select().from(relationTuples).where(eq(relationTuples.objectId, view.id)).all()).toEqual([]);
    expect(await db.select().from(shares).where(eq(shares.resourceId, view.id)).all()).toEqual([]);
  });

  test("deleting a missing contact throws and touches nothing", async () => {
    const owner = await seedUser("owner-a");
    const keep = await contactService.create(db, actor(owner), { name: "Keep Co", tags: ["supplier"] });

    await expect(contactService.delete(db, actor(owner), "no-such-contact"))
      .rejects
      .toMatchObject({ statusCode: 404 });

    // The unrelated contact's tag links remain intact (no stray cleanup ran).
    expect(await db.select().from(tagsRefs).where(eq(tagsRefs.resourceId, keep.id)).all()).toHaveLength(1);
  });
});

async function seedUser(id: string, role: "admin" | "user" = "user"): Promise<string> {
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
  return id;
}

function actor(id: string, role: "admin" | "user" = "user") {
  return { id, role };
}
