import type { AppDatabase } from "@/db";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { customAlphabet } from "nanoid";
import { createDb } from "@/db";
import { contacts, contactTags } from "@/modules/contact/schema";
import {
  createTag,
  deleteTag,
  listTagsWithUsage,
  normalizeTagName,
  renameTag,
  upsertTagIdTx,
} from "./tag.service";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);
const contactJoin = { table: contactTags, tagId: contactTags.tagId };

let db: AppDatabase;
let dbPath: string;

async function seedContact(id: string): Promise<string> {
  const now = new Date().toISOString();
  await db.insert(contacts).values({ id, ownerId: "owner", name: id, createdAt: now, updatedAt: now }).run();
  return id;
}

async function link(contactId: string, tagId: string): Promise<void> {
  await db.insert(contactTags).values({ contactId, tagId }).run();
}

beforeEach(async () => {
  const dir = resolve(tmpdir(), `test-tag-${Date.now()}-${nanoid()}`);
  mkdirSync(dir, { recursive: true });
  dbPath = resolve(dir, "test.db");
  db = await createDb(dbPath);
});

afterEach(() => {
  db.close();
  const dir = resolve(dbPath, "..");
  if (existsSync(dir))
    rmSync(dir, { recursive: true, force: true });
});

describe("normalizeTagName", () => {
  test("trims surrounding whitespace", () => {
    expect(normalizeTagName("  Marine  ")).toBe("Marine");
  });
});

describe("createTag", () => {
  test("trims, and rejects blanks", async () => {
    const tag = await createTag(db, "project", "  Marine  ");
    expect(tag).toEqual({ id: tag.id, name: "Marine", usageCount: 0 });
    expect(createTag(db, "project", "   ")).rejects.toThrow();
  });

  test("rejects duplicates only within the same source type", async () => {
    const projectTag = await createTag(db, "project", "VIP");
    // Same name in another source type is allowed — independent namespaces.
    const contactTag = await createTag(db, "contact", "VIP");
    expect(contactTag.id).not.toBe(projectTag.id);
    // Re-creating within the same source type collides.
    expect(createTag(db, "project", "VIP")).rejects.toThrow();
  });
});

describe("upsertTagIdTx", () => {
  test("find-or-create is idempotent per source type", async () => {
    let first = "";
    let second = "";
    let otherType = "";
    db.transaction((tx) => {
      const now = new Date().toISOString();
      first = upsertTagIdTx(tx, "contact", "supplier", now);
      second = upsertTagIdTx(tx, "contact", "supplier", now);
      otherType = upsertTagIdTx(tx, "document", "supplier", now);
    });
    expect(second).toBe(first);
    expect(otherType).not.toBe(first);
  });
});

describe("listTagsWithUsage", () => {
  test("counts only same-type assignments and orders most-used first", async () => {
    const popular = await createTag(db, "contact", "popular");
    const rare = await createTag(db, "contact", "rare");
    await createTag(db, "contact", "orphan");
    // A project tag with the same name must not leak into the contact list.
    await createTag(db, "project", "popular");

    const c1 = await seedContact("c1");
    const c2 = await seedContact("c2");
    await link(c1, popular.id);
    await link(c2, popular.id);
    await link(c1, rare.id);

    const list = await listTagsWithUsage(db, "contact", contactJoin);
    expect(list.map(t => [t.name, t.usageCount])).toEqual([
      ["popular", 2],
      ["rare", 1],
      ["orphan", 0],
    ]);
  });
});

describe("renameTag", () => {
  test("renames within type, recomputes usage, and rejects collisions", async () => {
    const a = await createTag(db, "contact", "Alpha");
    await createTag(db, "contact", "Beta");
    const c1 = await seedContact("c1");
    await link(c1, a.id);

    const renamed = await renameTag(db, "contact", a.id, "Gamma", contactJoin);
    expect(renamed).toEqual({ id: a.id, name: "Gamma", usageCount: 1 });
    expect(renameTag(db, "contact", a.id, "Beta", contactJoin)).rejects.toThrow();
    expect(await renameTag(db, "contact", "missing", "X", contactJoin)).toBeUndefined();
  });

  test("does not rename a tag belonging to a different source type", async () => {
    const projectTag = await createTag(db, "project", "Shared");
    expect(await renameTag(db, "contact", projectTag.id, "Renamed", contactJoin)).toBeUndefined();
  });
});

describe("deleteTag", () => {
  test("cascade-unlinks assignments and is scoped by source type", async () => {
    const tag = await createTag(db, "contact", "temp");
    const c1 = await seedContact("c1");
    await link(c1, tag.id);

    // Wrong source type leaves the row intact.
    expect(await deleteTag(db, "project", tag.id)).toBe(false);

    expect(await deleteTag(db, "contact", tag.id)).toBe(true);
    const links = await db.select().from(contactTags).all();
    expect(links).toHaveLength(0);
    expect(await deleteTag(db, "contact", tag.id)).toBe(false);
  });
});
