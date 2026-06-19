import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { addGroupMember, createGroup } from "@/modules/account/groups/groups.service";
import { users } from "@/modules/account/users/schema";
import {
  createVirtualUser,
  deleteVirtualUser,
  getUserById,
  getUserGroups,
  listActiveUsers,
  listAssignableUsers,
  listUsers,
  updateUser,
  updateVirtualUser,
} from "./users.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

async function seedUser(overrides: Partial<{
  id: string;
  oauthSub: string;
  username: string;
  name: string;
  email: string;
  role: "admin" | "user";
  status: "active" | "disabled";
}> = {}) {
  const id = overrides.id ?? nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: overrides.oauthSub ?? `sub-${id}`,
    username: overrides.username ?? `user-${id}`,
    name: overrides.name ?? `User ${id}`,
    email: overrides.email ?? `${id}@test.com`,
    role: overrides.role ?? "user",
    status: overrides.status ?? "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-user-${Date.now()}-${nanoid()}`);
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

describe("listUsers", () => {
  test("returns paginated results", async () => {
    for (let i = 0; i < 25; i++) await seedUser();
    const result = await listUsers(db, { page: 1, limit: 10 });
    expect(result.data.length).toBe(10);
    expect(result.total).toBe(25);
    expect(result.totalPages).toBe(3);
  });

  test("searches by name and email", async () => {
    await seedUser({ name: "Alice Smith", email: "alice@test.com", username: "alice" });
    await seedUser({ name: "Bob Jones", email: "bob@test.com", username: "bob" });

    const byName = await listUsers(db, { q: "alice", page: 1, limit: 20 });
    expect(byName.data.length).toBe(1);
    expect(byName.data[0]!.name).toBe("Alice Smith");

    const byEmail = await listUsers(db, { q: "bob@", page: 1, limit: 20 });
    expect(byEmail.data.length).toBe(1);
  });

  test("treats a literal underscore in the query as a literal, not a wildcard", async () => {
    // Without LIKE escaping, `_` is a single-char wildcard and `a_c` would
    // also match `axc` — an over-match that leaks the caller's wildcards.
    await seedUser({ name: "a_c", email: "lit-underscore@test.com", username: "lit-underscore" });
    await seedUser({ name: "axc", email: "wild-underscore@test.com", username: "wild-underscore" });

    const result = await listUsers(db, { q: "a_c", page: 1, limit: 20 });
    expect(result.total).toBe(1);
    expect(result.data[0]!.name).toBe("a_c");
  });

  test("treats a literal percent in the query as a literal, not a wildcard", async () => {
    // Without escaping, `%` matches any substring, so `50%off` would match
    // both rows below.
    await seedUser({ name: "50%off", email: "lit-percent@test.com", username: "lit-percent" });
    await seedUser({ name: "50 great big off", email: "wild-percent@test.com", username: "wild-percent" });

    const result = await listUsers(db, { q: "50%off", page: 1, limit: 20 });
    expect(result.total).toBe(1);
    expect(result.data[0]!.name).toBe("50%off");
  });

  test("a bare wildcard query no longer matches every row", async () => {
    await seedUser({ name: "Zoe", email: "zoe@test.com", username: "zoe" });
    await seedUser({ name: "Yan", email: "yan@test.com", username: "yan" });

    // `%` alone would match all rows pre-fix; escaped it matches only a
    // literal percent, of which there are none.
    const result = await listUsers(db, { q: "%", page: 1, limit: 20 });
    expect(result.total).toBe(0);
  });

  test("filters by role", async () => {
    await seedUser({ role: "admin" });
    await seedUser({ role: "user" });
    await seedUser({ role: "user" });

    const admins = await listUsers(db, { role: "admin", page: 1, limit: 20 });
    expect(admins.total).toBe(1);
  });

  test("filters by status", async () => {
    await seedUser({ status: "active" });
    await seedUser({ status: "disabled" });

    const active = await listUsers(db, { status: "active", page: 1, limit: 20 });
    expect(active.total).toBe(1);
  });

  test("filters by group", async () => {
    const u1 = await seedUser();
    await seedUser();
    const group = await createGroup(db, { name: "test-group" });
    await addGroupMember(db, group.id, u1);

    const result = await listUsers(db, { groupId: group.id, page: 1, limit: 20 });
    expect(result.total).toBe(1);
    expect(result.data[0]!.id).toBe(u1);
  });
});

describe("getUserById", () => {
  test("returns user or undefined", async () => {
    const id = await seedUser({ name: "Test" });
    expect((await getUserById(db, id))?.name).toBe("Test");
    expect(await getUserById(db, "nonexistent")).toBeUndefined();
  });
});

describe("updateUser", () => {
  test("updates role", async () => {
    const id = await seedUser({ role: "user" });
    const updated = await updateUser(db, id, { role: "admin" });
    expect(updated?.role).toBe("admin");
  });

  test("updates status", async () => {
    const id = await seedUser({ status: "active" });
    const updated = await updateUser(db, id, { status: "disabled" });
    expect(updated?.status).toBe("disabled");
  });

  test("updates name (editable for any user)", async () => {
    const id = await seedUser({ name: "Old Name" });
    const updated = await updateUser(db, id, { name: "New Name" });
    expect(updated?.name).toBe("New Name");
  });
});

describe("getUserGroups", () => {
  test("returns groups for user", async () => {
    const userId = await seedUser();
    const g1 = await createGroup(db, { name: "group-a" });
    const g2 = await createGroup(db, { name: "group-b" });
    await addGroupMember(db, g1.id, userId);
    await addGroupMember(db, g2.id, userId);

    const userGroupsList = await getUserGroups(db, userId);
    expect(userGroupsList.length).toBe(2);
    expect(userGroupsList.map(g => g.name).sort()).toEqual(["group-a", "group-b"]);
  });
});

describe("createVirtualUser", () => {
  test("mints a virtual user with synthetic identity fields", async () => {
    const created = await createVirtualUser(db, { username: "vstaff", name: "Virtual Staff" });
    expect(created?.username).toBe("vstaff");
    expect(created?.name).toBe("Virtual Staff");
    expect(created?.email).toBe("vstaff@virtual.local");
    expect(created?.role).toBe("user");
    expect(created?.status).toBe("active");
    expect(created?.isVirtual).toBe(true);

    // oauthSub is not exposed via userColumns — assert it directly on the row.
    const row = await db.select().from(users).where(eq(users.id, created!.id)).get();
    expect(row?.oauthSub).toBe(`virtual:${created!.id}`);
  });

  test("rejects a username already used by a REAL user (409)", async () => {
    await seedUser({ username: "taken" });
    await expect(createVirtualUser(db, { username: "taken", name: "Dup" }))
      .rejects
      .toMatchObject({ statusCode: 409 });
  });

  test("rejects a username already used by a VIRTUAL user (409)", async () => {
    await createVirtualUser(db, { username: "vdup", name: "First" });
    await expect(createVirtualUser(db, { username: "vdup", name: "Second" }))
      .rejects
      .toMatchObject({ statusCode: 409 });
  });

  test("accepts an explicit email (the binding key)", async () => {
    const created = await createVirtualUser(db, { username: "vmail", name: "V Mail", email: "future@corp.com" });
    expect(created?.email).toBe("future@corp.com");
  });

  test("rejects an email already used by another user (409)", async () => {
    await seedUser({ username: "ereal", email: "dup@corp.com" });
    await expect(createVirtualUser(db, { username: "evirtual", name: "Dup", email: "dup@corp.com" }))
      .rejects
      .toMatchObject({ statusCode: 409 });
  });
});

describe("updateVirtualUser", () => {
  test("renames a virtual user", async () => {
    const created = await createVirtualUser(db, { username: "rename-me", name: "Old" });
    const updated = await updateVirtualUser(db, created!.id, { name: "New", username: "renamed" });
    expect(updated?.name).toBe("New");
    expect(updated?.username).toBe("renamed");
  });

  test("rejects a rename that collides with another user (409)", async () => {
    await seedUser({ username: "occupied" });
    const created = await createVirtualUser(db, { username: "free", name: "V" });
    await expect(updateVirtualUser(db, created!.id, { username: "occupied" }))
      .rejects
      .toMatchObject({ statusCode: 409 });
  });

  test("updates the email", async () => {
    const created = await createVirtualUser(db, { username: "vedit", name: "V" });
    const updated = await updateVirtualUser(db, created!.id, { email: "real@corp.com" });
    expect(updated?.email).toBe("real@corp.com");
  });

  test("rejects an email that collides with another user (409)", async () => {
    await seedUser({ username: "owner", email: "owned@corp.com" });
    const created = await createVirtualUser(db, { username: "vfree", name: "V" });
    await expect(updateVirtualUser(db, created!.id, { email: "owned@corp.com" }))
      .rejects
      .toMatchObject({ statusCode: 409 });
  });
});

describe("deleteVirtualUser", () => {
  test("refuses to delete a real user", async () => {
    const realId = await seedUser({ username: "real-keep" });
    await expect(deleteVirtualUser(db, realId)).rejects.toMatchObject({ statusCode: 409 });
    expect(await getUserById(db, realId)).toBeDefined();
  });

  test("hard-deletes a virtual user", async () => {
    const created = await createVirtualUser(db, { username: "v-del", name: "Gone" });
    expect(await deleteVirtualUser(db, created!.id)).toBe(true);
    expect(await getUserById(db, created!.id)).toBeUndefined();
  });

  test("throws NotFound for an unknown id", async () => {
    await expect(deleteVirtualUser(db, "ghost")).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("assignable vs visible users", () => {
  test("visible-users excludes virtual; assignable-users includes them", async () => {
    await seedUser({ name: "Real One", username: "real-one" });
    await createVirtualUser(db, { username: "virtual-one", name: "Virtual One" });

    const visible = await listActiveUsers(db);
    expect(visible.map(u => u.username).sort()).toEqual(["real-one"]);

    const assignable = await listAssignableUsers(db);
    expect(assignable.map(u => u.username).sort()).toEqual(["real-one", "virtual-one"]);
    expect(assignable.find(u => u.username === "virtual-one")?.isVirtual).toBe(true);
  });
});
