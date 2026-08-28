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
import {
  __resetBackupRegistryForTests,
  getDataModules,
  getTablesForModules,
  registerBackupContribution,
  resolveModulesWithDeps,
} from "@/modules/backup/registry";
import { importJsonBackup, validateBackupData } from "@/modules/backup/restore.service";
import { itemBackupContribution } from "@/modules/item/item.backup";
import { policyBackupContribution } from "@/modules/policy/policy.backup";
import { projectBackupContribution } from "@/modules/project/project.backup";
import { createProject } from "@/modules/project/project.service";
import { tagBackupContribution } from "@/modules/tag/tag.backup";
import { procurementBackupContribution } from "./procurement.backup";
import { createCategory } from "./procurement.categories";
import { createGlobalCategory } from "./procurement.global-categories";
import { globalProcurementCategories, procurementCategories } from "./schema";
// Registers the `procurement` section so `createProject` runs the copy-on-create
// hook — the exported category rows below come from it, not from a hand-insert.
import "./index";

let sourceDb: AppDatabase;
let restoredDb: AppDatabase;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(resolvePath(tmpdir(), "test-procurement-backup-"));
  sourceDb = await createDb(resolvePath(dir, "source.db"));
  restoredDb = await createDb(resolvePath(dir, "restored.db"));
  __resetBackupRegistryForTests();
  // The procurement contribution deps on items / policies / projects; projects
  // in turn deps on users / tags. Register the whole chain so the export
  // resolves it.
  registerBackupContribution(accountBackupContribution);
  registerBackupContribution(tagBackupContribution);
  registerBackupContribution(projectBackupContribution);
  registerBackupContribution(itemBackupContribution);
  registerBackupContribution(policyBackupContribution);
  registerBackupContribution(procurementBackupContribution);
});

afterEach(() => {
  sourceDb.close();
  restoredDb.close();
  __resetBackupRegistryForTests();
  rmSync(dir, { recursive: true, force: true });
});

async function seedOwner(): Promise<void> {
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
}

describe("procurement backup contribution", () => {
  test("claims the category tables in FK-safe order", () => {
    const mod = getDataModules().procurements;
    expect(mod?.name).toBe("procurements");
    // Global vocabulary first (no outbound FK), then the per-project copies,
    // then the procurements whose category_id points at them.
    expect(mod?.tables.map(table => getTableName(table))).toEqual([
      "global_procurement_categories",
      "procurement_categories",
      "procurement_details",
    ]);
  });

  // PLAN-108 Risks / "Backup contribution regrouping": `procurement_categories`
  // FKs `projects.id`, and it now lives in a DIFFERENT contribution from
  // `projects`. Prove the topological walk still emits `projects` first —
  // otherwise every restore would fail on the FK.
  test("projects still precedes procurement_categories in the global insert order", () => {
    const modules = resolveModulesWithDeps(["procurements"]);
    expect(modules.indexOf("projects")).toBeLessThan(modules.indexOf("procurements"));

    const tables = getTablesForModules(modules).map(table => getTableName(table));
    expect(tables.indexOf("projects")).toBeGreaterThanOrEqual(0);
    expect(tables.indexOf("projects")).toBeLessThan(tables.indexOf("procurement_categories"));
  });

  // The importer maps archive rows to live tables BY TABLE NAME, so moving a
  // table between contributions should be transparent. PLAN-108 requires that
  // be proven rather than assumed: export a project whose categories were
  // seeded by the section's provision hook, re-import, and assert the rows land
  // back on the same project.
  test("procurement categories round-trip and stay attached to their project", async () => {
    await seedOwner();
    await createGlobalCategory(sourceDb, { name: "Engine", code: "ENG" });
    await createGlobalCategory(sourceDb, { name: "Safety" });

    // Two projects, so the assertion covers per-project scoping rather than
    // "some category rows came back".
    const refit = await createProject(sourceDb, { name: "Refit", creatorId: "user_owner" });
    const survey = await createProject(sourceDb, { name: "Survey", creatorId: "user_owner" });
    await createCategory(sourceDb, refit.id, { name: "Materials", code: "MAT" });

    const { modules, body } = streamJsonBackup(sourceDb, ["procurements"]);
    // `projects` is pulled in as a dependency, ahead of this contribution.
    expect(modules).toContain("projects");
    expect(modules.indexOf("projects")).toBeLessThan(modules.indexOf("procurements"));

    const parsed = validateBackupData(JSON.parse(await readStreamToString(body)));
    // 2 globals copied into each of 2 projects, plus the one added by hand.
    expect(parsed.tables.procurement_categories).toHaveLength(5);
    expect(parsed.tables.global_procurement_categories).toHaveLength(2);

    await importJsonBackup(restoredDb, parsed);

    const namesFor = async (projectId: string): Promise<string[]> => {
      const rows = await restoredDb
        .select({ name: procurementCategories.name })
        .from(procurementCategories)
        .where(eq(procurementCategories.projectId, projectId))
        .all();
      return rows.map(r => r.name).sort();
    };
    expect(await namesFor(refit.id)).toEqual(["Engine", "Materials", "Safety"]);
    expect(await namesFor(survey.id)).toEqual(["Engine", "Safety"]);

    const restoredGlobals = await restoredDb
      .select({ name: globalProcurementCategories.name, code: globalProcurementCategories.code })
      .from(globalProcurementCategories)
      .all();
    expect(restoredGlobals.map(g => g.name).sort()).toEqual(["Engine", "Safety"]);
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
