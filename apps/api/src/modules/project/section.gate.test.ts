import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createDb } from "@/db";
import { driveRoutes } from "@/modules/drive";
import { issueRoutes } from "@/modules/issue";
import { procurementRoutes } from "@/modules/procurement";
import { mountRoutes, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { createProject } from "./project.service";
import { unmountSection } from "./section.service";
// Registers the session-cookie auth provider that `authRequired` resolves
// through. The three module barrels imported above also register their
// sections, which is what makes the mounted / unmounted split observable.
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-section-gate-${Date.now()}-${testNanoid()}`);
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

/** A project on the default `general` preset, plus its owner's session cookie. */
async function ownedProject(): Promise<{ shortId: string; id: string; cookie: string }> {
  const { userId, cookie } = await sessionCookieFor(db, "user");
  const project = await createProject(db, { name: "P", creatorId: userId });
  return { shortId: project.shortId, id: project.id, cookie };
}

// PLAN-108 §3: `requireSection` is an ADDITIONAL existence gate on top of the
// capability checks each surface already had. Fail-closed (docs/decisions/003):
// an unmounted section is indistinguishable from a missing project — 404, not
// 403 — so a caller cannot probe which projects mount what. Each case asserts
// the mounted response FIRST, so a 404 that came from a broken fixture rather
// than the gate cannot pass silently.
describe("requireSection gates the three built-in project sections", () => {
  test("/projects/:id/issues 404s once the `issues` section is unmounted", async () => {
    const app = mountRoutes(db, [issueRoutes]);
    const { shortId, id, cookie } = await ownedProject();

    const mounted = await app.request(`/projects/${shortId}/issues`, { headers: { Cookie: cookie } });
    expect(mounted.status).toBe(200);

    await unmountSection(db, id, "issues");

    const unmounted = await app.request(`/projects/${shortId}/issues`, { headers: { Cookie: cookie } });
    expect(unmounted.status).toBe(404);
  });

  test("/projects/:id/procurements 404s once the `procurement` section is unmounted", async () => {
    const app = mountRoutes(db, [procurementRoutes]);
    const { shortId, id, cookie } = await ownedProject();

    const mounted = await app.request(`/projects/${shortId}/procurements`, { headers: { Cookie: cookie } });
    expect(mounted.status).toBe(200);

    await unmountSection(db, id, "procurement");

    const unmounted = await app.request(`/projects/${shortId}/procurements`, { headers: { Cookie: cookie } });
    expect(unmounted.status).toBe(404);
  });

  // The project files surface is addressed by owner scope, not a route param,
  // so the gate sits in the drive module's `resolveProjectOwnerId` funnel. The
  // top-level `/drive` module is untouched by it — asserted below.
  test("the project files surface 404s once the `files` section is unmounted", async () => {
    const app = mountRoutes(db, [driveRoutes]);
    const { shortId, id, cookie } = await ownedProject();
    const url = `/drive/entries?ownerType=project&ownerId=${shortId}`;

    const mounted = await app.request(url, { headers: { Cookie: cookie } });
    expect(mounted.status).toBe(200);

    await unmountSection(db, id, "files");

    const unmounted = await app.request(url, { headers: { Cookie: cookie } });
    expect(unmounted.status).toBe(404);

    // The personal drive is not project-scoped and keeps working regardless.
    const personal = await app.request("/drive/entries", { headers: { Cookie: cookie } });
    expect(personal.status).toBe(200);
  });

  // Two projects rather than one: `unmountSection` refuses while a section
  // still holds data, so the project that proves the mounted path works can
  // never be the one that proves the unmounted path 404s.
  test("mutations are gated too, not just the read edges", async () => {
    const app = mountRoutes(db, [issueRoutes, procurementRoutes]);
    const post = (cookie: string, body: unknown): RequestInit => ({
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookie },
      body: JSON.stringify(body),
    });

    const mounted = await ownedProject();
    expect((await app.request(`/projects/${mounted.shortId}/issues`, post(mounted.cookie, { title: "T" }))).status).toBe(201);
    expect((await app.request(`/projects/${mounted.shortId}/procurements`, post(mounted.cookie, { itemName: "Bolt" }))).status).toBe(201);

    const bare = await ownedProject();
    await unmountSection(db, bare.id, "issues");
    await unmountSection(db, bare.id, "procurement");

    expect((await app.request(`/projects/${bare.shortId}/issues`, post(bare.cookie, { title: "T" }))).status).toBe(404);
    expect((await app.request(`/projects/${bare.shortId}/procurements`, post(bare.cookie, { itemName: "Bolt" }))).status).toBe(404);
  });
});
