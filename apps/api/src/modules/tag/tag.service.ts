import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { TagSourceType } from "./schema";
import type { AppDatabase, AppTransaction } from "@/db";
import { and, count, desc, eq, ne } from "drizzle-orm";
import { ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { tags } from "./schema";

// Central operations over the shared, type-scoped tag vocabulary. Domains own
// their own join tables (project_tags / contact_tags / document_tags) and pass
// the join here only to count assignments — the tag module never imports a
// domain schema, so the dependency direction stays one-way.

/** Max length for a tag name, mirrored by the route-level zod schemas. */
export const TAG_NAME_MAX = 50;

export interface TagView {
  readonly id: string;
  readonly name: string;
  // Number of rows in the source type's join table referencing this tag.
  readonly usageCount: number;
}

/** A domain's assignment join table plus its `tag_id` column. */
export interface TagJoin {
  readonly table: SQLiteTable;
  readonly tagId: AnySQLiteColumn;
}

/** Trim a raw tag name. Uniqueness/lookup is exact on the trimmed value. */
export function normalizeTagName(raw: string): string {
  return raw.trim();
}

/** Reject empty or over-long names. `name` is expected to be normalized. */
export function assertValidTagName(name: string): void {
  if (!name)
    throw new ValidationError("Tag name is required", { name: "Required" });
  if (name.length > TAG_NAME_MAX)
    throw new ValidationError(`Tag name must be at most ${TAG_NAME_MAX} characters`, { name: "Too long" });
}

/** Look up a tag id by exact name within one source type. */
async function findTagId(db: AppDatabase, sourceType: TagSourceType, name: string): Promise<string | undefined> {
  const row = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.sourceType, sourceType), eq(tags.name, name))).get();
  return row?.id;
}

/**
 * Synchronous find-or-create inside a transaction. `name` must already be
 * normalized and non-empty. Returns the tag id for (sourceType, name),
 * inserting a fresh row when the pair does not exist yet.
 */
export function upsertTagIdTx(tx: AppTransaction, sourceType: TagSourceType, name: string, now: string): string {
  const existing = tx.select({ id: tags.id }).from(tags).where(and(eq(tags.sourceType, sourceType), eq(tags.name, name))).get();
  if (existing)
    return existing.id;
  const id = nanoid();
  tx.insert(tags).values({ id, name, sourceType, createdAt: now, updatedAt: now }).run();
  return id;
}

/** List one source type's vocabulary with assignment counts (most-used first, then by name). */
export async function listTagsWithUsage(
  db: AppDatabase,
  sourceType: TagSourceType,
  join: TagJoin,
): Promise<readonly TagView[]> {
  const usageCount = count(join.tagId);
  return await db
    .select({ id: tags.id, name: tags.name, usageCount })
    .from(tags)
    .leftJoin(join.table, eq(join.tagId, tags.id))
    .where(eq(tags.sourceType, sourceType))
    .groupBy(tags.id)
    .orderBy(desc(usageCount), tags.name)
    .all();
}

/** Count assignments referencing a tag in its source type's join table. */
async function usageOf(db: AppDatabase, join: TagJoin, tagId: string): Promise<number> {
  const row = await db.select({ value: count() }).from(join.table).where(eq(join.tagId, tagId)).get();
  return row?.value ?? 0;
}

/** Create a tag in one source type. Trims, validates, and rejects same-type duplicates. */
export async function createTag(db: AppDatabase, sourceType: TagSourceType, rawName: string): Promise<TagView> {
  const name = normalizeTagName(rawName);
  assertValidTagName(name);
  if (await findTagId(db, sourceType, name))
    throw new ValidationError("Tag name already exists", { name: "Duplicate" });

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(tags).values({ id, name, sourceType, createdAt: now, updatedAt: now }).run();
  return { id, name, usageCount: 0 };
}

/**
 * Rename a tag within one source type. Returns undefined when the tag is gone
 * (or belongs to another type); rejects a name collision inside the same type.
 */
export async function renameTag(
  db: AppDatabase,
  sourceType: TagSourceType,
  id: string,
  rawName: string,
  join: TagJoin,
): Promise<TagView | undefined> {
  const name = normalizeTagName(rawName);
  assertValidTagName(name);

  const existing = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.id, id), eq(tags.sourceType, sourceType))).get();
  if (!existing)
    return undefined;
  const collision = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.sourceType, sourceType), eq(tags.name, name), ne(tags.id, id))).get();
  if (collision)
    throw new ValidationError("Tag name already exists", { name: "Duplicate" });

  const now = new Date().toISOString();
  await db.update(tags).set({ name, updatedAt: now }).where(eq(tags.id, id)).run();
  return { id, name, usageCount: await usageOf(db, join, id) };
}

/**
 * Delete a tag by id within one source type. The join tables declare
 * `tag_id` with `ON DELETE CASCADE`, so removing the row also unlinks every
 * assignment. Returns false when the tag does not exist for this type.
 */
export async function deleteTag(db: AppDatabase, sourceType: TagSourceType, id: string): Promise<boolean> {
  const existing = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.id, id), eq(tags.sourceType, sourceType))).get();
  if (!existing)
    return false;
  await db.delete(tags).where(eq(tags.id, id)).run();
  return true;
}
