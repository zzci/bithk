import type { AppDatabase } from "@/db";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve as resolvePath } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq, getTableName } from "drizzle-orm";
import { createDb } from "@/db";
import { accountBackupContribution } from "@/modules/account/account.backup";
import { users } from "@/modules/account/users/schema";
import { streamJsonBackup } from "@/modules/backup/export.service";
import { __resetBackupRegistryForTests, getDataModules, registerBackupContribution } from "@/modules/backup/registry";
import { importJsonBackup, validateBackupData } from "@/modules/backup/restore.service";
import { __resetSearchRegistryForTests, getSearchSources, registerSearchSource } from "@/modules/search/search.registry";
import { shipBackupContribution } from "@/modules/ship/ship.backup";
import { tagBackupContribution } from "@/modules/tag/tag.backup";
import { projectBackupContribution } from "./project.backup";
import { createCategory } from "./project.categories";
import { listRoles } from "./project.roles";
import { createProject } from "./project.service";
import { procurementCategories, projectMembers, projectRoles, projects, projectSections } from "./schema";
import { mountSection } from "./section.service";

let sourceDb: AppDatabase;
let restoredDb: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(resolvePath(tmpdir(), "test-project-backup-"));
  sourceDb = await createDb(resolvePath(dir, "source.db"));
  restoredDb = await createDb(resolvePath(dir, "restored.db"));
  __resetBackupRegistryForTests();
  // The project contribution declares `users`, `ships` and `tags` deps for
  // FK-safe insert ordering; register them so the export resolves the chain.
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(shipBackupContribution);
  registerBackupContribution(tagBackupContribution);
  registerBackupContribution(projectBackupContribution);
});

afterEach(() => {
  sourceDb.close();
  restoredDb.close();
  __resetBackupRegistryForTests();
  rmSync(dir, { recursive: true, force: true });
});

describe("project backup contribution", () => {
  test("registers the projects module with FK-safe tables and deps", () => {
    const mod = getDataModules().projects;
    expect(mod?.name).toBe("projects");
    // Global procurement vocab leads (no project FK), then the project parent
    // and children that FK back to it: roles before members
    // (members.role_id → roles), then the section mounts, categories last.
    expect(mod?.tables.map(table => getTableName(table))).toEqual([
      "global_procurement_categories",
      "projects",
      "project_roles",
      "project_members",
      "project_sections",
      "procurement_categories",
    ]);
    expect(mod?.deps).toEqual(["users", "ships", "tags"]);
  });

  test("project index registers the contribution when imported", async () => {
    __resetBackupRegistryForTests();
    // The cache-busted re-import also re-runs the index's search-source
    // registration, whose duplicate keys throw; clear and restore that
    // process-global registry around the import.
    const searchSources = getSearchSources();
    __resetSearchRegistryForTests();

    try {
      await import(`./index.ts?backup-registration=${Date.now()}`);

      const mod = getDataModules().projects;
      expect(mod?.tables.map(table => getTableName(table))).toEqual([
        "global_procurement_categories",
        "projects",
        "project_roles",
        "project_members",
        "project_sections",
        "procurement_categories",
      ]);
    }
    finally {
      __resetSearchRegistryForTests();
      for (const source of searchSources)
        registerSearchSource(source);
    }
  });

  test("exports and restores projects with roles, members and categories", async () => {
    const now = "2026-05-24T00:00:00.000Z";
    await sourceDb.insert(users).values({
      id: "user_owner",
      oauthSub: "sub-owner",
      username: "owner",
      name: "Owner",
      email: "owner@example.test",
      role: "user",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).run();

    const project = await createProject(sourceDb, { name: "Refit", creatorId: "user_owner" });
    await createCategory(sourceDb, project.id, { name: "Materials", code: "MAT" });

    // The creator is seeded as the Project Owner member, and the default role
    // set (owner/guest + presets) is created alongside the project.
    const seededRoles = await listRoles(sourceDb, project.id);
    const seededMembers = await sourceDb.select().from(projectMembers).where(eq(projectMembers.projectId, project.id)).all();

    const { modules, body } = streamJsonBackup(sourceDb, ["projects"]);
    const parsed = validateBackupData(JSON.parse(await readStreamToString(body)));
    // Dependencies resolve ahead of `projects` so FK inserts stay valid.
    expect(modules).toContain("users");
    expect(modules).toContain("ships");
    expect(modules).toContain("tags");
    expect(modules).toContain("projects");
    expect(parsed.tables.projects).toHaveLength(1);
    expect(parsed.tables.procurement_categories).toHaveLength(1);

    const result = await importJsonBackup(restoredDb, parsed);
    expect(result.rowsImported).toBeGreaterThanOrEqual(1);

    const restoredProjects = await restoredDb
      .select({ id: projects.id, name: projects.name, creatorId: projects.creatorId })
      .from(projects)
      .all();
    expect(restoredProjects).toEqual([{ id: project.id, name: "Refit", creatorId: "user_owner" }]);

    const restoredRoles = await restoredDb.select().from(projectRoles).where(eq(projectRoles.projectId, project.id)).all();
    expect(restoredRoles).toHaveLength(seededRoles.length);

    const restoredMembers = await restoredDb.select().from(projectMembers).where(eq(projectMembers.projectId, project.id)).all();
    expect(restoredMembers.map(m => m.id).sort()).toEqual(seededMembers.map(m => m.id).sort());

    const restoredCategories = await restoredDb
      .select({ name: procurementCategories.name, code: procurementCategories.code })
      .from(procurementCategories)
      .all();
    expect(restoredCategories).toEqual([{ name: "Materials", code: "MAT" }]);
  });

  // PLAN-108: the section mounts ARE the project's tabs. If they do not survive
  // export/import, a restored project comes back tab-less — so assert the rows
  // themselves, not just the table's presence in the contribution.
  test("section mounts round-trip through export and import", async () => {
    const now = "2026-08-28T00:00:00.000Z";
    await sourceDb.insert(users).values({
      id: "user_owner",
      oauthSub: "sub-owner",
      username: "owner",
      name: "Owner",
      email: "owner@example.test",
      role: "user",
      status: "active",
      createdAt: now,
      updatedAt: now,
    }).run();

    // Two projects with DIFFERENT mount sets, so the assertion covers per-project
    // scoping and tab order rather than one fixed list.
    const plain = await createProject(sourceDb, { name: "Refit", creatorId: "user_owner" });
    const extended = await createProject(sourceDb, { name: "MV Test", creatorId: "user_owner" });
    await mountSection(sourceDb, extended.id, "ship-profile");

    const sourceRows = await sourceDb.select().from(projectSections).all();
    const keysOf = async (db: AppDatabase, projectId: string): Promise<string[]> => {
      const rows = await db
        .select({ key: projectSections.key })
        .from(projectSections)
        .where(eq(projectSections.projectId, projectId))
        .orderBy(projectSections.sortOrder)
        .all();
      return rows.map(r => r.key);
    };
    const plainKeys = await keysOf(sourceDb, plain.id);
    const extendedKeys = await keysOf(sourceDb, extended.id);
    expect(plainKeys.length).toBeGreaterThan(0);
    expect(extendedKeys).toEqual([...plainKeys, "ship-profile"]);

    const { body } = streamJsonBackup(sourceDb, ["projects"]);
    const parsed = validateBackupData(JSON.parse(await readStreamToString(body)));
    expect(parsed.tables.project_sections).toHaveLength(sourceRows.length);

    await importJsonBackup(restoredDb, parsed);

    expect(await keysOf(restoredDb, plain.id)).toEqual(plainKeys);
    expect(await keysOf(restoredDb, extended.id)).toEqual(extendedKeys);
  });
});

async function readStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done)
      break;
    if (value)
      out += decoder.decode(value);
  }
  return out;
}
