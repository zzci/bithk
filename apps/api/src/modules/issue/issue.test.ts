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
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject } from "@/modules/project/project.service";
import {
  createIssue,
  getIssueByShortId,
  listByProject,
  resolveProjectIssueAccess,
  searchIssues,
  softDeleteIssue,
  updateIssue,
} from "./issue.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;
let sqlite: Database;

// Bootstrap the full schema directly from the definitions so the suite is
// runnable without applying migrations, mirroring `project.service.test.ts`.
const SCHEMA_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tags_refs (
    resource_id TEXT NOT NULL,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (resource_id, tag_id)
  )`,
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
    pinned INTEGER NOT NULL DEFAULT false,
    pinned_at TEXT,
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
    ship_id TEXT,
    cover_reference_id TEXT,
    creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    deleted_at TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_short_id_idx ON projects (short_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS projects_code_idx ON projects (code)`,
  `CREATE TABLE IF NOT EXISTS project_roles (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    capabilities TEXT NOT NULL DEFAULT '[]',
    is_system INTEGER NOT NULL DEFAULT 0,
    kind TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS project_members (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT,
    role_id TEXT NOT NULL REFERENCES project_roles(id),
    title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS project_members_project_user_idx ON project_members (project_id, user_id)`,
  `CREATE TABLE IF NOT EXISTS issue_details (
    item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    due_date TEXT,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
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
  // `createProject` reads `settings` (project defaults) and seeds from
  // `global_procurement_categories` (copy-on-create), so both must exist here.
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS global_procurement_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT,
    description TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
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

/** Resolve the seeded baseline "Member" role id for a project. */
async function memberRoleId(projectId: string): Promise<string> {
  const roles = await listRoles(db, projectId);
  return roles.find(r => r.name === "Reader")!.id;
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
  test("creates a work order with required fields", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const issue = await createIssue(db, { title: "Test task", creatorId: creator, projectId: project.id });
    expect(issue.id).toHaveLength(8); // short_id
    expect(issue.title).toBe("Test task");
    expect(issue.status).toBe("todo");
    expect(issue.priority).toBe("medium");
    expect(issue.creatorId).toBe(creator);
    expect(issue.assigneeId).toBeNull();
    expect(issue.projectId).toBe(project.shortId);
    expect(issue.assigneeMemberId).toBeNull();
    expect(issue.version).toBe(1);

    // The owner tuple is written; no assignee tuple without an assignee.
    const item = await db.select().from(items).where(eq(items.shortId, issue.id)).get();
    const tuples = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item!.id),
    )).all();
    const relations = new Set(tuples.map(t => `${t.relation}@${t.subjectId}`));
    expect(relations.has(`owner@${creator}`)).toBe(true);
    expect([...relations].some(r => r.startsWith("assignee@"))).toBe(false);
  });

  test("internal assignee writes BOTH the column and the user tuple", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const member = await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });

    const issue = await createIssue(db, {
      title: "Work order",
      description: "Detailed",
      priority: "high",
      dueDate: "2026-12-31",
      creatorId: creator,
      projectId: project.id,
      assigneeMemberId: member.id,
    });
    expect(issue.description).toBe("Detailed");
    expect(issue.priority).toBe("high");
    expect(issue.dueDate).toBe("2026-12-31");
    expect(issue.assigneeMemberId).toBe(member.id);
    // Internal member → user tuple is also written.
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
    const ext = await addMember(db, project.id, { roleId: await memberRoleId(project.id), displayName: "Supplier" });

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
    const memberB = await addMember(db, projectB.id, { roleId: await memberRoleId(projectB.id), userId: bob });

    await expect(createIssue(db, {
      title: "Bad",
      creatorId: creator,
      projectId: projectA.id,
      assigneeMemberId: memberB.id,
    })).rejects.toThrow();
  });
});

describe("updateIssue", () => {
  test("changes status; bumps version", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const issue = await createIssue(db, { title: "T", creatorId: creator, projectId: project.id });
    expect(issue.version).toBe(1);
    const updated = await updateIssue(db, issue.id, { status: "working" });
    expect(updated?.status).toBe("working");
    expect(updated!.version).toBeGreaterThan(1);
  });

  test("reassigning resyncs the user tuple (internal → external)", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const roleId = await memberRoleId(project.id);
    const internal = await addMember(db, project.id, { roleId, userId: bob });
    const external = await addMember(db, project.id, { roleId, displayName: "Ext" });

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

    const item = await db.select().from(items).where(eq(items.shortId, issue.id)).get();
    const tuples = await db.select().from(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item!.id),
      eq(relationTuples.relation, "assignee"),
    )).all();
    expect(tuples).toHaveLength(0);
  });

  test("setting assigneeMemberId=null drops the tuple", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const member = await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    const issue = await createIssue(db, { title: "T", creatorId: creator, projectId: project.id, assigneeMemberId: member.id });
    await updateIssue(db, issue.id, { assigneeMemberId: null });
    const refreshed = await getIssueByShortId(db, issue.id);
    expect(refreshed?.assigneeId).toBeNull();
    expect(refreshed?.assigneeMemberId).toBeNull();
  });
});

describe("softDeleteIssue", () => {
  test("stamps deleted_at and clears every tuple", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const project = await createProject(db, { name: "P", creatorId: creator });
    const member = await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
    const issue = await createIssue(db, { title: "T", creatorId: creator, projectId: project.id, assigneeMemberId: member.id });
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

describe("listByProject", () => {
  test("returns only that project's work orders, newest-first", async () => {
    const creator = await seedUser("Alice");
    const projectA = await createProject(db, { name: "A", creatorId: creator });
    const projectB = await createProject(db, { name: "B", creatorId: creator });
    await createIssue(db, { title: "A1", creatorId: creator, projectId: projectA.id });
    await createIssue(db, { title: "A2", creatorId: creator, projectId: projectA.id });
    await createIssue(db, { title: "B1", creatorId: creator, projectId: projectB.id });

    const r = await listByProject(db, { projectId: projectA.id });
    expect(r.total).toBe(2);
    expect(r.data.map(d => d.title).sort()).toEqual(["A1", "A2"]);
  });

  test("paginates with page / limit (newest-first)", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    for (let i = 0; i < 5; i++)
      await createIssue(db, { title: `Task ${i}`, creatorId: creator, projectId: project.id });

    const page1 = await listByProject(db, { projectId: project.id, page: 1, limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.total).toBe(5);
    const page3 = await listByProject(db, { projectId: project.id, page: 3, limit: 2 });
    expect(page3.data).toHaveLength(1);
  });

  test("filters by status / priority / title", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    await createIssue(db, { title: "Fix the bug", creatorId: creator, projectId: project.id, status: "todo", priority: "high" });
    await createIssue(db, { title: "Add feature", creatorId: creator, projectId: project.id, status: "done", priority: "low" });

    expect((await listByProject(db, { projectId: project.id, status: "todo" })).data.map(d => d.title)).toEqual(["Fix the bug"]);
    expect((await listByProject(db, { projectId: project.id, priority: "low" })).data.map(d => d.title)).toEqual(["Add feature"]);
    expect((await listByProject(db, { projectId: project.id, q: "bug" })).data.map(d => d.title)).toEqual(["Fix the bug"]);
  });

  test("a literal % or _ in the title filter is matched literally", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    await createIssue(db, { title: "100% done", creatorId: creator, projectId: project.id });
    await createIssue(db, { title: "100x done", creatorId: creator, projectId: project.id });
    await createIssue(db, { title: "a_b", creatorId: creator, projectId: project.id });
    await createIssue(db, { title: "axb", creatorId: creator, projectId: project.id });

    expect((await listByProject(db, { projectId: project.id, q: "100%" })).data.map(d => d.title)).toEqual(["100% done"]);
    expect((await listByProject(db, { projectId: project.id, q: "a_b" })).data.map(d => d.title)).toEqual(["a_b"]);
  });
});

describe("searchIssues", () => {
  test("non-admin sees only issues in projects they belong to", async () => {
    const me = await seedUser("Me");
    const other = await seedUser("Other");
    const mine = await createProject(db, { name: "Mine", creatorId: me });
    const theirs = await createProject(db, { name: "Theirs", creatorId: other });
    await createIssue(db, { title: "alpha task", creatorId: me, projectId: mine.id });
    await createIssue(db, { title: "alpha order", creatorId: other, projectId: theirs.id });

    const r = await searchIssues(db, { userId: me, isAdmin: false, q: "alpha" });
    expect(r.map(i => i.title)).toEqual(["alpha task"]);
    expect(r[0]!.projectId).toBe(mine.shortId);
  });

  test("admin sees matching issues across all projects", async () => {
    const me = await seedUser("Me");
    const other = await seedUser("Other");
    const admin = await seedUser("Root", "admin");
    const mine = await createProject(db, { name: "Mine", creatorId: me });
    const theirs = await createProject(db, { name: "Theirs", creatorId: other });
    await createIssue(db, { title: "alpha task", creatorId: me, projectId: mine.id });
    await createIssue(db, { title: "alpha order", creatorId: other, projectId: theirs.id });

    const r = await searchIssues(db, { userId: admin, isAdmin: true, q: "alpha" });
    expect(r.map(i => i.title).sort()).toEqual(["alpha order", "alpha task"]);
  });

  test("a literal % or _ in the search term does not over-match as a wildcard", async () => {
    const admin = await seedUser("Root", "admin");
    const project = await createProject(db, { name: "P", creatorId: admin });
    await createIssue(db, { title: "50% off", creatorId: admin, projectId: project.id });
    await createIssue(db, { title: "50x off", creatorId: admin, projectId: project.id });

    const r = await searchIssues(db, { userId: admin, isAdmin: true, q: "50%" });
    expect(r.map(i => i.title)).toEqual(["50% off"]);
  });
});

describe("resolveProjectIssueAccess", () => {
  test("a project member can read; a non-member is fail-closed", async () => {
    const creator = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const outsider = await seedUser("Eve");
    const project = await createProject(db, { name: "P", creatorId: creator });
    await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
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
    const member = await addMember(db, project.id, { roleId: await memberRoleId(project.id), userId: bob });
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
