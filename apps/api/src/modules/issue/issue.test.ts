import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { customAlphabet } from "nanoid";
import * as schema from "@/db/schema";
import { users } from "@/modules/account/users/schema";
import { items } from "@/modules/item/schema";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { relationTuples } from "@/modules/policy/schema";
import { addMember, createProject } from "@/modules/project/project.service";
import {
  createIssue,
  getIssueByShortId,
  listByProject,
  listIssues,
  listMyIssues,
  resolveProjectIssueAccess,
  softDeleteIssue,
  updateIssue,
} from "./issue.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;
let sqlite: Database;

// The Drizzle migration adds the new `issue_details.project_id` /
// `assignee_member_id` columns and the `projects` / `project_members` tables,
// but the coordinator generates it after this work lands. Bootstrap the full
// schema directly from the definitions so the suite is runnable now, mirroring
// the approach in `project.service.test.ts`.
const SCHEMA_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    oauth_sub TEXT NOT NULL,
    username TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    avatar TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_items_short_id ON items (short_id)`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    short_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    description TEXT,
    start_date TEXT,
    end_date TEXT,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_short_id_idx ON projects (short_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_code_idx ON projects (code)`,
  `CREATE TABLE IF NOT EXISTS project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    member_type TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT,
    external_ref TEXT,
    supplier_info TEXT,
    can_view_procurement INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_user_idx ON project_members (project_id, user_id)`,
  `CREATE TABLE IF NOT EXISTS issue_details (
    item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    assignee_member_id TEXT REFERENCES project_members(id) ON DELETE SET NULL
  )`,
  `CREATE INDEX IF NOT EXISTS issue_project_idx ON issue_details (project_id)`,
  `CREATE TABLE IF NOT EXISTS relation_tuples (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    object_id TEXT NOT NULL,
    relation TEXT NOT NULL,
    subject_namespace TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    subject_relation TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT NOT NULL,
    UNIQUE (namespace, object_id, relation, subject_namespace, subject_id, subject_relation)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tuples_object ON relation_tuples (namespace, object_id, relation)`,
  `CREATE INDEX IF NOT EXISTS idx_tuples_subject ON relation_tuples (subject_namespace, subject_id, subject_relation)`,
];

function makeDb(path: string): AppDatabase {
  sqlite = new Database(path, { create: true, strict: true });
  sqlite.exec("PRAGMA foreign_keys = ON");
  const drizzled = drizzle(sqlite, { schema });
  for (const ddl of SCHEMA_DDL)
    drizzled.run(sql.raw(ddl));
  return Object.assign(drizzled, { close: () => sqlite.close() }) as AppDatabase;
}

async function seedUser(name: string, role: "admin" | "user" = "user"): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `${name.toLowerCase()}-${id}`,
    name,
    email: `${id}@test.com`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

beforeEach(() => {
  const dir = resolve(tmpdir(), `test-issue-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = makeDb(dbPath);
  loadNamespaces();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("createIssue", () => {
  test("creates with required fields", async () => {
    const userId = await seedUser("Alice");
    const issue = await createIssue(db, { title: "Test task", creatorId: userId });
    expect(issue.id).toHaveLength(8); // short_id
    expect(issue.title).toBe("Test task");
    expect(issue.status).toBe("open");
    expect(issue.priority).toBe("medium");
    expect(issue.creatorId).toBe(userId);
    expect(issue.assigneeId).toBeNull();
    expect(issue.projectId).toBeNull();
    expect(issue.assigneeMemberId).toBeNull();
    expect(issue.version).toBe(1);
  });

  test("writes the owner tuple + writes assignee tuple when provided", async () => {
    const creator = await seedUser("Alice");
    const assignee = await seedUser("Bob");
    const issue = await createIssue(db, {
      title: "Full task",
      description: "Detailed",
      priority: "high",
      creatorId: creator,
      assigneeId: assignee,
      dueDate: "2026-12-31",
    });
    expect(issue.description).toBe("Detailed");
    expect(issue.priority).toBe("high");
    expect(issue.assigneeId).toBe(assignee);
    expect(issue.dueDate).toBe("2026-12-31");

    // The item id (ulid) is on `items.short_id = issue.id` → resolve back.
    const item = await db.select().from(items).where(eq(items.shortId, issue.id)).get();
    const tuples = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item!.id),
    )).all();
    const relations = new Set(tuples.map(t => `${t.relation}@${t.subjectId}`));
    expect(relations.has(`owner@${creator}`)).toBe(true);
    expect(relations.has(`assignee@${assignee}`)).toBe(true);
  });
});

describe("updateIssue", () => {
  test("changes status; bumps version", async () => {
    const userId = await seedUser("Alice");
    const issue = await createIssue(db, { title: "T", creatorId: userId });
    expect(issue.version).toBe(1);
    const updated = await updateIssue(db, issue.id, { status: "in_progress" });
    expect(updated?.status).toBe("in_progress");
    expect(updated!.version).toBeGreaterThan(1);
  });

  test("swaps the assignee tuple (1 in, 1 out)", async () => {
    const creator = await seedUser("Alice");
    const a = await seedUser("Bob");
    const b = await seedUser("Carol");
    const issue = await createIssue(db, { title: "T", creatorId: creator, assigneeId: a });
    expect(issue.assigneeId).toBe(a);
    const updated = await updateIssue(db, issue.id, { assigneeId: b });
    expect(updated?.assigneeId).toBe(b);

    const item = await db.select().from(items).where(eq(items.shortId, issue.id)).get();
    const tuples = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item!.id),
      eq(relationTuples.relation, "assignee"),
    )).all();
    expect(tuples).toHaveLength(1);
    expect(tuples[0]!.subjectId).toBe(b);
  });

  test("setting assigneeId=null drops the tuple", async () => {
    const creator = await seedUser("Alice");
    const a = await seedUser("Bob");
    const issue = await createIssue(db, { title: "T", creatorId: creator, assigneeId: a });
    await updateIssue(db, issue.id, { assigneeId: null });
    const refreshed = await getIssueByShortId(db, issue.id);
    expect(refreshed?.assigneeId).toBeNull();
  });
});

describe("softDeleteIssue", () => {
  test("stamps deleted_at and clears every tuple", async () => {
    const creator = await seedUser("Alice");
    const a = await seedUser("Bob");
    const issue = await createIssue(db, { title: "T", creatorId: creator, assigneeId: a });
    await softDeleteIssue(db, issue.id);
    expect(await getIssueByShortId(db, issue.id)).toBeUndefined();
    const item = await db.select().from(items).where(eq(items.shortId, issue.id)).get();
    const tuples = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item!.id),
    )).all();
    expect(tuples).toEqual([]);
  });
});

describe("listIssues (admin path)", () => {
  test("paginates and orders newest-first", async () => {
    const userId = await seedUser("Alice");
    for (let i = 0; i < 5; i++)
      await createIssue(db, { title: `Task ${i}`, creatorId: userId });
    const page1 = await listIssues(db, { page: 1, limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    const page3 = await listIssues(db, { page: 3, limit: 2 });
    expect(page3.data).toHaveLength(1);
  });

  test("filters by status", async () => {
    const userId = await seedUser("Alice");
    await createIssue(db, { title: "Open", creatorId: userId, status: "open" });
    await createIssue(db, { title: "Done", creatorId: userId, status: "done" });
    const r = await listIssues(db, { status: "open" });
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.title).toBe("Open");
  });

  test("filters by priority", async () => {
    const userId = await seedUser("Alice");
    await createIssue(db, { title: "Low", creatorId: userId, priority: "low" });
    await createIssue(db, { title: "High", creatorId: userId, priority: "high" });
    const r = await listIssues(db, { priority: "high" });
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.title).toBe("High");
  });

  test("filters by search (LIKE on title)", async () => {
    const userId = await seedUser("Alice");
    await createIssue(db, { title: "Fix the bug", creatorId: userId });
    await createIssue(db, { title: "Add feature", creatorId: userId });
    const r = await listIssues(db, { q: "bug" });
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.title).toBe("Fix the bug");
  });

  test("filters by assignee id via the policy tuple set", async () => {
    const creator = await seedUser("Alice");
    const target = await seedUser("Bob");
    const other = await seedUser("Carol");
    await createIssue(db, { title: "Assigned", creatorId: creator, assigneeId: target });
    await createIssue(db, { title: "Free", creatorId: creator });
    await createIssue(db, { title: "Other", creatorId: creator, assigneeId: other });
    const r = await listIssues(db, { assigneeId: target });
    expect(r.data).toHaveLength(1);
    expect(r.data[0]!.title).toBe("Assigned");
  });

  test("excludes project work orders from the personal admin list", async () => {
    const creator = await seedUser("Alice");
    await createIssue(db, { title: "Personal", creatorId: creator });
    const project = await createProject(db, { name: "P", creatorId: creator });
    await createIssue(db, { title: "Work order", creatorId: creator, projectId: project.id });
    const r = await listIssues(db, {});
    expect(r.data.map(d => d.title)).toEqual(["Personal"]);
  });
});

describe("listMyIssues", () => {
  test("returns issues I created OR have been assigned", async () => {
    const me = await seedUser("Me");
    const other = await seedUser("Other");
    const minePlain = await createIssue(db, { title: "Mine plain", creatorId: me });
    const assignedToMe = await createIssue(db, { title: "Assigned to me", creatorId: other, assigneeId: me });
    await createIssue(db, { title: "Theirs entirely", creatorId: other });
    const r = await listMyIssues(db, { userId: me });
    const ids = r.data.map(d => d.id).sort();
    expect(ids).toEqual([minePlain.id, assignedToMe.id].sort());
  });

  test("excludes project work orders even when I created them", async () => {
    const me = await seedUser("Me");
    const personal = await createIssue(db, { title: "Personal", creatorId: me });
    const project = await createProject(db, { name: "P", creatorId: me });
    await createIssue(db, { title: "Work order", creatorId: me, projectId: project.id });
    const r = await listMyIssues(db, { userId: me });
    expect(r.data.map(d => d.id)).toEqual([personal.id]);
  });
});

describe("project issues", () => {
  test("internal assignee writes BOTH the column and the user tuple", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const member = await addMember(db, project.id, { memberType: "internal", userId: bob });

    const issue = await createIssue(db, {
      title: "Work order",
      creatorId: creator,
      projectId: project.id,
      assigneeMemberId: member.id,
    });
    expect(issue.projectId).toBe(project.shortId);
    expect(issue.assigneeMemberId).toBe(member.id);
    // Internal member → legacy user tuple is also written.
    expect(issue.assigneeId).toBe(bob);

    const item = await db.select().from(items).where(eq(items.shortId, issue.id)).get();
    const tuples = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item!.id),
      eq(relationTuples.relation, "assignee"),
    )).all();
    expect(tuples).toHaveLength(1);
    expect(tuples[0]!.subjectId).toBe(bob);
  });

  test("external assignee writes ONLY the column (no user tuple)", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const ext = await addMember(db, project.id, { memberType: "external", displayName: "Supplier" });

    const issue = await createIssue(db, {
      title: "External order",
      creatorId: creator,
      projectId: project.id,
      assigneeMemberId: ext.id,
    });
    expect(issue.assigneeMemberId).toBe(ext.id);
    expect(issue.assigneeId).toBeNull();

    const item = await db.select().from(items).where(eq(items.shortId, issue.id)).get();
    const tuples = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item!.id),
      eq(relationTuples.relation, "assignee"),
    )).all();
    expect(tuples).toHaveLength(0);
  });

  test("rejects an assignee member that is not on the project", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const projectA = await createProject(db, { name: "A", creatorId: creator });
    const projectB = await createProject(db, { name: "B", creatorId: creator });
    const memberB = await addMember(db, projectB.id, { memberType: "internal", userId: bob });

    await expect(createIssue(db, {
      title: "Bad",
      creatorId: creator,
      projectId: projectA.id,
      assigneeMemberId: memberB.id,
    })).rejects.toThrow();
  });

  test("listByProject returns only that project's open work orders", async () => {
    const creator = await seedUser("Alice");
    const projectA = await createProject(db, { name: "A", creatorId: creator });
    const projectB = await createProject(db, { name: "B", creatorId: creator });
    await createIssue(db, { title: "A1", creatorId: creator, projectId: projectA.id });
    await createIssue(db, { title: "A2", creatorId: creator, projectId: projectA.id });
    await createIssue(db, { title: "B1", creatorId: creator, projectId: projectB.id });
    await createIssue(db, { title: "Personal", creatorId: creator });

    const r = await listByProject(db, { projectId: projectA.id });
    expect(r.total).toBe(2);
    expect(r.data.map(d => d.title).sort()).toEqual(["A1", "A2"]);
  });

  test("reassigning a project issue resyncs the user tuple (internal → external)", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const internal = await addMember(db, project.id, { memberType: "internal", userId: bob });
    const external = await addMember(db, project.id, { memberType: "external", displayName: "Ext" });

    const issue = await createIssue(db, {
      title: "Order",
      creatorId: creator,
      projectId: project.id,
      assigneeMemberId: internal.id,
    });
    expect(issue.assigneeId).toBe(bob);

    const updated = await updateIssue(db, issue.id, { assigneeMemberId: external.id });
    expect(updated?.assigneeMemberId).toBe(external.id);
    expect(updated?.assigneeId).toBeNull();
  });
});

describe("resolveProjectIssueAccess", () => {
  test("a project member can read; a non-member is fail-closed", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const outsider = await seedUser("Eve");
    const project = await createProject(db, { name: "P", creatorId: creator });
    await addMember(db, project.id, { memberType: "internal", userId: bob, role: "member" });
    const issue = await createIssue(db, { title: "Order", creatorId: creator, projectId: project.id });
    const item = (await db.select().from(items).where(eq(items.shortId, issue.id)).get())!;

    const memberAccess = await resolveProjectIssueAccess(db, item, project.id, bob);
    expect(memberAccess.canRead).toBe(true);

    const outsiderAccess = await resolveProjectIssueAccess(db, item, project.id, outsider);
    expect(outsiderAccess.canRead).toBe(false);
    expect(outsiderAccess.canEdit).toBe(false);
  });

  test("the assignee can only update status; pm/creator can edit", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const member = await addMember(db, project.id, { memberType: "internal", userId: bob, role: "member" });
    const issue = await createIssue(db, {
      title: "Order",
      creatorId: creator,
      projectId: project.id,
      assigneeMemberId: member.id,
    });
    const item = (await db.select().from(items).where(eq(items.shortId, issue.id)).get())!;

    const assigneeAccess = await resolveProjectIssueAccess(db, item, project.id, bob);
    expect(assigneeAccess.isAssignee).toBe(true);
    expect(assigneeAccess.canEdit).toBe(false); // member assignee → status only

    const pmAccess = await resolveProjectIssueAccess(db, item, project.id, creator);
    expect(pmAccess.canEdit).toBe(true); // pm + creator
  });
});
