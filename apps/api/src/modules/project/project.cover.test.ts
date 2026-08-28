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
import { releaseReferenceTx } from "@/modules/file";
import { fileRoutes } from "@/modules/file/file.routes";
import { __resetFilePermissionHooksForTests } from "@/modules/file/permission";
import { fileReferences } from "@/modules/file/schema";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { loadNamespaces } from "@/modules/policy/namespace-config";
import { testConfig as harnessTestConfig, mountRoutes, sessionCookieFor } from "@/shared/test/route-harness";
import { projectCoverPermissionHook, registerProjectCoverPermissionHook } from "./project.cover.permission";
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
// Side-effect import: register the auth provider so the session cookie
// resolves to an actor in the HTTP read test.
import "@/modules/account";

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

  test("F4: replacing a cover releases the previous reference (no leak)", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Swap", creatorId: creator });
    const first = await setProjectCover(db, testConfig(), project.id, pngFile(), creator);
    const firstRef = first!.coverReferenceId!;
    const other = new File([Uint8Array.from([...PNG_1X1, 5, 6, 7])], "c2.png", { type: "image/png" });
    const second = await setProjectCover(db, testConfig(), project.id, other, creator);

    // The repoint committed alongside the release: the old reference row is
    // gone (no dangling/orphaned ref) and the new one is live.
    expect(await db.select().from(fileReferences).where(eq(fileReferences.id, firstRef)).get()).toBeUndefined();
    expect(await db.select().from(fileReferences).where(eq(fileReferences.id, second!.coverReferenceId!)).get()).toBeTruthy();
  });

  test("F4: a failed cover repoint + release rolls back together (no dangling/released ref)", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Atomic", creatorId: creator });
    const withCover = await setProjectCover(db, testConfig(), project.id, pngFile(), creator);
    const refA = withCover!.coverReferenceId!;

    // Drive the same repoint-then-release the service does, but throw before
    // commit. Both the cover clear and the reference release must roll back.
    expect(() =>
      db.transaction((tx) => {
        tx.update(projects).set({ coverReferenceId: null }).where(eq(projects.id, project.id)).run();
        releaseReferenceTx(tx, refA);
        throw new Error("boom");
      }),
    ).toThrow("boom");

    const after = await getProjectByShortId(db, project.shortId);
    expect(after?.coverReferenceId).toBe(refA);
    expect(await db.select().from(fileReferences).where(eq(fileReferences.id, refA)).get()).toBeTruthy();
  });

  test("permission hook: any authenticated user reads; delete stays manage-gated", async () => {
    const creator = await seedUser();
    const outsider = await seedUser("user");
    const project = await createProject(db, { name: "Dock", creatorId: creator });
    await setProjectCover(db, testConfig(), project.id, pngFile(), creator);

    const fresh = await getProjectByShortId(db, project.shortId);
    const ref = { ownerId: project.id } as Parameters<typeof projectCoverPermissionHook.canRead>[2];

    expect(fresh?.coverReferenceId).toBeTruthy();
    expect(await projectCoverPermissionHook.canRead(db, { id: creator, role: "user" }, ref)).toBe(true);
    // A non-member authenticated user may now read the cover, but writes stay closed.
    expect(await projectCoverPermissionHook.canRead(db, { id: outsider, role: "user" }, ref)).toBe(true);
    expect(await projectCoverPermissionHook.canDelete(db, { id: outsider, role: "user" }, ref)).toBe(false);
  });

  test("HTTP: a non-member authenticated user GETs the cover image (200)", async () => {
    // The file content route resets the shared hook registry in this suite's
    // beforeEach, so (re)register the cover hook before mounting the route.
    loadNamespaces();
    registerProjectCoverPermissionHook();

    const creator = await seedUser("user");
    const project = await createProject(db, { name: "Quay", creatorId: creator });
    await setProjectCover(db, testConfig(), project.id, pngFile(), creator);

    const fresh = await getProjectByShortId(db, project.shortId);
    const refId = fresh!.coverReferenceId!;
    const refRow = await db.select().from(fileReferences).where(eq(fileReferences.id, refId)).get();
    const fileId = refRow!.fileId;

    // A separately-seeded, authenticated user who is NOT a member of the project.
    const outsider = await sessionCookieFor(db, "user");
    const app = mountRoutes(db, [fileRoutes], harnessTestConfig({ FILE_PRESIGN_ENABLED: false }));
    const res = await app.request(`/files/${fileId}/content?ref=${refId}`, {
      headers: { Cookie: outsider.cookie },
    });
    // Local driver + presign disabled streams the bytes directly → 200.
    expect(res.status).toBe(200);
  });

  test("non-member with no manage capability cannot delete; PM member can", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Pier", creatorId: creator });
    await setProjectCover(db, testConfig(), project.id, pngFile(), creator);
    const ref = { ownerId: project.id } as Parameters<typeof projectCoverPermissionHook.canDelete>[2];

    // The creator is seeded as the Project Owner member → has project.manage.
    expect(await projectCoverPermissionHook.canDelete(db, { id: creator, role: "user" }, ref)).toBe(true);

    // A plain reader (Reader role) holds no manage capability.
    const memberUser = await seedUser("user");
    const memberRole = (await listRoles(db, project.id)).find(r => r.name === "Reader")!;
    await addMember(db, project.id, { roleId: memberRole.id, userId: memberUser });
    expect(await projectCoverPermissionHook.canDelete(db, { id: memberUser, role: "user" }, ref)).toBe(false);
    expect(await projectCoverPermissionHook.canRead(db, { id: memberUser, role: "user" }, ref)).toBe(true);
  });
});

describe("ship-preset projects use the plain project cover", () => {
  // PLAN-108 §5: a ship IS a project, so there is no ship cover to inherit —
  // the project's own `project_cover` reference is the only source.
  test("a ship-preset project starts with no cover and shows its own once set", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Aurora", creatorId: creator, preset: "ship" });
    expect((await composeProjectWithTags(db, project)).coverImageUrl).toBeNull();

    const updated = await setProjectCover(db, testConfig(), project.id, pngFile(), creator);
    const url = (await composeProjectWithTags(db, updated!)).coverImageUrl;
    expect(url).toContain(`ref=${updated!.coverReferenceId}`);
  });

  test("a project with no cover reference resolves to null", async () => {
    const creator = await seedUser();
    const project = await createProject(db, { name: "Standalone", creatorId: creator });
    expect((await composeProjectWithTags(db, project)).coverImageUrl).toBeNull();
  });
});
