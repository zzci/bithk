import type { PolicyContext, ResourceDefinition, ResourceHooks } from "./registry";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { ForbiddenError } from "@/shared/lib/errors";
import { loadNamespaces } from "./namespace-config";
import { ResourceAccess } from "./permission";
import { relationTuples } from "./schema";

// Field-level policy checks resolve through the real Zanzibar engine, so a
// throwaway SQLite DB with a few direct grant tuples drives every branch of
// `projectFields` / `filterWritable` deterministically (no engine mocks).
const testNamespaces = [
  { name: "user" },
  {
    name: "doc",
    relations: {
      viewer: { union: [{ this: {} }] },
      editor: { union: [{ this: {} }] },
      admin: { union: [{ this: {} }] },
    },
  },
] as const;

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
const OBJECT_ID = "doc-1";

async function grant(db: AppDatabase, relation: string, userId: string) {
  await db.insert(relationTuples).values({
    id: nanoid(),
    namespace: "doc",
    objectId: OBJECT_ID,
    relation,
    subjectNamespace: "user",
    subjectId: userId,
    subjectRelation: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
  }).run();
}

// projectFields / filterWritable never touch the logger; a bare stub keeps
// the context minimal.
const stubLogger = {} as unknown as Logger;

function ctxFor(db: AppDatabase, userId: string): PolicyContext {
  return { db, actor: { id: userId, type: "user" }, logger: stubLogger };
}

function makeAccess(opts: { hooks?: ResourceHooks } = {}): ResourceAccess<"read" | "update"> {
  const definition: ResourceDefinition<"read" | "update"> = {
    name: "doc",
    namespace: "doc",
    actions: { read: "viewer", update: "editor" },
    fields: {
      read: { secret: "admin" },
      write: { locked: "admin" },
    },
    ...(opts.hooks ? { hooks: opts.hooks } : {}),
  };
  return new ResourceAccess(definition);
}

describe("ResourceAccess field filtering", () => {
  let db: AppDatabase;
  let dbPath: string;

  beforeEach(async () => {
    loadNamespaces(testNamespaces);
    const dir = resolve(tmpdir(), `test-permission-${Date.now()}-${nanoid()}`);
    mkdirSync(dir, { recursive: true });
    dbPath = resolve(dir, "test.db");
    db = await createDb(dbPath);
  });

  afterEach(() => {
    db.close();
    const dir = resolve(dbPath, "..");
    if (existsSync(dir))
      rmSync(dir, { recursive: true, force: true });
    // loadNamespaces is a clear+replace singleton — restore defaults so the
    // test-only `doc` namespace does not leak into other policy test files.
    loadNamespaces();
  });

  describe("projectFields", () => {
    it("returns a shallow copy with all fields when no read policy is set", async () => {
      const definition: ResourceDefinition<"read"> = {
        name: "doc",
        namespace: "doc",
        actions: { read: "viewer" },
      };
      const access = new ResourceAccess(definition);
      const row = { id: OBJECT_ID, title: "hi", secret: "x" };

      const out = await access.projectFields(ctxFor(db, "alice"), OBJECT_ID, row);

      expect(out).toEqual(row);
      expect(out).not.toBe(row);
    });

    it("keeps unrestricted fields regardless of permissions", async () => {
      const access = makeAccess();
      const row = { id: OBJECT_ID, title: "hi" };

      const out = await access.projectFields(ctxFor(db, "alice"), OBJECT_ID, row);

      expect(out).toEqual(row);
    });

    it("keeps a restricted field when the actor holds the required relation", async () => {
      const access = makeAccess();
      await grant(db, "admin", "alice");
      const row = { id: OBJECT_ID, title: "hi", secret: "classified" };

      const out = await access.projectFields(ctxFor(db, "alice"), OBJECT_ID, row);

      expect(out).toEqual(row);
    });

    it("drops a restricted field when the actor lacks the required relation", async () => {
      const access = makeAccess();
      await grant(db, "viewer", "bob");
      const row = { id: OBJECT_ID, title: "hi", secret: "classified" };

      const out = await access.projectFields(ctxFor(db, "bob"), OBJECT_ID, row);

      expect(out).toEqual({ id: OBJECT_ID, title: "hi" });
      expect("secret" in out).toBe(false);
    });

    it("does not mutate the input row", async () => {
      const access = makeAccess();
      const row = { id: OBJECT_ID, title: "hi", secret: "classified" };

      await access.projectFields(ctxFor(db, "bob"), OBJECT_ID, row);

      expect(row).toEqual({ id: OBJECT_ID, title: "hi", secret: "classified" });
    });

    it("includes restricted fields when a bypass hook short-circuits the check", async () => {
      const access = makeAccess({ hooks: { bypass: () => true } });
      const row = { id: OBJECT_ID, title: "hi", secret: "classified" };

      const out = await access.projectFields(ctxFor(db, "nobody"), OBJECT_ID, row);

      expect(out).toEqual(row);
    });
  });

  describe("filterWritable", () => {
    it("returns a shallow copy with all fields when no write policy is set", async () => {
      const definition: ResourceDefinition<"update"> = {
        name: "doc",
        namespace: "doc",
        actions: { update: "editor" },
      };
      const access = new ResourceAccess(definition);
      const payload = { title: "hi", locked: true };

      const out = await access.filterWritable(ctxFor(db, "alice"), OBJECT_ID, payload);

      expect(out).toEqual(payload);
      expect(out).not.toBe(payload);
    });

    it("keeps unrestricted fields and a permitted restricted field", async () => {
      const access = makeAccess();
      await grant(db, "admin", "alice");
      const payload = { title: "hi", locked: true };

      const out = await access.filterWritable(ctxFor(db, "alice"), OBJECT_ID, payload);

      expect(out).toEqual(payload);
    });

    it("strips a forbidden restricted field by default", async () => {
      const access = makeAccess();
      const payload = { title: "hi", locked: true };

      const out = await access.filterWritable(ctxFor(db, "bob"), OBJECT_ID, payload);

      expect(out).toEqual({ title: "hi" });
      expect("locked" in out).toBe(false);
    });

    it("throws ForbiddenError listing denied fields when mode is reject", async () => {
      const access = makeAccess();
      const payload = { title: "hi", locked: true };

      const promise = access.filterWritable(ctxFor(db, "bob"), OBJECT_ID, payload, { onForbidden: "reject" });

      await expect(promise).rejects.toThrow(ForbiddenError);
      await expect(promise).rejects.toThrow("locked");
    });
  });

  describe("canReadField / canWriteField", () => {
    it("allows any field that is not listed in the policy", async () => {
      const access = makeAccess();
      expect(await access.canReadField(ctxFor(db, "bob"), "title", OBJECT_ID)).toBe(true);
      expect(await access.canWriteField(ctxFor(db, "bob"), "title", OBJECT_ID)).toBe(true);
    });

    it("gates a restricted field on the required relation", async () => {
      const access = makeAccess();
      await grant(db, "admin", "alice");

      expect(await access.canReadField(ctxFor(db, "alice"), "secret", OBJECT_ID)).toBe(true);
      expect(await access.canReadField(ctxFor(db, "bob"), "secret", OBJECT_ID)).toBe(false);
      expect(await access.canWriteField(ctxFor(db, "alice"), "locked", OBJECT_ID)).toBe(true);
      expect(await access.canWriteField(ctxFor(db, "bob"), "locked", OBJECT_ID)).toBe(false);
    });
  });
});
