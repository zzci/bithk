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
import { createProject } from "@/modules/project/project.service";
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

async function mount(app: Hono<AppEnv>, p: OwnedProject, key: string): Promise<Response> {
  return app.request(`/projects/${p.shortId}/sections/${key}`, jsonReq("PUT", p.cookie));
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

// Mounting is not creating: `PUT /projects/:id/sections/:key` writes the mount
// row and nothing else — `provision` hooks run only inside `createProject`. So
// a project that "becomes a ship" later gets the routes but none of the seeded
// data, and each section behaves differently in that state.
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

  test("a late-mounted equipment section starts with NO copied global categories", async () => {
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
    const project = await ownedProject("general", "Plain");
    expect((await mount(app, project, "equipment")).status).toBe(200);

    // Empty, not seeded — copy-on-create only runs at create time. The surface
    // is usable (200 + an empty list, categories can be added by hand), it just
    // does not inherit the admin template a ship-preset project would get.
    const list = await app.request(`/projects/${project.shortId}/equipment-categories`, { headers: { Cookie: project.cookie } });
    expect(list.status).toBe(200);
    expect((await list.json() as { data: unknown[] }).data).toHaveLength(0);
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

  // FINDING (PLAN-108 §3, for L2): unlike the other two, `ship-profile` cannot
  // recover from a late mount. Its provision hook is the ONLY writer of
  // `ship_profiles`, and `PUT .../ship-profile` updates an existing row rather
  // than upserting one — so the section mounts, the tab appears, and both verbs
  // answer 404 "Ship profile ... not found" forever. That is a confusing dead
  // end rather than an empty section, and it is a product decision (upsert on
  // PUT, or a `mount` hook alongside `provision`), not a test fix.
  test("ship-profile mounts but both verbs stay 404 — no provision hook runs on a late mount", async () => {
    const app = buildApp();
    const project = await ownedProject("general", "Plain");

    expect(await statusOf(app, project, "ship-profile")).toBe(404);

    const mounted = await mount(app, project, "ship-profile");
    expect(mounted.status).toBe(200);
    expect((await mounted.json() as { data: string[] }).data).toContain("ship-profile");

    // The mount row exists, so `requireSection` now passes...
    expect(await listSections(db, project.internalId)).toContain("ship-profile");
    // ...but no profile row was created, so the surface is a dead end.
    expect(await db.select().from(shipProfiles).where(eq(shipProfiles.projectId, project.internalId)).get()).toBeUndefined();
    expect(await statusOf(app, project, "ship-profile")).toBe(404);

    const put = await app.request(`/projects/${project.shortId}/ship-profile`, jsonReq("PUT", project.cookie, { hullNumber: "HULL-LATE" }));
    expect(put.status).toBe(404);
  });

  test("re-mounting an already-mounted section is a no-op, not an error", async () => {
    const app = buildApp();
    const ship = await ownedProject("ship");
    const again = await mount(app, ship, "worklist");
    expect(again.status).toBe(200);
    expect((await again.json() as { data: string[] }).data.filter(k => k === "worklist")).toHaveLength(1);
  });
});
