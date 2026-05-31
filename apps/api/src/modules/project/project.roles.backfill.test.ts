import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import {
  backfillProjectRoles,
  COMMENTER_CAPS,
  READER_CAPS,
  WRITER_CAPS,
} from "./project.roles";
import { projectMembers, projectRoles, projects } from "./schema";

const nanoid8 = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-backfill-${Date.now()}-${nanoid8()}`);
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

// ── helpers ───────────────────────────────────────────────────────────────

async function seedUser(): Promise<string> {
  const id = nanoid8();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `user-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

/**
 * Insert a legacy-shaped project:
 *   - Project Owner (isSystem=1, kind=null, full caps)
 *   - Member (isSystem=0, kind=null, empty caps)
 *   - one project_members row pointing at Member
 */
async function insertLegacyProject(): Promise<{
  projectId: string;
  ownerRoleId: string;
  memberRoleId: string;
  memberId: string;
}> {
  const projectId = nanoid8();
  const ownerRoleId = nanoid8();
  const memberRoleId = nanoid8();
  const memberId = nanoid8();
  const now = new Date().toISOString();
  const userId = await seedUser();

  await db.insert(projects).values({
    id: projectId,
    shortId: nanoid8(),
    code: `P-${nanoid8()}`,
    name: "Legacy Project",
    status: "active",
    creatorId: userId,
    version: 1,
    updatedAt: now,
  }).run();

  // Legacy owner: isSystem=1, kind=null
  await db.insert(projectRoles).values({
    id: ownerRoleId,
    projectId,
    name: "Project Owner",
    capabilities: JSON.stringify([
      "issue.view",
      "issue.comment",
      "issue.manage",
      "procurement.view",
      "procurement.comment",
      "procurement.manage",
      "files.view",
      "files.manage",
      "categories.manage",
      "members.manage",
      "roles.manage",
      "project.manage",
    ]),
    isSystem: 1,
    kind: null,
    createdAt: now,
    updatedAt: now,
  }).run();

  // Legacy member: isSystem=0, kind=null, empty caps
  await db.insert(projectRoles).values({
    id: memberRoleId,
    projectId,
    name: "Member",
    capabilities: "[]",
    isSystem: 0,
    kind: null,
    createdAt: now,
    updatedAt: now,
  }).run();

  // A project_member row pointing at the Member role
  await db.insert(projectMembers).values({
    id: memberId,
    projectId,
    userId,
    roleId: memberRoleId,
    createdAt: now,
    updatedAt: now,
  }).run();

  return { projectId, ownerRoleId, memberRoleId, memberId };
}

/**
 * Insert a new-style project (already has Owner+Guest+Reader+Commenter+Writer).
 */
async function insertNewStyleProject(): Promise<{ projectId: string }> {
  const projectId = nanoid8();
  const now = new Date().toISOString();
  const userId = await seedUser();

  await db.insert(projects).values({
    id: projectId,
    shortId: nanoid8(),
    code: `P-${nanoid8()}`,
    name: "New-style Project",
    status: "active",
    creatorId: userId,
    version: 1,
    updatedAt: now,
  }).run();

  await db.insert(projectRoles).values([
    {
      id: nanoid8(),
      projectId,
      name: "Project Owner",
      capabilities: "[]",
      isSystem: 1,
      kind: "owner",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: nanoid8(),
      projectId,
      name: "Guest",
      capabilities: "[]",
      isSystem: 1,
      kind: "guest",
      createdAt: now,
      updatedAt: now,
    },
    {
      id: nanoid8(),
      projectId,
      name: "Reader",
      capabilities: JSON.stringify([...READER_CAPS]),
      isSystem: 0,
      kind: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: nanoid8(),
      projectId,
      name: "Commenter",
      capabilities: JSON.stringify([...COMMENTER_CAPS]),
      isSystem: 0,
      kind: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: nanoid8(),
      projectId,
      name: "Writer",
      capabilities: JSON.stringify([...WRITER_CAPS]),
      isSystem: 0,
      kind: null,
      createdAt: now,
      updatedAt: now,
    },
  ]).run();

  return { projectId };
}

// ── tests ─────────────────────────────────────────────────────────────────

describe("backfillProjectRoles", () => {
  test("backfills legacy project: owner kind set, guest inserted, member→reader, presets added", async () => {
    const { projectId, ownerRoleId, memberRoleId, memberId } = await insertLegacyProject();

    const result = await backfillProjectRoles(db);

    expect(result.projectsScanned).toBe(1);
    expect(result.projectsTouched).toBe(1);

    const projRoles = await db
      .select()
      .from(projectRoles)
      .where(eq(projectRoles.projectId, projectId))
      .all();

    // 1. Owner kind is now 'owner'
    const ownerRow = projRoles.find(r => r.id === ownerRoleId);
    expect(ownerRow).toBeDefined();
    expect(ownerRow!.kind).toBe("owner");

    // 2. Guest role exists: isSystem=1, kind='guest', empty caps
    const guestRow = projRoles.find(r => r.kind === "guest");
    expect(guestRow).toBeDefined();
    expect(guestRow!.isSystem).toBe(1);
    expect(JSON.parse(guestRow!.capabilities)).toEqual([]);

    // 3. The old Member row (same id) is now named "Reader" with READER_CAPS
    const readerRow = projRoles.find(r => r.id === memberRoleId);
    expect(readerRow).toBeDefined();
    expect(readerRow!.name).toBe("Reader");
    expect(JSON.parse(readerRow!.capabilities)).toEqual([...READER_CAPS]);
    expect(readerRow!.isSystem).toBe(0);
    expect(readerRow!.kind).toBeNull();

    // The project_member still points at the same row id (now Reader)
    const member = await db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.id, memberId))
      .get();
    expect(member).toBeDefined();
    expect(member!.roleId).toBe(memberRoleId);

    // 4. Commenter and Writer presets are present
    const commenterRow = projRoles.find(r => r.name === "Commenter");
    expect(commenterRow).toBeDefined();
    expect(JSON.parse(commenterRow!.capabilities)).toEqual([...COMMENTER_CAPS]);

    const writerRow = projRoles.find(r => r.name === "Writer");
    expect(writerRow).toBeDefined();
    expect(JSON.parse(writerRow!.capabilities)).toEqual([...WRITER_CAPS]);

    // Exactly 5 roles: Owner + Guest + Reader (ex-Member) + Commenter + Writer
    expect(projRoles.length).toBe(5);
  });

  test("idempotent: second run produces no additional roles", async () => {
    await insertLegacyProject();

    await backfillProjectRoles(db);

    const countAfterFirst = (await db.select().from(projectRoles).all()).length;

    const result2 = await backfillProjectRoles(db);
    expect(result2.projectsTouched).toBe(0);
    expect(result2.rolesInserted).toBe(0);

    const countAfterSecond = (await db.select().from(projectRoles).all()).length;
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  test("new-style project is untouched", async () => {
    const { projectId } = await insertNewStyleProject();

    const rolesBefore = await db
      .select()
      .from(projectRoles)
      .where(eq(projectRoles.projectId, projectId))
      .all();

    const result = await backfillProjectRoles(db);

    expect(result.projectsTouched).toBe(0);
    expect(result.rolesInserted).toBe(0);

    const rolesAfter = await db
      .select()
      .from(projectRoles)
      .where(eq(projectRoles.projectId, projectId))
      .all();
    expect(rolesAfter.length).toBe(rolesBefore.length);
  });

  test("mixed: only the legacy project is touched", async () => {
    await insertNewStyleProject();
    const { ownerRoleId } = await insertLegacyProject();

    const result = await backfillProjectRoles(db);

    expect(result.projectsScanned).toBe(2);
    expect(result.projectsTouched).toBe(1);

    const ownerRow = await db
      .select()
      .from(projectRoles)
      .where(eq(projectRoles.id, ownerRoleId))
      .get();
    expect(ownerRow!.kind).toBe("owner");
  });

  test("no projects: backfill is a no-op", async () => {
    const result = await backfillProjectRoles(db);
    expect(result.projectsScanned).toBe(0);
    expect(result.projectsTouched).toBe(0);
    expect(result.rolesInserted).toBe(0);
  });
});
