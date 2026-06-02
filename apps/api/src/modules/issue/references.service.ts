import type { AppDatabase } from "@/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { issueReferences } from "@/modules/issue/references.schema";
import { worklists } from "@/modules/ship/schema";
import { nanoid } from "@/shared/lib/id";

// Resolved worklist payload surfaced for reference rendering.
export interface ResolvedWorklist {
  readonly id: string;
  readonly name: string;
  readonly category: string | null;
  readonly checklist: string | null;
  readonly precautions: string | null;
}

// A reference as returned to clients. For `worklist` refs the `worklist` field
// carries the resolved worklist, or `null` when the soft reference is dangling
// (target deleted) — never an error.
export interface IssueReferenceView {
  readonly id: string;
  readonly refType: string;
  readonly refId: string;
  readonly label: string | null;
  readonly createdAt: string;
  // Present only for `refType === "worklist"`.
  readonly worklist?: ResolvedWorklist | null;
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
 * Resolve a batch of worklist refIds to their payloads. Missing ids are simply
 * absent from the map (caller degrades to `null`).
 */
async function resolveWorklists(db: AppDatabase, refIds: readonly string[]): Promise<Map<string, ResolvedWorklist>> {
  const map = new Map<string, ResolvedWorklist>();
  if (refIds.length === 0)
    return map;
  const rows = await db.select({
    id: worklists.id,
    name: worklists.name,
    category: worklists.category,
    checklist: worklists.checklist,
    precautions: worklists.precautions,
  }).from(worklists).where(inArray(worklists.id, [...refIds])).all();
  for (const r of rows)
    map.set(r.id, r);
  return map;
}

function toView(row: typeof issueReferences.$inferSelect, resolved: Map<string, ResolvedWorklist>): IssueReferenceView {
  if (row.refType === "worklist") {
    return {
      id: row.id,
      refType: row.refType,
      refId: row.refId,
      label: row.label,
      createdAt: row.createdAt,
      worklist: resolved.get(row.refId) ?? null,
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
 * List an issue's references, resolving `worklist` refs to their checklist +
 * precautions. Dangling soft references degrade to `worklist:null`.
 */
export async function listReferences(db: AppDatabase, itemId: string): Promise<IssueReferenceView[]> {
  const rows = await db.select().from(issueReferences).where(eq(issueReferences.itemId, itemId)).orderBy(desc(issueReferences.createdAt), desc(issueReferences.id)).all();
  const worklistIds = rows.filter(r => r.refType === "worklist").map(r => r.refId);
  const resolved = await resolveWorklists(db, worklistIds);
  return rows.map(r => toView(r, resolved));
}

/** Add a single reference to an issue. Returns the resolved view. */
export async function addReference(db: AppDatabase, itemId: string, input: AddReferenceInput): Promise<IssueReferenceView> {
  const now = new Date().toISOString();
  const [row] = buildReferenceRows(itemId, [input], now);
  await db.insert(issueReferences).values(row!).run();
  const resolved = input.refType === "worklist"
    ? await resolveWorklists(db, [input.refId])
    : new Map<string, ResolvedWorklist>();
  return toView(row!, resolved);
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
