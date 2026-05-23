import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { relationTuples } from "@/modules/policy/schema";
import { loadNamespaces } from "./namespace-config";
import { check, expand, listUserResources } from "./zanzibar.engine";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

async function insertTuple(
  db: AppDatabase,
  ns: string,
  objId: string,
  rel: string,
  subNs: string,
  subId: string,
  subRel?: string | null,
) {
  await db.insert(relationTuples).values({
    id: nanoid(),
    namespace: ns,
    objectId: objId,
    relation: rel,
    subjectNamespace: subNs,
    subjectId: subId,
    subjectRelation: subRel ?? null,
    createdBy: null,
    createdAt: new Date().toISOString(),
  }).run();
}

describe("Zanzibar tuple-to-userset (item parent inheritance + resource groups)", () => {
  let db: AppDatabase;
  let dbPath: string;

  beforeEach(async () => {
    loadNamespaces(); // default namespaces: user, group, resource_group, item
    const dir = resolve(tmpdir(), `test-zanzibar-ttu-${Date.now()}-${nanoid()}`);
    mkdirSync(dir, { recursive: true });
    dbPath = resolve(dir, "test.db");
    db = await createDb(dbPath);
  });

  afterEach(() => {
    db.close();
    const dir = resolve(dbPath, "..");
    if (existsSync(dir))
      rmSync(dir, { recursive: true, force: true });
    loadNamespaces();
  });

  describe("check via tuple_to_userset (parent_item)", () => {
    it("inherits viewer from a parent item down the parent_item edge", async () => {
      // alice is viewer of the parent; child points up to parent via parent_item.
      await insertTuple(db, "item", "parent", "viewer", "user", "alice");
      await insertTuple(db, "item", "child", "parent_item", "item", "parent");

      const result = await check(db, "item", "child", "viewer", "user", "alice");
      expect(result.allowed).toBe(true);
      // The chain should name the parent_item edge it resolved through.
      expect(result.resolvedThrough.some(s => s.includes("parent_item"))).toBe(true);
    });

    it("inherits editor (and therefore viewer) from a parent's owner", async () => {
      await insertTuple(db, "item", "parent", "owner", "user", "bob");
      await insertTuple(db, "item", "child", "parent_item", "item", "parent");

      // owner → editor on parent, editor flows down via TTU to child.
      expect((await check(db, "item", "child", "editor", "user", "bob")).allowed).toBe(true);
      expect((await check(db, "item", "child", "viewer", "user", "bob")).allowed).toBe(true);
    });

    it("does not grant access to an unrelated user through the parent edge", async () => {
      await insertTuple(db, "item", "parent", "viewer", "user", "alice");
      await insertTuple(db, "item", "child", "parent_item", "item", "parent");

      expect((await check(db, "item", "child", "viewer", "user", "mallory")).allowed).toBe(false);
    });

    it("survives a parent_item cycle without infinite recursion", async () => {
      // a → b → a forms a cycle on the parent_item edge.
      await insertTuple(db, "item", "a", "parent_item", "item", "b");
      await insertTuple(db, "item", "b", "parent_item", "item", "a");

      const result = await check(db, "item", "a", "viewer", "user", "nobody");
      expect(result.allowed).toBe(false);
    });

    it("resolves multi-level parent inheritance (grandparent → parent → child)", async () => {
      await insertTuple(db, "item", "grandparent", "viewer", "user", "carol");
      await insertTuple(db, "item", "parent", "parent_item", "item", "grandparent");
      await insertTuple(db, "item", "child", "parent_item", "item", "parent");

      expect((await check(db, "item", "child", "viewer", "user", "carol")).allowed).toBe(true);
    });
  });

  describe("expand via tuple_to_userset", () => {
    it("includes the parent item subtree as a child node", async () => {
      await insertTuple(db, "item", "parent", "viewer", "user", "alice");
      await insertTuple(db, "item", "child", "parent_item", "item", "parent");

      const tree = await expand(db, "item", "child", "viewer");
      // The TTU branch attaches a node for the parent item under the
      // computed_userset relation (viewer).
      const ttuNode = tree.find(n => n.namespace === "item" && n.id === "parent" && n.relation === "viewer");
      expect(ttuNode).toBeDefined();
    });
  });

  describe("listUserResources through resource groups (tuple_to_userset)", () => {
    it("lists items reachable via a resource_group the user can view", async () => {
      // alice is a direct viewer of resource_group rg1.
      await insertTuple(db, "resource_group", "rg1", "viewer", "user", "alice");
      // doc1 is parented to rg1 via the parent_item tupleset.
      await insertTuple(db, "item", "doc1", "parent_item", "resource_group", "rg1");

      const items = await listUserResources(db, "alice", "item", "viewer");
      expect(items).toContain("doc1");
    });

    it("respects resource_group relation inheritance (admin implies viewer)", async () => {
      // alice is admin of rg1; admin implies viewer in the resource_group ns.
      await insertTuple(db, "resource_group", "rg1", "admin", "user", "alice");
      await insertTuple(db, "item", "doc2", "parent_item", "resource_group", "rg1");

      const items = await listUserResources(db, "alice", "item", "viewer");
      expect(items).toContain("doc2");
    });

    it("does not leak items from a resource_group the user cannot access", async () => {
      await insertTuple(db, "resource_group", "rg1", "viewer", "user", "alice");
      await insertTuple(db, "item", "secret", "parent_item", "resource_group", "rg2");

      const items = await listUserResources(db, "alice", "item", "viewer");
      expect(items).not.toContain("secret");
    });
  });
});
