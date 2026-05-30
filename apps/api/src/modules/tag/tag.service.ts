import type { AnySQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { TagSourceType } from "./schema";
import type { AppDatabase, AppTransaction } from "@/db";
import { and, count, desc, eq, getTableColumns, inArray, ne, or, sql } from "drizzle-orm";
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

// ─── Resource assignment helpers ──────────────────────────────────────────
// Reusable logic for a domain's assignment join table (project_tags /
// contact_tags / document_tags). Callers pass an explicit binding so the tag
// module never imports a domain schema — the dependency direction stays
// one-way. Behavior mirrors the per-domain helpers these replace exactly.

/**
 * A domain's assignment join: the source type it scopes to, its join `table`,
 * the column pointing back at the owning resource, and the `tag_id` column.
 */
export interface ResourceTagBinding {
  readonly sourceType: TagSourceType;
  readonly table: SQLiteTable;
  readonly resourceColumn: AnySQLiteColumn;
  readonly tagColumn: AnySQLiteColumn;
}

/** A tag id paired with its display name for one resource. */
export interface ResourceTagView {
  readonly id: string;
  readonly name: string;
}

/** A grouped tag view carrying the source-type-wide usage count. */
export interface ResourceTagUsageView {
  readonly id: string;
  readonly name: string;
  readonly usageCount: number;
}

/**
 * Resolve the join table's JS property keys for the bound resource/tag columns.
 * Insert `.values()` is keyed by property name, but a binding only carries the
 * column objects, so match them back by identity. Throws if either column does
 * not belong to the binding table (a wiring error).
 */
function joinColumnKeys(binding: ResourceTagBinding): { resourceKey: string; tagKey: string } {
  const columns = getTableColumns(binding.table);
  let resourceKey: string | undefined;
  let tagKey: string | undefined;
  for (const [key, column] of Object.entries(columns)) {
    if (column === binding.resourceColumn)
      resourceKey = key;
    else if (column === binding.tagColumn)
      tagKey = key;
  }
  if (!resourceKey || !tagKey)
    throw new Error("Tag binding columns do not belong to the binding table");
  return { resourceKey, tagKey };
}

/**
 * Replace one resource's tags with `names`: drop its join rows, then upsert each
 * normalized, non-empty, case-insensitively-deduplicated name into the shared
 * vocabulary and re-link it. Runs synchronously inside a transaction.
 */
export function syncResourceTagsTx(
  tx: AppTransaction,
  binding: ResourceTagBinding,
  resourceId: string,
  names: readonly string[],
  now: string,
): void {
  const { resourceKey, tagKey } = joinColumnKeys(binding);
  tx.delete(binding.table).where(eq(binding.resourceColumn, resourceId)).run();
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key))
      continue;
    seen.add(key);
    const tagId = upsertTagIdTx(tx, binding.sourceType, name, now);
    tx.insert(binding.table).values({ [resourceKey]: resourceId, [tagKey]: tagId } as Record<string, string>).run();
  }
}

/** Tags assigned to one resource as `{id,name}`, ordered by name. */
export async function listResourceTagViews(
  db: AppDatabase,
  binding: ResourceTagBinding,
  resourceId: string,
): Promise<readonly ResourceTagView[]> {
  return await db
    .select({ id: tags.id, name: tags.name })
    .from(binding.table)
    .innerJoin(tags, eq(tags.id, binding.tagColumn))
    .where(eq(binding.resourceColumn, resourceId))
    .orderBy(tags.name)
    .all();
}

/** Tag names assigned to one resource, ordered by name. */
export async function listResourceTagNames(
  db: AppDatabase,
  binding: ResourceTagBinding,
  resourceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(binding.table)
    .innerJoin(tags, eq(tags.id, binding.tagColumn))
    .where(eq(binding.resourceColumn, resourceId))
    .orderBy(tags.name)
    .all();
  return rows.map(r => r.name);
}

/**
 * Load tags for a set of resource ids, grouped by resource id. Each view
 * carries the same source-type-wide `usageCount` the global tag list reports
 * (correlated subquery), so embedded tags match the filter vocabulary.
 */
export async function loadResourceTagsByResource(
  db: AppDatabase,
  binding: ResourceTagBinding,
  resourceIds: readonly string[],
): Promise<Map<string, ResourceTagUsageView[]>> {
  const map = new Map<string, ResourceTagUsageView[]>();
  if (resourceIds.length === 0)
    return map;
  const rows = await db
    .select({
      resourceId: binding.resourceColumn,
      id: tags.id,
      name: tags.name,
      usageCount: sql<number>`(SELECT COUNT(*) FROM ${binding.table} WHERE ${binding.tagColumn} = ${tags.id})`,
    })
    .from(binding.table)
    .innerJoin(tags, eq(tags.id, binding.tagColumn))
    .where(inArray(binding.resourceColumn, [...resourceIds]))
    .all();
  for (const r of rows) {
    // A bound resource column is always a text id column, so the value is a string.
    const resourceId = r.resourceId as string;
    const list = map.get(resourceId) ?? [];
    list.push({ id: r.id, name: r.name, usageCount: r.usageCount });
    map.set(resourceId, list);
  }
  return map;
}

/** Resolve a trimmed value matching `tags.id` OR `tags.name` within a source type. */
export async function resolveTagIdByIdOrName(
  db: AppDatabase,
  sourceType: TagSourceType,
  value: string,
): Promise<string | null> {
  const trimmed = value.trim();
  if (!trimmed)
    return null;
  const row = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(or(eq(tags.id, trimmed), eq(tags.name, trimmed)), eq(tags.sourceType, sourceType)))
    .get();
  return row?.id ?? null;
}

/**
 * Resource ids assigned a given tag, looked up by tag id OR name (for list
 * filtering). Returns an empty array when the tag does not resolve.
 */
export async function listResourceIdsByTag(
  db: AppDatabase,
  binding: ResourceTagBinding,
  tagIdOrName: string,
): Promise<string[]> {
  const tagId = await resolveTagIdByIdOrName(db, binding.sourceType, tagIdOrName);
  if (!tagId)
    return [];
  const rows = await db
    .select({ resourceId: binding.resourceColumn })
    .from(binding.table)
    .where(eq(binding.tagColumn, tagId))
    .all();
  // A bound resource column is always a text id column, so values are strings.
  return rows.map(r => r.resourceId as string);
}

/**
 * Resource ids carrying ANY of the given tags (OR / union), each resolved by
 * tag id OR name. Blank/unresolvable values are ignored; the result is
 * de-duplicated. Returns an empty array when nothing resolves (an empty input
 * therefore applies no filter at the caller).
 */
export async function listResourceIdsByAnyTag(
  db: AppDatabase,
  binding: ResourceTagBinding,
  tagIdsOrNames: readonly string[],
): Promise<string[]> {
  const resolved: string[] = [];
  for (const value of tagIdsOrNames) {
    const tagId = await resolveTagIdByIdOrName(db, binding.sourceType, value);
    if (tagId)
      resolved.push(tagId);
  }
  if (resolved.length === 0)
    return [];
  const rows = await db
    .select({ resourceId: binding.resourceColumn })
    .from(binding.table)
    .where(inArray(binding.tagColumn, resolved))
    .all();
  // A bound resource column is always a text id column, so values are strings.
  return [...new Set(rows.map(r => r.resourceId as string))];
}
