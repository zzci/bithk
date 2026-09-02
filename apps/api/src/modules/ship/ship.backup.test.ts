import type { AppDatabase } from "@/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, getTableName } from "drizzle-orm";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { users } from "@/modules/account/users/schema";
import { __resetBackupRegistryForTests, getDataModules, registerBackupContribution, resolveModulesWithDeps } from "@/modules/backup/registry";
import { projectBackupContribution } from "@/modules/project/project.backup";
import { createProject } from "@/modules/project/project.service";
import { tagBackupContribution } from "@/modules/tag/tag.backup";
import { roundTripBackupV2 } from "@/shared/test/backup-roundtrip";
import { shipEquipment, shipEquipmentCategories, shipProfiles, worklists } from "./schema";
import { shipBackupContribution } from "./ship.backup";
import { createEquipment } from "./ship.equipment.service";
import { createGlobalEquipmentManufacturer } from "./ship.global-equipment-manufacturer.service";
import { createProjectEquipmentCategory } from "./ship.ship-equipment-category.service";
import { createProjectWorklist } from "./ship.worklist.service";
// Registers the three maritime sections, so `preset: "ship"` provisions.
import "./index";

// PLAN-108 §7: every maritime table now hangs off `projects.id`. If the export
// or the restore lost that scoping, a restored fleet would come back with
// profiles, equipment and worklists attached to the wrong project (or to none),
// so this file round-trips a real ship-preset project rather than asserting the
// contribution's shape alone.

let sourceDb: AppDatabase;
let restoredDb: AppDatabase;
let dir: string;

const NOW = "2026-08-28T00:00:00.000Z";

beforeEach(async () => {
  dir = mkdtempSync(resolvePath(tmpdir(), "test-ship-backup-"));
  sourceDb = await createDb(resolvePath(dir, "source.db"));
  restoredDb = await createDb(resolvePath(dir, "restored.db"));
  __resetBackupRegistryForTests();
  // `ships` depends on `projects`, which depends on `users` + `tags`; register
  // the whole chain so the dependency walk can resolve it.
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(tagBackupContribution);
  registerBackupContribution(projectBackupContribution);
  registerBackupContribution(shipBackupContribution);
});

afterEach(() => {
  sourceDb.close();
  restoredDb.close();
  __resetBackupRegistryForTests();
  rmSync(dir, { recursive: true, force: true });
});

async function seedOwner(): Promise<string> {
  await sourceDb.insert(users).values({
    id: "user_owner",
    oauthSub: "sub-owner",
    username: "owner",
    name: "Owner",
    email: "owner@example.test",
    role: "user",
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  }).run();
  return "user_owner";
}

describe("ship backup contribution", () => {
  test("registers the ships module with FK-safe tables and a one-way projects dep", () => {
    const mod = getDataModules().ships;
    expect(mod?.name).toBe("ships");
    expect(mod?.tables.map(table => getTableName(table))).toEqual([
      "global_equipment_categories",
      "equipment_manufacturers",
      "ship_profiles",
      "ship_equipment_categories",
      "ship_equipment",
      "worklists",
    ]);
    expect(mod?.deps).toEqual(["users", "projects"]);
  });

  // The pre-fold model had `projects.ship_id` pointing at `ships` while every
  // ship table pointed back at `projects`, so the two modules listed each other
  // and `resolveModulesWithDeps` had to break the cycle. With the fold the edge
  // is one-way, and it must stay that way.
  test("there is no projects <-> ships cycle", () => {
    expect(shipBackupContribution.deps).toContain("projects");
    expect(projectBackupContribution.deps).not.toContain("ships");

    // A ships export drags projects in; a projects export never drags ships in.
    const fromShips = resolveModulesWithDeps(["ships"]);
    expect(fromShips).toContain("projects");
    expect(fromShips.indexOf("projects")).toBeLessThan(fromShips.indexOf("ships"));
    expect(resolveModulesWithDeps(["projects"])).not.toContain("ships");
  });

  test("a ship-only export declares its deps in the manifest", async () => {
    await seedOwner();
    const modules = resolveModulesWithDeps(["ships"]);
    expect(modules).toContain("users");
    expect(modules).toContain("projects");
    expect(modules).toContain("ships");
    expect(modules.indexOf("projects")).toBeLessThan(modules.indexOf("ships"));
  });

  test("profiles, categories, equipment and worklists round-trip attached to the right project", async () => {
    const ownerId = await seedOwner();

    // Two ship-preset projects, so every assertion below has to be scoped —
    // a dropped `project_id` would let one project's rows land on the other.
    const aurora = await createProject(sourceDb, {
      name: "Aurora",
      creatorId: ownerId,
      preset: "ship",
      sectionData: { "ship-profile": { hullNumber: "HULL-A", shipStatus: "active", imoNumber: "IMO-A" } },
    });
    const borealis = await createProject(sourceDb, {
      name: "Borealis",
      creatorId: ownerId,
      preset: "ship",
      sectionData: { "ship-profile": { hullNumber: "HULL-B" } },
    });

    const manufacturer = await createGlobalEquipmentManufacturer(sourceDb, { name: "MTU" });
    const auroraCategory = await createProjectEquipmentCategory(sourceDb, aurora.id, { nameZh: "ZH Propulsion", nameEn: "Propulsion" });
    const borealisCategory = await createProjectEquipmentCategory(sourceDb, borealis.id, { nameZh: "ZH Deck", nameEn: "Deck" });

    const auroraEquipment = await createEquipment(sourceDb, aurora.id, {
      name: "Main Engine",
      categoryId: auroraCategory.id,
      manufacturerId: manufacturer.id,
      status: "active",
    });
    const borealisEquipment = await createEquipment(sourceDb, borealis.id, { name: "Bow Thruster" });

    const auroraWorklist = await createProjectWorklist(sourceDb, aurora.id, { name: "Hull check" });
    expect(auroraWorklist.status).toBe("ok");
    const borealisWorklist = await createProjectWorklist(sourceDb, borealis.id, { name: "Deck wash" });
    expect(borealisWorklist.status).toBe("ok");

    const { tables } = await roundTripBackupV2(sourceDb, restoredDb, ["ships"], dir);
    expect(tables.ship_profiles).toHaveLength(2);
    expect(tables.ship_equipment).toHaveLength(2);
    expect(tables.worklists).toHaveLength(2);

    // ship_profiles — keyed by project, particulars intact.
    const restoredAuroraProfile = await restoredDb.select().from(shipProfiles).where(eq(shipProfiles.projectId, aurora.id)).get();
    expect(restoredAuroraProfile?.hullNumber).toBe("HULL-A");
    expect(restoredAuroraProfile?.shipStatus).toBe("active");
    expect(restoredAuroraProfile?.imoNumber).toBe("IMO-A");
    expect((await restoredDb.select().from(shipProfiles).where(eq(shipProfiles.projectId, borealis.id)).get())?.hullNumber).toBe("HULL-B");

    // ship_equipment_categories — each project keeps only its own.
    const restoredAuroraCategories = await restoredDb.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.projectId, aurora.id)).all();
    expect(restoredAuroraCategories.map(c => c.nameEn)).toEqual(["Propulsion"]);
    const restoredBorealisCategories = await restoredDb.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.projectId, borealis.id)).all();
    expect(restoredBorealisCategories.map(c => c.nameEn)).toEqual(["Deck"]);
    expect(restoredAuroraCategories[0]!.id).toBe(auroraCategory.id);
    expect(restoredBorealisCategories[0]!.id).toBe(borealisCategory.id);

    // ship_equipment — project scoping plus the category / manufacturer FKs.
    const restoredAuroraEquipment = await restoredDb.select().from(shipEquipment).where(eq(shipEquipment.projectId, aurora.id)).all();
    expect(restoredAuroraEquipment).toHaveLength(1);
    expect(restoredAuroraEquipment[0]!.id).toBe(auroraEquipment.id);
    expect(restoredAuroraEquipment[0]!.name).toBe("Main Engine");
    expect(restoredAuroraEquipment[0]!.categoryId).toBe(auroraCategory.id);
    expect(restoredAuroraEquipment[0]!.manufacturerId).toBe(manufacturer.id);
    const restoredBorealisEquipment = await restoredDb.select().from(shipEquipment).where(eq(shipEquipment.projectId, borealis.id)).all();
    expect(restoredBorealisEquipment.map(e => e.id)).toEqual([borealisEquipment.id]);

    // worklists — the project-scoped rows land back on their own project.
    const restoredAuroraWorklists = await restoredDb.select().from(worklists).where(eq(worklists.projectId, aurora.id)).all();
    expect(restoredAuroraWorklists.map(w => w.name)).toEqual(["Hull check"]);
    const restoredBorealisWorklists = await restoredDb.select().from(worklists).where(eq(worklists.projectId, borealis.id)).all();
    expect(restoredBorealisWorklists.map(w => w.name)).toEqual(["Deck wash"]);
  });

  test("global worklists (no project) survive alongside the project-scoped ones", async () => {
    const ownerId = await seedOwner();
    const ship = await createProject(sourceDb, { name: "Aurora", creatorId: ownerId, preset: "ship" });

    await sourceDb.insert(worklists).values({
      id: "wl_global01",
      projectId: null,
      name: "Global template",
      checklist: null,
      precautions: null,
      createdAt: NOW,
      updatedAt: NOW,
    }).run();
    const scoped = await createProjectWorklist(sourceDb, ship.id, { name: "Project local" });
    expect(scoped.status).toBe("ok");

    await roundTripBackupV2(sourceDb, restoredDb, ["ships"], dir);

    const restored = await restoredDb.select().from(worklists).all();
    expect(restored.map(w => w.name).sort()).toEqual(["Global template", "Project local"]);
    expect(restored.find(w => w.name === "Global template")!.projectId).toBeNull();
    expect(restored.find(w => w.name === "Project local")!.projectId).toBe(ship.id);
  });
});
