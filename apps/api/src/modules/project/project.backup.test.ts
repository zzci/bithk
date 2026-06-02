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
import { shipBackupContribution } from "@/modules/ship/ship.backup";
import { tagBackupContribution } from "@/modules/tag/tag.backup";
import { projectBackupContribution } from "./project.backup";
import { createCategory } from "./project.categories";
import { listRoles } from "./project.roles";
import { createProject } from "./project.service";
import { procurementCategories, projectMembers, projectRoles, projects } from "./schema";

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
    // Parent first, then children that FK back to it: roles before members
    // (members.role_id → roles), categories last.
    expect(mod?.tables.map(table => getTableName(table))).toEqual([
      "projects",
      "project_roles",
      "project_members",
      "procurement_categories",
    ]);
    expect(mod?.deps).toEqual(["users", "ships", "tags"]);
  });

  test("project index registers the contribution when imported", async () => {
    __resetBackupRegistryForTests();

    await import(`./index.ts?backup-registration=${Date.now()}`);

    const mod = getDataModules().projects;
    expect(mod?.tables.map(table => getTableName(table))).toEqual([
      "projects",
      "project_roles",
      "project_members",
      "procurement_categories",
    ]);
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
