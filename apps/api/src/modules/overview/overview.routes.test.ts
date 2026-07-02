import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { createDb } from "@/db";
import { DEFAULT_MODULES_SETTING_KEY } from "@/modules/account/groups/module-gate";
import { createIssue, softDeleteIssue } from "@/modules/issue/issue.service";
import { items } from "@/modules/item/schema";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { createProcurement } from "@/modules/procurement/procurement.service";
import { listRoles } from "@/modules/project/project.roles";
import { addMember, createProject } from "@/modules/project/project.service";
import { projectMembers } from "@/modules/project/schema";
import { setSetting } from "@/modules/settings/settings.service";
import { mountRoutes, sessionCookieFor, testNanoid } from "@/shared/test/route-harness";
import { overviewRoutes } from "./overview.routes";
import { userFavorites } from "./schema";
import "@/modules/account";

let db: AppDatabase;
let dbPath: string;

function buildApp() {
  return mountRoutes(db, [overviewRoutes]);
}

async function roleId(projectId: string, name: string): Promise<string> {
  const roles = await listRoles(db, projectId);
  const role = roles.find(r => r.name === name);
  if (!role)
    throw new Error(`Role "${name}" not found for project ${projectId}`);
  return role.id;
}

interface Envelope<T> {
  success: boolean;
  data: T;
}

interface FavoriteBody {
  targetType: string;
  id: string;
  name?: string;
  code?: string;
  title?: string;
  itemName?: string;
  status: string;
  projectId?: string;
  projectName?: string;
  favoritedAt: string;
}

interface OverviewBody {
  myIssues: Array<{ id: string; title: string; status: string; projectId: string; projectName: string }>;
  openProcurements: Array<{ id: string; itemName: string; status: string; projectId: string }>;
}

async function getFavorites(cookie: string): Promise<FavoriteBody[]> {
  const res = await buildApp().request("/favorites", { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const body = await res.json() as Envelope<FavoriteBody[]>;
  return body.data;
}

async function getOverviewData(cookie: string): Promise<OverviewBody> {
  const res = await buildApp().request("/overview", { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const body = await res.json() as Envelope<OverviewBody>;
  return body.data;
}

function putFavorite(cookie: string, type: string, id: string) {
  return buildApp().request(`/favorites/${type}/${id}`, { method: "PUT", headers: { Cookie: cookie } });
}

function deleteFavorite(cookie: string, type: string, id: string) {
  return buildApp().request(`/favorites/${type}/${id}`, { method: "DELETE", headers: { Cookie: cookie } });
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-overview-routes-${Date.now()}-${testNanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  loadNamespaces();
  // Ungrouped non-admin test users resolve their visible modules through the
  // built-in Default group; grant `projects` so member-gating (not module
  // concealment) is what the tests below exercise.
  await setSetting(db, DEFAULT_MODULES_SETTING_KEY, JSON.stringify(["projects"]));
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("auth", () => {
  test("401 without a session on every surface", async () => {
    const app = buildApp();
    expect((await app.request("/overview")).status).toBe(401);
    expect((await app.request("/favorites")).status).toBe(401);
    expect((await app.request("/favorites/project/x", { method: "PUT" })).status).toBe(401);
    expect((await app.request("/favorites/project/x", { method: "DELETE" })).status).toBe(401);
  });
});

describe("favorites CRUD + hydration", () => {
  test("member favorites a project; list hydrates it; re-PUT is idempotent", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "Alpha", creatorId: userId });

    expect((await putFavorite(cookie, "project", project.shortId)).status).toBe(200);
    expect((await putFavorite(cookie, "project", project.shortId)).status).toBe(200);

    const favs = await getFavorites(cookie);
    expect(favs).toHaveLength(1);
    expect(favs[0]?.targetType).toBe("project");
    expect(favs[0]?.id).toBe(project.shortId);
    expect(favs[0]?.name).toBe("Alpha");
    expect(favs[0]?.favoritedAt).toBeTruthy();
  });

  test("unknown type → 422; unknown id and non-member project → the same 404", async () => {
    const { cookie } = await sessionCookieFor(db, "user");
    const { userId: ownerId } = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "P", creatorId: ownerId });

    expect((await putFavorite(cookie, "bookmark", "whatever")).status).toBe(422);
    const missing = await putFavorite(cookie, "project", "zzzzzzzz");
    const nonMember = await putFavorite(cookie, "project", project.shortId);
    expect(missing.status).toBe(404);
    expect(nonMember.status).toBe(404);
  });

  test("admin can favorite any project without membership", async () => {
    const { userId: ownerId } = await sessionCookieFor(db, "user");
    const { cookie: adminCookie } = await sessionCookieFor(db, "admin");
    const project = await createProject(db, { name: "P", creatorId: ownerId });

    expect((await putFavorite(adminCookie, "project", project.shortId)).status).toBe(200);
    const favs = await getFavorites(adminCookie);
    expect(favs.map(f => f.id)).toEqual([project.shortId]);
  });

  test("issue favorite requires issue.view: Reader 200, Guest 404", async () => {
    const { userId: ownerId } = await sessionCookieFor(db, "user");
    const reader = await sessionCookieFor(db, "user");
    const guest = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "P", creatorId: ownerId });
    await addMember(db, project.id, { userId: reader.userId, roleId: await roleId(project.id, "Reader") });
    await addMember(db, project.id, { userId: guest.userId, roleId: await roleId(project.id, "Guest") });
    const issue = await createIssue(db, { title: "Fix pump", creatorId: ownerId, projectId: project.id });

    expect((await putFavorite(reader.cookie, "issue", issue.id)).status).toBe(200);
    expect((await putFavorite(guest.cookie, "issue", issue.id)).status).toBe(404);

    const favs = await getFavorites(reader.cookie);
    expect(favs).toHaveLength(1);
    expect(favs[0]?.targetType).toBe("issue");
    expect(favs[0]?.title).toBe("Fix pump");
    expect(favs[0]?.projectId).toBe(project.shortId);
    expect(favs[0]?.projectName).toBe("P");
  });

  test("procurement favorite requires procurement.view and hydrates amount", async () => {
    const { userId: ownerId, cookie } = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "P", creatorId: ownerId });
    const proc = await createProcurement(db, { projectId: project.id, itemName: "Anchor chain", creatorId: ownerId, amount: 1200.5, currency: "USD" });

    expect((await putFavorite(cookie, "procurement", proc.id)).status).toBe(200);
    const favs = await getFavorites(cookie);
    expect(favs[0]?.targetType).toBe("procurement");
    expect(favs[0]?.itemName).toBe("Anchor chain");
  });

  test("DELETE unfavorites and stays 200 when nothing matches", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "P", creatorId: userId });
    await putFavorite(cookie, "project", project.shortId);

    expect((await deleteFavorite(cookie, "project", project.shortId)).status).toBe(200);
    expect(await getFavorites(cookie)).toEqual([]);
    expect((await deleteFavorite(cookie, "project", project.shortId)).status).toBe(200);
    expect((await deleteFavorite(cookie, "project", "zzzzzzzz")).status).toBe(200);
  });

  test("favorites are per-user", async () => {
    const a = await sessionCookieFor(db, "user");
    const b = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "P", creatorId: a.userId });
    await addMember(db, project.id, { userId: b.userId, roleId: await roleId(project.id, "Reader") });
    await putFavorite(a.cookie, "project", project.shortId);

    expect(await getFavorites(b.cookie)).toEqual([]);
  });

  test("lost membership hides the favorite but keeps the row; soft-deleted issue is omitted", async () => {
    const { userId: ownerId } = await sessionCookieFor(db, "user");
    const member = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "P", creatorId: ownerId });
    await addMember(db, project.id, { userId: member.userId, roleId: await roleId(project.id, "Reader") });
    const issue = await createIssue(db, { title: "T", creatorId: ownerId, projectId: project.id });
    await putFavorite(member.cookie, "project", project.shortId);
    await putFavorite(member.cookie, "issue", issue.id);

    await softDeleteIssue(db, issue.id);
    await db.delete(projectMembers).where(and(
      eq(projectMembers.projectId, project.id),
      eq(projectMembers.userId, member.userId),
    )).run();

    expect(await getFavorites(member.cookie)).toEqual([]);
    // Rows survive: access may come back (fail-closed display, no data loss).
    const rows = await db.select().from(userFavorites).where(eq(userFavorites.userId, member.userId)).all();
    expect(rows).toHaveLength(2);
  });

  test("a hard-deleted target prunes its favorite row lazily", async () => {
    const { userId: ownerId, cookie } = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "P", creatorId: ownerId });
    const issue = await createIssue(db, { title: "T", creatorId: ownerId, projectId: project.id });
    await putFavorite(cookie, "issue", issue.id);

    // Simulate a hard delete of the backing item row (no FK from favorites).
    await db.delete(items).where(eq(items.shortId, issue.id)).run();

    expect(await getFavorites(cookie)).toEqual([]);
    const rows = await db.select().from(userFavorites).where(eq(userFavorites.userId, ownerId)).all();
    expect(rows).toHaveLength(0);
  });
});

describe("GET /overview", () => {
  test("myIssues: only open issues assigned to the caller, in projects they are still a member of", async () => {
    const { userId: ownerId } = await sessionCookieFor(db, "user");
    const me = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "P", creatorId: ownerId });
    const meMember = await addMember(db, project.id, { userId: me.userId, roleId: await roleId(project.id, "Reader") });

    const mine = await createIssue(db, { title: "Mine", creatorId: ownerId, projectId: project.id, assigneeMemberId: meMember.id });
    await createIssue(db, { title: "Mine done", creatorId: ownerId, projectId: project.id, assigneeMemberId: meMember.id, status: "done" });
    await createIssue(db, { title: "Unassigned", creatorId: ownerId, projectId: project.id });

    // An assignment in a project the caller has since left must not surface.
    const other = await createProject(db, { name: "Q", creatorId: ownerId });
    const otherMember = await addMember(db, other.id, { userId: me.userId, roleId: await roleId(other.id, "Reader") });
    await createIssue(db, { title: "Left behind", creatorId: ownerId, projectId: other.id, assigneeMemberId: otherMember.id });
    await db.delete(projectMembers).where(eq(projectMembers.id, otherMember.id)).run();

    const data = await getOverviewData(me.cookie);
    expect(data.myIssues.map(i => i.id)).toEqual([mine.id]);
    expect(data.myIssues[0]?.projectId).toBe(project.shortId);
    expect(data.myIssues[0]?.projectName).toBe("P");
  });

  test("openProcurements: capability-scoped, non-terminal statuses only", async () => {
    const { userId: ownerId } = await sessionCookieFor(db, "user");
    const reader = await sessionCookieFor(db, "user");
    const guest = await sessionCookieFor(db, "user");
    const outsider = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "P", creatorId: ownerId });
    await addMember(db, project.id, { userId: reader.userId, roleId: await roleId(project.id, "Reader") });
    await addMember(db, project.id, { userId: guest.userId, roleId: await roleId(project.id, "Guest") });

    const open = await createProcurement(db, { projectId: project.id, itemName: "Rope", creatorId: ownerId });
    await createProcurement(db, { projectId: project.id, itemName: "Paint", creatorId: ownerId, status: "received" });
    await createProcurement(db, { projectId: project.id, itemName: "Valve", creatorId: ownerId, status: "cancelled" });

    const readerData = await getOverviewData(reader.cookie);
    expect(readerData.openProcurements.map(p => p.id)).toEqual([open.id]);
    expect((await getOverviewData(guest.cookie)).openProcurements).toEqual([]);
    expect((await getOverviewData(outsider.cookie)).openProcurements).toEqual([]);
  });

  test("admin sees open procurements across all projects without membership", async () => {
    const { userId: ownerId } = await sessionCookieFor(db, "user");
    const admin = await sessionCookieFor(db, "admin");
    const project = await createProject(db, { name: "P", creatorId: ownerId });
    const open = await createProcurement(db, { projectId: project.id, itemName: "Rope", creatorId: ownerId });

    const data = await getOverviewData(admin.cookie);
    expect(data.openProcurements.map(p => p.id)).toEqual([open.id]);
  });
});

describe("module visibility", () => {
  test("a caller without the projects module gets empty data and fail-closed writes", async () => {
    const { userId, cookie } = await sessionCookieFor(db, "user");
    const project = await createProject(db, { name: "P", creatorId: userId });
    await putFavorite(cookie, "project", project.shortId);

    // Revoke the Default group's `projects` grant: the ungrouped caller's
    // module set collapses to [] and the workbench must go dark with it.
    await setSetting(db, DEFAULT_MODULES_SETTING_KEY, JSON.stringify([]));

    expect(await getFavorites(cookie)).toEqual([]);
    const data = await getOverviewData(cookie);
    expect(data.myIssues).toEqual([]);
    expect(data.openProcurements).toEqual([]);
    expect((await putFavorite(cookie, "project", project.shortId)).status).toBe(404);
  });
});
