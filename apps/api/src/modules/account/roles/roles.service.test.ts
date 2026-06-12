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
  test("seeds the default Guest role with zero modules", async () => {
    const result = await backfillGlobalRoles(db);
    expect(result.created).toBe(true);

    const role = await resolveDefaultRole(db);
    expect(role).toBeDefined();
    expect(role!.name).toBe(DEFAULT_ROLE_NAME);
    expect(role!.isSystem).toBe(1);
    expect(role!.kind).toBe("default");
    expect(parseModules(role!.modules)).toEqual([]);
  });

  test("is idempotent — a second run inserts nothing", async () => {
    await backfillGlobalRoles(db);
    const second = await backfillGlobalRoles(db);
    expect(second.created).toBe(false);
    const rows = await db.select().from(globalRoles).all();
    expect(rows.length).toBe(1);
  });

  test("demotes a legacy module-carrying default in place and inserts Guest", async () => {
    // Pre-FEAT-031 state: kind='default' "Member" carrying modules, with a
    // user explicitly assigned to it.
    const now = new Date().toISOString();
    await db.insert(globalRoles).values({
      id: "legacy-member",
      name: "Member",
      modules: JSON.stringify(["documents", "drive"]),
      isSystem: 1,
      kind: "default",
      createdAt: now,
      updatedAt: now,
    }).run();
    const userId = await seedUser(db, "user");
    await db.update(users).set({ globalRoleId: "legacy-member" }).where(eq(users.id, userId)).run();

    const result = await backfillGlobalRoles(db);
    expect(result.created).toBe(true);

    // Legacy row became a custom role, keeping id/name/modules.
    const legacy = (await db.select().from(globalRoles).where(eq(globalRoles.id, "legacy-member")).get())!;
    expect(legacy.isSystem).toBe(0);
    expect(legacy.kind).toBeNull();
    expect(legacy.name).toBe("Member");
    expect(parseModules(legacy.modules)).toEqual(["documents", "drive"]);

    // Its explicit assignee keeps exactly the old visibility.
    expect(await resolveUserModules(db, await loadUser(userId))).toEqual(["documents", "drive"]);

    // A fresh Guest default exists alongside it.
    const guest = (await resolveDefaultRole(db))!;
    expect(guest.id).not.toBe("legacy-member");
    expect(guest.name).toBe(DEFAULT_ROLE_NAME);
    expect(parseModules(guest.modules)).toEqual([]);
  });

  test("repairs a dropped isSystem flag and a stale name on the default role", async () => {
    await backfillGlobalRoles(db);
    const role = (await resolveDefaultRole(db))!;
    await db.update(globalRoles).set({ isSystem: 0, name: "Stale" }).where(eq(globalRoles.id, role.id)).run();

    await backfillGlobalRoles(db);
    const after = (await resolveDefaultRole(db))!;
    expect(after.id).toBe(role.id);
    expect(after.isSystem).toBe(1);
    expect(after.name).toBe(DEFAULT_ROLE_NAME);
  });
});

describe("updateGlobalRole", () => {
  test("refuses to modify the system Guest role", async () => {
    await backfillGlobalRoles(db);
    const guest = (await resolveDefaultRole(db))!;
    expect(updateGlobalRole(db, guest.id, { name: "Renamed" })).rejects.toThrow("System roles cannot be modified");
  });

  test("updates a custom role", async () => {
    const role = await createGlobalRole(db, { name: "Member", modules: ["drive"] });
    const updated = await updateGlobalRole(db, role.id, { modules: ["drive", "ships"] });
    expect(parseModules(updated!.modules)).toEqual(["drive", "ships"]);
  });
});

describe("resolveUserModules", () => {
  test("admin resolves to all registered module keys", async () => {
    await backfillGlobalRoles(db);
    const userId = await seedUser(db, "admin");
    const modules = await resolveUserModules(db, await loadUser(userId));
    expect(modules).toEqual([...MODULE_KEYS]);
  });

  test("NULL globalRoleId resolves to the Guest floor — no modules", async () => {
    await backfillGlobalRoles(db);
    const userId = await seedUser(db, "user");
    const modules = await resolveUserModules(db, await loadUser(userId));
    expect(modules).toEqual([]);
  });

  test("an assigned role resolves to its own modules", async () => {
    await backfillGlobalRoles(db);
    const role = await createGlobalRole(db, { name: "Drive only", modules: ["drive"] });
    const userId = await seedUser(db, "user");
    await db.update(users).set({ globalRoleId: role.id }).where(eq(users.id, userId)).run();

    const modules = await resolveUserModules(db, await loadUser(userId));
    expect(modules).toEqual(["drive"]);
  });

  test("deleting a held role falls holders back to the Guest floor", async () => {
    await backfillGlobalRoles(db);
    const role = await createGlobalRole(db, { name: "Doomed", modules: ["ships"] });
    const userId = await seedUser(db, "user");
    await db.update(users).set({ globalRoleId: role.id }).where(eq(users.id, userId)).run();

    expect(await deleteGlobalRole(db, role.id)).toBe("deleted");

    // FK ON DELETE SET NULL must have cleared the assignment.
    const user = await loadUser(userId);
    expect(user.globalRoleId).toBeNull();
    expect(await resolveUserModules(db, user)).toEqual([]);
  });
});
