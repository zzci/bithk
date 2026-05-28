import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { __resetFilePermissionHooksForTests } from "@/modules/file/permission";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { createShip, setShipCover } from "@/modules/ship/ship.service";
import { projectCoverPermissionHook } from "./project.cover.permission";
import { listRoles } from "./project.roles";
import {
  addMember,
  composeProjectWithTags,
  createProject,
  getProjectByShortId,
  removeProjectCover,
  setProjectCover,
} from "./project.service";
import { projects } from "./schema";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

// Real 1x1 PNG — uploadAndReference verifies the declared MIME against the
// magic bytes, so a forged text payload would be rejected.
const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  c => c.charCodeAt(0),
);

function testConfig(): Config {
  return {
    MAX_UPLOAD_BYTES: 10 * 1024 * 1024,
    MAX_ATTACHMENTS_PER_RESOURCE: 20,
    UPLOADS_TOTAL_BYTES: 0,
    FILE_GC_MODE: "sync",
    FILE_PRESIGN_ENABLED: false,
    FILE_PRESIGN_TTL_SECONDS: 300,
  } as unknown as Config;
}

function pngFile(): File {
  return new File([PNG_1X1], "cover.png", { type: "image/png" });
}

let db: AppDatabase;
let dbPath: string;

async function seedUser(role: "admin" | "user" = "admin"): Promise<string> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: `user-${id}`,
    name: `User ${id}`,
    email: `${id}@test.com`,
    role,
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-project-cover-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __resetFilePermissionHooksForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("project cover", () => {
  test("set then remove exposes / clears coverImageUrl", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Bridge", creatorId: creator });

    expect((await composeProjectWithTags(db, project)).coverImageUrl).toBeNull();

    const afterSet = await setProjectCover(db, testConfig(), project.id, pngFile(), creator);
    expect(afterSet?.coverReferenceId).toBeTruthy();
    const setView = await composeProjectWithTags(db, afterSet!);
    expect(setView.coverImageUrl).toMatch(/^\/api\/files\/.+\/content\?ref=.+&inline=true$/);

    const afterRemove = await removeProjectCover(db, testConfig(), project.id);
    expect(afterRemove?.coverReferenceId).toBeNull();
    expect((await composeProjectWithTags(db, afterRemove!)).coverImageUrl).toBeNull();
  });

  test("replacing a cover swaps the reference", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Tower", creatorId: creator });

    const first = await setProjectCover(db, testConfig(), project.id, pngFile(), creator);
    const firstRef = first!.coverReferenceId;
    // A different image so the upload does not collide on the per-owner unique ref.
    const other = new File([Uint8Array.from([...PNG_1X1, 0, 1, 2])], "cover2.png", { type: "image/png" });
    const second = await setProjectCover(db, testConfig(), project.id, other, creator);

    expect(second!.coverReferenceId).toBeTruthy();
    expect(second!.coverReferenceId).not.toBe(firstRef);
  });

  test("permission hook: members read, non-members do not", async () => {
    const creator = await seedUser();
    const outsider = await seedUser("user");
    const project = await createProject(db, { name: "Dock", creatorId: creator });
    await setProjectCover(db, testConfig(), project.id, pngFile(), creator);

    const fresh = await getProjectByShortId(db, project.shortId);
    const ref = { ownerId: project.id } as Parameters<typeof projectCoverPermissionHook.canRead>[2];

    expect(fresh?.coverReferenceId).toBeTruthy();
    expect(await projectCoverPermissionHook.canRead(db, { id: creator, role: "user" }, ref)).toBe(true);
    expect(await projectCoverPermissionHook.canRead(db, { id: outsider, role: "user" }, ref)).toBe(false);
    expect(await projectCoverPermissionHook.canDelete(db, { id: outsider, role: "user" }, ref)).toBe(false);
  });

  test("non-member with no manage capability cannot delete; PM member can", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Pier", creatorId: creator });
    await setProjectCover(db, testConfig(), project.id, pngFile(), creator);
    const ref = { ownerId: project.id } as Parameters<typeof projectCoverPermissionHook.canDelete>[2];

    // The creator is seeded as the Project Owner member → has project.manage.
    expect(await projectCoverPermissionHook.canDelete(db, { id: creator, role: "user" }, ref)).toBe(true);

    // A plain member (Member role) holds no manage capability.
    const memberUser = await seedUser("user");
    const memberRole = (await listRoles(db, project.id)).find(r => r.name === "Member")!;
    await addMember(db, project.id, { roleId: memberRole.id, userId: memberUser });
    expect(await projectCoverPermissionHook.canDelete(db, { id: memberUser, role: "user" }, ref)).toBe(false);
    expect(await projectCoverPermissionHook.canRead(db, { id: memberUser, role: "user" }, ref)).toBe(true);
  });
});

describe("base project inherits the ship cover", () => {
  test("base project with no own cover shows the ship cover; own cover overrides", async () => {
    const creator = await seedUser();
    const ship = await createShip(db, { name: "Aurora", creatorId: creator });
    const baseProject = (await db.select().from(projects).where(eq(projects.id, ship.baseProjectId!)).get())!;

    // No covers yet.
    expect((await composeProjectWithTags(db, baseProject)).coverImageUrl).toBeNull();

    // Ship gets a cover → the base project inherits it.
    const shippedRow = await setShipCover(db, testConfig(), ship.id, pngFile(), creator);
    const inherited = (await composeProjectWithTags(db, baseProject)).coverImageUrl;
    expect(inherited).toContain(`ref=${shippedRow!.coverReferenceId}`);

    // Base project sets its own cover → it overrides the inherited one.
    const own = new File([Uint8Array.from([...PNG_1X1, 9, 8, 7])], "own.png", { type: "image/png" });
    const afterOwn = await setProjectCover(db, testConfig(), baseProject.id, own, creator);
    const ownUrl = (await composeProjectWithTags(db, afterOwn!)).coverImageUrl;
    expect(ownUrl).toContain(`ref=${afterOwn!.coverReferenceId}`);
    expect(ownUrl).not.toContain(`ref=${shippedRow!.coverReferenceId}`);
  });

  test("a non-base project does not inherit any ship cover", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Standalone", creatorId: creator });
    expect((await composeProjectWithTags(db, project)).coverImageUrl).toBeNull();
  });
});
