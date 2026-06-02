import type { AppDatabase } from "@/db";
import type { AddReferenceInput } from "@/modules/issue/references.service";
import type { ResourceTagBinding } from "@/modules/tag/tag.service";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { issueReferences } from "@/modules/issue/references.schema";
import { buildReferenceRows } from "@/modules/issue/references.service";
import { issueDetails } from "@/modules/issue/schema";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { getMemberCapabilities, resolveAssignableMember } from "@/modules/project/project.service";
import { projectMembers, projects } from "@/modules/project/schema";
import { listResourceIdsByAnyTag, listResourceTagViews, loadResourceTagsByResource, syncResourceTagsTx } from "@/modules/tag/tag.service";
import { NotFoundError } from "@/shared/lib/errors";
import { nanoid, ulid } from "@/shared/lib/id";

export type IssueStatus = "todo" | "working" | "review" | "done" | "cancel";

// The issue domain's tag binding (tag type='issue'). Resources are keyed by the
// issue's `items.id`. Exported so `routes/protected.ts` registers the same type
// for the shared `GET /tags?type=issue` vocabulary route.
export const issueTagBinding: ResourceTagBinding = {
  type: "issue",
};
export type IssuePriority = "low" | "medium" | "high" | "urgent";

// Backslash is the ESCAPE char, so it must be escaped first; every LIKE built
// from this MUST carry `ESCAPE '\'` or the backslashes match literally.
const LIKE_SPECIAL_RE = /[\\%_]/g;

function escapeLike(v: string): string {
  return v.replace(LIKE_SPECIAL_RE, "\\$&");
}

/** Composite view returned by routes and tests. */
export interface IssueRow {
  readonly id: string; // short_id (8-char nanoid)
  readonly title: string;
  readonly description: string | null;
  readonly status: IssueStatus;
  readonly priority: IssuePriority;
  readonly creatorId: string;
  // The user-tuple assignee, derived from the policy engine. Set only for
  // INTERNAL member assignees; NULL for external members or no assignee.
  readonly assigneeId: string | null;
  readonly dueDate: string | null;
  // The owning project's short_id. Always set — every issue is a work order.
  readonly projectId: string;
  // `project_members.id` of the assignee, or NULL when unassigned.
  readonly assigneeMemberId: string | null;
  readonly createdAt: string; // decoded from items.id (ULID timestamp prefix)
  readonly updatedAt: string;
  readonly version: number;
  // Pin state lives on the shared `items` base. Pinned issues surface in the
  // project overview Pin area; `pinnedAt` is set when pinned, NULL otherwise.
  readonly pinned: boolean;
  readonly pinnedAt: string | null;
  // Tags assigned to this issue (tag type 'issue'), ordered by name.
  readonly tags: { readonly id: string; readonly name: string }[];
}

// Crockford base32 → ms decode for the ULID timestamp prefix that lives on
// `items.id`. The first 10 chars carry the upload millisecond.
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

async function getAssigneeId(db: AppDatabase, itemId: string): Promise<string | null> {
  const row = await db.select({ subjectId: relationTuples.subjectId })
    .from(relationTuples)
    .where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, itemId),
      eq(relationTuples.relation, "assignee"),
      eq(relationTuples.subjectNamespace, "user"),
    ))
    .get();
  return row?.subjectId ?? null;
}

/**
 * Batch-resolve the user-tuple assignee for a set of issue item ids in a single
 * query, returning a `itemId → userId` map. Replaces the per-row
 * `getAssigneeId` call on list/search paths (F1/F5).
 */
async function loadAssigneeIds(db: AppDatabase, itemIds: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (itemIds.length === 0)
    return map;
  const rows = await db.select({ objectId: relationTuples.objectId, subjectId: relationTuples.subjectId })
    .from(relationTuples)
    .where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.relation, "assignee"),
      eq(relationTuples.subjectNamespace, "user"),
      inArray(relationTuples.objectId, [...itemIds]),
    ))
    .all();
  for (const r of rows)
    map.set(r.objectId, r.subjectId);
  return map;
}

/** Resolve a project's short_id from its internal ULID. */
async function projectShortId(db: AppDatabase, projectId: string): Promise<string> {
  const row = await db.select({ shortId: projects.shortId }).from(projects).where(eq(projects.id, projectId)).get();
  return row?.shortId ?? projectId;
}

/**
 * Pure row composer: builds an `IssueRow` from already-fetched parts (item,
 * details, the project short id, the resolved assignee, and tags). The
 * list/search paths prefetch every part in batch, so no per-row query remains.
 */
function composeIssueRow(
  item: typeof items.$inferSelect,
  details: typeof issueDetails.$inferSelect,
  projectShort: string,
  assigneeId: string | null,
  tags: readonly { id: string; name: string }[],
): IssueRow {
  return {
    id: item.shortId,
    title: item.title,
    description: details.description ?? null,
    status: item.status as IssueStatus,
    priority: (details.priority ?? "medium") as IssuePriority,
    creatorId: item.creatorId,
    assigneeId,
    dueDate: details.dueDate ?? null,
    projectId: projectShort,
    assigneeMemberId: details.assigneeMemberId ?? null,
    createdAt: ulidTimestamp(item.id),
    updatedAt: item.updatedAt,
    version: item.version,
    pinned: item.pinned,
    pinnedAt: item.pinnedAt,
    tags: tags.map(t => ({ id: t.id, name: t.name })),
  };
}

/**
 * Single-row composer used by create / get / update. Fetches the row's details,
 * assignee, project short id, and tags individually — acceptable for one row.
 * The list/search paths use `composeIssueRow` with batched data instead.
 */
async function composeIssue(
  db: AppDatabase,
  item: typeof items.$inferSelect,
  details?: typeof issueDetails.$inferSelect | undefined,
  tags?: readonly { id: string; name: string }[] | undefined,
): Promise<IssueRow> {
  const d = details ?? (await db.select().from(issueDetails).where(eq(issueDetails.itemId, item.id)).get())!;
  const assigneeId = await getAssigneeId(db, item.id);
  const projectShort = await projectShortId(db, d.projectId);
  const tagList = tags ?? await listResourceTagViews(db, issueTagBinding, item.id);
  return composeIssueRow(item, d, projectShort, assigneeId, tagList);
}

// ─── CRUD ─────────────────────────────────────────────────────────────

export interface CreateIssueInput {
  readonly title: string;
  readonly description?: string | undefined;
  readonly status?: IssueStatus | undefined;
  readonly priority?: IssuePriority | undefined;
  readonly creatorId: string;
  readonly dueDate?: string | undefined;
  // The owning project's internal ULID. Required — every issue is a work order.
  readonly projectId: string;
  // Assignment target: a `project_members.id`. An internal member also gets
  // the `item#assignee@user` tuple so assignee-based lookups keep working.
  readonly assigneeMemberId?: string | undefined;
  // Optional generic references inserted in the same transaction. Additive —
  // omitting it leaves the create path's behavior unchanged.
  readonly references?: readonly AddReferenceInput[] | undefined;
  // Optional tag names (tag type 'issue') synced in the same transaction.
  readonly tags?: readonly string[] | undefined;
}

export async function createIssue(db: AppDatabase, input: CreateIssueInput): Promise<IssueRow> {
  const id = ulid();
  const shortId = nanoid();
  const now = new Date().toISOString();

  // Validate the assignee member up front (async, outside the sync
  // transaction) and resolve its user id so an internal member also gets the
  // `item#assignee@user` tuple.
  let assigneeMemberId: string | null = null;
  let memberUserTuple: string | null = null;
  if (input.assigneeMemberId) {
    const member = await resolveAssignableMember(db, input.projectId, input.assigneeMemberId);
    if (!member)
      throw new NotFoundError("Project member", input.assigneeMemberId);
    assigneeMemberId = member.id;
    memberUserTuple = member.userId; // null for external members
  }

  // bun:sqlite transactions are synchronous — drop async to keep COMMIT/ROLLBACK semantics.
  db.transaction((tx) => {
    tx.insert(items).values({
      id,
      shortId,
      type: "issue",
      title: input.title,
      status: input.status ?? "todo",
      creatorId: input.creatorId,
      version: 1,
      deletedAt: null,
      updatedAt: now,
    }).run();

    tx.insert(issueDetails).values({
      itemId: id,
      description: input.description ?? null,
      priority: input.priority ?? "medium",
      dueDate: input.dueDate ?? null,
      projectId: input.projectId,
      assigneeMemberId,
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

    // For an internal member assignee, mirror the assignment as an
    // `item#assignee@user` tuple so assignee-based access checks hold.
    if (memberUserTuple) {
      tx.insert(relationTuples).values({
        id: nanoid(),
        namespace: "item",
        objectId: id,
        relation: "assignee",
        subjectNamespace: "user",
        subjectId: memberUserTuple,
        subjectRelation: null,
        createdBy: input.creatorId,
        createdAt: now,
      }).run();
    }

    // Optional generic references (e.g. a maintenance_template that turns this
    // issue into a work order). Soft references — no target validation here.
    if (input.references && input.references.length > 0) {
      for (const row of buildReferenceRows(id, input.references, now))
        tx.insert(issueReferences).values(row).run();
    }

    // Optional tag assignment (tag type 'issue'), synced inside the same tx.
    if (input.tags)
      syncResourceTagsTx(tx, issueTagBinding, id, input.tags, now);
  });

  const item = (await db.select().from(items).where(eq(items.id, id)).get())!;
  return await composeIssue(db, item);
}

export async function getIssueByShortId(db: AppDatabase, shortId: string): Promise<IssueRow | undefined> {
  const item = await db.select().from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "issue"), isNull(items.deletedAt)),
  ).get();
  if (!item)
    return undefined;
  return await composeIssue(db, item);
}

export interface UpdateIssueInput {
  readonly title?: string | undefined;
  readonly description?: string | null | undefined;
  readonly status?: IssueStatus | undefined;
  readonly priority?: IssuePriority | undefined;
  readonly dueDate?: string | null | undefined;
  // Reassignment target (`project_members.id`); null clears the assignment.
  readonly assigneeMemberId?: string | null | undefined;
  // Replacement tag set (tag type 'issue'); omit to leave tags unchanged.
  readonly tags?: readonly string[] | undefined;
}

export async function updateIssue(db: AppDatabase, shortId: string, input: UpdateIssueInput): Promise<IssueRow | undefined> {
  const item = await db.select().from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "issue"), isNull(items.deletedAt)),
  ).get();
  if (!item)
    return undefined;

  const now = new Date().toISOString();

  const details = await db.select().from(issueDetails).where(eq(issueDetails.itemId, item.id)).get();
  const projectId = details!.projectId;

  // Reassignment: validate the member up front (async) and resolve its user id
  // so the `item#assignee@user` tuple stays in sync.
  let nextMemberId: string | null = null;
  let nextMemberUser: string | null = null;
  if (input.assigneeMemberId !== undefined && input.assigneeMemberId !== null) {
    const member = await resolveAssignableMember(db, projectId, input.assigneeMemberId);
    if (!member)
      throw new NotFoundError("Project member", input.assigneeMemberId);
    nextMemberId = member.id;
    nextMemberUser = member.userId; // null for external members
  }
  const syncMemberTuple = input.assigneeMemberId !== undefined;

  db.transaction((tx) => {
    const itemPatch: Record<string, unknown> = { updatedAt: now, version: sql`${items.version} + 1` };
    if (input.title !== undefined)
      itemPatch.title = input.title;
    if (input.status !== undefined)
      itemPatch.status = input.status;
    tx.update(items).set(itemPatch).where(eq(items.id, item.id)).run();

    const detailsPatch: Record<string, unknown> = {};
    if (input.description !== undefined)
      detailsPatch.description = input.description;
    if (input.priority !== undefined)
      detailsPatch.priority = input.priority;
    if (input.dueDate !== undefined)
      detailsPatch.dueDate = input.dueDate;
    if (syncMemberTuple)
      detailsPatch.assigneeMemberId = nextMemberId;
    if (Object.keys(detailsPatch).length > 0) {
      tx.update(issueDetails).set(detailsPatch).where(eq(issueDetails.itemId, item.id)).run();
    }

    // Replace the issue's tag set when `tags` is provided (omit = unchanged).
    if (input.tags !== undefined)
      syncResourceTagsTx(tx, issueTagBinding, item.id, input.tags, now);

    // Resync the `item#assignee@user` tuple from the (internal) member's user
    // id whenever the member changes.
    if (syncMemberTuple) {
      // Replace any existing assignee tuple. Even when the subject is null we
      // drop the prior tuple — the canonical "no assignee" state is "no tuple".
      tx.delete(relationTuples).where(and(
        eq(relationTuples.namespace, "item"),
        eq(relationTuples.objectId, item.id),
        eq(relationTuples.relation, "assignee"),
      )).run();
      if (nextMemberUser !== null) {
        tx.insert(relationTuples).values({
          id: nanoid(),
          namespace: "item",
          objectId: item.id,
          relation: "assignee",
          subjectNamespace: "user",
          subjectId: nextMemberUser,
          subjectRelation: null,
          createdBy: item.creatorId,
          createdAt: now,
        }).run();
      }
    }
  });

  const refreshed = await db.select().from(items).where(eq(items.id, item.id)).get();
  if (!refreshed)
    return undefined;
  return await composeIssue(db, refreshed);
}

export async function softDeleteIssue(db: AppDatabase, shortId: string): Promise<void> {
  const item = await db.select().from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "issue")),
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

// ─── List ─────────────────────────────────────────────────────────────

export interface ListByProjectParams {
  readonly projectId: string; // internal ULID
  readonly q?: string | undefined;
  readonly status?: string | undefined;
  readonly priority?: string | undefined;
  // Multi-tag filter (tag type 'issue'). OR / union semantics: an issue
  // matches if it carries ANY of these tags. Empty/omitted = no tag filter.
  readonly tagIds?: readonly string[] | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

/**
 * List the work orders that belong to a single project. Membership is enforced
 * by the route layer; this scopes purely on `issue_details.project_id` and the
 * standard issue filters, excluding soft-deleted rows.
 */
export async function listByProject(
  db: AppDatabase,
  params: ListByProjectParams,
): Promise<{ data: IssueRow[]; total: number }> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  // Single innerJoin (items ⋈ issueDetails) so status/title (on items) and
  // projectId/priority (on issueDetails) live in one bounded query — no
  // pre-scan of every itemId, no unbounded IN list (F3). Mirrors procurement.
  const conditions = [
    eq(items.type, "issue"),
    isNull(items.deletedAt),
    eq(issueDetails.projectId, params.projectId),
  ];
  if (params.priority && params.priority !== "__all__")
    conditions.push(eq(issueDetails.priority, params.priority as IssuePriority));
  if (params.status && params.status !== "__all__")
    conditions.push(eq(items.status, params.status));
  if (params.q)
    conditions.push(sql`${items.title} LIKE ${`%${escapeLike(params.q)}%`} ESCAPE '\\'`);

  // Multi-tag filter: union of the item ids carrying any of the selected tags.
  if (params.tagIds && params.tagIds.length > 0) {
    const tagItemIds = await listResourceIdsByAnyTag(db, issueTagBinding, params.tagIds);
    if (tagItemIds.length === 0)
      return { data: [], total: 0 };
    conditions.push(inArray(items.id, tagItemIds));
  }

  const where = and(...conditions);

  const totalRow = await db.select({ value: count() })
    .from(items)
    .innerJoin(issueDetails, eq(issueDetails.itemId, items.id))
    .where(where)
    .get();
  const total = totalRow?.value ?? 0;
  if (total === 0)
    return { data: [], total: 0 };

  // Every row in this list shares one project, so resolve its short_id once (F1).
  const projectShort = await projectShortId(db, params.projectId);

  const rows = await db.select({ item: items, details: issueDetails })
    .from(items)
    .innerJoin(issueDetails, eq(issueDetails.itemId, items.id))
    .where(where)
    .orderBy(desc(items.id))
    .limit(limit)
    .offset((page - 1) * limit)
    .all();

  // Batch the assignee tuples + tags for the whole page (F1).
  const itemIds = rows.map(r => r.item.id);
  const tagMap = await loadResourceTagsByResource(db, issueTagBinding, itemIds);
  const assigneeMap = await loadAssigneeIds(db, itemIds);
  const data = rows.map(r => composeIssueRow(
    r.item,
    r.details,
    projectShort,
    assigneeMap.get(r.item.id) ?? null,
    tagMap.get(r.item.id) ?? [],
  ));
  return { data, total };
}

export interface SearchIssuesParams {
  readonly userId: string;
  readonly isAdmin: boolean;
  readonly q: string;
  readonly limit?: number | undefined;
}

/**
 * Title search across the issues a user may see: every issue for an app admin,
 * otherwise issues in the projects the user is a member of. Backs global
 * search; access scope mirrors the project-membership gate on the routes.
 */
export async function searchIssues(db: AppDatabase, params: SearchIssuesParams): Promise<IssueRow[]> {
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));
  const term = params.q.trim();
  if (term.length === 0)
    return [];

  const conditions = [
    eq(items.type, "issue"),
    isNull(items.deletedAt),
    sql`${items.title} LIKE ${`%${escapeLike(term)}%`} ESCAPE '\\'`,
  ];

  if (!params.isAdmin) {
    const memberProjects = await db.selectDistinct({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, params.userId))
      .all();
    if (memberProjects.length === 0)
      return [];
    // Push the project scope straight into the joined WHERE — no pre-scan of
    // every itemId (F5).
    conditions.push(inArray(issueDetails.projectId, memberProjects.map(r => r.projectId)));
  }

  const rows = await db.select({ item: items, details: issueDetails })
    .from(items)
    .innerJoin(issueDetails, eq(issueDetails.itemId, items.id))
    .where(and(...conditions))
    .orderBy(desc(items.id))
    .limit(limit)
    .all();
  if (rows.length === 0)
    return [];

  // Batch tags + assignee tuples for the whole result set, and resolve each
  // distinct project's short id once (search spans projects, so it cannot be a
  // single lookup like listByProject).
  const itemIds = rows.map(r => r.item.id);
  const tagMap = await loadResourceTagsByResource(db, issueTagBinding, itemIds);
  const assigneeMap = await loadAssigneeIds(db, itemIds);
  const projectIds = [...new Set(rows.map(r => r.details.projectId))];
  const projectRows = await db.select({ id: projects.id, shortId: projects.shortId })
    .from(projects)
    .where(inArray(projects.id, projectIds))
    .all();
  const projectShortMap = new Map(projectRows.map(p => [p.id, p.shortId]));

  return rows.map(r => composeIssueRow(
    r.item,
    r.details,
    projectShortMap.get(r.details.projectId) ?? r.details.projectId,
    assigneeMap.get(r.item.id) ?? null,
    tagMap.get(r.item.id) ?? [],
  ));
}

// ─── Access helper ────────────────────────────────────────────────────

export interface IssueAccess {
  readonly isCreator: boolean;
  readonly isAssignee: boolean;
  readonly canRead: boolean;
  readonly canEdit: boolean;
  readonly canComment: boolean;
}

/**
 * Project-issue access.
 *
 * - any project member can read
 * - the assignee can change status only (the route layer enforces the
 *   field-level rule)
 * - a pm, or the issue creator, can edit every field
 *
 * Fail-closed: a non-member resolves to all-false so project issues never leak.
 */
export async function resolveProjectIssueAccess(
  db: AppDatabase,
  item: typeof items.$inferSelect,
  projectId: string, // internal ULID
  userId: string,
): Promise<IssueAccess> {
  const caps = await getMemberCapabilities(db, projectId, userId);
  const isMember = caps !== null;
  const isCreator = item.creatorId === userId;
  const assignedTuple = await db.select({ id: relationTuples.id })
    .from(relationTuples)
    .where(and(
      eq(relationTuples.namespace, "item"),
      eq(relationTuples.objectId, item.id),
      eq(relationTuples.relation, "assignee"),
      eq(relationTuples.subjectNamespace, "user"),
      eq(relationTuples.subjectId, userId),
    ))
    .get();
  const isAssignee = !!assignedTuple;
  const canRead = isMember && (caps?.has("issue.view") ?? false);
  const canEdit = isMember && (isCreator || (caps?.has("issue.manage") ?? false));
  const canComment = isMember && (caps?.has("issue.comment") ?? false);
  return { isCreator, isAssignee, canRead, canEdit, canComment };
}

/**
 * Resolve the underlying `items` row by short_id. Routes that need to
 * touch comments / attachments translate `:id` → items.id via this.
 */
export async function resolveIssueItem(db: AppDatabase, shortId: string) {
  return await db.select().from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "issue"), isNull(items.deletedAt)),
  ).get();
}

/** Resolve the owning project's internal ULID for an issue short_id. */
export async function resolveIssueProjectId(db: AppDatabase, shortId: string): Promise<string | null> {
  const item = await db.select({ id: items.id }).from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "issue"), isNull(items.deletedAt)),
  ).get();
  if (!item)
    return null;
  const d = await db.select({ projectId: issueDetails.projectId }).from(issueDetails).where(eq(issueDetails.itemId, item.id)).get();
  return d?.projectId ?? null;
}
