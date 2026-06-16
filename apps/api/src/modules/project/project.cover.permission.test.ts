import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { projectCoverPermissionHook, projectDefaultCoverPermissionHook } from "./project.cover.permission";
import { createProject } from "./project.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

async function seedUser(role: "admin" | "user" = "user"): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `user-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-project-cover-perm-${Date.now()}-${nanoid()}`);
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

describe("project cover permission hook — admin bypass", () => {
  test("an app admin reads and deletes a cover without being a project member", async () => {
    const creator = await seedUser("user");
    const admin = await seedUser("admin");
    const project = await createProject(db, { name: "Hangar", creatorId: creator });
    const ref = { ownerId: project.id } as Parameters<typeof projectCoverPermissionHook.canRead>[2];

    // The admin is not a member of this project; the `actor.role === "admin"`
    // early-return is the only thing granting access.
    expect(await projectCoverPermissionHook.canRead(db, { id: admin, role: "admin" }, ref)).toBe(true);
    expect(await projectCoverPermissionHook.canDelete(db, { id: admin, role: "admin" }, ref)).toBe(true);
  });

  test("the admin bypass holds even for an unknown project owner id", async () => {
    const admin = await seedUser("admin");
    const ref = { ownerId: "missing-project" } as Parameters<typeof projectCoverPermissionHook.canDelete>[2];

    // Membership lookup would fail for a non-existent project, so a `true`
    // result proves the admin branch short-circuits before any DB read.
    expect(await projectCoverPermissionHook.canRead(db, { id: admin, role: "admin" }, ref)).toBe(true);
    expect(await projectCoverPermissionHook.canDelete(db, { id: admin, role: "admin" }, ref)).toBe(true);
  });
});

describe("project default cover permission hook", () => {
  test("any authenticated user reads; delete is admin-only", async () => {
    const user = await seedUser("user");
    const admin = await seedUser("admin");
    const ref = { ownerId: "global" } as Parameters<typeof projectDefaultCoverPermissionHook.canRead>[2];

    // Read is open to any authenticated actor (the default cover is read-only
    // branding seeded onto new projects).
    expect(await projectDefaultCoverPermissionHook.canRead(db, { id: user, role: "user" }, ref)).toBe(true);
    // Delete stays admin-only — the default is managed through admin routes.
    expect(await projectDefaultCoverPermissionHook.canDelete(db, { id: user, role: "user" }, ref)).toBe(false);
    expect(await projectDefaultCoverPermissionHook.canDelete(db, { id: admin, role: "admin" }, ref)).toBe(true);
  });
});
