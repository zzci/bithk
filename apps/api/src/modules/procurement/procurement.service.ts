import type { ProcurementStatus } from "./schema";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { audit } from "@/modules/audit/audit.service";
import { resolve as resolveGlobalContact } from "@/modules/contact/contact.service";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { resolveCategory } from "@/modules/project/project.categories";
import { resolveAssignableMember } from "@/modules/project/project.service";
import { projects } from "@/modules/project/schema";
import { NotFoundError, ValidationError } from "@/shared/lib/errors";
import { nanoid, ulid } from "@/shared/lib/id";
import { PROCUREMENT_STATUSES, procurementDetails } from "./schema";

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

async function assertSupplierExists(db: AppDatabase, supplierId: string): Promise<void> {
  try {
    await resolveGlobalContact(db, supplierId);
  }
  catch (error) {
    if (error instanceof NotFoundError)
      throw new ValidationError("Supplier is not a valid contact", { supplierId: "Unknown supplier" });
    throw error;
  }
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
  readonly creatorId: string;
  readonly createdAt: string; // decoded from items.id (ULID timestamp prefix)
  readonly updatedAt: string;
  readonly version: number;
  // Pin state lives on the shared `items` base. Pinned procurements surface in
  // the project overview Pin area; `pinnedAt` is set when pinned, NULL otherwise.
  readonly pinned: boolean;
  readonly pinnedAt: string | null;
}

function composeProcurement(
  item: typeof items.$inferSelect,
  details: typeof procurementDetails.$inferSelect,
  projectShortId: string,
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
    creatorId: item.creatorId,
    createdAt: ulidTimestamp(item.id),
    updatedAt: item.updatedAt,
    version: item.version,
    pinned: item.pinned,
    pinnedAt: item.pinnedAt,
  };
}

async function loadByShortId(
  db: AppDatabase,
  shortId: string,
): Promise<{ item: typeof items.$inferSelect; details: typeof procurementDetails.$inferSelect; projectShortId: string } | undefined> {
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
  return { item, details, projectShortId: project.shortId };
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
  readonly creatorId: string;
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
      status: input.status ?? "draft",
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
  });

  return (await getProcurementByShortId(db, shortId))!;
}

export async function getProcurementByShortId(db: AppDatabase, shortId: string): Promise<ProcurementRow | undefined> {
  const loaded = await loadByShortId(db, shortId);
  return loaded ? composeProcurement(loaded.item, loaded.details, loaded.projectShortId) : undefined;
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
    if (Object.keys(detailsPatch).length > 0)
      tx.update(procurementDetails).set(detailsPatch).where(eq(procurementDetails.itemId, item.id)).run();
  });

  return await getProcurementByShortId(db, shortId);
}

export async function softDeleteProcurement(db: AppDatabase, shortId: string): Promise<void> {
  const item = await db.select().from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "procurement")),
  ).get();
  if (!item)
    return;
  const now = new Date().toISOString();
  db.transaction((tx) => {
    tx.update(items)
      .set({ deletedAt: now, updatedAt: now, version: sql`${items.version} + 1` })
      .where(and(eq(items.id, item.id), isNull(items.deletedAt)))
      .run();
    tx.delete(relationTuples).where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item.id),
    )).run();
  });
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
  readonly status?: string | undefined;
  readonly categoryId?: string | undefined;
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
  if (params.categoryId)
    conditions.push(eq(procurementDetails.categoryId, params.categoryId));
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

  const data = rows.map(r => composeProcurement(r.item, r.details, project.shortId));
  return { data, total };
}
