import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { createProject } from "@/modules/project/project.service";
import { projects, projectSections } from "@/modules/project/schema";
import { nanoid } from "@/shared/lib/id";
import { assertMountIntegrity, checkMountIntegrity } from "./seed.integrity";
// Side-effect imports: the four barrels register the project sections whose
// provision hooks `createProject` runs. The seed importer pulls in the same
// four for the same reason.
import "@/modules/drive";
import "@/modules/issue";
import "@/modules/procurement";
import "@/modules/ship";

// PLAN-108: a project's tabs come entirely from its `project_sections` rows, so
// a dropped mount hides a core tab with no error. `bun run seed` asserts this
// invariant after importing; these tests keep it enforced in CI, where nobody
// runs the seed.

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-seed-integrity-${Date.now()}-${nanoid()}`);
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

async function seedUser(): Promise<string> {
  const id = nanoid();
  await db.insert(users).values({
    oauthSub: `test|${id}`,
    id,
    username: `u-${id}`,
    name: "Seed User",
    email: `${id}@example.com`,
    role: "admin",
  }).run();
  return id;
}

describe("seed mount integrity", () => {
  test("an empty database has nothing to violate", async () => {
    expect(await checkMountIntegrity(db)).toEqual({ projects: 0, ships: 0, violations: [] });
  });

  test("projects created through the normal path pass", async () => {
    const creatorId = await seedUser();
    await createProject(db, { name: "General", creatorId });
    await createProject(db, {
      name: "Vessel",
      creatorId,
      preset: "ship",
      sectionData: { "ship-profile": { hullNumber: "YN-2026-001" } },
    });

    const report = await checkMountIntegrity(db);
    expect(report).toEqual({ projects: 2, ships: 1, violations: [] });
    await expect(assertMountIntegrity(db)).resolves.toBeDefined();
  });

  test("a general project missing a core section is reported and throws", async () => {
    const creatorId = await seedUser();
    const project = await createProject(db, { name: "General", creatorId });

    await db.delete(projectSections)
      .where(and(eq(projectSections.projectId, project.id), eq(projectSections.key, "files")))
      .run();

    const report = await checkMountIntegrity(db);
    expect(report.violations).toEqual([
      { shortId: project.shortId, name: "General", preset: "general", missing: ["files"] },
    ]);
    await expect(assertMountIntegrity(db)).rejects.toThrow(/mount integrity check failed/);
  });

  test("a ship project is measured against the ship preset, not the general one", async () => {
    const creatorId = await seedUser();
    const project = await createProject(db, {
      name: "Vessel",
      creatorId,
      preset: "ship",
      sectionData: { "ship-profile": { hullNumber: "YN-2026-002" } },
    });

    // The three maritime mounts go; the profile row stays, which is exactly the
    // regression the profile-row marker exists to catch.
    for (const key of ["ship-profile", "equipment", "worklist"]) {
      await db.delete(projectSections)
        .where(and(eq(projectSections.projectId, project.id), eq(projectSections.key, key)))
        .run();
    }

    const report = await checkMountIntegrity(db);
    expect(report.violations).toEqual([
      { shortId: project.shortId, name: "Vessel", preset: "ship", missing: ["ship-profile", "equipment", "worklist"] },
    ]);
    await expect(assertMountIntegrity(db)).rejects.toThrow(/missing ship-profile, equipment, worklist/);
  });

  test("soft-deleted projects are out of scope", async () => {
    const creatorId = await seedUser();
    const project = await createProject(db, { name: "Gone", creatorId });
    await db.delete(projectSections).where(eq(projectSections.projectId, project.id)).run();
    await db.update(projects)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(projects.id, project.id))
      .run();

    expect((await checkMountIntegrity(db)).violations).toEqual([]);
  });
});
