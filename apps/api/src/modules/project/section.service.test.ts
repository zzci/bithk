import type { AppDatabase } from "@/db";
import type { ProtectedEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { errorHandler } from "@/shared/middleware/error-handler";
import { createProject } from "./project.service";
import { projects, projectSections } from "./schema";
import { requireSection } from "./section.middleware";
import { registerProjectSection, resetProjectSectionRegistry } from "./section.registry";
import {
  hasSection,
  listSections,
  loadSectionsForProjects,
  mountSection,
  provisionSections,
  unmountSection,
} from "./section.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

async function seedUser(): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `user-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

/** All mount rows of one project, in `sort_order`. */
function sectionRows(projectId: string) {
  return db.select().from(projectSections).where(eq(projectSections.projectId, projectId)).orderBy(projectSections.sortOrder).all();
}

function sectionRow(projectId: string, key: string) {
  return db.select().from(projectSections).where(and(eq(projectSections.projectId, projectId), eq(projectSections.key, key))).get();
}

/**
 * Run `fn` while counting `db.select` calls, so a batch loader can prove it
 * really is one query rather than one per project.
 */
async function countSelects<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const original: AppDatabase["select"] = db.select.bind(db);
  let calls = 0;
  db.select = ((...args: Parameters<AppDatabase["select"]>) => {
    calls += 1;
    return original(...args);
  }) as AppDatabase["select"];
  try {
    return [await fn(), calls];
  }
  finally {
    db.select = original;
  }
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-section-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
});

afterEach(() => {
  resetProjectSectionRegistry();
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("provisionSections", () => {
  test("mounts the general preset in tab order with a sort_order gap", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });

    const rows = await sectionRows(project.id);
    expect(rows.map(r => r.key)).toEqual(["issues", "procurement", "files"]);
    expect(rows.map(r => r.sortOrder)).toEqual([0, 10, 20]);
    expect(rows.every(r => r.createdAt === project.updatedAt)).toBe(true);
  });

  test("mounts a preset key even when no module registered a definition for it", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Vessel", creatorId: creator, preset: "ship" });

    expect(await listSections(db, project.id)).toEqual([
      "issues",
      "procurement",
      "files",
      "ship-profile",
      "equipment",
      "worklist",
    ]);
  });

  test("runs the registered provision hooks in PRESET order, not registration order", async () => {
    const seen: string[] = [];
    registerProjectSection({ key: "files", provision: () => void seen.push("files") });
    registerProjectSection({ key: "issues", provision: () => void seen.push("issues") });

    const creator = await seedUser();
    await createProject(db, { name: "Hooked", creatorId: creator });

    expect(seen).toEqual(["issues", "files"]);
  });

  test("hands the provision hook the preset, creator, timestamp and section payload", async () => {
    let captured: unknown;
    registerProjectSection({
      key: "ship-profile",
      provision: (_tx, projectId, ctx) => {
        captured = {
          projectId,
          preset: ctx.preset,
          creatorId: ctx.creatorId,
          sectionData: ctx.sectionData,
          now: ctx.now,
        };
      },
    });

    const creator = await seedUser();
    const project = await createProject(db, {
      name: "Vessel",
      creatorId: creator,
      preset: "ship",
      sectionData: { "ship-profile": { hullNumber: "IMO-1" } },
    });

    expect(captured).toEqual({
      projectId: project.id,
      preset: "ship",
      creatorId: creator,
      sectionData: { "ship-profile": { hullNumber: "IMO-1" } },
      now: project.updatedAt,
    });
  });

  test("commits a provision hook's writes with the rest of the project transaction", async () => {
    registerProjectSection({
      key: "issues",
      provision: (tx, projectId, ctx) => {
        tx.insert(projectSections).values({ projectId, key: "extra", sortOrder: 990, createdAt: ctx.now }).run();
      },
    });

    const creator = await seedUser();
    const project = await createProject(db, { name: "Extra", creatorId: creator });

    expect(await hasSection(db, project.id, "extra")).toBe(true);
  });

  test("rejects an async provision hook rather than losing its writes after COMMIT", async () => {
    // @ts-expect-error an async provision hook is rejected at compile time; the
    // runtime guard asserted below is the defence in depth behind it.
    registerProjectSection({ key: "files", provision: async () => {} });

    const creator = await seedUser();
    await expect(createProject(db, { name: "Async", creatorId: creator })).rejects.toThrow(/synchronously/);
  });

  test("is callable directly inside a caller-owned transaction", async () => {
    const creator = await seedUser();
    const kept = await createProject(db, { name: "Kept", creatorId: creator });
    const target = await createProject(db, { name: "Target", creatorId: creator });
    await db.delete(projectSections).where(eq(projectSections.projectId, target.id)).run();

    db.transaction((tx) => {
      provisionSections(tx, target.id, "ship", {
        preset: "ship",
        now: new Date().toISOString(),
        creatorId: creator,
        sectionData: undefined,
      });
    });

    expect(await listSections(db, target.id)).toHaveLength(6);
    expect(await listSections(db, kept.id)).toHaveLength(3);
  });
});

describe("mountSection", () => {
  test("appends a preset key after the current last section", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });

    await mountSection(db, project.id, "equipment");

    expect(await listSections(db, project.id)).toEqual(["issues", "procurement", "files", "equipment"]);
    expect((await sectionRow(project.id, "equipment"))?.sortOrder).toBe(30);
  });

  test("accepts a registered key that no preset lists", async () => {
    registerProjectSection({ key: "documents" });
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });

    await mountSection(db, project.id, "documents");

    expect(await hasSection(db, project.id, "documents")).toBe(true);
  });

  test("rejects a key that is neither in a preset nor registered", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });

    await expect(mountSection(db, project.id, "nope")).rejects.toMatchObject({
      statusCode: 422,
      code: "VALIDATION_ERROR",
    });
    expect(await listSections(db, project.id)).toEqual(["issues", "procurement", "files"]);
  });

  test("is idempotent — re-mounting keeps the original sort order", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });

    await mountSection(db, project.id, "issues");

    expect(await listSections(db, project.id)).toEqual(["issues", "procurement", "files"]);
    expect((await sectionRow(project.id, "issues"))?.sortOrder).toBe(0);
  });

  test("starts at zero on a project with no sections yet", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });
    await db.delete(projectSections).where(eq(projectSections.projectId, project.id)).run();

    await mountSection(db, project.id, "files");

    expect((await sectionRow(project.id, "files"))?.sortOrder).toBe(0);
  });
});

describe("unmountSection", () => {
  test("removes the mount row of a section with no data", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });

    await unmountSection(db, project.id, "procurement");

    expect(await listSections(db, project.id)).toEqual(["issues", "files"]);
  });

  test("refuses with 409 while the section still holds data", async () => {
    registerProjectSection({ key: "issues", hasData: async () => true });
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });

    await expect(unmountSection(db, project.id, "issues")).rejects.toMatchObject({
      statusCode: 409,
      code: "SECTION_NOT_EMPTY",
    });
    expect(await hasSection(db, project.id, "issues")).toBe(true);
  });

  test("unmounts once the section reports it is empty", async () => {
    registerProjectSection({ key: "issues", hasData: async () => false });
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });

    await unmountSection(db, project.id, "issues");

    expect(await hasSection(db, project.id, "issues")).toBe(false);
  });

  test("asks hasData only about the project it was called for", async () => {
    const inspected: string[] = [];
    registerProjectSection({
      key: "files",
      hasData: async (_db, projectId) => {
        inspected.push(projectId);
        return false;
      },
    });
    const creator = await seedUser();
    const a = await createProject(db, { name: "A", creatorId: creator });
    const b = await createProject(db, { name: "B", creatorId: creator });

    await unmountSection(db, a.id, "files");

    expect(inspected).toEqual([a.id]);
    expect(await hasSection(db, b.id, "files")).toBe(true);
  });

  test("unmounting a section that is not mounted is a no-op", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });

    await unmountSection(db, project.id, "equipment");

    expect(await listSections(db, project.id)).toEqual(["issues", "procurement", "files"]);
  });
});

describe("listSections / hasSection", () => {
  test("orders by sort_order, not by insertion or alphabet", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });
    await db.update(projectSections)
      .set({ sortOrder: -5 })
      .where(and(eq(projectSections.projectId, project.id), eq(projectSections.key, "files")))
      .run();

    expect(await listSections(db, project.id)).toEqual(["files", "issues", "procurement"]);
  });

  test("returns an empty list for an unknown project", async () => {
    expect(await listSections(db, "no-such-project")).toEqual([]);
  });

  test("hasSection distinguishes mounted from unmounted", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });

    expect(await hasSection(db, project.id, "issues")).toBe(true);
    expect(await hasSection(db, project.id, "equipment")).toBe(false);
  });
});

describe("loadSectionsForProjects", () => {
  test("returns every project's sections from a single query", async () => {
    const creator = await seedUser();
    const general = await createProject(db, { name: "General", creatorId: creator });
    const ship = await createProject(db, { name: "Ship", creatorId: creator, preset: "ship" });

    const [map, selects] = await countSelects(() => loadSectionsForProjects(db, [general.id, ship.id]));

    expect(selects).toBe(1);
    expect(map.get(general.id)).toEqual(["issues", "procurement", "files"]);
    expect(map.get(ship.id)).toEqual([
      "issues",
      "procurement",
      "files",
      "ship-profile",
      "equipment",
      "worklist",
    ]);
  });

  test("issues no query at all for an empty id list", async () => {
    const [map, selects] = await countSelects(() => loadSectionsForProjects(db, []));

    expect(selects).toBe(0);
    expect(map.size).toBe(0);
  });

  test("omits projects that have no sections rather than mapping them to an empty list", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Alpha", creatorId: creator });
    await db.delete(projectSections).where(eq(projectSections.projectId, project.id)).run();

    const map = await loadSectionsForProjects(db, [project.id, "missing"]);

    expect(map.size).toBe(0);
    expect(map.get(project.id)).toBeUndefined();
  });
});

describe("requireSection", () => {
  function buildApp(): Hono<ProtectedEnv> {
    const app = new Hono<ProtectedEnv>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      await next();
    });
    app.get("/projects/:projectId/equipment", requireSection("equipment"), c => c.json({ ok: true }));
    app.get("/legacy/:id/equipment", requireSection("equipment", { param: "id" }), c => c.json({ ok: true }));
    app.onError(errorHandler);
    return app;
  }

  test("passes a request whose project has the section mounted", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Vessel", creatorId: creator, preset: "ship" });

    const res = await buildApp().request(`/projects/${project.shortId}/equipment`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("404s a project that has not mounted the section", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Plain", creatorId: creator });

    const res = await buildApp().request(`/projects/${project.shortId}/equipment`);

    expect(res.status).toBe(404);
  });

  test("404s an unknown project short id", async () => {
    const res = await buildApp().request("/projects/nosuchid/equipment");

    expect(res.status).toBe(404);
  });

  test("404s a soft-deleted project even with the section mounted", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Vessel", creatorId: creator, preset: "ship" });
    await db.update(projects)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(projects.id, project.id))
      .run();

    const res = await buildApp().request(`/projects/${project.shortId}/equipment`);

    expect(res.status).toBe(404);
  });

  test("honours a custom param name", async () => {
    const creator = await seedUser();
    const mounted = await createProject(db, { name: "Vessel", creatorId: creator, preset: "ship" });
    const plain = await createProject(db, { name: "Plain", creatorId: creator });
    const app = buildApp();

    expect((await app.request(`/legacy/${mounted.shortId}/equipment`)).status).toBe(200);
    expect((await app.request(`/legacy/${plain.shortId}/equipment`)).status).toBe(404);
  });
});
