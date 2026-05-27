import type { Config } from "@/config";
import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
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
