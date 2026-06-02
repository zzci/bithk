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
import { __resetFilePermissionHooksForTests } from "@/modules/file/permission";
import { __setLocalDriverRootForTests } from "@/modules/file/storage/local";
import { __resetDriverRegistryForTests, setActiveDriver } from "@/modules/file/storage/registry";
import { shipCoverPermissionHook } from "./ship.cover.permission";
import {
  composeShipWithBase,
  createShip,
  getShipById,
  removeShipCover,
  setShipCover,
} from "./ship.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

// Real 1x1 PNG — uploadAndReference verifies the declared MIME against magic
// bytes, so a forged text payload would be rejected.
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

// A second, content-distinct PNG. uploadAndReference dedups by content hash and
// refuses re-attaching the same bytes to one owner, so the replace test (T7)
// needs a different image for the second upload.
const PNG_1X1_ALT = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  c => c.charCodeAt(0),
);

function pngFileAlt(): File {
  return new File([PNG_1X1_ALT], "cover-2.png", { type: "image/png" });
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
  const dir = resolve(tmpdir(), `test-ship-cover-${Date.now()}-${nanoid()}`);
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

describe("ship cover", () => {
  test("set then remove exposes / clears coverImageUrl", async () => {
    const creator = await seedUser();
    const ship = await createShip(db, { name: "Aurora", creatorId: creator });

    expect((await composeShipWithBase(db, ship)).coverImageUrl).toBeNull();

    const afterSet = await setShipCover(db, testConfig(), ship.id, pngFile(), creator);
    expect(afterSet?.coverReferenceId).toBeTruthy();
    const setView = await composeShipWithBase(db, afterSet!);
    expect(setView.coverImageUrl).toMatch(/^\/api\/files\/.+\/content\?ref=.+&inline=true$/);

    const afterRemove = await removeShipCover(db, testConfig(), ship.id);
    expect(afterRemove?.coverReferenceId).toBeNull();
    expect((await composeShipWithBase(db, afterRemove!)).coverImageUrl).toBeNull();
  });

  // T7: replacing the cover (set A then set B) repoints to B and releases A so
  // the old file reference is not leaked.
  test("replacing the cover releases the previous reference", async () => {
    const creator = await seedUser();
    const ship = await createShip(db, { name: "Halcyon", creatorId: creator });

    const afterA = await setShipCover(db, testConfig(), ship.id, pngFile(), creator);
    const refA = afterA!.coverReferenceId!;
    expect(refA).toBeTruthy();

    const afterB = await setShipCover(db, testConfig(), ship.id, pngFileAlt(), creator);
    const refB = afterB!.coverReferenceId!;
    expect(refB).toBeTruthy();
    expect(refB).not.toBe(refA);

    // A is released (row gone); B is the live reference.
    expect(await getReferenceById(db, refA)).toBeUndefined();
    expect(await getReferenceById(db, refB)).toBeDefined();
  });

  test("permission hook: base-project members read, others do not; manage gates delete", async () => {
    const creator = await seedUser();
    const outsider = await seedUser("user");
    const ship = await createShip(db, { name: "Nimbus", creatorId: creator });
    await setShipCover(db, testConfig(), ship.id, pngFile(), creator);

    const fresh = await getShipById(db, ship.id);
    const ref = { ownerId: ship.id } as Parameters<typeof shipCoverPermissionHook.canRead>[2];

    expect(fresh?.coverReferenceId).toBeTruthy();
    // Creator is the base project's PM member → read + manage.
    expect(await shipCoverPermissionHook.canRead(db, { id: creator, role: "user" }, ref)).toBe(true);
    expect(await shipCoverPermissionHook.canDelete(db, { id: creator, role: "user" }, ref)).toBe(true);
    // Outsider is not a member → neither.
    expect(await shipCoverPermissionHook.canRead(db, { id: outsider, role: "user" }, ref)).toBe(false);
    expect(await shipCoverPermissionHook.canDelete(db, { id: outsider, role: "user" }, ref)).toBe(false);
    // App admin bypasses.
    expect(await shipCoverPermissionHook.canRead(db, { id: outsider, role: "admin" }, ref)).toBe(true);
  });
});
