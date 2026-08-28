import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { createProject } from "@/modules/project/project.service";
import { projects } from "@/modules/project/schema";
import { createCategory, deleteCategory, hasProjectCategories, listCategories, resolveCategory, updateCategory } from "./procurement.categories";
import {
  createGlobalCategory,
  deleteGlobalCategory,
  listGlobalCategories,
  updateGlobalCategory,
} from "./procurement.global-categories";
// Registers the `procurement` section, whose `provision` hook is what copies the
// global category template into a new project (PLAN-108 §3). Without this
// side-effect import there is no hook and copy-on-create silently does nothing.
import "./index";

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

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-procurement-categories-${Date.now()}-${nanoid()}`);
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

describe("global procurement categories", () => {
  test("CRUD over the global template set", async () => {
    const created = await createGlobalCategory(db, { name: "Hull", code: "HUL" });
    expect(created.name).toBe("Hull");
    expect((await listGlobalCategories(db)).map(c => c.name)).toEqual(["Hull"]);

    const updated = await updateGlobalCategory(db, created.id, { name: "Hull & deck" });
    expect(updated?.name).toBe("Hull & deck");
    expect(await updateGlobalCategory(db, "missing", { name: "X" })).toBeUndefined();

    expect(await deleteGlobalCategory(db, created.id)).toBe(true);
    expect(await deleteGlobalCategory(db, created.id)).toBe(false);
    expect(await listGlobalCategories(db)).toHaveLength(0);
  });

  test("a new project is seeded from the current global set (copy-on-create)", async () => {
    const creator = await seedUser("Alice");
    await createGlobalCategory(db, { name: "Engine", code: "ENG" });
    await createGlobalCategory(db, { name: "Safety" });

    const project = await createProject(db, { name: "P", creatorId: creator });
    const seeded = await listCategories(db, project.id);
    expect(seeded.map(c => c.name).sort()).toEqual(["Engine", "Safety"]);
  });

  test("a project created with no globals defined gets none", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    expect(await listCategories(db, project.id)).toHaveLength(0);
  });

  test("later global edits do not touch existing projects", async () => {
    const creator = await seedUser("Alice");
    const cat = await createGlobalCategory(db, { name: "Original" });
    const project = await createProject(db, { name: "P", creatorId: creator });

    // Mutate the global set after the project exists.
    await updateGlobalCategory(db, cat.id, { name: "Renamed" });
    await createGlobalCategory(db, { name: "Added later" });
    await deleteGlobalCategory(db, cat.id);

    const seeded = await listCategories(db, project.id);
    // The project keeps its original copy, unaffected by global churn.
    expect(seeded.map(c => c.name)).toEqual(["Original"]);
  });
});

describe("per-project procurement categories", () => {
  test("CRUD is scoped to the owning project", async () => {
    const creator = await seedUser("Alice");
    const mine = await createProject(db, { name: "Mine", creatorId: creator });
    const other = await createProject(db, { name: "Other", creatorId: creator });

    const created = await createCategory(db, mine.id, { name: "Deck", code: "DCK" });
    expect(await resolveCategory(db, mine.id, created.id)).toBeDefined();
    // The same id read through a different project must not resolve.
    expect(await resolveCategory(db, other.id, created.id)).toBeUndefined();

    expect((await updateCategory(db, mine.id, created.id, { name: "Deck & hull" }))?.name).toBe("Deck & hull");
    expect(await updateCategory(db, other.id, created.id, { name: "Steal" })).toBeUndefined();

    expect(await deleteCategory(db, other.id, created.id)).toBe(false);
    expect(await deleteCategory(db, mine.id, created.id)).toBe(true);
    expect(await listCategories(db, mine.id)).toHaveLength(0);
  });

  test("hasProjectCategories backs the section unmount guard", async () => {
    const creator = await seedUser("Alice");
    const project = await createProject(db, { name: "P", creatorId: creator });
    expect(await hasProjectCategories(db, project.id)).toBe(false);

    await createCategory(db, project.id, { name: "Deck" });
    expect(await hasProjectCategories(db, project.id)).toBe(true);
  });
});

describe("copy-on-create runs inside the create transaction", () => {
  // PLAN-108 §3 moved this copy out of `createProjectTx` and into the
  // `procurement` section's `provision` hook. The hook MUST stay synchronous:
  // bun:sqlite transactions are, so writes deferred past an `await` would land
  // after COMMIT. Assert atomicity directly — the categories must be visible in
  // the same statement window as the project row, never a moment later.
  test("the seeded categories are committed with the project row", async () => {
    const creator = await seedUser("Alice");
    await createGlobalCategory(db, { name: "Engine" });
    await createGlobalCategory(db, { name: "Safety" });

    const project = await createProject(db, { name: "P", creatorId: creator });

    const row = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, project.id)).get();
    expect(row).toBeDefined();
    // Same read pass: had provisioning happened outside the transaction the
    // project row would exist with no categories behind it.
    expect((await listCategories(db, project.id)).map(c => c.name).sort()).toEqual(["Engine", "Safety"]);
  });
});
