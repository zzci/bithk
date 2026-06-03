import type { AppDatabase } from "@/db";
import type { FileServiceConfig } from "@/modules/file";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { getReferenceById } from "@/modules/file";
import { __resetFilePermissionHooksForTests } from "@/modules/file/permission";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { addMember, getMemberCapabilities } from "@/modules/project/project.service";
import { projects } from "@/modules/project/schema";
import { globalEquipmentCategories, shipEquipmentCategories, ships } from "./schema";
import {
  bindProject,
  composeShipWithBase,
  createShip,
  getShipById,
  getShipByShortId,
  listShipProjects,
  listShips,
  resolveShipId,
  setShipCover,
  softDeleteShip,
  unbindProject,
  updateShip,
  userCanManageShip,
  userCanReadShip,
} from "./ship.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

// softDeleteShip only touches the file service when the ship has a cover image;
// these ships have none, so this stub is never exercised.
const fileConfig: FileServiceConfig = {
  FILE_GC_MODE: "sync",
  FILE_PRESIGN_ENABLED: false,
  FILE_PRESIGN_TTL_SECONDS: 300,
};

// Full config for the cover-release path (T8/B2), where setShipCover uploads a
// real blob through the local driver and softDeleteShip releases it.
const coverConfig = {
  MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
  MAX_ATTACHMENTS_PER_RESOURCE: 20,
  UPLOADS_TOTAL_BYTES: 0,
  FILE_GC_MODE: "sync",
  FILE_PRESIGN_ENABLED: false,
  FILE_PRESIGN_TTL_SECONDS: 300,
} as unknown as Parameters<typeof setShipCover>[1];

// Real 1x1 PNG — uploadAndReference verifies the declared MIME against magic bytes.
const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  c => c.charCodeAt(0),
);

function pngFile(): File {
  return new File([PNG_1X1], "cover.png", { type: "image/png" });
}

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
  return roles.find(r => r.name === "Reader")!.id;
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
    expect(ship.version).toBe(1);
    expect(ship.code).toContain("S-");
    expect(ship.baseProjectId).not.toBeNull();

    // The base project points back at the ship (ships.base_project_id ↔ projects.ship_id).
    const baseProject = await db.select().from(projects).where(eq(projects.id, ship.baseProjectId!)).get();
    expect(baseProject).toBeDefined();
    expect(baseProject!.shipId).toBe(ship.id);
  });

  test("seeds the creator as Project Owner on the base project", async () => {
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
      buildYear: 2024,
      lengthOverall: 42.5,
      imoNumber: "IMO1234567",
      creatorId: creator,
    });
    expect(ship.code).toBe("HULL-1");
    expect(ship.buildYear).toBe(2024);
    expect(ship.lengthOverall).toBe(42.5);
    expect(ship.imoNumber).toBe("IMO1234567");

    const view = await composeShipWithBase(db, ship);
    // baseProjectId in the view is the base project's *short* id.
    const baseProject = await db.select().from(projects).where(eq(projects.id, ship.baseProjectId!)).get();
    expect(view.baseProjectId).toBe(baseProject!.shortId);
  });

  test("writes tag assignments and surfaces them on the view", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "Tagged", tags: ["charter", "flagship"], creatorId: creator });

    const view = await composeShipWithBase(db, ship);
    expect(view.tags.map(t => t.name).sort()).toEqual(["charter", "flagship"]);

    // The list view carries the same tags.
    const listed = await listShips(db, {});
    const row = listed.data.find(s => s.id === ship.shortId)!;
    expect(row.tags.map(t => t.name).sort()).toEqual(["charter", "flagship"]);
  });
});

describe("equipment-category copy-on-create", () => {
  async function seedGlobalCategory(nameZh: string, nameEn: string, code: string | null = null): Promise<void> {
    const now = new Date().toISOString();
    await db.insert(globalEquipmentCategories).values({
      id: nanoid(),
      nameZh,
      nameEn,
      code,
      description: null,
      createdAt: now,
      updatedAt: now,
    }).run();
  }

  test("createShip copies the global template into the new ship's own category set", async () => {
    await seedGlobalCategory("推进系统", "Propulsion", "propulsion");
    await seedGlobalCategory("导航设备", "Navigation", "navigation");
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "Aurora", creatorId: creator });

    const rows = await db.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.shipId, ship.id)).all();
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.nameEn).sort()).toEqual(["Navigation", "Propulsion"]);

    // Copies carry fresh per-ship ids, never the global template ids.
    const globalIds = new Set((await db.select().from(globalEquipmentCategories).all()).map(g => g.id));
    for (const r of rows) {
      expect(r.shipId).toBe(ship.id);
      expect(globalIds.has(r.id)).toBe(false);
    }
  });

  test("each ship snapshots independently; later global edits do not touch existing ships", async () => {
    await seedGlobalCategory("推进系统", "Propulsion", "propulsion");
    const creator = await seedUser("Alice");
    const shipA = await createShip(db, { name: "A", creatorId: creator });

    // Edit the global template AFTER ship A exists, then create ship B.
    await db.update(globalEquipmentCategories).set({ nameEn: "Main Propulsion" }).run();
    const shipB = await createShip(db, { name: "B", creatorId: creator });

    const aRows = await db.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.shipId, shipA.id)).all();
    const bRows = await db.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.shipId, shipB.id)).all();
    expect(aRows[0]!.nameEn).toBe("Propulsion"); // A keeps its create-time snapshot
    expect(bRows[0]!.nameEn).toBe("Main Propulsion"); // B sees the later edit
  });

  test("hard-deleting a ship cascades its equipment categories", async () => {
    await seedGlobalCategory("推进系统", "Propulsion", "propulsion");
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "Aurora", creatorId: creator });
    expect(await db.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.shipId, ship.id)).all()).toHaveLength(1);

    await db.delete(ships).where(eq(ships.id, ship.id)).run();
    expect(await db.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.shipId, ship.id)).all()).toHaveLength(0);
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

  test("replaces tags when supplied, leaves them untouched otherwise", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "P", tags: ["alpha"], creatorId: creator });

    // Supplying tags replaces the set.
    await updateShip(db, ship.shortId, { tags: ["beta", "gamma"] });
    let view = await composeShipWithBase(db, ship);
    expect(view.tags.map(t => t.name).sort()).toEqual(["beta", "gamma"]);

    // Omitting tags on a later update keeps the existing assignments.
    await updateShip(db, ship.shortId, { name: "P2" });
    view = await composeShipWithBase(db, ship);
    expect(view.tags.map(t => t.name).sort()).toEqual(["beta", "gamma"]);

    // An empty array clears them.
    await updateShip(db, ship.shortId, { tags: [] });
    view = await composeShipWithBase(db, ship);
    expect(view.tags).toHaveLength(0);
  });

  // T3: an unknown short id resolves to undefined, which the route maps to 404.
  test("returns undefined for an unknown ship (route maps this to 404)", async () => {
    expect(await updateShip(db, "nope1234", { name: "X" })).toBeUndefined();
  });

  // T3: an empty patch still bumps the version and stamps updatedAt without
  // changing any field (the route schema forbids `{}`, but the service does not).
  test("an empty patch still bumps the version, leaving fields untouched", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "P", code: "HULL-1", creatorId: creator });
    const updated = await updateShip(db, ship.shortId, {});
    expect(updated!.version).toBe(2);
    expect(updated!.name).toBe("P");
    expect(updated!.code).toBe("HULL-1");
  });
});

describe("softDeleteShip", () => {
  test("hides the ship and unbinds the base project to preserve its data", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "P", creatorId: creator });
    const baseProjectId = ship.baseProjectId!;

    await softDeleteShip(db, fileConfig, ship.shortId);

    expect(await getShipByShortId(db, ship.shortId)).toBeUndefined();
    expect(await resolveShipId(db, ship.shortId)).toBeNull();

    // The base project survives, only unbound.
    const baseProject = await db.select().from(projects).where(eq(projects.id, baseProjectId)).get();
    expect(baseProject).toBeDefined();
    expect(baseProject!.shipId).toBeNull();
  });

  // T8: a second delete is a no-op — it neither throws nor re-bumps the version.
  test("is idempotent: a second call on an already-deleted ship is a no-op", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "P", creatorId: creator });

    await softDeleteShip(db, fileConfig, ship.shortId);
    const afterFirst = await getShipById(db, ship.id);
    expect(afterFirst!.deletedAt).not.toBeNull();
    const versionAfterFirst = afterFirst!.version;

    // Second call: no throw, no further version bump.
    await softDeleteShip(db, fileConfig, ship.shortId);
    const afterSecond = await getShipById(db, ship.id);
    expect(afterSecond!.version).toBe(versionAfterFirst);
  });

  // T8: every project linked to the ship is unbound, not only the base project.
  test("unbinds extra bound projects as well as the base project", async () => {
    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "P", creatorId: creator });
    const { createProject } = await import("@/modules/project/project.service");
    const extra = await createProject(db, { name: "Extra", creatorId: creator });
    expect(await bindProject(db, ship.id, extra.shortId)).toBe("ok");

    await softDeleteShip(db, fileConfig, ship.shortId);

    // Both the base project and the extra project are now unbound.
    const stillBound = await db.select().from(projects).where(eq(projects.shipId, ship.id)).all();
    expect(stillBound).toHaveLength(0);
    const extraRow = await db.select().from(projects).where(eq(projects.id, extra.id)).get();
    expect(extraRow!.shipId).toBeNull();
  });

  // T8 / B2 regression: a soft-deleted ship releases its cover reference so the
  // file ref-count is not leaked.
  test("releases the cover image reference (B2)", async () => {
    __resetDriverRegistryForTests();
    __resetFilePermissionHooksForTests();
    __setLocalDriverRootForTests(resolve(dbPath, "..", "blobs"));
    setActiveDriver("local");

    const creator = await seedUser("Alice");
    const ship = await createShip(db, { name: "P", creatorId: creator });
    const withCover = await setShipCover(db, coverConfig, ship.id, pngFile(), creator);
    const coverRef = withCover!.coverReferenceId!;
    expect(coverRef).toBeTruthy();
    expect(await getReferenceById(db, coverRef)).toBeDefined();

    await softDeleteShip(db, coverConfig, ship.shortId);

    // The reference row is gone (released), and the row no longer points at it.
    expect(await getReferenceById(db, coverRef)).toBeUndefined();
    const row = await getShipById(db, ship.id);
    expect(row!.coverReferenceId).toBeNull();
  });
});

describe("listShips", () => {
  test("paginates, filters by status, excludes soft-deleted", async () => {
    const creator = await seedUser("Alice");
    await createShip(db, { name: "A", status: "active", creatorId: creator });
    await createShip(db, { name: "B", status: "archived", creatorId: creator });
    const gone = await createShip(db, { name: "C", creatorId: creator });
    await softDeleteShip(db, fileConfig, gone.shortId);

    const all = await listShips(db, {});
    expect(all.total).toBe(2);

    const archived = await listShips(db, { status: "archived" });
    expect(archived.total).toBe(1);
    expect(archived.data[0]!.name).toBe("B");
  });

  test("filters by tagId", async () => {
    const creator = await seedUser("Alice");
    await createShip(db, { name: "Charter", tags: ["charter"], creatorId: creator });
    await createShip(db, { name: "Plain", creatorId: creator });

    // Resolve the tag id from a listed ship's embedded tags.
    const listed = await listShips(db, {});
    const tag = listed.data.flatMap(s => s.tags).find(t => t.name === "charter")!;
    expect(tag).toBeDefined();

    const byTag = await listShips(db, { tagId: tag.id });
    expect(byTag.total).toBe(1);
    expect(byTag.data[0]!.name).toBe("Charter");

    // An unknown tag yields an empty result, not an unfiltered list.
    const none = await listShips(db, { tagId: "no-such-tag" });
    expect(none.total).toBe(0);
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

  // T5: `q` matches the ship code, not just the name.
  test("q matches by code as well as by name", async () => {
    const creator = await seedUser("Alice");
    await createShip(db, { name: "Aurora", code: "HULL-XYZ", creatorId: creator });
    await createShip(db, { name: "Bridge", code: "HULL-ABC", creatorId: creator });

    const byCode = await listShips(db, { q: "XYZ" });
    expect(byCode.total).toBe(1);
    expect(byCode.data[0]!.code).toBe("HULL-XYZ");
  });

  // T5: total counts the whole filtered set while a page returns only `limit`
  // rows; a later page returns the remainder.
  test("paginates across multiple pages (total spans the set, page slices it)", async () => {
    const creator = await seedUser("Alice");
    for (let i = 0; i < 5; i++)
      await createShip(db, { name: `Ship ${i}`, creatorId: creator });

    const page1 = await listShips(db, { page: 1, limit: 2 });
    expect(page1.total).toBe(5);
    expect(page1.data).toHaveLength(2);

    const page3 = await listShips(db, { page: 3, limit: 2 });
    expect(page3.total).toBe(5);
    expect(page3.data).toHaveLength(1); // 5 = 2 + 2 + 1

    // Pages do not overlap.
    const ids = new Set([...page1.data, ...page3.data].map(s => s.id));
    expect(ids.size).toBe(3);
  });

  // T5: limit is clamped to [1, 100]; an out-of-range value never widens or
  // empties the page.
  test("clamps the limit to the [1, 100] range", async () => {
    const creator = await seedUser("Alice");
    for (let i = 0; i < 3; i++)
      await createShip(db, { name: `Ship ${i}`, creatorId: creator });

    // Above the cap → clamped to 100, so all 3 fit on one page.
    expect((await listShips(db, { limit: 5000 })).data).toHaveLength(3);
    // Below the floor → clamped to 1.
    const clampedLow = await listShips(db, { limit: 0 });
    expect(clampedLow.data).toHaveLength(1);
    expect(clampedLow.total).toBe(3);
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
