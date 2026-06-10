import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { MODULE_KEYS } from "@/shared/modules";
import { seedUser, testNanoid } from "@/shared/test/route-harness";
import {
  backfillGlobalRoles,
  createGlobalRole,
  DEFAULT_ROLE_MODULES,
  DEFAULT_ROLE_NAME,
  deleteGlobalRole,
  parseModules,
  resolveDefaultRole,
  resolveUserModules,
  updateGlobalRole,
} from "./roles.service";
import { globalRoles } from "./schema";

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-global-roles-${Date.now()}-${testNanoid()}`);
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

async function loadUser(id: string) {
  return (await db.select().from(users).where(eq(users.id, id)).get())!;
}

describe("backfillGlobalRoles", () => {
  test("seeds the default Member role with the exact module set", async () => {
    const result = await backfillGlobalRoles(db);
    expect(result.created).toBe(true);

    const role = await resolveDefaultRole(db);
    expect(role).toBeDefined();
    expect(role!.name).toBe(DEFAULT_ROLE_NAME);
    expect(role!.isSystem).toBe(1);
    expect(role!.kind).toBe("default");
    expect(parseModules(role!.modules)).toEqual([...DEFAULT_ROLE_MODULES]);
    // hr stays admin-only at rollout — existing users keep today's visibility.
    expect(parseModules(role!.modules)).not.toContain("hr");
  });

  test("is idempotent — a second run inserts nothing", async () => {
    await backfillGlobalRoles(db);
    const second = await backfillGlobalRoles(db);
    expect(second.created).toBe(false);
    const rows = await db.select().from(globalRoles).all();
    expect(rows.length).toBe(1);
  });

  test("does not clobber an admin-edited default role", async () => {
    await backfillGlobalRoles(db);
    const role = (await resolveDefaultRole(db))!;
    await updateGlobalRole(db, role.id, { name: "Staff", modules: ["drive"] });

    const again = await backfillGlobalRoles(db);
    expect(again.created).toBe(false);

    const after = (await resolveDefaultRole(db))!;
    expect(after.id).toBe(role.id);
    expect(after.name).toBe("Staff");
    expect(parseModules(after.modules)).toEqual(["drive"]);
  });

  test("repairs a dropped isSystem flag on the default role", async () => {
    await backfillGlobalRoles(db);
    const role = (await resolveDefaultRole(db))!;
    await db.update(globalRoles).set({ isSystem: 0 }).where(eq(globalRoles.id, role.id)).run();

    await backfillGlobalRoles(db);
    expect((await resolveDefaultRole(db))!.isSystem).toBe(1);
  });
});

describe("resolveUserModules", () => {
  test("admin resolves to all registered module keys", async () => {
    await backfillGlobalRoles(db);
    const userId = await seedUser(db, "admin");
    const modules = await resolveUserModules(db, await loadUser(userId));
    expect(modules).toEqual([...MODULE_KEYS]);
  });

  test("NULL globalRoleId resolves to the default role's modules", async () => {
    await backfillGlobalRoles(db);
    const userId = await seedUser(db, "user");
    const modules = await resolveUserModules(db, await loadUser(userId));
    expect(modules).toEqual([...DEFAULT_ROLE_MODULES]);
  });

  test("an assigned role resolves to its own modules", async () => {
    await backfillGlobalRoles(db);
    const role = await createGlobalRole(db, { name: "Drive only", modules: ["drive"] });
    const userId = await seedUser(db, "user");
    await db.update(users).set({ globalRoleId: role.id }).where(eq(users.id, userId)).run();

    const modules = await resolveUserModules(db, await loadUser(userId));
    expect(modules).toEqual(["drive"]);
  });

  test("deleting a held role falls holders back to the default role", async () => {
    await backfillGlobalRoles(db);
    const role = await createGlobalRole(db, { name: "Doomed", modules: ["ships"] });
    const userId = await seedUser(db, "user");
    await db.update(users).set({ globalRoleId: role.id }).where(eq(users.id, userId)).run();

    expect(await deleteGlobalRole(db, role.id)).toBe("deleted");

    // FK ON DELETE SET NULL must have cleared the assignment.
    const user = await loadUser(userId);
    expect(user.globalRoleId).toBeNull();
    expect(await resolveUserModules(db, user)).toEqual([...DEFAULT_ROLE_MODULES]);
  });
});
