import type { AppDatabase, RunResult } from "@/db";
import type { PolicyContext } from "@/modules/policy";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { groups } from "@/modules/account/groups/schema";
import { documentAccess } from "@/modules/document/document.permission";
import { documentDetails, documentPins, documentTags } from "@/modules/document/schema";
import { items } from "@/modules/item/schema";
import { NOOP_POLICY_LOGGER } from "@/modules/policy";
import { relationTuples } from "@/modules/policy/schema";
import { listUserResources } from "@/modules/policy/zanzibar.engine";
import { deleteSharesForResource } from "@/modules/share";
import { tags } from "@/modules/tag/schema";
import { listResourceIdsByTag, listResourceTagNames, syncResourceTagsTx } from "@/modules/tag/tag.service";
import { nanoid, ulid } from "@/shared/lib/id";

// Document assignment join binding for the shared tag helpers. Scopes every
// helper call to source_type 'document' and the `document_tags` join.
const DOCUMENT_TAG_BINDING = {
  sourceType: "document",
  table: documentTags,
  resourceColumn: documentTags.itemId,
  tagColumn: documentTags.tagId,
} as const;

// Escape the LIKE wildcards (`%`, `_`) *and* the escape character itself
// (`\`) so a user-supplied term is matched literally. Backslash must be
// escaped first / together — handled here by the single character class — so
// `\` → `\\` rather than being re-consumed by a later pass. Pair every
// pattern built with this helper with an explicit `ESCAPE '\'` clause:
// SQLite's LIKE has no default escape character, so without it the
// backslashes would match literally and over-match user `%` / `_`.
const LIKE_SPECIAL_RE = /[\\%_]/g;

function escapeLike(v: string): string {
  return v.replace(LIKE_SPECIAL_RE, "\\$&");
}

const ULID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
function ulidTimestamp(id: string): string {
  let ms = 0;
  for (let i = 0; i < 10; i++) {
    const code = ULID_ALPHABET.indexOf(id[i] ?? "");
    if (code < 0)
      return new Date().toISOString();
    ms = ms * 32 + code;
  }
  return new Date(ms).toISOString();
}

/** Composite document row returned by routes and tests. */
export interface DocumentRow {
  readonly id: string; // items.short_id
  readonly title: string;
  readonly content: string | null;
  readonly tags: string;
  readonly parentId: string | null; // parent document's short_id (null for root)
  readonly version: number;
  readonly commentsLocked: boolean;
  readonly creatorId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Internal helper — short_id → items row. */
async function getItemByShortId(db: AppDatabase, shortId: string) {
  return await db.select().from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "document"), isNull(items.deletedAt)),
  ).get();
}

async function getParentShortId(db: DbReader, parentItemId: string | null): Promise<string | null> {
  if (!parentItemId)
    return null;
  const row = await db.select({ shortId: items.shortId }).from(items).where(eq(items.id, parentItemId)).get();
  return row?.shortId ?? null;
}

// Minimum surface `getParentShortId` needs: a `select` entry point. Both
// `AppDatabase` and Drizzle's transaction handle satisfy this shape, so call
// sites can pass `tx` from inside a `db.transaction` callback without
// resorting to `as unknown as AppDatabase`.
type DbReader = Pick<AppDatabase, "select">;

async function composeDocument(
  db: AppDatabase,
  item: typeof items.$inferSelect,
  details?: typeof documentDetails.$inferSelect | undefined,
): Promise<DocumentRow> {
  const d = details ?? await db.select().from(documentDetails).where(eq(documentDetails.itemId, item.id)).get();
  return {
    id: item.shortId,
    title: item.title,
    content: d?.content ?? null,
    // Tags are now sourced from the `document_tags` join over the global typed
    // vocabulary. The response keeps the legacy JSON-string shape so the
    // frontend contract is unchanged.
    tags: JSON.stringify(await listResourceTagNames(db, DOCUMENT_TAG_BINDING, item.id)),
    parentId: await getParentShortId(db, d?.parentId ?? null),
    version: item.version,
    commentsLocked: d?.commentsLocked ?? false,
    creatorId: item.creatorId,
    createdAt: ulidTimestamp(item.id),
    updatedAt: item.updatedAt,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────

export interface CreateDocumentInput {
  readonly title: string;
  readonly content?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly parentId?: string | null | undefined; // short_id
  readonly creatorId: string;
}

export async function createDocument(db: AppDatabase, input: CreateDocumentInput): Promise<DocumentRow> {
  const id = ulid();
  const shortId = nanoid();
  const now = new Date().toISOString();

  // Resolve parent short_id to internal id before opening the tx.
  let parentItemId: string | null = null;
  if (input.parentId) {
    const parentItem = await getItemByShortId(db, input.parentId);
    if (!parentItem)
      throw new Error(`Parent document ${input.parentId} not found`);
    parentItemId = parentItem.id;
  }

  db.transaction((tx) => {
    tx.insert(items).values({
      id,
      shortId,
      type: "document",
      title: input.title,
      status: "active",
      creatorId: input.creatorId,
      version: 1,
      deletedAt: null,
      updatedAt: now,
    }).run();

    // Tags live in the `document_tags` join (written below), never on
    // `document_details`, so no tag field is set here.
    tx.insert(documentDetails).values({
      itemId: id,
      content: input.content ?? null,
      parentId: parentItemId,
      commentsLocked: false,
    }).run();

    // owner tuple
    tx.insert(relationTuples).values({
      id: nanoid(),
      namespace: "item",
      objectId: id,
      relation: "owner",
      subjectNamespace: "user",
      subjectId: input.creatorId,
      subjectRelation: null,
      createdBy: input.creatorId,
      createdAt: now,
    }).run();

    if (parentItemId) {
      // parent_item edge for permission inheritance.
      tx.insert(relationTuples).values({
        id: nanoid(),
        namespace: "item",
        objectId: id,
        relation: "parent_item",
        subjectNamespace: "item",
        subjectId: parentItemId,
        subjectRelation: null,
        createdBy: input.creatorId,
        createdAt: now,
      }).run();
    }

    if (input.tags && input.tags.length > 0)
      syncResourceTagsTx(tx, DOCUMENT_TAG_BINDING, id, input.tags, now);
  });

  if (input.tags && input.tags.length > 0)
    invalidateTagCache();

  const item = (await db.select().from(items).where(eq(items.id, id)).get())!;
  return await composeDocument(db, item);
}

export async function getDocumentById(db: AppDatabase, shortId: string): Promise<DocumentRow | undefined> {
  const item = await getItemByShortId(db, shortId);
  if (!item)
    return undefined;
  return await composeDocument(db, item);
}

/**
 * Optimistic-concurrency conflict result. Returned by {@link updateDocument}
 * when the caller's `expectedVersion` no longer matches the stored row.
 */
export interface VersionConflict {
  readonly conflict: true;
  readonly current: DocumentRow;
}

export function isVersionConflict(v: unknown): v is VersionConflict {
  return typeof v === "object" && v !== null && (v as { conflict?: unknown }).conflict === true;
}

export interface UpdateDocumentInput {
  readonly title?: string | undefined;
  readonly content?: string | undefined;
  readonly tags?: readonly string[] | undefined;
  readonly parentId?: string | null | undefined; // short_id
  readonly commentsLocked?: boolean | undefined;
  readonly expectedVersion?: number | undefined;
}

export async function updateDocument(
  db: AppDatabase,
  shortId: string,
  input: UpdateDocumentInput,
): Promise<DocumentRow | VersionConflict | undefined> {
  const item = await getItemByShortId(db, shortId);
  if (!item)
    return undefined;

  // Resolve target parent short_id (if any) before opening tx.
  let parentItemIdSpec: string | null | undefined;
  if (input.parentId !== undefined) {
    if (input.parentId === null) {
      parentItemIdSpec = null;
    }
    else {
      const parent = await getItemByShortId(db, input.parentId);
      if (!parent)
        throw new Error(`Parent document ${input.parentId} not found`);
      parentItemIdSpec = parent.id;
    }
  }

  const now = new Date().toISOString();

  // Transactional writes run synchronously (bun:sqlite tx is sync). The
  // result is composed outside the tx — reads of just-committed rows are
  // safe because no other writer can mutate the row in between.
  type TxOutcome
    = | { kind: "ok"; refreshed: typeof items.$inferSelect }
      | { kind: "conflict"; current: typeof items.$inferSelect }
      | { kind: "missing" };

  const outcome: TxOutcome = db.transaction((tx): TxOutcome => {
    // Optimistic-concurrency check + version bump in one statement.
    const where = input.expectedVersion !== undefined
      ? and(eq(items.id, item.id), eq(items.version, input.expectedVersion), isNull(items.deletedAt))
      : and(eq(items.id, item.id), isNull(items.deletedAt));
    const itemPatch: Record<string, unknown> = { updatedAt: now, version: sql`${items.version} + 1` };
    if (input.title !== undefined)
      itemPatch.title = input.title;
    const res = tx.update(items).set(itemPatch).where(where).run() as unknown as RunResult;
    if (input.expectedVersion !== undefined && res.changes === 0) {
      const current = tx.select().from(items).where(eq(items.id, item.id)).get();
      if (current && current.version !== input.expectedVersion) {
        return { kind: "conflict", current };
      }
      return { kind: "missing" };
    }

    const detailsPatch: Record<string, unknown> = {};
    if (input.content !== undefined)
      detailsPatch.content = input.content;
    if (input.commentsLocked !== undefined)
      detailsPatch.commentsLocked = input.commentsLocked;
    if (parentItemIdSpec !== undefined)
      detailsPatch.parentId = parentItemIdSpec;
    if (Object.keys(detailsPatch).length > 0) {
      tx.update(documentDetails).set(detailsPatch).where(eq(documentDetails.itemId, item.id)).run();
    }

    // Tags are stored in `document_tags` (global typed vocabulary), rewritten
    // here in the same transaction so the version bump above stays atomic with
    // the tag change.
    if (input.tags !== undefined)
      syncResourceTagsTx(tx, DOCUMENT_TAG_BINDING, item.id, input.tags, now);

    if (parentItemIdSpec !== undefined) {
      // Rewrite the parent_item tuple in lockstep with the business column.
      tx.delete(relationTuples).where(and(
        eq(relationTuples.namespace, "item"),
        eq(relationTuples.objectId, item.id),
        eq(relationTuples.relation, "parent_item"),
      )).run();
      if (parentItemIdSpec !== null) {
        tx.insert(relationTuples).values({
          id: nanoid(),
          namespace: "item",
          objectId: item.id,
          relation: "parent_item",
          subjectNamespace: "item",
          subjectId: parentItemIdSpec,
          subjectRelation: null,
          createdBy: item.creatorId,
          createdAt: now,
        }).run();
      }
    }

    const refreshed = tx.select().from(items).where(eq(items.id, item.id)).get()!;
    return { kind: "ok", refreshed };
  });

  if (input.tags !== undefined && outcome.kind === "ok")
    invalidateTagCache();

  if (outcome.kind === "missing")
    return undefined;
  if (outcome.kind === "conflict")
    return { conflict: true, current: await composeDocument(db, outcome.current) };
  return await composeDocument(db, outcome.refreshed);
}

export async function moveDocument(
  db: AppDatabase,
  shortId: string,
  parentShortId: string | null,
  expectedVersion?: number,
): Promise<DocumentRow | VersionConflict | undefined> {
  return await updateDocument(db, shortId, { parentId: parentShortId, expectedVersion });
}

export async function softDeleteDocument(db: AppDatabase, shortId: string): Promise<void> {
  const item = await getItemByShortId(db, shortId);
  if (!item)
    return;
  const now = new Date().toISOString();
  const deletedShortIds = db.transaction((tx): readonly string[] => {
    // Walk descendants via document_details.parent_id.
    const desc = tx.all<{ id: string }>(sql`
      WITH RECURSIVE descendants(id) AS (
        SELECT item_id FROM ${documentDetails} WHERE parent_id = ${item.id}
        UNION ALL
        SELECT dd.item_id FROM ${documentDetails} dd JOIN descendants ON dd.parent_id = descendants.id
      )
      SELECT id FROM descendants
    `);
    const idsToDelete = [item.id, ...desc.map(r => r.id)];

    tx.update(items)
      .set({ deletedAt: now, updatedAt: now, version: sql`${items.version} + 1` })
      .where(and(inArray(items.id, idsToDelete), isNull(items.deletedAt)))
      .run();
    tx.delete(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      inArray(relationTuples.objectId, idsToDelete),
    )).run();
    return tx.select({ shortId: items.shortId })
      .from(items)
      .where(inArray(items.id, idsToDelete))
      .all()
      .map(r => r.shortId);
  });

  // Anonymous public links live in the polymorphic `shares` table (no FK to
  // items), so the soft-delete above does not cascade to them. Remove every
  // public link attached to the deleted subtree explicitly — mirroring the
  // drive module's delete path and honouring the share schema's contract
  // that cascade cleanup is the owning module's responsibility.
  for (const sid of deletedShortIds)
    await deleteSharesForResource(db, "document", sid);
}

/** Returned to admin UI alongside the soft-deleted root. */
export async function listSoftDeletedDescendants(db: AppDatabase, shortId: string): Promise<readonly DocumentRow[]> {
  const root = await db.select().from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "document")),
  ).get();
  if (!root)
    return [];
  const desc = await db.all<{ id: string }>(sql`
    WITH RECURSIVE descendants(id) AS (
      SELECT item_id FROM ${documentDetails} WHERE parent_id = ${root.id}
      UNION ALL
      SELECT dd.item_id FROM ${documentDetails} dd JOIN descendants ON dd.parent_id = descendants.id
    )
    SELECT id FROM descendants
  `);
  if (desc.length === 0)
    return [];
  const rows = await db.select().from(items).where(inArray(items.id, desc.map(r => r.id))).all();
  const composed: DocumentRow[] = [];
  for (const r of rows)
    composed.push(await composeDocument(db, r));
  return composed;
}

/**
 * Return short_ids for every descendant of the given short_id.
 * Used by the routes layer to audit per-document delete events.
 */
export async function listDescendantIds(db: AppDatabase, shortId: string): Promise<readonly string[]> {
  const item = await db.select().from(items).where(eq(items.shortId, shortId)).get();
  if (!item)
    return [];
  const rows = await db.all<{ short_id: string }>(sql`
    WITH RECURSIVE descendants(id) AS (
      SELECT item_id FROM ${documentDetails} WHERE parent_id = ${item.id}
      UNION ALL
      SELECT dd.item_id FROM ${documentDetails} dd JOIN descendants ON dd.parent_id = descendants.id
    )
    SELECT i.short_id FROM ${items} i JOIN descendants d ON i.id = d.id
  `);
  return rows.map(r => r.short_id);
}

// ─── List ─────────────────────────────────────────────────────────────

export interface ListDocumentsParams {
  readonly q?: string | undefined;
  readonly tag?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

async function buildDocumentConditions(params: ListDocumentsParams) {
  const conditions = [eq(items.type, "document"), isNull(items.deletedAt)];
  if (params.q) {
    conditions.push(sql`${items.title} LIKE ${`%${escapeLike(params.q)}%`} ESCAPE '\\'`);
  }
  return conditions;
}

/**
 * Resolve the set of `items.id` the user has a direct or inherited
 * `viewer` grant on. The policy engine's `listUserResources` returns
 * direct + group grants; we then expand via `parent_item` business
 * descendants because the engine's tuple-to-userset path only handles
 * resource_group today.
 */
async function listVisibleItemIds(db: AppDatabase, userId: string): Promise<readonly string[]> {
  const direct = await listUserResources(db, userId, "item", "viewer");
  if (direct.length === 0)
    return [];
  const rows = await db.all<{ id: string }>(sql`
    WITH RECURSIVE chain(id) AS (
      SELECT value FROM json_each(${JSON.stringify([...direct])})
      UNION
      SELECT dd.item_id FROM ${documentDetails} dd JOIN chain c ON dd.parent_id = c.id
    )
    SELECT id FROM chain
  `);
  return rows.map(r => r.id);
}

export async function listMyDocuments(db: AppDatabase, params: ListDocumentsParams & { userId: string }) {
  const visibleIds = await listVisibleItemIds(db, params.userId);
  const creatorClause = eq(items.creatorId, params.userId);

  const conditions = await buildDocumentConditions(params);
  let where = and(...conditions);
  where = visibleIds.length > 0
    ? and(where, or(creatorClause, inArray(items.id, [...visibleIds])))
    : and(where, creatorClause);

  if (params.tag) {
    // Filter is by tag NAME today; `listResourceIdsByTag` accepts a name or id,
    // so name lookups keep working unchanged.
    const ids = await listResourceIdsByTag(db, DOCUMENT_TAG_BINDING, params.tag);
    if (ids.length === 0)
      return { data: [] as DocumentRow[], total: 0 };
    where = and(where, inArray(items.id, ids));
  }

  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  const totalRow = await db.select({ value: count() }).from(items).where(where).get();
  const total = totalRow?.value ?? 0;
  const rows = await db.select().from(items).where(where).orderBy(desc(items.updatedAt), desc(items.id)).limit(limit).offset((page - 1) * limit).all();
  const data: DocumentRow[] = [];
  for (const r of rows)
    data.push(await composeDocument(db, r));
  return { data, total };
}

// ─── Tree ─────────────────────────────────────────────────────────────

export interface DocumentTreeNode {
  readonly id: string;
  readonly title: string;
  readonly parentId: string | null;
  readonly updatedAt: string;
  readonly childCount: number;
  readonly pinned: boolean;
}

interface TreeRow {
  readonly id: string;
  readonly short_id: string;
  readonly title: string;
  readonly parent_id: string | null;
  readonly updated_at: string;
  readonly pinned: number;
}

export async function getDocumentTreeForUser(
  db: AppDatabase,
  user: { id: string },
): Promise<readonly DocumentTreeNode[]> {
  // Owner-scoped for everyone, admins included: the tree is limited to
  // documents the user created plus those explicitly shared with them
  // (and the descendants of shared docs, via listVisibleItemIds).
  let rows: readonly TreeRow[];
  const visibleIds = await listVisibleItemIds(db, user.id);
  // `pinned` is per-user: a row counts as pinned only when this caller
  // owns the pin, so a shared doc pinned by someone else still shows
  // unpinned here.
  const pinnedExpr = sql<number>`(SELECT 1 FROM ${documentPins} dp WHERE dp.item_id = i.id AND dp.user_id = ${user.id})`;
  if (visibleIds.length === 0) {
    rows = await db.all<TreeRow>(sql`
      SELECT i.id, i.short_id, i.title, dd.parent_id, i.updated_at,
             COALESCE(${pinnedExpr}, 0) AS pinned
      FROM ${items} i JOIN ${documentDetails} dd ON dd.item_id = i.id
      WHERE i.type = 'document' AND i.deleted_at IS NULL
        AND i.creator_id = ${user.id}
      ORDER BY LOWER(i.title) ASC
    `);
  }
  else {
    rows = await db.all<TreeRow>(sql`
      SELECT i.id, i.short_id, i.title, dd.parent_id, i.updated_at,
             COALESCE(${pinnedExpr}, 0) AS pinned
      FROM ${items} i JOIN ${documentDetails} dd ON dd.item_id = i.id
      WHERE i.type = 'document' AND i.deleted_at IS NULL
        AND (i.creator_id = ${user.id}
             OR i.id IN (SELECT value FROM json_each(${JSON.stringify([...visibleIds])})))
      ORDER BY LOWER(i.title) ASC
    `);
  }

  // Map internal ids → short ids for the rendered tree.
  const idToShort = new Map<string, string>();
  for (const r of rows)
    idToShort.set(r.id, r.short_id);

  const childCount = new Map<string, number>();
  for (const r of rows) {
    if (r.parent_id) {
      childCount.set(r.parent_id, (childCount.get(r.parent_id) ?? 0) + 1);
    }
  }

  return rows.map(r => ({
    id: r.short_id,
    title: r.title,
    parentId: r.parent_id ? idToShort.get(r.parent_id) ?? null : null,
    updatedAt: r.updated_at,
    childCount: childCount.get(r.id) ?? 0,
    pinned: r.pinned === 1,
  }));
}

// ─── Pins (per-user) ──────────────────────────────────────────────────

/**
 * Pin a document for `userId`. Idempotent — re-pinning is a no-op.
 * Read-access enforcement lives at the route layer (the global policy
 * middleware plus an in-handler `document:read` assert), so this helper
 * trusts its caller and only resolves the short_id to an internal id.
 * Returns `false` when the short_id does not resolve to a live document.
 */
export async function pinDocument(db: AppDatabase, userId: string, shortId: string): Promise<boolean> {
  const item = await getItemByShortId(db, shortId);
  if (!item)
    return false;
  await db.insert(documentPins)
    .values({ userId, itemId: item.id })
    .onConflictDoNothing()
    .run();
  return true;
}

/** Remove a user's pin on a document. Idempotent — unpinning twice is a no-op. */
export async function unpinDocument(db: AppDatabase, userId: string, shortId: string): Promise<boolean> {
  const item = await getItemByShortId(db, shortId);
  if (!item)
    return false;
  await db.delete(documentPins)
    .where(and(eq(documentPins.userId, userId), eq(documentPins.itemId, item.id)))
    .run();
  return true;
}

// ─── Permissions ─────────────────────────────────────────────────────

/**
 * Resolve the effective permission a user has on a document. Honours
 * `parent_item` subtree inheritance through the policy engine. Returns
 * `null` when the user has neither direct nor inherited access.
 */
export async function getDocumentPermission(
  db: AppDatabase,
  shortId: string,
  userId: string,
): Promise<"editor" | "viewer" | null> {
  const item = await getItemByShortId(db, shortId);
  if (!item)
    return null;
  // No creator-special-case: `createDocument` writes the owner tuple
  // for the creator, and the engine's `editor ⊇ owner` rewrite picks
  // it up. Goes through the framework so the same owner-scoped hook
  // chain that gates routes also applies to this read helper.
  // Read-only path → onGranted / onRevoked won't fire, so the shared
  // NOOP_POLICY_LOGGER constant keeps PolicyContext type-complete
  // without forcing every caller of this internal helper to thread one
  // through.
  const ctx: PolicyContext = { db, logger: NOOP_POLICY_LOGGER, actor: { id: userId, type: "user" } };
  if (await documentAccess.can(ctx, "document:update", item.id))
    return "editor";
  if (await documentAccess.can(ctx, "document:read", item.id))
    return "viewer";
  return null;
}

// ─── Sharing (policy tuples) ─────────────────────────────────────────

export interface ShareWithSource {
  readonly id: string;
  readonly documentId: string; // short_id of the doc the share row is attached to
  readonly targetType: "user" | "group";
  readonly targetId: string;
  readonly permission: "viewer" | "editor";
  readonly createdAt: string;
  readonly inheritedFrom: { readonly id: string; readonly title: string } | null;
}

export async function listDocumentSharesWithInheritance(
  db: AppDatabase,
  shortId: string,
): Promise<readonly ShareWithSource[]> {
  const item = await getItemByShortId(db, shortId);
  if (!item)
    return [];
  // Build the ancestor chain via document_details.parent_id (self + all ancestors).
  const ancestors = await db.all<{ id: string; short_id: string; title: string; depth: number }>(sql`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT ${item.id}, 0
      UNION ALL
      SELECT dd.parent_id, c.depth + 1
      FROM ${documentDetails} dd JOIN chain c ON dd.item_id = c.id
      WHERE dd.parent_id IS NOT NULL
    )
    SELECT i.id, i.short_id, i.title, c.depth
    FROM chain c JOIN ${items} i ON i.id = c.id
    ORDER BY c.depth ASC
  `);
  if (ancestors.length === 0)
    return [];
  const ancestorIds = ancestors.map(a => a.id);
  const meta = new Map(ancestors.map(a => [a.id, { short_id: a.short_id, title: a.title, depth: a.depth }]));

  const shares = await db.select().from(relationTuples).where(and(
    eq(relationTuples.namespace, "item"),
    inArray(relationTuples.objectId, ancestorIds),
    inArray(relationTuples.relation, ["viewer", "editor"]),
  )).all();

  const rows = shares.map((s) => {
    const info = meta.get(s.objectId)!;
    return {
      id: s.id,
      documentId: info.short_id,
      targetType: s.subjectNamespace as "user" | "group",
      targetId: s.subjectId,
      permission: s.relation as "viewer" | "editor",
      createdAt: s.createdAt,
      inheritedFrom: info.depth === 0 ? null : { id: info.short_id, title: info.title },
    };
  });
  // Self-shares first, ancestors closest-up next.
  rows.sort((a, b) => {
    const da = meta.get(ancestorIds.find(id => meta.get(id)!.short_id === a.documentId)!)?.depth ?? 0;
    const db_ = meta.get(ancestorIds.find(id => meta.get(id)!.short_id === b.documentId)!)?.depth ?? 0;
    return da - db_;
  });
  return rows;
}

export interface AddShareInput {
  readonly documentId: string; // short_id
  readonly targetType: "user" | "group";
  readonly targetId: string;
  readonly permission: "viewer" | "editor";
}

/**
 * Add or replace a share grant on a document. Routes the **write**
 * through `documentAccess.grant` so the framework's `canGrant` hook
 * (owner-or-admin) and `onGranted` hook (audit) both fire.
 *
 * Upsert semantics: re-sharing the same subject with a different role
 * replaces the existing tuple rather than creating a second grant. We
 * collapse the inevitable delete-then-insert into a single transaction
 * — and intentionally **skip** the framework `revoke()` for the prior
 * tuple, otherwise every role change would emit a spurious
 * `document.share_removed` audit event.
 */
export async function addDocumentShare(ctx: PolicyContext, input: AddShareInput) {
  const item = await getItemByShortId(ctx.db, input.documentId);
  if (!item)
    throw new Error("Document not found");

  await ctx.db.delete(relationTuples).where(and(
    eq(relationTuples.namespace, "item"),
    eq(relationTuples.objectId, item.id),
    inArray(relationTuples.relation, ["viewer", "editor"]),
    eq(relationTuples.subjectNamespace, input.targetType),
    eq(relationTuples.subjectId, input.targetId),
  )).run();

  const tuple = await documentAccess.grant(ctx, {
    subject: { type: input.targetType, id: input.targetId },
    relation: input.permission,
    objectId: item.id,
  });

  return {
    id: tuple.id,
    documentId: item.shortId,
    targetType: input.targetType,
    targetId: input.targetId,
    permission: input.permission,
    createdAt: tuple.createdAt,
  };
}

export async function getDocumentShareById(db: AppDatabase, tupleId: string) {
  const row = await db.select().from(relationTuples).where(eq(relationTuples.id, tupleId)).get();
  if (!row || row.namespace !== "item")
    return undefined;
  const item = await db.select({ shortId: items.shortId }).from(items).where(eq(items.id, row.objectId)).get();
  return {
    id: row.id,
    documentId: item?.shortId ?? "",
    targetType: row.subjectNamespace as "user" | "group",
    targetId: row.subjectId,
    permission: row.relation as "viewer" | "editor",
    createdAt: row.createdAt,
  };
}

/**
 * Revoke a share by its tuple id. Looks the row up first so the
 * framework `revoke()` can run its hooks against the resolved
 * composite key (and `onRevoked` knows what to audit).
 */
export async function removeDocumentShare(ctx: PolicyContext, tupleId: string): Promise<void> {
  const row = await ctx.db.select().from(relationTuples).where(eq(relationTuples.id, tupleId)).get();
  if (!row)
    return;
  await documentAccess.revoke(ctx, {
    subject: { type: row.subjectNamespace, id: row.subjectId, ...(row.subjectRelation ? { relation: row.subjectRelation } : {}) },
    relation: row.relation,
    objectId: row.objectId,
  });
}

// ─── Tags ─────────────────────────────────────────────────────────────

const TAG_CACHE_TTL_MS = 30_000;
let tagCache: { db: unknown; loadedAt: number; tags: readonly string[] } | null = null;

export function invalidateTagCache(): void {
  tagCache = null;
}

export async function listAllTags(db: AppDatabase): Promise<readonly string[]> {
  if (tagCache && tagCache.db === db && Date.now() - tagCache.loadedAt < TAG_CACHE_TTL_MS)
    return tagCache.tags;
  // Distinct document tag names actually in use, read from the global typed
  // vocabulary via the `document_tags` join.
  const rows = await db
    .select({ name: tags.name })
    .from(tags)
    .innerJoin(documentTags, eq(documentTags.tagId, tags.id))
    .where(eq(tags.sourceType, "document"))
    .groupBy(tags.name)
    .orderBy(tags.name)
    .all();
  const names = rows.map(r => r.name);
  tagCache = { db, loadedAt: Date.now(), tags: names };
  return names;
}

export async function listAllGroups(db: AppDatabase) {
  return await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .orderBy(groups.name)
    .all();
}

export async function resolveDocumentItem(db: AppDatabase, shortId: string) {
  return await getItemByShortId(db, shortId);
}

// ─── Public-link subtree access ──────────────────────────────────────

/** A node in a public-link subtree. `id`/`parentId` are short_ids. */
export interface PublicSubtreeNode {
  readonly id: string; // short_id
  readonly itemId: string; // internal items.id
  readonly title: string;
  /** short_id of the parent *within* the subtree; null for the root. */
  readonly parentId: string | null;
}

/**
 * The document identified by `rootItemId` plus every non-deleted
 * descendant, walked through `document_details.parent_id`. Drives
 * public-link subtree access: a link on a folder document reaches the
 * whole subtree. Soft-deleted documents are filtered out, so a cascade
 * delete (which stamps `deleted_at` across the subtree) removes them
 * here too. Returns `[]` when the root itself is missing or deleted.
 */
export async function listPublicSubtree(db: AppDatabase, rootItemId: string): Promise<readonly PublicSubtreeNode[]> {
  const rows = await db.all<{ id: string; short_id: string; title: string; parent_id: string | null }>(sql`
    WITH RECURSIVE subtree(id) AS (
      SELECT ${rootItemId}
      UNION
      SELECT dd.item_id FROM ${documentDetails} dd JOIN subtree s ON dd.parent_id = s.id
    )
    SELECT i.id, i.short_id, i.title, dd.parent_id
    FROM subtree st
    JOIN ${items} i ON i.id = st.id
    JOIN ${documentDetails} dd ON dd.item_id = i.id
    WHERE i.deleted_at IS NULL
  `);
  const idToShort = new Map(rows.map(r => [r.id, r.short_id]));
  return rows.map(r => ({
    id: r.short_id,
    itemId: r.id,
    title: r.title,
    // Parent is scoped to the subtree: the root (whose parent_id points
    // outside the walked set, or is null) reports parentId=null.
    parentId: r.id === rootItemId
      ? null
      : (r.parent_id && idToShort.has(r.parent_id) ? idToShort.get(r.parent_id)! : null),
  }));
}

/** Compose a document by its internal item id; `undefined` if missing or soft-deleted. */
export async function getDocumentByItemId(db: AppDatabase, itemId: string): Promise<DocumentRow | undefined> {
  const item = await db.select().from(items).where(
    and(eq(items.id, itemId), eq(items.type, "document"), isNull(items.deletedAt)),
  ).get();
  if (!item)
    return undefined;
  return await composeDocument(db, item);
}
