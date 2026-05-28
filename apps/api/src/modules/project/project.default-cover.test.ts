import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { getReferenceById } from "@/modules/file";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { getSetting } from "@/modules/settings/settings.service";
import {
  composeProjectWithTags,
  createProject,
  getDefaultProjectCover,
  PROJECT_DEFAULT_COVER_KEY,
  removeDefaultProjectCover,
  setDefaultProjectCover,
} from "./project.service";

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
  return new File([PNG_1X1], "default.png", { type: "image/png" });
}

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
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
  }).run();
  return id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-project-default-cover-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  __resetDriverRegistryForTests();
  __setLocalDriverRootForTests(resolve(dir, "blobs"));
  setActiveDriver("local");
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("global default project cover", () => {
  test("get returns nulls when unset", async () => {
    expect(await getDefaultProjectCover(db)).toEqual({ referenceId: null, url: null });
  });

  test("upload creates a reference, sets the key, and returns the inline url", async () => {
    const result = await setDefaultProjectCover(db, testConfig(), pngFile(), await seedUser());

    expect(result.referenceId).toBeTruthy();
    expect(result.url).toMatch(/^\/api\/files\/.+\/content\?ref=.+&inline=true$/);
    expect(result.url).toContain(`ref=${result.referenceId}`);

    // The setting points at the new reference so create-seeding can consume it.
    expect(await getSetting(db, PROJECT_DEFAULT_COVER_KEY)).toBe(result.referenceId);
    // The reference exists.
    expect(await getReferenceById(db, result.referenceId!)).toBeTruthy();
    // GET mirrors the upload result.
    expect(await getDefaultProjectCover(db)).toEqual(result);
  });

  test("replace releases the prior reference and repoints the key", async () => {
    const uploader = await seedUser();
    const first = await setDefaultProjectCover(db, testConfig(), pngFile(), uploader);
    const firstRef = first.referenceId!;

    // A distinct image so the upload does not dedupe onto the same reference.
    const other = new File([Uint8Array.from([...PNG_1X1, 7, 8, 9])], "default2.png", { type: "image/png" });
    const second = await setDefaultProjectCover(db, testConfig(), other, uploader);

    expect(second.referenceId).toBeTruthy();
    expect(second.referenceId).not.toBe(firstRef);
    // Old reference released, key now points at the new one.
    expect(await getReferenceById(db, firstRef)).toBeUndefined();
    expect(await getSetting(db, PROJECT_DEFAULT_COVER_KEY)).toBe(second.referenceId);
  });

  test("remove releases the reference and clears the setting", async () => {
    const set = await setDefaultProjectCover(db, testConfig(), pngFile(), await seedUser());

    await removeDefaultProjectCover(db, testConfig());

    expect(await getReferenceById(db, set.referenceId!)).toBeUndefined();
    expect(await getSetting(db, PROJECT_DEFAULT_COVER_KEY)).toBeNull();
    expect(await getDefaultProjectCover(db)).toEqual({ referenceId: null, url: null });
  });

  test("remove is idempotent when no default is set", async () => {
    await removeDefaultProjectCover(db, testConfig());
    expect(await getSetting(db, PROJECT_DEFAULT_COVER_KEY)).toBeNull();
  });

  test("create-seeding applies the default cover to a new project", async () => {
    const uploader = await seedUser();
    const set = await setDefaultProjectCover(db, testConfig(), pngFile(), uploader);

    const project = await createProject(db, { name: "Seeded", creatorId: uploader });

    expect(project.coverReferenceId).toBe(set.referenceId);
    const view = await composeProjectWithTags(db, project);
    expect(view.coverImageUrl).toContain(`ref=${set.referenceId}`);
  });
});
