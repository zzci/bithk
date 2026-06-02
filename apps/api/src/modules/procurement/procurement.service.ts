import type { ProcurementPriority, ProcurementStatus } from "./schema";
import type { AppDatabase } from "@/db";
import type { ResourceTagBinding } from "@/modules/tag/tag.service";
import type { Logger } from "@/shared/lib/logger";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { audit } from "@/modules/audit/audit.service";
import { contacts } from "@/modules/contact/schema";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { resolveCategory } from "@/modules/project/project.categories";
import { resolveAssignableMember } from "@/modules/project/project.service";
import { projects } from "@/modules/project/schema";
import { listResourceIdsByAnyTag, listResourceTagViews, loadResourceTagsByResource, syncResourceTagsTx } from "@/modules/tag/tag.service";
import { ValidationError } from "@/shared/lib/errors";
import { nanoid, ulid } from "@/shared/lib/id";
import { PROCUREMENT_STATUSES, procurementDetails } from "./schema";

// The procurement domain's tag binding (tag type='procurement'). Resources are
// keyed by the procurement's `items.id`. Exported so `routes/protected.ts`
// registers the same type for the shared `GET /tags?type=procurement` route.
export const procurementTagBinding: ResourceTagBinding = {
  type: "procurement",
};

// Backslash is the ESCAPE char, so it must be escaped first; every LIKE built
// from this MUST carry `ESCAPE '\'` or the backslashes match literally.
const LIKE_SPECIAL_RE = /[\\%_]/g;

function escapeLike(v: string): string {
  return v.replace(LIKE_SPECIAL_RE, "\\$&");
}

// Crockford base32 → ms decode for the ULID timestamp prefix that lives on
// `items.id`. The first 10 chars carry the creation millisecond.
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

function isProcurementStatus(value: string): value is ProcurementStatus {
  return (PROCUREMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Validate a supplier reference. A supplier MUST be a non-confidential contact.
 * Confidential contacts carry restricted fields and must never be attachable by
 * an actor who cannot see them, so a confidential id behaves exactly like a
 * non-existent one: both produce the SAME "unknown supplier" error. This keeps
 * procurement create/update from being used as an oracle to probe — or silently
 * attach — confidential contacts (IDOR / existence leak — audit FIX-AUDIT-004).
 *
 * Non-confidential contacts are global/visible references and resolve normally
 * regardless of their `visibility` flag.
 */
async function assertSupplierExists(db: AppDatabase, supplierId: string): Promise<void> {
  const supplier = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(
      eq(contacts.id, supplierId),
      eq(contacts.confidential, false),
    ))
    .get();
  if (!supplier)
    throw new ValidationError("Supplier is not a valid contact", { supplierId: "Unknown supplier" });
}

/** Composite view returned by routes and tests. */
export interface ProcurementRow {
  readonly id: string; // short_id (8-char nanoid)
  readonly projectId: string; // project short_id — the SOLE external project identifier (never the ULID)
  readonly title: string;
  readonly itemName: string;
  readonly status: ProcurementStatus;
  readonly supplierId: string | null;
  readonly categoryId: string | null;
  readonly assigneeMemberId: string | null;
  readonly quantity: number | null;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly description: string | null;
  readonly priority: ProcurementPriority;
  readonly dueDate: string | null;
  readonly creatorId: string;
  readonly createdAt: string; // decoded from items.id (ULID timestamp prefix)
  readonly updatedAt: string;
  readonly version: number;
  // Pin state lives on the shared `items` base. Pinned procurements surface in
  // the project overview Pin area; `pinnedAt` is set when pinned, NULL otherwise.
  readonly pinned: boolean;
  readonly pinnedAt: string | null;
  // Tags assigned to this procurement (tag type 'procurement'), ordered by name.
  readonly tags: { readonly id: string; readonly name: string }[];
}

function composeProcurement(
  item: typeof items.$inferSelect,
  details: typeof procurementDetails.$inferSelect,
  projectShortId: string,
  tags: readonly { id: string; name: string }[],
): ProcurementRow {
  return {
    id: item.shortId,
    projectId: projectShortId,
    title: item.title,
    itemName: details.itemName,
    status: item.status as ProcurementStatus,
    supplierId: details.supplierId,
    categoryId: details.categoryId,
    assigneeMemberId: details.assigneeMemberId,
    quantity: details.quantity,
    amount: details.amount,
    currency: details.currency,
    description: details.description,
    priority: details.priority,
    dueDate: details.dueDate,
    creatorId: item.creatorId,
    createdAt: ulidTimestamp(item.id),
    updatedAt: item.updatedAt,
    version: item.version,
    pinned: item.pinned,
    pinnedAt: item.pinnedAt,
    tags: tags.map(t => ({ id: t.id, name: t.name })),
  };
}

async function loadByShortId(
  db: AppDatabase,
  shortId: string,
): Promise<{ item: typeof items.$inferSelect; details: typeof procurementDetails.$inferSelect; projectShortId: string; tags: readonly { id: string; name: string }[] } | undefined> {
  const item = await db.select().from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "procurement"), isNull(items.deletedAt)),
  ).get();
  if (!item)
    return undefined;
  const details = await db.select().from(procurementDetails).where(eq(procurementDetails.itemId, item.id)).get();
  if (!details)
    return undefined;
  // `details.project_id` is the internal ULID; the API only ever exposes the
  // project short_id, so resolve it here.
  const project = await db.select({ shortId: projects.shortId }).from(projects).where(eq(projects.id, details.projectId)).get();
  if (!project)
    return undefined;
  const tags = await listResourceTagViews(db, procurementTagBinding, item.id);
  return { item, details, projectShortId: project.shortId, tags };
}

// ─── CRUD ─────────────────────────────────────────────────────────────

export interface CreateProcurementInput {
  /** Internal project ULID (resolve a URL shortId via resolveProjectId first). */
  readonly projectId: string;
  readonly itemName: string;
  readonly title?: string | undefined;
  readonly status?: ProcurementStatus | undefined;
  readonly supplierId?: string | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly assigneeMemberId?: string | null | undefined;
  readonly quantity?: number | null | undefined;
  readonly amount?: number | null | undefined;
  readonly currency?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly priority?: ProcurementPriority | undefined;
  readonly dueDate?: string | null | undefined;
  readonly creatorId: string;
  // Optional tag names (tag type 'procurement') synced with the procurement.
  readonly tags?: readonly string[] | undefined;
}

/**
 * Create a procurement row. Validates assignment targets belong to the project
 * before writing. Inserts the base `items` row (type='procurement'), the
 * `procurement_details` row and the owner tuple in ONE synchronous
 * transaction — bun:sqlite transactions are synchronous, so COMMIT/ROLLBACK
 * semantics only hold when the callback stays sync.
 */
export async function createProcurement(db: AppDatabase, input: CreateProcurementInput): Promise<ProcurementRow> {
  if (input.supplierId)
    await assertSupplierExists(db, input.supplierId);
  if (input.categoryId) {
    const category = await resolveCategory(db, input.projectId, input.categoryId);
    if (!category)
      throw new ValidationError("Category does not belong to this project", { categoryId: "Unknown category" });
  }
  if (input.assigneeMemberId) {
    const member = await resolveAssignableMember(db, input.projectId, input.assigneeMemberId);
    if (!member)
      throw new ValidationError("Assignee is not a member of this project", { assigneeMemberId: "Unknown project member" });
  }

  const id = ulid();
  const shortId = nanoid();
  const now = new Date().toISOString();

  db.transaction((tx) => {
    tx.insert(items).values({
      id,
      shortId,
      type: "procurement",
      title: input.title ?? input.itemName,
      status: input.status ?? "requested",
      creatorId: input.creatorId,
      version: 1,
      deletedAt: null,
      updatedAt: now,
    }).run();

    tx.insert(procurementDetails).values({
      itemId: id,
      projectId: input.projectId,
      supplierId: input.supplierId ?? null,
      categoryId: input.categoryId ?? null,
      assigneeMemberId: input.assigneeMemberId ?? null,
      itemName: input.itemName,
      quantity: input.quantity ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      description: input.description ?? null,
      priority: input.priority ?? "low",
      dueDate: input.dueDate ?? null,
    }).run();

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

    // Optional tag assignment (tag type 'procurement'), synced inside the same tx.
    if (input.tags)
      syncResourceTagsTx(tx, procurementTagBinding, id, input.tags, now);
  });

  return (await getProcurementByShortId(db, shortId))!;
}

export async function getProcurementByShortId(db: AppDatabase, shortId: string): Promise<ProcurementRow | undefined> {
  const loaded = await loadByShortId(db, shortId);
  return loaded ? composeProcurement(loaded.item, loaded.details, loaded.projectShortId, loaded.tags) : undefined;
}

/**
 * Resolve the underlying `items` row by short_id. Routes that need to touch
 * comments / attachments translate `:id` → items.id via this.
 */
export async function resolveProcurementItem(db: AppDatabase, shortId: string) {
  return await db.select().from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "procurement"), isNull(items.deletedAt)),
  ).get();
}

export interface UpdateProcurementInput {
  readonly title?: string | undefined;
  readonly itemName?: string | undefined;
  readonly supplierId?: string | null | undefined;
  readonly categoryId?: string | null | undefined;
  readonly assigneeMemberId?: string | null | undefined;
  readonly quantity?: number | null | undefined;
  readonly amount?: number | null | undefined;
  readonly currency?: string | null | undefined;
  readonly description?: string | null | undefined;
  readonly priority?: ProcurementPriority | undefined;
  readonly dueDate?: string | null | undefined;
  // Replacement tag set (tag type 'procurement'); omit to leave tags unchanged.
  readonly tags?: readonly string[] | undefined;
}

export async function updateProcurement(
  db: AppDatabase,
  shortId: string,
  input: UpdateProcurementInput,
): Promise<ProcurementRow | undefined> {
  const loaded = await loadByShortId(db, shortId);
  if (!loaded)
    return undefined;
  const { item, details } = loaded;

  if (input.supplierId)
    await assertSupplierExists(db, input.supplierId);
  if (input.categoryId) {
    const category = await resolveCategory(db, details.projectId, input.categoryId);
    if (!category)
      throw new ValidationError("Category does not belong to this project", { categoryId: "Unknown category" });
  }
  if (input.assigneeMemberId) {
    const member = await resolveAssignableMember(db, details.projectId, input.assigneeMemberId);
    if (!member)
      throw new ValidationError("Assignee is not a member of this project", { assigneeMemberId: "Unknown project member" });
  }

  const now = new Date().toISOString();

  db.transaction((tx) => {
    const itemPatch: Record<string, unknown> = { updatedAt: now, version: sql`${items.version} + 1` };
    if (input.title !== undefined)
      itemPatch.title = input.title;
    tx.update(items).set(itemPatch).where(eq(items.id, item.id)).run();

    const detailsPatch: Record<string, unknown> = {};
    if (input.itemName !== undefined)
      detailsPatch.itemName = input.itemName;
    if (input.supplierId !== undefined)
      detailsPatch.supplierId = input.supplierId;
    if (input.categoryId !== undefined)
      detailsPatch.categoryId = input.categoryId;
    if (input.assigneeMemberId !== undefined)
      detailsPatch.assigneeMemberId = input.assigneeMemberId;
    if (input.quantity !== undefined)
      detailsPatch.quantity = input.quantity;
    if (input.amount !== undefined)
      detailsPatch.amount = input.amount;
    if (input.currency !== undefined)
      detailsPatch.currency = input.currency;
    if (input.description !== undefined)
      detailsPatch.description = input.description;
    if (input.priority !== undefined)
      detailsPatch.priority = input.priority;
    if (input.dueDate !== undefined)
      detailsPatch.dueDate = input.dueDate;
    if (Object.keys(detailsPatch).length > 0)
      tx.update(procurementDetails).set(detailsPatch).where(eq(procurementDetails.itemId, item.id)).run();

    // Replace the procurement's tag set when `tags` is provided (omit = unchanged).
    if (input.tags !== undefined)
      syncResourceTagsTx(tx, procurementTagBinding, item.id, input.tags, now);
  });

  return await getProcurementByShortId(db, shortId);
}

// ─── Status ───────────────────────────────────────────────────────────

export interface ChangeStatusActor {
  readonly id: string;
  readonly name: string;
}

export interface ChangeStatusMeta {
  readonly ip: string;
  readonly userAgent: string;
}

/**
 * Change a procurement's status (stored on `items.status`). Validates the
 * target against {@link PROCUREMENT_STATUSES} defensively (the route layer
 * already validates at the zod boundary), bumps the item version and emits a
 * `procurement.status_changed` audit event carrying from→to. A status-change
 * comment log is plain `item_comments`, so no separate history table.
 */
export async function changeStatus(
  db: AppDatabase,
  logger: Logger,
  shortId: string,
  newStatus: ProcurementStatus,
  actor: ChangeStatusActor,
  meta: ChangeStatusMeta,
): Promise<ProcurementRow | undefined> {
  if (!isProcurementStatus(newStatus))
    throw new ValidationError("Invalid procurement status", { status: "Unknown status" });

  const loaded = await loadByShortId(db, shortId);
  if (!loaded)
    return undefined;
  const { item, details } = loaded;
  const previous = item.status;

  const now = new Date().toISOString();
  await db.update(items)
    .set({ status: newStatus, updatedAt: now, version: sql`${items.version} + 1` })
    .where(eq(items.id, item.id))
    .run();

  await audit(db, logger, {
    actorId: actor.id,
    actorName: actor.name,
    action: "procurement.status_changed",
    resourceType: "procurement",
    resourceId: shortId,
    resourceName: details.itemName,
    detail: { from: previous, to: newStatus },
    ip: meta.ip,
    userAgent: meta.userAgent,
    result: "success",
  });

  return await getProcurementByShortId(db, shortId);
}

// ─── List ─────────────────────────────────────────────────────────────

export interface ListProcurementParams {
  // Title / item-name search (LIKE on items.title OR procurement_details.item_name).
  readonly q?: string | undefined;
  readonly status?: string | undefined;
  readonly priority?: string | undefined;
  readonly categoryId?: string | undefined;
  // Multi-tag filter (tag type 'procurement'). OR / union semantics: a
  // procurement matches if it carries ANY of these tags. Empty/omitted = no filter.
  readonly tagIds?: readonly string[] | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

export interface ListProcurementResult {
  readonly data: readonly ProcurementRow[];
  readonly total: number;
}

/** List procurements for a project (internal ULID), excluding soft-deleted. */
export async function listByProject(
  db: AppDatabase,
  projectId: string,
  params: ListProcurementParams = {},
): Promise<ListProcurementResult> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  const conditions = [
    eq(items.type, "procurement"),
    isNull(items.deletedAt),
    eq(procurementDetails.projectId, projectId),
  ];
  if (params.status && isProcurementStatus(params.status))
    conditions.push(eq(items.status, params.status));
  if (params.priority && params.priority !== "__all__")
    conditions.push(eq(procurementDetails.priority, params.priority as ProcurementPriority));
  if (params.categoryId)
    conditions.push(eq(procurementDetails.categoryId, params.categoryId));
  if (params.q) {
    const like = `%${escapeLike(params.q)}%`;
    conditions.push(sql`(${items.title} LIKE ${like} ESCAPE '\\' OR ${procurementDetails.itemName} LIKE ${like} ESCAPE '\\')`);
  }

  // Multi-tag filter: union of the item ids carrying any of the selected tags.
  if (params.tagIds && params.tagIds.length > 0) {
    const tagItemIds = await listResourceIdsByAnyTag(db, procurementTagBinding, params.tagIds);
    if (tagItemIds.length === 0)
      return { data: [], total: 0 };
    conditions.push(inArray(items.id, tagItemIds));
  }

  const where = and(...conditions);

  const totalRow = await db.select({ value: count() })
    .from(items)
    .innerJoin(procurementDetails, eq(procurementDetails.itemId, items.id))
    .where(where)
    .get();
  const total = totalRow?.value ?? 0;

  // Every row in this list shares one project, so resolve its short_id once.
  const project = await db.select({ shortId: projects.shortId }).from(projects).where(eq(projects.id, projectId)).get();
  if (!project)
    return { data: [], total: 0 };

  const rows = await db.select({ item: items, details: procurementDetails })
    .from(items)
    .innerJoin(procurementDetails, eq(procurementDetails.itemId, items.id))
    .where(where)
    .orderBy(desc(items.id))
    .limit(limit)
    .offset((page - 1) * limit)
    .all();

  const tagMap = await loadResourceTagsByResource(db, procurementTagBinding, rows.map(r => r.item.id));
  const data = rows.map(r => composeProcurement(r.item, r.details, project.shortId, tagMap.get(r.item.id) ?? []));
  return { data, total };
}
