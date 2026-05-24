import type { AppDatabase } from "@/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { issueReferences } from "@/modules/issue/references.schema";
import { issueDetails } from "@/modules/issue/schema";
import { items } from "@/modules/item/schema";
import { projects } from "@/modules/project/schema";
import { maintenanceTemplates } from "@/modules/ship/schema";
import { nanoid } from "@/shared/lib/id";

// Resolved maintenance-template payload surfaced for work-order rendering.
export interface ResolvedTemplate {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly checklist: string | null;
  readonly precautions: string | null;
}

// A reference as returned to clients. For `maintenance_template` refs the
// `template` field carries the resolved template, or `null` when the soft
// reference is dangling (target deleted) — never an error.
export interface IssueReferenceView {
  readonly id: string;
  readonly refType: string;
  readonly refId: string;
  readonly label: string | null;
  readonly createdAt: string;
  // Present only for `refType === "maintenance_template"`.
  readonly template?: ResolvedTemplate | null;
}

export interface AddReferenceInput {
  readonly refType: string;
  readonly refId: string;
  readonly label?: string | null | undefined;
}

/** Row shape used when inserting references inside another transaction. */
export interface ReferenceRow {
  readonly id: string;
  readonly itemId: string;
  readonly refType: string;
  readonly refId: string;
  readonly label: string | null;
  readonly createdAt: string;
}

/**
 * Build reference rows for a given item id. Shared by the create-issue flow
 * (inserted inside its transaction) and the standalone add endpoint.
 */
export function buildReferenceRows(itemId: string, refs: readonly AddReferenceInput[], now: string): ReferenceRow[] {
  return refs.map(r => ({
    id: nanoid(),
    itemId,
    refType: r.refType,
    refId: r.refId,
    label: r.label ?? null,
    createdAt: now,
  }));
}

/**
 * Resolve a batch of maintenance-template refIds to their template payloads.
 * Missing ids are simply absent from the map (caller degrades to `null`).
 */
async function resolveTemplates(db: AppDatabase, refIds: readonly string[]): Promise<Map<string, ResolvedTemplate>> {
  const map = new Map<string, ResolvedTemplate>();
  if (refIds.length === 0)
    return map;
  const rows = await db.select({
    id: maintenanceTemplates.id,
    name: maintenanceTemplates.name,
    category: maintenanceTemplates.category,
    checklist: maintenanceTemplates.checklist,
    precautions: maintenanceTemplates.precautions,
  }).from(maintenanceTemplates).where(inArray(maintenanceTemplates.id, [...refIds])).all();
  for (const r of rows)
    map.set(r.id, r);
  return map;
}

function toView(row: typeof issueReferences.$inferSelect, templates: Map<string, ResolvedTemplate>): IssueReferenceView {
  if (row.refType === "maintenance_template") {
    return {
      id: row.id,
      refType: row.refType,
      refId: row.refId,
      label: row.label,
      createdAt: row.createdAt,
      template: templates.get(row.refId) ?? null,
    };
  }
  return {
    id: row.id,
    refType: row.refType,
    refId: row.refId,
    label: row.label,
    createdAt: row.createdAt,
  };
}

/**
 * List an issue's references, resolving `maintenance_template` refs to their
 * checklist + precautions. Dangling soft references degrade to `template:null`.
 */
export async function listReferences(db: AppDatabase, itemId: string): Promise<IssueReferenceView[]> {
  const rows = await db.select().from(issueReferences).where(eq(issueReferences.itemId, itemId)).orderBy(desc(issueReferences.createdAt), desc(issueReferences.id)).all();
  const templateIds = rows.filter(r => r.refType === "maintenance_template").map(r => r.refId);
  const templates = await resolveTemplates(db, templateIds);
  return rows.map(r => toView(r, templates));
}

/** Add a single reference to an issue. Returns the resolved view. */
export async function addReference(db: AppDatabase, itemId: string, input: AddReferenceInput): Promise<IssueReferenceView> {
  const now = new Date().toISOString();
  const [row] = buildReferenceRows(itemId, [input], now);
  await db.insert(issueReferences).values(row!).run();
  const templates = input.refType === "maintenance_template"
    ? await resolveTemplates(db, [input.refId])
    : new Map<string, ResolvedTemplate>();
  return toView(row!, templates);
}

/**
 * Delete a reference scoped to its owning issue. Returns false when the
 * reference does not exist (or belongs to a different issue) so the route can
 * surface a 404 instead of silently succeeding.
 */
export async function deleteReference(db: AppDatabase, itemId: string, referenceId: string): Promise<boolean> {
  const existing = await db.select({ id: issueReferences.id }).from(issueReferences).where(and(eq(issueReferences.id, referenceId), eq(issueReferences.itemId, itemId))).get();
  if (!existing)
    return false;
  await db.delete(issueReferences).where(eq(issueReferences.id, referenceId)).run();
  return true;
}

// A maintenance work order = an issue carrying a `maintenance_template`
// reference, living in one of a ship's bound projects (`projects.ship_id`).
export interface MaintenanceOrderRow {
  readonly id: string; // issue short_id
  readonly title: string;
  readonly status: string;
  readonly projectId: string; // internal ULID of the owning project
  readonly templateRefId: string; // maintenance_templates.id (soft)
  readonly referenceId: string;
}

/**
 * List a ship's maintenance work orders: non-deleted issues in the ship's bound
 * projects that carry at least one `maintenance_template` reference. Minimal
 * shape for the T5b work-order UI; resolution of template detail is done via
 * {@link listReferences} per issue.
 */
export async function listShipMaintenanceOrders(db: AppDatabase, shipInternalId: string): Promise<MaintenanceOrderRow[]> {
  const projectRows = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.shipId, shipInternalId), isNull(projects.deletedAt))).all();
  if (projectRows.length === 0)
    return [];
  const projectIds = projectRows.map(r => r.id);

  const scoped = await db.select({ itemId: issueDetails.itemId, projectId: issueDetails.projectId })
    .from(issueDetails)
    .where(inArray(issueDetails.projectId, projectIds))
    .all();
  if (scoped.length === 0)
    return [];
  const projectByItem = new Map(scoped.map(r => [r.itemId, r.projectId]));

  const refRows = await db.select({ id: issueReferences.id, itemId: issueReferences.itemId, refId: issueReferences.refId })
    .from(issueReferences)
    .where(and(
      inArray(issueReferences.itemId, [...projectByItem.keys()]),
      eq(issueReferences.refType, "maintenance_template"),
    ))
    .all();
  if (refRows.length === 0)
    return [];

  const itemRows = await db.select({ id: items.id, shortId: items.shortId, title: items.title, status: items.status })
    .from(items)
    .where(and(
      inArray(items.id, refRows.map(r => r.itemId)),
      eq(items.type, "issue"),
      isNull(items.deletedAt),
    ))
    .orderBy(desc(items.id))
    .all();
  const itemById = new Map(itemRows.map(r => [r.id, r]));

  const out: MaintenanceOrderRow[] = [];
  for (const ref of refRows) {
    const item = itemById.get(ref.itemId);
    if (!item)
      continue; // soft-deleted or non-issue → skip
    out.push({
      id: item.shortId,
      title: item.title,
      status: item.status,
      projectId: projectByItem.get(ref.itemId)!,
      templateRefId: ref.refId,
      referenceId: ref.id,
    });
  }
  return out;
}
