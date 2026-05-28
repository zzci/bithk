import type { ProcurementStatus } from "./schema";
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
import * as contactService from "@/modules/contact/contact.service";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { createCategory } from "@/modules/project/project.categories";
import { createRole, listRoles } from "@/modules/project/project.roles";
import { addMember, createProject, getMemberCapabilities, hasCapability } from "@/modules/project/project.service";
import {
  changeStatus,
  createProcurement,
  getProcurementByShortId,
  listByProject,
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

async function seedGlobalContact(ownerId: string, name = "Supplier Co") {
  return await contactService.create(db, { id: ownerId, role: "user" }, { name });
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

  test("writes issue-parity fields and defaults priority to medium", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });

    const withFields = await createProcurement(db, {
      projectId: project.id,
      itemName: "Generators",
      description: "Backup power units",
      priority: "high",
      dueDate: "2026-09-01",
      creatorId: creator,
    });
    expect(withFields.description).toBe("Backup power units");
    expect(withFields.priority).toBe("high");
    expect(withFields.dueDate).toBe("2026-09-01");

    const defaults = await createProcurement(db, {
      projectId: project.id,
      itemName: "Bolts",
      creatorId: creator,
    });
    expect(defaults.priority).toBe("medium");
    expect(defaults.description).toBeNull();
    expect(defaults.dueDate).toBeNull();

    // The fields also surface through list responses.
    const listed = await listByProject(db, project.id);
    const generators = listed.data.find(r => r.itemName === "Generators")!;
    expect(generators.priority).toBe("high");
    expect(generators.description).toBe("Backup power units");
    expect(generators.dueDate).toBe("2026-09-01");
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

  test("accepts any global contact, a category, and a member assignee", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const contactOwner = await seedUser("Carol");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const supplier = await seedGlobalContact(contactOwner);
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

  test("rejects an unknown supplier contact", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    await expect(createProcurement(db, {
      projectId: project.id,
      itemName: "X",
      supplierId: "missing-supplier",
      creatorId: creator,
    })).rejects.toThrow("Supplier is not a valid contact");
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
  test("paginates, filters by status, scopes to the project", async () => {
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
  });

  test("filters by the cancelled status", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const keep = await createProcurement(db, { projectId: project.id, itemName: "Keep", creatorId: creator });
    const drop = await createProcurement(db, { projectId: project.id, itemName: "Drop", creatorId: creator });
    await changeStatus(db, logger, drop.id, "cancelled", { id: creator, name: "Alice" }, { ip: "1", userAgent: "t" });

    const cancelled = await listByProject(db, project.id, { status: "cancelled" });
    expect(cancelled.total).toBe(1);
    expect(cancelled.data[0]!.itemName).toBe("Drop");

    // The non-cancelled procurement is still listed and untouched.
    const all = await listByProject(db, project.id);
    expect(all.total).toBe(2);
    expect(all.data.map(r => r.itemName)).toContain(keep.itemName);
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
    const contactOwner = await seedUser("Carol");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const supplier = await seedGlobalContact(contactOwner, "Global Supplier");
    const assignee = await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    const row = await createProcurement(db, { projectId: project.id, itemName: "Pipes", creatorId: creator });

    const updated = await updateProcurement(db, row.id, {
      title: "Updated order",
      itemName: "Steel pipes",
      supplierId: supplier.id,
      assigneeMemberId: assignee.id,
      quantity: 42,
    });
    expect(updated?.title).toBe("Updated order");
    expect(updated?.itemName).toBe("Steel pipes");
    expect(updated?.supplierId).toBe(supplier.id);
    expect(updated?.assigneeMemberId).toBe(assignee.id);
    expect(updated?.quantity).toBe(42);
    expect(updated!.version).toBeGreaterThan(1);

    const other = await createProject(db, { name: "Other", creatorId: creator });
    const foreign = await addMember(db, other.id, { roleId: await memberRoleId(other.id), userId: bob });
    await expect(updateProcurement(db, row.id, { assigneeMemberId: foreign.id })).rejects.toThrow();
    await expect(updateProcurement(db, row.id, { supplierId: "missing-supplier" })).rejects.toThrow("Supplier is not a valid contact");
  });

  test("patches issue-parity fields and clears description / dueDate to null", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const row = await createProcurement(db, {
      projectId: project.id,
      itemName: "Cranes",
      description: "Initial note",
      priority: "low",
      dueDate: "2026-08-01",
      creatorId: creator,
    });

    const updated = await updateProcurement(db, row.id, {
      description: "Revised note",
      priority: "urgent",
      dueDate: "2026-12-31",
    });
    expect(updated?.description).toBe("Revised note");
    expect(updated?.priority).toBe("urgent");
    expect(updated?.dueDate).toBe("2026-12-31");

    // Sending null clears description and dueDate; priority is left untouched.
    const cleared = await updateProcurement(db, row.id, { description: null, dueDate: null });
    expect(cleared?.description).toBeNull();
    expect(cleared?.dueDate).toBeNull();
    expect(cleared?.priority).toBe("urgent");
  });

  test("returns undefined for an unknown procurement", async () => {
    expect(await updateProcurement(db, "missing00", { itemName: "x" })).toBeUndefined();
  });
});

describe("cancellation (procurement is non-deletable)", () => {
  test("moving to cancelled preserves the row, its base item, and its owner tuple", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const row = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: creator });

    await changeStatus(db, logger, row.id, "cancelled", { id: creator, name: "Alice" }, { ip: "1", userAgent: "t" });

    // The procurement is still addressable — cancellation is not deletion.
    const after = await getProcurementByShortId(db, row.id);
    expect(after?.status).toBe("cancelled");

    const item = await db.select().from(items).where(eq(items.shortId, row.id)).get();
    expect(item!.deletedAt).toBeNull();
    const tuples = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item!.id),
    )).all();
    expect(tuples).toHaveLength(1);
    expect(tuples[0]!.relation).toBe("owner");
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

// Lock-in for L1 DECISION 1 (2026-05-23): procurement status is an intentional
// FREE-TRANSITION manual tracker (any -> any), enum-validated and fully
// audited — NOT a state machine. These tests pin that contract so a future
// change cannot silently introduce transition restrictions.
// See docs/decisions/2026-05-23-procurement-free-transitions.md.
describe("status free transitions (lock-in)", () => {
  test("every status reachable from every other status, each audited with from/to + version bump", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const row = await createProcurement(db, { projectId: project.id, itemName: "Valves", creatorId: creator });
    expect(row.status).toBe("draft");

    // A deliberately non-linear tour: forward, backward, skip-ahead, and both
    // into and back OUT of the terminal-looking "closed" state.
    const tour: ProcurementStatus[] = [
      "requested",
      "ordered",
      "draft", // backward
      "closed", // skip ahead to the terminal-looking state
      "received", // OUT of closed — proves it is not terminal
      "ordered", // backward again
    ];

    let previous = row.status;
    let lastVersion = row.version;
    for (const next of tour) {
      const updated = await changeStatus(
        db,
        logger,
        row.id,
        next,
        { id: creator, name: "Alice" },
        { ip: "127.0.0.1", userAgent: "test" },
      );
      expect(updated?.status).toBe(next);
      expect(updated!.version).toBeGreaterThan(lastVersion);
      lastVersion = updated!.version;
      previous = next;
    }
    expect(previous).toBe("ordered");

    // One audit event per transition, each carrying the correct from/to pair.
    const events = await db.select().from(auditEvents).where(eq(auditEvents.action, "procurement.status_changed")).all();
    expect(events).toHaveLength(tour.length);
    const pairs = events
      .map(e => JSON.parse(e.detail!) as { from: string; to: string })
      .map(d => `${d.from}->${d.to}`);
    expect(pairs).toEqual([
      "draft->requested",
      "requested->ordered",
      "ordered->draft",
      "draft->closed",
      "closed->received",
      "received->ordered",
    ]);
  });

  test("the isProcurementStatus guard rejects an unknown status (defence behind the zod boundary)", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const row = await createProcurement(db, { projectId: project.id, itemName: "X", creatorId: creator });

    await expect(changeStatus(
      db,
      logger,
      row.id,
      "shipped" as ProcurementStatus, // not in PROCUREMENT_STATUSES
      { id: creator, name: "Alice" },
      { ip: "127.0.0.1", userAgent: "test" },
    )).rejects.toThrow();

    // The rejected change leaves the stored status untouched.
    const after = await getProcurementByShortId(db, row.id);
    expect(after?.status).toBe("draft");
  });
});
