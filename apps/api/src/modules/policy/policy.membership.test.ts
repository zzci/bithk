import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { users } from "@/modules/account/users/schema";
import { loadNamespaces } from "./namespace-config";
import {
  addGroupMembership,
  createTuple,
  deleteTupleByKey,
  deleteTuplesForEntity,
  getGroupMemberCounts,
  getTuplesByObject,
  getTuplesBySubject,
  listGroupIdsForUser,
  listGroupMembershipsForUser,
  listGroupMembershipsForUsers,
  listGroupMembersWithJoinedAt,
  listUserIdsInGroup,
  removeGroupMembership,
} from "./policy.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

let db: AppDatabase;
let dbPath: string;

beforeEach(async () => {
  loadNamespaces();
  const dir = resolve(tmpdir(), `test-policy-membership-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
  // `relation_tuples.created_by` references `users.id`; the actor must exist.
  await db.insert(users).values({
    id: "admin",
    oauthSub: "sub-admin",
    username: "admin",
    name: "Admin",
    email: "admin@example.com",
  }).run();
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
  loadNamespaces();
});

describe("addGroupMembership / removeGroupMembership", () => {
  test("add is idempotent and removal mirrors it", async () => {
    expect(await addGroupMembership(db, "g1", "alice", "admin")).toBe(true);
    // Second add finds the existing tuple → false, no duplicate row.
    expect(await addGroupMembership(db, "g1", "alice", "admin")).toBe(false);
    expect(await listUserIdsInGroup(db, "g1")).toEqual(["alice"]);

    expect(await removeGroupMembership(db, "g1", "alice")).toBe(true);
    // Removing again → false.
    expect(await removeGroupMembership(db, "g1", "alice")).toBe(false);
    expect(await listUserIdsInGroup(db, "g1")).toEqual([]);
  });
});

describe("group membership read helpers", () => {
  beforeEach(async () => {
    await addGroupMembership(db, "g1", "alice", "admin");
    await addGroupMembership(db, "g1", "bob", "admin");
    await addGroupMembership(db, "g2", "alice", "admin");
  });

  test("listGroupIdsForUser returns every group the user is in", async () => {
    expect([...await listGroupIdsForUser(db, "alice")].sort()).toEqual(["g1", "g2"]);
    expect(await listGroupIdsForUser(db, "bob")).toEqual(["g1"]);
    expect(await listGroupIdsForUser(db, "carol")).toEqual([]);
  });

  test("listUserIdsInGroup returns direct members only", async () => {
    expect([...await listUserIdsInGroup(db, "g1")].sort()).toEqual(["alice", "bob"]);
  });

  test("listGroupMembershipsForUser includes joinedAt", async () => {
    const rows = await listGroupMembershipsForUser(db, "alice");
    expect(rows.map(r => r.groupId).sort()).toEqual(["g1", "g2"]);
    expect(rows[0]?.joinedAt).toBeTruthy();
  });

  test("listGroupMembershipsForUsers filters by the supplied ids", async () => {
    const filtered = await listGroupMembershipsForUsers(db, ["bob"]);
    expect(filtered).toEqual([{ userId: "bob", groupId: "g1" }]);
  });

  test("listGroupMembershipsForUsers returns all memberships when no ids given", async () => {
    const all = await listGroupMembershipsForUsers(db);
    expect(all).toHaveLength(3);
  });

  test("listGroupMembersWithJoinedAt returns members of one group", async () => {
    const rows = await listGroupMembersWithJoinedAt(db, "g1");
    expect(rows.map(r => r.subjectId).sort()).toEqual(["alice", "bob"]);
    expect(rows.every(r => typeof r.joinedAt === "string")).toBe(true);
  });

  test("getGroupMemberCounts aggregates per group, omitting empties", async () => {
    const counts = await getGroupMemberCounts(db);
    expect(counts.get("g1")).toBe(2);
    expect(counts.get("g2")).toBe(1);
    expect(counts.has("g3")).toBe(false);
  });
});

describe("deleteTupleByKey", () => {
  test("removes a tuple matched by its composite key (null subjectRelation)", async () => {
    await createTuple(db, {
      namespace: "item",
      objectId: "a",
      relation: "viewer",
      subjectNamespace: "user",
      subjectId: "alice",
    }, "admin");

    expect(await deleteTupleByKey(db, {
      namespace: "item",
      objectId: "a",
      relation: "viewer",
      subjectNamespace: "user",
      subjectId: "alice",
    })).toBe(true);
    expect(await getTuplesByObject(db, "item", "a")).toHaveLength(0);
  });

  test("matches a userset tuple by its subjectRelation", async () => {
    await createTuple(db, {
      namespace: "item",
      objectId: "a",
      relation: "viewer",
      subjectNamespace: "group",
      subjectId: "g1",
      subjectRelation: "member",
    }, "admin");

    // Without the subjectRelation the key does not match a userset tuple.
    expect(await deleteTupleByKey(db, {
      namespace: "item",
      objectId: "a",
      relation: "viewer",
      subjectNamespace: "group",
      subjectId: "g1",
    })).toBe(false);

    expect(await deleteTupleByKey(db, {
      namespace: "item",
      objectId: "a",
      relation: "viewer",
      subjectNamespace: "group",
      subjectId: "g1",
      subjectRelation: "member",
    })).toBe(true);
  });

  test("returns false when no tuple matches", async () => {
    expect(await deleteTupleByKey(db, {
      namespace: "item",
      objectId: "ghost",
      relation: "viewer",
      subjectNamespace: "user",
      subjectId: "nobody",
    })).toBe(false);
  });
});

describe("deleteTuplesForEntity", () => {
  test("removes tuples where the entity is the object or the subject", async () => {
    // entity g1 appears as a subject (membership) and as an object (resource grant)
    await addGroupMembership(db, "g1", "alice", "admin");
    await createTuple(db, {
      namespace: "item",
      objectId: "a",
      relation: "viewer",
      subjectNamespace: "group",
      subjectId: "g1",
      subjectRelation: "member",
    }, "admin");
    // An unrelated tuple that must survive.
    await addGroupMembership(db, "g2", "bob", "admin");

    await deleteTuplesForEntity(db, "group", "g1");

    expect(await getTuplesBySubject(db, "group", "g1")).toHaveLength(0);
    expect(await getTuplesByObject(db, "group", "g1")).toHaveLength(0);
    // g2's membership is untouched.
    expect(await listUserIdsInGroup(db, "g2")).toEqual(["bob"]);
  });
});
