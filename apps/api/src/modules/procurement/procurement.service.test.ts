import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { auditEvents } from "@/modules/audit/schema";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { createCategory } from "@/modules/project/project.categories";
import { createContact } from "@/modules/project/project.contacts";
import { createRole, listRoles } from "@/modules/project/project.roles";
import { addMember, createProject, getMemberCapabilities, hasCapability } from "@/modules/project/project.service";
import {
  changeStatus,
  createProcurement,
  getProcurementByShortId,
  listByProject,
  softDeleteProcurement,
  updateProcurement,
} from "./procurement.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
const logger = { error() {}, warn() {}, info() {}, debug() {} } as unknown as Logger;

let db: AppDatabase;
let dbPath: string;

async function seedUser(name: string): Promise<string> {
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

async function memberRoleId(projectId: string): Promise<string> {
  const roles = await listRoles(db, projectId);
  return roles.find(r => r.name === "Member")!.id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-procurement-${Date.now()}-${nanoid()}`);
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

describe("createProcurement", () => {
  test("writes item + details + owner tuple, defaults status to draft", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "Bridge", creatorId: creator });

    const row = await createProcurement(db, {
      projectId: project.id,
      itemName: "Steel beams",
      quantity: 10,
      amount: 50000,
      currency: "USD",
      creatorId: creator,
    });

    expect(row.id).toHaveLength(8);
    expect(row.title).toBe("Steel beams"); // title falls back to itemName
    expect(row.itemName).toBe("Steel beams");
    expect(row.status).toBe("draft");
    expect(row.projectId).toBe(project.shortId); // response exposes the project short_id, not the ULID
    expect(row.quantity).toBe(10);
    expect(row.amount).toBe(50000);
    expect(row.currency).toBe("USD");
    expect(row.version).toBe(1);

    const item = await db.select().from(items).where(eq(items.shortId, row.id)).get();
    expect(item!.type).toBe("procurement");
    const tuples = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item!.id),
    )).all();
    expect(tuples).toHaveLength(1);
    expect(tuples[0]!.relation).toBe("owner");
    expect(tuples[0]!.subjectId).toBe(creator);
  });

  test("uses an explicit title when provided", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const row = await createProcurement(db, {
      projectId: project.id,
      itemName: "Cables",
      title: "Q1 cable order",
      creatorId: creator,
    });
    expect(row.title).toBe("Q1 cable order");
    expect(row.itemName).toBe("Cables");
  });

  test("accepts a supplier contact, a category, and a member assignee from the project", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const supplier = await createContact(db, project.id, { type: "supplier", name: "Supplier Co" });
    const category = await createCategory(db, project.id, { name: "Materials" });
    const assignee = await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });

    const row = await createProcurement(db, {
      projectId: project.id,
      itemName: "Pumps",
      supplierId: supplier.id,
      categoryId: category.id,
      assigneeMemberId: assignee.id,
      creatorId: creator,
    });
    expect(row.supplierId).toBe(supplier.id);
    expect(row.categoryId).toBe(category.id);
    expect(row.assigneeMemberId).toBe(assignee.id);
  });

  test("rejects a non-supplier contact as supplier", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const client = await createContact(db, project.id, { type: "client", name: "Owner Inc" });
    await expect(createProcurement(db, {
      projectId: project.id,
      itemName: "X",
      supplierId: client.id,
      creatorId: creator,
    })).rejects.toThrow();
  });

  test("rejects an assignment target from another project", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const projectA = await createProject(db, { name: "A", creatorId: creator });
    const projectB = await createProject(db, { name: "B", creatorId: creator });
    const foreign = await addMember(db, projectB.id, { roleId: await memberRoleId(projectB.id), userId: bob });

    await expect(createProcurement(db, {
      projectId: projectA.id,
      itemName: "Bolts",
      assigneeMemberId: foreign.id,
      creatorId: creator,
    })).rejects.toThrow();

    const result = await listByProject(db, projectA.id);
    expect(result.total).toBe(0);
  });
});

describe("changeStatus", () => {
  test("updates status, bumps version, emits a status_changed audit event", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const row = await createProcurement(db, { projectId: project.id, itemName: "Valves", creatorId: creator });
    expect(row.status).toBe("draft");

    const updated = await changeStatus(
      db,
      logger,
      row.id,
      "requested",
      { id: creator, name: "Alice" },
      { ip: "127.0.0.1", userAgent: "test" },
    );
    expect(updated?.status).toBe("requested");
    expect(updated!.version).toBeGreaterThan(1);

    const events = await db.select().from(auditEvents).where(
      eq(auditEvents.action, "procurement.status_changed"),
    ).all();
    expect(events).toHaveLength(1);
    expect(events[0]!.resourceId).toBe(row.id);
    const detail = JSON.parse(events[0]!.detail!) as { from: string; to: string };
    expect(detail.from).toBe("draft");
    expect(detail.to).toBe("requested");
  });

  test("returns undefined for an unknown procurement", async () => {
    const result = await changeStatus(
      db,
      logger,
      "missing00",
      "ordered",
      { id: "x", name: "X" },
      { ip: "127.0.0.1", userAgent: "test" },
    );
    expect(result).toBeUndefined();
  });
});

describe("listByProject", () => {
  test("paginates, filters by status, scopes to the project, excludes soft-deleted", async () => {
    const creator = await seedUser("Alice");
    const projectA = await createProject(db, { name: "A", creatorId: creator });
    const projectB = await createProject(db, { name: "B", creatorId: creator });

    await createProcurement(db, { projectId: projectA.id, itemName: "A1", creatorId: creator });
    const a2 = await createProcurement(db, { projectId: projectA.id, itemName: "A2", creatorId: creator });
    await changeStatus(db, logger, a2.id, "ordered", { id: creator, name: "Alice" }, { ip: "1", userAgent: "t" });
    await createProcurement(db, { projectId: projectB.id, itemName: "B1", creatorId: creator });

    const all = await listByProject(db, projectA.id);
    expect(all.total).toBe(2);

    const ordered = await listByProject(db, projectA.id, { status: "ordered" });
    expect(ordered.total).toBe(1);
    expect(ordered.data[0]!.itemName).toBe("A2");

    await softDeleteProcurement(db, a2.id);
    const afterDelete = await listByProject(db, projectA.id);
    expect(afterDelete.total).toBe(1);
  });

  test("filters by category", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const cat = await createCategory(db, project.id, { name: "Equipment" });
    await createProcurement(db, { projectId: project.id, itemName: "Crane", categoryId: cat.id, creatorId: creator });
    await createProcurement(db, { projectId: project.id, itemName: "Sand", creatorId: creator });

    const byCat = await listByProject(db, project.id, { categoryId: cat.id });
    expect(byCat.total).toBe(1);
    expect(byCat.data[0]!.itemName).toBe("Crane");
  });
});

describe("updateProcurement", () => {
  test("patches fields, bumps version, and validates assignment targets", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const assignee = await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    const row = await createProcurement(db, { projectId: project.id, itemName: "Pipes", creatorId: creator });

    const updated = await updateProcurement(db, row.id, {
      title: "Updated order",
      itemName: "Steel pipes",
      assigneeMemberId: assignee.id,
      quantity: 42,
    });
    expect(updated?.title).toBe("Updated order");
    expect(updated?.itemName).toBe("Steel pipes");
    expect(updated?.assigneeMemberId).toBe(assignee.id);
    expect(updated?.quantity).toBe(42);
    expect(updated!.version).toBeGreaterThan(1);

    const other = await createProject(db, { name: "Other", creatorId: creator });
    const foreign = await addMember(db, other.id, { roleId: await memberRoleId(other.id), userId: bob });
    await expect(updateProcurement(db, row.id, { assigneeMemberId: foreign.id })).rejects.toThrow();
  });

  test("returns undefined for an unknown procurement", async () => {
    expect(await updateProcurement(db, "missing00", { itemName: "x" })).toBeUndefined();
  });
});

describe("softDeleteProcurement", () => {
  test("hides the procurement and clears its tuples", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const row = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: creator });

    await softDeleteProcurement(db, row.id);
    expect(await getProcurementByShortId(db, row.id)).toBeUndefined();

    const item = await db.select().from(items).where(eq(items.shortId, row.id)).get();
    const tuples = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item!.id),
    )).all();
    expect(tuples).toEqual([]);
  });
});

describe("capability gating (procurement.view)", () => {
  test("pm and a role-granted member can view; a plain member and an outsider cannot", async () => {
    const creator = await seedUser("Alice"); // pm (all capabilities)
    const granted = await seedUser("Carol");
    const plain = await seedUser("Bob");
    const outsider = await seedUser("Eve");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const viewer = await createRole(db, project.id, { name: "Procurement Viewer", capabilities: ["procurement.view"] });
    await addMember(db, project.id, { roleId: viewer.id, userId: granted });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: plain });

    expect(await hasCapability(db, project.id, creator, "procurement.view")).toBe(true);
    expect(await hasCapability(db, project.id, granted, "procurement.view")).toBe(true);
    expect(await hasCapability(db, project.id, plain, "procurement.view")).toBe(false);
    expect(await getMemberCapabilities(db, project.id, outsider)).toBeNull();
  });
});
