import type { TagType } from "./schema";
import type { AppDatabase, AppTransaction } from "@/db";
import { and, count, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { tags, tagsRefs } from "./schema";

// Central operations over the shared, type-scoped tag vocabulary and the single
// generic `tags_refs` assignment table. Every domain (project / contact /
// document / issue / procurement) passes a lightweight `{ type }` binding so the
// tag module never imports a domain schema — the dependency direction stays
// one-way.

/** Max length for a tag name, mirrored by the route-level zod schemas. */
export const TAG_NAME_MAX = 50;

export interface TagView {
  readonly id: string;
  readonly name: string;
  // Number of `tags_refs` rows referencing this tag.
  readonly usageCount: number;
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

/** Look up a tag id by exact name within one type. */
async function findTagId(db: AppDatabase, type: TagType, name: string): Promise<string | undefined> {
  const row = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.type, type), eq(tags.name, name))).get();
  return row?.id;
}

/**
 * Synchronous find-or-create inside a transaction. `name` must already be
 * normalized and non-empty. Returns the tag id for (type, name), inserting a
 * fresh row when the pair does not exist yet.
 */
export function upsertTagIdTx(tx: AppTransaction, type: TagType, name: string, now: string): string {
  const existing = tx.select({ id: tags.id }).from(tags).where(and(eq(tags.type, type), eq(tags.name, name))).get();
  if (existing)
    return existing.id;
  const id = nanoid();
  tx.insert(tags).values({ id, name, type, createdAt: now, updatedAt: now }).run();
  return id;
}

/** List one type's vocabulary with assignment counts (most-used first, then by name). */
export async function listTagsWithUsage(
  db: AppDatabase,
  type: TagType,
): Promise<readonly TagView[]> {
  const usageCount = count(tagsRefs.tagId);
  return await db
    .select({ id: tags.id, name: tags.name, usageCount })
    .from(tags)
    .leftJoin(tagsRefs, eq(tagsRefs.tagId, tags.id))
    .where(eq(tags.type, type))
    .groupBy(tags.id)
    .orderBy(desc(usageCount), tags.name)
    .all();
}

/** Count assignments referencing a tag. Tag ids are type-unique, so no type filter is needed. */
async function usageOf(db: AppDatabase, tagId: string): Promise<number> {
  const row = await db.select({ value: count() }).from(tagsRefs).where(eq(tagsRefs.tagId, tagId)).get();
  return row?.value ?? 0;
}

/** Create a tag in one type. Trims, validates, and rejects same-type duplicates. */
export async function createTag(db: AppDatabase, type: TagType, rawName: string): Promise<TagView> {
  const name = normalizeTagName(rawName);
  assertValidTagName(name);
  if (await findTagId(db, type, name))
    throw new ValidationError("Tag name already exists", { name: "Duplicate" });

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(tags).values({ id, name, type, createdAt: now, updatedAt: now }).run();
  return { id, name, usageCount: 0 };
}

/**
 * Rename a tag within one type. Returns undefined when the tag is gone (or
 * belongs to another type); rejects a name collision inside the same type.
 */
export async function renameTag(
  db: AppDatabase,
  type: TagType,
  id: string,
  rawName: string,
): Promise<TagView | undefined> {
  const name = normalizeTagName(rawName);
  assertValidTagName(name);

  const existing = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.id, id), eq(tags.type, type))).get();
  if (!existing)
    return undefined;
  const collision = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.type, type), eq(tags.name, name), ne(tags.id, id))).get();
  if (collision)
    throw new ValidationError("Tag name already exists", { name: "Duplicate" });

  const now = new Date().toISOString();
  await db.update(tags).set({ name, updatedAt: now }).where(eq(tags.id, id)).run();
  return { id, name, usageCount: await usageOf(db, id) };
}

/**
 * Delete a tag by id within one type. `tags_refs.tag_id` declares
 * `ON DELETE CASCADE`, so removing the row also unlinks every assignment.
 * Returns false when the tag does not exist for this type.
 */
export async function deleteTag(db: AppDatabase, type: TagType, id: string): Promise<boolean> {
  const existing = await db.select({ id: tags.id }).from(tags).where(and(eq(tags.id, id), eq(tags.type, type))).get();
  if (!existing)
    return false;
  await db.delete(tags).where(eq(tags.id, id)).run();
  return true;
}

// ─── Resource assignment helpers ──────────────────────────────────────────
// Reusable logic over the shared `tags_refs` table. Callers pass a `{ type }`
// binding so the tag module never imports a domain schema — the dependency
// direction stays one-way. Behavior mirrors the per-domain helpers these replace.

/**
 * A domain's tag binding. Now carries only the `type` discriminator: the join
 * table is the fixed, shared `tags_refs`, so no table/column reflection remains.
 */
export interface ResourceTagBinding {
  readonly type: TagType;
}

/** A tag id paired with its display name for one resource. */
export interface ResourceTagView {
  readonly id: string;
  readonly name: string;
}

/** A grouped tag view carrying the type-wide usage count. */
export interface ResourceTagUsageView {
  readonly id: string;
  readonly name: string;
  readonly usageCount: number;
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
  tx.delete(tagsRefs).where(eq(tagsRefs.resourceId, resourceId)).run();
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key))
      continue;
    seen.add(key);
    const tagId = upsertTagIdTx(tx, binding.type, name, now);
    tx.insert(tagsRefs).values({ resourceId, tagId }).run();
  }
}

/**
 * Remove every tag assignment for a resource. `tags_refs.resource_id` has no FK,
 * so a domain that HARD-deletes a resource calls this to drop its rows app-level
 * (replacing the prior per-domain join's `ON DELETE CASCADE`). Soft-delete paths
 * leave the rows in place — the resource row still exists.
 */
export async function deleteResourceTags(db: AppDatabase, resourceId: string): Promise<void> {
  await db.delete(tagsRefs).where(eq(tagsRefs.resourceId, resourceId)).run();
}

/** Tags assigned to one resource as `{id,name}`, ordered by name. */
export async function listResourceTagViews(
  db: AppDatabase,
  _binding: ResourceTagBinding,
  resourceId: string,
): Promise<readonly ResourceTagView[]> {
  return await db
    .select({ id: tags.id, name: tags.name })
    .from(tagsRefs)
    .innerJoin(tags, eq(tags.id, tagsRefs.tagId))
    .where(eq(tagsRefs.resourceId, resourceId))
    .orderBy(tags.name)
    .all();
}

/** Tag names assigned to one resource, ordered by name. */
export async function listResourceTagNames(
  db: AppDatabase,
  _binding: ResourceTagBinding,
  resourceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ name: tags.name })
    .from(tagsRefs)
    .innerJoin(tags, eq(tags.id, tagsRefs.tagId))
    .where(eq(tagsRefs.resourceId, resourceId))
    .orderBy(tags.name)
    .all();
  return rows.map(r => r.name);
}

/**
 * Load tags for a set of resource ids, grouped by resource id. Each view carries
 * the same type-wide `usageCount` the global tag list reports (correlated
 * subquery), so embedded tags match the filter vocabulary.
 */
export async function loadResourceTagsByResource(
  db: AppDatabase,
  _binding: ResourceTagBinding,
  resourceIds: readonly string[],
): Promise<Map<string, ResourceTagUsageView[]>> {
  const map = new Map<string, ResourceTagUsageView[]>();
  if (resourceIds.length === 0)
    return map;
  const rows = await db
    .select({
      resourceId: tagsRefs.resourceId,
      id: tags.id,
      name: tags.name,
      usageCount: sql<number>`(SELECT COUNT(*) FROM ${tagsRefs} WHERE ${tagsRefs.tagId} = ${tags.id})`,
    })
    .from(tagsRefs)
    .innerJoin(tags, eq(tags.id, tagsRefs.tagId))
    .where(inArray(tagsRefs.resourceId, [...resourceIds]))
    .all();
  for (const r of rows) {
    const list = map.get(r.resourceId) ?? [];
    list.push({ id: r.id, name: r.name, usageCount: r.usageCount });
    map.set(r.resourceId, list);
  }
  return map;
}

/** Resolve a trimmed value matching `tags.id` OR `tags.name` within a type. */
export async function resolveTagIdByIdOrName(
  db: AppDatabase,
  type: TagType,
  value: string,
): Promise<string | null> {
  const trimmed = value.trim();
  if (!trimmed)
    return null;
  const row = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(or(eq(tags.id, trimmed), eq(tags.name, trimmed)), eq(tags.type, type)))
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
  const tagId = await resolveTagIdByIdOrName(db, binding.type, tagIdOrName);
  if (!tagId)
    return [];
  const rows = await db
    .select({ resourceId: tagsRefs.resourceId })
    .from(tagsRefs)
    .where(eq(tagsRefs.tagId, tagId))
    .all();
  return rows.map(r => r.resourceId);
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
    const tagId = await resolveTagIdByIdOrName(db, binding.type, value);
    if (tagId)
      resolved.push(tagId);
  }
  if (resolved.length === 0)
    return [];
  const rows = await db
    .select({ resourceId: tagsRefs.resourceId })
    .from(tagsRefs)
    .where(inArray(tagsRefs.tagId, resolved))
    .all();
  return [...new Set(rows.map(r => r.resourceId))];
}
