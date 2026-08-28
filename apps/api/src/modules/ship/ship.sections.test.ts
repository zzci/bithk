import type { Hono } from "hono";
import type { AppDatabase } from "@/db";
import type { AppEnv } from "@/shared/lib/types";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createDb } from "@/db";
import { createSession } from "@/modules/account/auth/auth.service";
import { projectRoutes } from "@/modules/project/project.routes";
import { createProject, listProjects } from "@/modules/project/project.service";
import { listSections } from "@/modules/project/section.service";
import { mountRoutes, seedUser, testNanoid } from "@/shared/test/route-harness";
import { globalEquipmentCategories, shipEquipmentCategories, shipProfiles } from "./schema";
import { shipRoutes } from "./ship.routes";
// Registers the session-cookie auth provider that `authRequired` resolves through.
import "@/modules/account";
// Registers the three maritime sections (ship-profile / equipment / worklist).
import "./index";

// The mount/unmount lifecycle of the three maritime sections, driven through
// the real `PUT|DELETE /projects/:id/sections/:key` routes against the real
// `provision` / `hasData` hooks registered by `ship/index.ts`. The generic
// mount machinery is covered in `project/section.registry.test.ts` and
// `project/project.routes.test.ts` with stand-in sections; this file proves the
// SHIP hooks are wired to the right tables.
//
// No stand-in sections are registered here, so the process-global section
// registry needs no snapshot/restore.

let db: AppDatabase;
let dbPath: string;

function buildApp(): Hono<AppEnv> {
  return mountRoutes(db, [projectRoutes, shipRoutes]);
}

async function cookieForUser(userId: string): Promise<string> {
  return `session_id=${await createSession(db, userId, "access-token", undefined, 3600)}`;
}

function jsonReq(method: string, cookie: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
}

interface OwnedProject {
  ownerId: string;
  cookie: string;
  shortId: string;
  internalId: string;
}

/** A project whose creator (and therefore `project.manage` holder) drives the test. */
async function ownedProject(preset: "general" | "ship", name = "Aurora"): Promise<OwnedProject> {
  const ownerId = await seedUser(db, "user");
  const project = await createProject(db, { name, creatorId: ownerId, preset });
  return { ownerId, cookie: await cookieForUser(ownerId), shortId: project.shortId, internalId: project.id };
}

async function unmount(app: Hono<AppEnv>, p: OwnedProject, key: string): Promise<Response> {
  return app.request(`/projects/${p.shortId}/sections/${key}`, jsonReq("DELETE", p.cookie));
}

async function mount(app: Hono<AppEnv>, p: OwnedProject, key: string, body?: unknown): Promise<Response> {
  return app.request(`/projects/${p.shortId}/sections/${key}`, jsonReq("PUT", p.cookie, body));
}

/** The project's ship profile, which every mounted `ship-profile` section has. */
async function getProfile(app: Hono<AppEnv>, p: OwnedProject): Promise<{ hullNumber: string; shipStatus: string }> {
  const res = await app.request(`/projects/${p.shortId}/ship-profile`, { headers: { Cookie: p.cookie } });
  expect(res.status).toBe(200);
  return (await res.json() as { data: { hullNumber: string; shipStatus: string } }).data;
}

/** The project's equipment-category names, in list order. */
async function categoryNames(app: Hono<AppEnv>, p: OwnedProject): Promise<string[]> {
  const res = await app.request(`/projects/${p.shortId}/equipment-categories`, { headers: { Cookie: p.cookie } });
  expect(res.status).toBe(200);
  return (await res.json() as { data: { nameEn: string }[] }).data.map(c => c.nameEn);
}

async function seedGlobalCategory(nameEn: string, code: string): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(globalEquipmentCategories).values({
    id: testNanoid(),
    nameZh: `ZH ${nameEn}`,
    nameEn,
    code,
    description: null,
    createdAt: now,
    updatedAt: now,
  }).run();
}

async function statusOf(app: Hono<AppEnv>, p: OwnedProject, path: string): Promise<number> {
  return (await app.request(`/projects/${p.shortId}/${path}`, { headers: { Cookie: p.cookie } })).status;
}

/** Assert a `DELETE .../sections/:key` was refused and left the section mounted. */
async function expectRefused(res: Response, p: OwnedProject, key: string): Promise<void> {
  expect(res.status).toBe(409);
  expect((await res.json() as { error: { code: string } }).error.code).toBe("SECTION_NOT_EMPTY");
  expect(await listSections(db, p.internalId)).toContain(key);
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-ship-sections-${Date.now()}-${testNanoid()}`);
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

// Each section owns a different table, so each needs its own proof that
// `hasData` reads THAT table: a mis-wired predicate would either let a section
// with data be unmounted (silent data orphaning) or wedge an empty one.
describe("unmounting a ship section while it still holds data", () => {
  test("ship-profile refuses while the profile row exists, and succeeds once it is gone", async () => {
    const app = buildApp();
    const ship = await ownedProject("ship");

    // The preset's provision hook always inserts the profile row, so a ship
    // project is blocked from unmounting `ship-profile` from the start.
    await expectRefused(await unmount(app, ship, "ship-profile"), ship, "ship-profile");
    expect(await statusOf(app, ship, "ship-profile")).toBe(200);

    // No route deletes a profile (the vessel particulars are the section), so
    // clear the row directly to exercise the empty branch of the predicate.
    await db.delete(shipProfiles).where(eq(shipProfiles.projectId, ship.internalId)).run();

    const ok = await unmount(app, ship, "ship-profile");
    expect(ok.status).toBe(200);
    expect((await ok.json() as { data: string[] }).data).not.toContain("ship-profile");
    expect(await statusOf(app, ship, "ship-profile")).toBe(404);
  });

  test("equipment refuses while an equipment row exists", async () => {
    const app = buildApp();
    // No global category templates are seeded, so the copy-on-create hook
    // leaves the project with zero categories — the equipment row is the only
    // thing the predicate can be reacting to.
    const ship = await ownedProject("ship");
    expect(await db.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.projectId, ship.internalId)).all()).toHaveLength(0);

    const created = await app.request(`/projects/${ship.shortId}/equipment`, jsonReq("POST", ship.cookie, { name: "Main Engine" }));
    expect(created.status).toBe(201);
    const equipmentId = (await created.json() as { data: { id: string } }).data.id;

    await expectRefused(await unmount(app, ship, "equipment"), ship, "equipment");
    expect(await statusOf(app, ship, "equipment")).toBe(200);

    expect((await app.request(`/projects/${ship.shortId}/equipment/${equipmentId}`, jsonReq("DELETE", ship.cookie))).status).toBe(200);

    const ok = await unmount(app, ship, "equipment");
    expect(ok.status).toBe(200);
    expect((await ok.json() as { data: string[] }).data).not.toContain("equipment");
    expect(await statusOf(app, ship, "equipment")).toBe(404);
  });

  test("equipment refuses while only a category exists (the second half of the predicate)", async () => {
    const app = buildApp();
    const ship = await ownedProject("ship");

    const created = await app.request(`/projects/${ship.shortId}/equipment-categories`, jsonReq("POST", ship.cookie, { nameZh: "ZH Propulsion", nameEn: "Propulsion" }));
    expect(created.status).toBe(201);
    const categoryId = (await created.json() as { data: { id: string } }).data.id;

    await expectRefused(await unmount(app, ship, "equipment"), ship, "equipment");
    expect(await statusOf(app, ship, "equipment-categories")).toBe(200);

    expect((await app.request(`/projects/${ship.shortId}/equipment-categories/${categoryId}`, jsonReq("DELETE", ship.cookie))).status).toBe(200);

    expect((await unmount(app, ship, "equipment")).status).toBe(200);
    expect(await statusOf(app, ship, "equipment-categories")).toBe(404);
  });

  test("equipment refuses right after creation when the global template seeded categories", async () => {
    const now = new Date().toISOString();
    await db.insert(globalEquipmentCategories).values({
      id: testNanoid(),
      nameZh: "ZH Main Engine",
      nameEn: "Main Engine",
      code: "ME",
      description: null,
      createdAt: now,
      updatedAt: now,
    }).run();

    const app = buildApp();
    const ship = await ownedProject("ship");
    await expectRefused(await unmount(app, ship, "equipment"), ship, "equipment");
  });

  test("worklist refuses while a project worklist exists, and succeeds once it is gone", async () => {
    const app = buildApp();
    const ship = await ownedProject("ship");

    // Empty to begin with: worklists have no provision hook.
    expect((await unmount(app, ship, "worklist")).status).toBe(200);
    expect((await mount(app, ship, "worklist")).status).toBe(200);

    const created = await app.request(`/projects/${ship.shortId}/worklists`, jsonReq("POST", ship.cookie, { name: "Hull check" }));
    expect(created.status).toBe(201);
    const worklistId = (await created.json() as { data: { id: string } }).data.id;

    await expectRefused(await unmount(app, ship, "worklist"), ship, "worklist");
    expect(await statusOf(app, ship, "worklists")).toBe(200);

    expect((await app.request(`/projects/${ship.shortId}/worklists/${worklistId}`, jsonReq("DELETE", ship.cookie))).status).toBe(200);

    const ok = await unmount(app, ship, "worklist");
    expect(ok.status).toBe(200);
    expect((await ok.json() as { data: string[] }).data).not.toContain("worklist");
    expect(await statusOf(app, ship, "worklists")).toBe(404);
  });

  test("each ship section's data blocks only its OWN unmount", async () => {
    const app = buildApp();
    const ship = await ownedProject("ship");
    expect((await app.request(`/projects/${ship.shortId}/worklists`, jsonReq("POST", ship.cookie, { name: "Hull check" }))).status).toBe(201);

    // A worklist must not wedge `equipment`, which is empty.
    expect((await unmount(app, ship, "equipment")).status).toBe(200);
    await expectRefused(await unmount(app, ship, "worklist"), ship, "worklist");
  });
});

// Mounting IS provisioning: `PUT /projects/:id/sections/:key` writes the mount
// row and runs the section's `provision` hook in the same transaction, so a
// project that "becomes a ship" later is seeded exactly as the `ship` preset
// would have seeded it (PLAN-108 §5). These tests drive that through the real
// route against the real ship hooks — a general project must be able to grow
// each maritime section into a working, correctly seeded surface.
describe("late mount onto an existing general project", () => {
  test("equipment goes from 404 to a working, empty surface", async () => {
    const app = buildApp();
    const project = await ownedProject("general", "Plain");

    expect(await statusOf(app, project, "equipment")).toBe(404);
    expect(await statusOf(app, project, "equipment-categories")).toBe(404);

    const mounted = await mount(app, project, "equipment");
    expect(mounted.status).toBe(200);
    expect((await mounted.json() as { data: string[] }).data).toEqual(["issues", "procurement", "files", "equipment"]);

    expect(await statusOf(app, project, "equipment")).toBe(200);
    expect(await statusOf(app, project, "equipment-categories")).toBe(200);

    // Writable straight away: the section needs no seeded data to work.
    const created = await app.request(`/projects/${project.shortId}/equipment`, jsonReq("POST", project.cookie, { name: "Winch" }));
    expect(created.status).toBe(201);
  });

  test("a late-mounted equipment section copies the global category template, like a ship-preset create", async () => {
    await seedGlobalCategory("Main Engine", "ME");

    const app = buildApp();
    const late = await ownedProject("general", "Plain");
    expect((await mount(app, late, "equipment")).status).toBe(200);

    // Same seeding as the preset path: the mount runs the section's `provision`
    // hook, so a project that becomes a ship late still inherits the admin
    // template rather than starting with an empty category set.
    const ship = await ownedProject("ship");
    expect(await categoryNames(app, late)).toEqual(["Main Engine"]);
    expect(await categoryNames(app, late)).toEqual(await categoryNames(app, ship));
  });

  test("re-mounting equipment after an unmount copies the template once, not twice", async () => {
    await seedGlobalCategory("Main Engine", "ME");

    const app = buildApp();
    const project = await ownedProject("general", "Plain");
    expect((await mount(app, project, "equipment")).status).toBe(200);

    // `unmountSection` refuses while the section holds data, so a re-mount can
    // only ever start from an empty state — drop the copied category first.
    await expectRefused(await unmount(app, project, "equipment"), project, "equipment");
    await db.delete(shipEquipmentCategories).where(eq(shipEquipmentCategories.projectId, project.internalId)).run();
    expect((await unmount(app, project, "equipment")).status).toBe(200);

    expect((await mount(app, project, "equipment")).status).toBe(200);
    expect(await categoryNames(app, project)).toEqual(["Main Engine"]);
  });

  test("worklist goes from 404 to a working, empty surface", async () => {
    const app = buildApp();
    const project = await ownedProject("general", "Plain");

    expect(await statusOf(app, project, "worklists")).toBe(404);
    expect(await statusOf(app, project, "referenceable-worklists")).toBe(404);

    expect((await mount(app, project, "worklist")).status).toBe(200);

    expect(await statusOf(app, project, "worklists")).toBe(200);
    expect(await statusOf(app, project, "referenceable-worklists")).toBe(200);
    expect((await app.request(`/projects/${project.shortId}/worklists`, jsonReq("POST", project.cookie, { name: "Hull check" }))).status).toBe(201);
  });

  // The invariant PLAN-108 §5 states outright: "section mounted" and "profile
  // row exists" are equivalent. `provision` is the ONLY writer of
  // `ship_profiles` and `PUT .../ship-profile` updates rather than upserts, so
  // a mount that skipped provisioning would leave both verbs answering 404
  // forever with no API path to ever create the row. A general project must be
  // able to become a ship after creation.
  test("ship-profile mounts into a working surface — a profile row exists and both verbs answer", async () => {
    const app = buildApp();
    const project = await ownedProject("general", "Plain");

    expect(await statusOf(app, project, "ship-profile")).toBe(404);

    const mounted = await mount(app, project, "ship-profile");
    expect(mounted.status).toBe(200);
    expect((await mounted.json() as { data: string[] }).data).toContain("ship-profile");

    // The mount row exists, so `requireSection` passes...
    expect(await listSections(db, project.internalId)).toContain("ship-profile");
    // ...and so does the profile row the section is defined by.
    expect(await db.select().from(shipProfiles).where(eq(shipProfiles.projectId, project.internalId)).get()).toBeDefined();
    expect(await statusOf(app, project, "ship-profile")).toBe(200);

    const put = await app.request(`/projects/${project.shortId}/ship-profile`, jsonReq("PUT", project.cookie, { hullNumber: "HULL-LATE" }));
    expect(put.status).toBe(200);
    expect((await put.json() as { data: { hullNumber: string } }).data.hullNumber).toBe("HULL-LATE");
  });

  test("a hull number supplied with the mount is used", async () => {
    const app = buildApp();
    const project = await ownedProject("general", "Plain");

    const mounted = await mount(app, project, "ship-profile", { sectionData: { hullNumber: "HULL-MOUNT", shipStatus: "active" } });
    expect(mounted.status).toBe(200);

    const profile = await getProfile(app, project);
    expect(profile.hullNumber).toBe("HULL-MOUNT");
    expect(profile.shipStatus).toBe("active");
  });

  test("mounting with no payload falls back to the same generated hull number a bare ship create uses", async () => {
    const app = buildApp();
    const late = await ownedProject("general", "Plain");
    const ship = await ownedProject("ship");

    expect((await mount(app, late, "ship-profile")).status).toBe(200);

    // One defaulting rule, reached from both paths.
    const generated = (internalId: string): string => `S-${internalId.slice(-8).toUpperCase()}`;
    expect((await getProfile(app, late)).hullNumber).toBe(generated(late.internalId));
    expect((await getProfile(app, ship)).hullNumber).toBe(generated(ship.internalId));
  });

  test("a rejected ship-profile payload leaves the section unmounted, not half-mounted", async () => {
    const app = buildApp();
    const taken = await ownedProject("ship");
    const project = await ownedProject("general", "Plain");
    const existingHull = (await getProfile(app, taken)).hullNumber;

    // Hull numbers are UNIQUE, so this provision fails inside the transaction.
    const res = await mount(app, project, "ship-profile", { sectionData: { hullNumber: existingHull } });
    expect(res.status).toBe(422);

    expect(await listSections(db, project.internalId)).not.toContain("ship-profile");
    expect(await db.select().from(shipProfiles).where(eq(shipProfiles.projectId, project.internalId)).get()).toBeUndefined();
    expect(await statusOf(app, project, "ship-profile")).toBe(404);
  });

  test("re-mounting an already-mounted section is a no-op, not an error", async () => {
    const app = buildApp();
    const ship = await ownedProject("ship");
    const again = await mount(app, ship, "worklist");
    expect(again.status).toBe(200);
    expect((await again.json() as { data: string[] }).data.filter(k => k === "worklist")).toHaveLength(1);
  });
});

// FIX-071: the list card renders the vessel's identity, so a ship project's
// LIST ROW carries a small profile summary instead of the card fetching
// `/projects/{id}/ship-profile` itself. The contribution comes from the
// `ship-profile` section's `listSummary` hook, so the project module still
// never imports the ship module.
describe("ship-profile list summary", () => {
  /**
   * Run `body` against a probe database that counts every `select` it issues.
   * An N+1 shows up as a count that grows with the number of rows returned.
   */
  async function countSelects(body: (probe: AppDatabase) => Promise<unknown>): Promise<number> {
    let selects = 0;
    const probe: AppDatabase = Object.create(db);
    (probe as { select: unknown }).select = (...args: unknown[]) => {
      selects += 1;
      return (db.select as (...a: unknown[]) => unknown)(...args);
    };
    await body(probe);
    return selects;
  }

  test("a ship row carries its particulars while a general row carries no summary", async () => {
    const app = buildApp();
    const ship = await ownedProject("ship", "Aurora");
    await ownedProject("general", "Plain");
    const update = await app.request(`/projects/${ship.shortId}/ship-profile`, jsonReq("PUT", ship.cookie, {
      hullNumber: "HULL-9",
      shipStatus: "underway",
      imoNumber: "IMO-1234567",
      mmsi: "412345678",
    }));
    expect(update.status).toBe(200);

    const listed = await listProjects(db, {});
    const aurora = listed.data.find(p => p.name === "Aurora")!;
    const plain = listed.data.find(p => p.name === "Plain")!;

    expect(aurora.sectionSummary?.["ship-profile"]).toEqual({
      hullNumber: "HULL-9",
      shipStatus: "underway",
      imoNumber: "IMO-1234567",
      mmsi: "412345678",
    });
    // A project without the section mounted contributes nothing.
    expect(plain.sectionSummary?.["ship-profile"]).toBeUndefined();
  });

  test("the summary loads in one batch, so the query count does not scale with rows", async () => {
    const ownerId = await seedUser(db, "user");
    for (let i = 1; i <= 6; i++)
      await createProject(db, { name: `Ship ${i}`, creatorId: ownerId, preset: "ship" });

    const forOneRow = await countSelects(probe => listProjects(probe, { section: "ship-profile", limit: 1 }));
    const forSixRows = await countSelects(probe => listProjects(probe, { section: "ship-profile", limit: 6 }));

    // Six ship cards cost exactly what one costs: the hook runs once per page,
    // never once per row.
    expect(forSixRows).toBe(forOneRow);
    const sixRows = await listProjects(db, { section: "ship-profile", limit: 6 });
    expect(sixRows.data).toHaveLength(6);
    expect(sixRows.data.every(p => p.sectionSummary?.["ship-profile"] !== undefined)).toBe(true);
  });
});
