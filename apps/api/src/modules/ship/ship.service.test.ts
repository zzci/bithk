import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { addMember, getMemberCapabilities } from "@/modules/project/project.service";
import { projects } from "@/modules/project/schema";
import {
  bindProject,
  composeShipWithBase,
  createShip,
  getShipByShortId,
  listShipProjects,
  listShips,
  resolveShipId,
  softDeleteShip,
  unbindProject,
  updateShip,
  userCanManageShip,
  userCanReadShip,
} from "./ship.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

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

/** Resolve the seeded baseline "Member" role id for a project. */
async function memberRoleId(projectInternalId: string): Promise<string> {
  const { projectRoles } = await import("@/modules/project/schema");
  const roles = await db.select().from(projectRoles).where(eq(projectRoles.projectId, projectInternalId)).all();
  return roles.find(r => r.name === "Member")!.id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-ship-${Date.now()}-${nanoid()}`);
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

describe("createShip", () => {
  test("creates the ship and its base project atomically with a bidirectional link", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "Aurora", creatorId: creator });

    expect(ship.shortId).toHaveLength(8);
    expect(ship.name).toBe("Aurora");
    expect(ship.status).toBe("active");
    expect(ship.lifecycleStage).toBe("design");
    expect(ship.version).toBe(1);
    expect(ship.code).toContain("S-");
    expect(ship.baseProjectId).not.toBeNull();

    // The base project points back at the ship (ships.base_project_id ↔ projects.ship_id).
    const baseProject = await db.select().from(projects).where(eq(projects.id, ship.baseProjectId!)).get();
    expect(baseProject).toBeDefined();
    expect(baseProject!.shipId).toBe(ship.id);
  });

  test("seeds the creator as Project Manager on the base project", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "Bridge", creatorId: creator });

    const caps = await getMemberCapabilities(db, ship.baseProjectId!, creator);
    expect(caps?.has("project.manage")).toBe(true);
  });

  test("persists yacht attributes and a provided code", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, {
      name: "Tower",
      code: "HULL-1",
      lifecycleStage: "in_service",
      buildYear: 2024,
      lengthOverall: 42.5,
      imoNumber: "IMO1234567",
      creatorId: creator,
    });
    expect(ship.code).toBe("HULL-1");
    expect(ship.lifecycleStage).toBe("in_service");
    expect(ship.buildYear).toBe(2024);
    expect(ship.lengthOverall).toBe(42.5);
    expect(ship.imoNumber).toBe("IMO1234567");

    const view = await composeShipWithBase(db, ship);
    // baseProjectId in the view is the base project's *short* id.
    const baseProject = await db.select().from(projects).where(eq(projects.id, ship.baseProjectId!)).get();
    expect(view.baseProjectId).toBe(baseProject!.shortId);
  });
});

describe("updateShip", () => {
  test("bumps version and applies the patch", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "P", creatorId: creator });
    const updated = await updateShip(db, ship.shortId, { name: "P2", status: "archived", builder: "Acme" });
    expect(updated?.name).toBe("P2");
    expect(updated?.status).toBe("archived");
    expect(updated?.builder).toBe("Acme");
    expect(updated!.version).toBe(2);
  });
});

describe("softDeleteShip", () => {
  test("hides the ship and unbinds the base project to preserve its data", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "P", creatorId: creator });
    const baseProjectId = ship.baseProjectId!;

    await softDeleteShip(db, ship.shortId);

    expect(await getShipByShortId(db, ship.shortId)).toBeUndefined();
    expect(await resolveShipId(db, ship.shortId)).toBeNull();

    // The base project survives, only unbound.
    const baseProject = await db.select().from(projects).where(eq(projects.id, baseProjectId)).get();
    expect(baseProject).toBeDefined();
    expect(baseProject!.shipId).toBeNull();
  });
});

describe("listShips", () => {
  test("paginates, filters by status / lifecycleStage, excludes soft-deleted", async () => {
    const creator = await seedUser("Alice");
    await createShip(db, { name: "A", status: "active", creatorId: creator });
    await createShip(db, { name: "B", status: "archived", lifecycleStage: "maintenance", creatorId: creator });
    const gone = await createShip(db, { name: "C", creatorId: creator });
    await softDeleteShip(db, gone.shortId);

    const all = await listShips(db, {});
    expect(all.total).toBe(2);

    const archived = await listShips(db, { status: "archived" });
    expect(archived.total).toBe(1);
    expect(archived.data[0]!.name).toBe("B");

    const maint = await listShips(db, { lifecycleStage: "maintenance" });
    expect(maint.data.map(s => s.name)).toEqual(["B"]);
  });

  test("memberUserId scopes to ships whose base project the user belongs to", async () => {
    const owner = await seedUser("Owner");
    const outsider = await seedUser("Outsider");
    await createShip(db, { name: "Owned", creatorId: owner });

    const mine = await listShips(db, { memberUserId: owner });
    expect(mine.total).toBe(1);
    const theirs = await listShips(db, { memberUserId: outsider });
    expect(theirs.total).toBe(0);
  });

  test("a literal % in the query is matched literally, not as a wildcard", async () => {
    const creator = await seedUser("Alice");
    await createShip(db, { name: "a%b", creatorId: creator });
    await createShip(db, { name: "axb", creatorId: creator });

    const pct = await listShips(db, { q: "a%b" });
    expect(pct.data.map(s => s.name)).toEqual(["a%b"]);
  });
});

describe("permission helpers", () => {
  test("read = base-project member; manage = project.manage on base project", async () => {
    const creator = await seedUser("Alice");
    const member = await seedUser("Bob");
    const outsider = await seedUser("Eve");
    const ship = await createShip(db, { name: "P", creatorId: creator });
    // Add Bob as a plain Member (no project.manage).
    await addMember(db, ship.baseProjectId!, { roleId: await memberRoleId(ship.baseProjectId!), userId: member });

    expect(await userCanReadShip(db, ship, creator, false)).toBe(true);
    expect(await userCanManageShip(db, ship, creator, false)).toBe(true);

    expect(await userCanReadShip(db, ship, member, false)).toBe(true);
    expect(await userCanManageShip(db, ship, member, false)).toBe(false);

    expect(await userCanReadShip(db, ship, outsider, false)).toBe(false);
    // admin bypasses membership.
    expect(await userCanReadShip(db, ship, outsider, true)).toBe(true);
    expect(await userCanManageShip(db, ship, outsider, true)).toBe(true);
  });
});

describe("ship ↔ project binding", () => {
  test("lists the base project, binds and unbinds extra projects, protects the base", async () => {
    const creator = await seedUser("Alice");
    const shipA = await createShip(db, { name: "A", creatorId: creator });
    const shipB = await createShip(db, { name: "B", creatorId: creator });

    // Initially only the base project is bound, flagged isBase.
    const initial = await listShipProjects(db, shipA.id, shipA.baseProjectId);
    expect(initial).toHaveLength(1);
    expect(initial[0]!.isBase).toBe(true);

    // Bind ship B's base project to ship A → rejected (it is a base project).
    const projB = await db.select().from(projects).where(eq(projects.id, shipB.baseProjectId!)).get();
    expect(await bindProject(db, shipA.id, projB!.shortId)).toBe("is_base");

    // Bind a standalone project.
    const { createProject } = await import("@/modules/project/project.service");
    const standalone = await createProject(db, { name: "Extra", creatorId: creator });
    expect(await bindProject(db, shipA.id, standalone.shortId)).toBe("ok");

    const after = await listShipProjects(db, shipA.id, shipA.baseProjectId);
    expect(after).toHaveLength(2);
    expect(after.filter(p => p.isBase)).toHaveLength(1);

    // The base project cannot be unbound.
    const baseProject = await db.select().from(projects).where(eq(projects.id, shipA.baseProjectId!)).get();
    expect(await unbindProject(db, shipA.id, shipA.baseProjectId, baseProject!.shortId)).toBe("is_base");

    // The extra project can.
    expect(await unbindProject(db, shipA.id, shipA.baseProjectId, standalone.shortId)).toBe("ok");
    expect(await listShipProjects(db, shipA.id, shipA.baseProjectId)).toHaveLength(1);
  });

  test("bind is idempotent and reports unknown projects", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "P", creatorId: creator });
    const { createProject } = await import("@/modules/project/project.service");
    const extra = await createProject(db, { name: "Extra", creatorId: creator });

    expect(await bindProject(db, ship.id, extra.shortId)).toBe("ok");
    expect(await bindProject(db, ship.id, extra.shortId)).toBe("ok"); // idempotent
    expect(await bindProject(db, ship.id, "nope1234")).toBe("not_found");
  });
});
