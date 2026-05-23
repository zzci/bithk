import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { Secret, TOTP } from "otpauth";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { totpChallenges } from "./schema";
import {
  __resetTotpFailureTrackerForTests,
  confirmTotpDevice,
  consumeTotpChallenge,
  createTotpChallenge,
  createTotpDevice,
  deleteTotpDevice,
  hasVerifiedTotp,
  issueStepUpToken,
  isTotpUserLocked,
  listTotpDevices,
  validateStepUpToken,
  verifyTotpCode,
} from "./totp.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

/** Generate a TOTP code for `secret`, optionally for a future timestep. */
function code(secret: string, stepOffset = 0): string {
  const totp = new TOTP({ algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
  return totp.generate({ timestamp: Date.now() + stepOffset * 30_000 });
}

async function makeUser(id: string): Promise<string> {
  await db.insert(users).values({
    id,
    oauthSub: `sub-${id}`,
    username: id,
    name: id,
    email: `${id}@example.com`,
  }).run();
  return id;
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-totp-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  await __resetTotpFailureTrackerForTests(db);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("device enrolment", () => {
  test("createTotpDevice returns a usable secret + provisioning material and lists it unverified", async () => {
    const userId = await makeUser("u1");
    const device = await createTotpDevice(db, userId, "Phone", "u1@example.com", "Acme");
    expect(device.secret).toBeTruthy();
    expect(device.uri).toContain("otpauth://totp/");
    expect(device.uri).toContain("issuer=Acme");
    expect(device.qrCode.startsWith("data:image/png;base64,")).toBe(true);

    const list = await listTotpDevices(db, userId);
    expect(list).toHaveLength(1);
    expect(list[0]?.verified).toBe(false);
  });
});

describe("confirmTotpDevice", () => {
  test("verifies the device when the correct code is supplied", async () => {
    const userId = await makeUser("u1");
    const device = await createTotpDevice(db, userId, "Phone", "u1@example.com");
    expect(await confirmTotpDevice(db, device.id, userId, code(device.secret))).toBe(true);
    expect(await hasVerifiedTotp(db, userId)).toBe(true);
  });

  test("rejects a wrong code", async () => {
    const userId = await makeUser("u1");
    const device = await createTotpDevice(db, userId, "Phone", "u1@example.com");
    expect(await confirmTotpDevice(db, device.id, userId, "000000")).toBe(false);
    expect(await hasVerifiedTotp(db, userId)).toBe(false);
  });

  test("rejects confirming a device that belongs to another user", async () => {
    const owner = await makeUser("owner");
    const attacker = await makeUser("attacker");
    const device = await createTotpDevice(db, owner, "Phone", "owner@example.com");
    expect(await confirmTotpDevice(db, device.id, attacker, code(device.secret))).toBe(false);
  });

  test("a code cannot be replayed to re-confirm an already-verified device", async () => {
    const userId = await makeUser("u1");
    const device = await createTotpDevice(db, userId, "Phone", "u1@example.com");
    const c = code(device.secret);
    expect(await confirmTotpDevice(db, device.id, userId, c)).toBe(true);
    // Already verified → false on the second call regardless of the code.
    expect(await confirmTotpDevice(db, device.id, userId, c)).toBe(false);
  });
});

describe("deleteTotpDevice", () => {
  test("removes an owned device and returns true", async () => {
    const userId = await makeUser("u1");
    const device = await createTotpDevice(db, userId, "Phone", "u1@example.com");
    expect(await deleteTotpDevice(db, device.id, userId)).toBe(true);
    expect(await listTotpDevices(db, userId)).toHaveLength(0);
  });

  test("returns false for an unknown / non-owned device", async () => {
    const userId = await makeUser("u1");
    expect(await deleteTotpDevice(db, "missing", userId)).toBe(false);
  });
});

describe("verifyTotpCode", () => {
  test("succeeds with a fresh code on a verified device", async () => {
    const userId = await makeUser("u1");
    const device = await createTotpDevice(db, userId, "Phone", "u1@example.com");
    await confirmTotpDevice(db, device.id, userId, code(device.secret));
    // A code from a later timestep than the one consumed by confirm.
    expect(await verifyTotpCode(db, userId, code(device.secret, 1))).toBe(true);
  });

  test("rejects a wrong code and a replayed code", async () => {
    const userId = await makeUser("u1");
    const device = await createTotpDevice(db, userId, "Phone", "u1@example.com");
    await confirmTotpDevice(db, device.id, userId, code(device.secret));
    expect(await verifyTotpCode(db, userId, "000000")).toBe(false);

    const fresh = code(device.secret, 1);
    expect(await verifyTotpCode(db, userId, fresh)).toBe(true);
    // Same timestep can't be redeemed twice.
    expect(await verifyTotpCode(db, userId, fresh)).toBe(false);
  });

  test("returns false when the user has no verified device", async () => {
    const userId = await makeUser("u1");
    await createTotpDevice(db, userId, "Phone", "u1@example.com"); // unverified
    expect(await verifyTotpCode(db, userId, "000000")).toBe(false);
  });

  test("locks the user after 5 failures and refuses even a valid code", async () => {
    const userId = await makeUser("u1");
    const device = await createTotpDevice(db, userId, "Phone", "u1@example.com");
    await confirmTotpDevice(db, device.id, userId, code(device.secret));

    for (let i = 0; i < 5; i++)
      expect(await verifyTotpCode(db, userId, "000000")).toBe(false);

    expect((await isTotpUserLocked(db, userId)).locked).toBe(true);
    // A real code is rejected while locked (fails closed before the DB read).
    expect(await verifyTotpCode(db, userId, code(device.secret, 2))).toBe(false);
  });

  test("a successful verify clears the failure counter", async () => {
    const userId = await makeUser("u1");
    const device = await createTotpDevice(db, userId, "Phone", "u1@example.com");
    await confirmTotpDevice(db, device.id, userId, code(device.secret));
    for (let i = 0; i < 4; i++)
      await verifyTotpCode(db, userId, "000000");
    expect(await verifyTotpCode(db, userId, code(device.secret, 1))).toBe(true);
    expect((await isTotpUserLocked(db, userId)).locked).toBe(false);
  });
});

describe("login TOTP challenge", () => {
  test("creates, consumes once, and cannot be consumed twice", async () => {
    const userId = await makeUser("u1");
    const id = await createTotpChallenge(db, userId, "access-tok", "refresh-tok", 3600, "/back");
    const consumed = await consumeTotpChallenge(db, id);
    expect(consumed?.userId).toBe(userId);
    expect(consumed?.accessToken).toBe("access-tok");
    expect(consumed?.redirectUri).toBe("/back");
    expect(await consumeTotpChallenge(db, id)).toBeUndefined();
  });

  test("an expired challenge is pruned and not consumable", async () => {
    const userId = await makeUser("u1");
    await db.insert(totpChallenges).values({
      id: "stale",
      userId,
      accessToken: "a",
      refreshToken: null,
      expiresIn: null,
      redirectUri: "/",
      expiresAt: Date.now() - 1,
    }).run();
    expect(await consumeTotpChallenge(db, "stale")).toBeUndefined();
    const rows = await db.select().from(totpChallenges).where(eq(totpChallenges.id, "stale")).all();
    expect(rows).toHaveLength(0);
  });
});

describe("step-up token", () => {
  test("validates once for the issuing user then is consumed (single-use)", () => {
    const token = issueStepUpToken("user-step-1");
    expect(validateStepUpToken(token, "user-step-1")).toBe(true);
    expect(validateStepUpToken(token, "user-step-1")).toBe(false);
  });

  test("rejects a token presented for a different user and consumes it (fail-closed)", () => {
    const token = issueStepUpToken("user-step-2");
    expect(validateStepUpToken(token, "someone-else")).toBe(false);
    // A mismatched attempt invalidates the token: anyone presenting it
    // already holds the secret, so consuming on any anomaly is the safe
    // choice and the real owner cannot reuse it afterwards.
    expect(validateStepUpToken(token, "user-step-2")).toBe(false);
  });

  test("rejects an unknown token", () => {
    expect(validateStepUpToken("never-issued", "user-step-3")).toBe(false);
  });
});
