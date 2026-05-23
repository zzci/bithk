import type { AppDatabase } from "@/db";
import { and, count, desc, eq, inArray, isNull, like, notInArray, or, sql } from "drizzle-orm";
import { users } from "@/modules/account/users/schema";
import { issueDetails } from "@/modules/issue/schema";
import { items } from "@/modules/item/schema";
import { relationTuples } from "@/modules/policy/schema";
import { check, listUserResources } from "@/modules/policy/zanzibar.engine";
import { getRole, resolveAssignableMember } from "@/modules/project/project.service";
import { projects } from "@/modules/project/schema";
import { NotFoundError } from "@/shared/lib/errors";
import { nanoid, ulid } from "@/shared/lib/id";

export type IssueStatus = "open" | "in_progress" | "done" | "cancelled";
export type IssuePriority = "low" | "medium" | "high" | "urgent";

const LIKE_SPECIAL_RE = /[%_]/g;

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
  readonly assigneeId: string | null;
  readonly dueDate: string | null;
  // NULL → personal issue; set → project issue. Exposed as the project short_id
  // so the frontend can link without a second lookup.
  readonly projectId: string | null;
  // `project_members.id` for project issues; NULL for personal issues.
  readonly assigneeMemberId: string | null;
  readonly createdAt: string; // decoded from items.id (ULID timestamp prefix)
  readonly updatedAt: string;
  readonly version: number;
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

/** Resolve a project's short_id from its internal ULID, or null when unset/missing. */
async function projectShortId(db: AppDatabase, projectId: string | null): Promise<string | null> {
  if (!projectId)
    return null;
  const row = await db.select({ shortId: projects.shortId }).from(projects).where(eq(projects.id, projectId)).get();
  return row?.shortId ?? null;
}

async function composeIssue(
  db: AppDatabase,
  item: typeof items.$inferSelect,
  details?: typeof issueDetails.$inferSelect | undefined,
): Promise<IssueRow> {
  const d = details ?? await db.select().from(issueDetails).where(eq(issueDetails.itemId, item.id)).get();
  const assigneeId = await getAssigneeId(db, item.id);
  return {
    id: item.shortId,
    title: item.title,
    description: d?.description ?? null,
    status: item.status as IssueStatus,
    priority: (d?.priority ?? "medium") as IssuePriority,
    creatorId: item.creatorId,
    assigneeId,
    dueDate: d?.dueDate ?? null,
    projectId: await projectShortId(db, d?.projectId ?? null),
    assigneeMemberId: d?.assigneeMemberId ?? null,
    createdAt: ulidTimestamp(item.id),
    updatedAt: item.updatedAt,
    version: item.version,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────

export interface CreateIssueInput {
  readonly title: string;
  readonly description?: string | undefined;
  readonly status?: IssueStatus | undefined;
  readonly priority?: IssuePriority | undefined;
  readonly creatorId: string;
  readonly assigneeId?: string | undefined;
  readonly dueDate?: string | undefined;
  // Internal project ULID. When set this is a project issue and `assigneeId`
  // is ignored in favor of `assigneeMemberId` (a `project_members.id`).
  readonly projectId?: string | undefined;
  readonly assigneeMemberId?: string | undefined;
}

export async function createIssue(db: AppDatabase, input: CreateIssueInput): Promise<IssueRow> {
  const id = ulid();
  const shortId = nanoid();
  const now = new Date().toISOString();

  // Project issues assign to a `project_members.id`. Validate the member up
  // front (async, outside the sync transaction) and resolve its user id so an
  // internal member also gets the legacy `item#assignee@user` tuple.
  let assigneeMemberId: string | null = null;
  let memberUserTuple: string | null = null;
  if (input.projectId && input.assigneeMemberId) {
    const member = await resolveAssignableMember(db, input.projectId, input.assigneeMemberId);
    if (!member)
      throw new NotFoundError("Project member", input.assigneeMemberId);
    assigneeMemberId = member.id;
    memberUserTuple = member.userId; // null for external members
  }

  // Personal issues keep the user-tuple assignment path unchanged.
  const personalAssignee = input.projectId ? null : (input.assigneeId ?? null);

  // bun:sqlite transactions are synchronous — drop async to keep COMMIT/ROLLBACK semantics.
  db.transaction((tx) => {
    tx.insert(items).values({
      id,
      shortId,
      type: "issue",
      title: input.title,
      status: input.status ?? "open",
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
      projectId: input.projectId ?? null,
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

    // Personal user-tuple assignee, or — for a project issue with an internal
    // member — the same tuple so "my issues" / item-assignee semantics hold.
    const tupleSubject = personalAssignee ?? memberUserTuple;
    if (tupleSubject) {
      tx.insert(relationTuples).values({
        id: nanoid(),
        namespace: "item",
        objectId: id,
        relation: "assignee",
        subjectNamespace: "user",
        subjectId: tupleSubject,
        subjectRelation: null,
        createdBy: input.creatorId,
        createdAt: now,
      }).run();
    }
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
  readonly assigneeId?: string | null | undefined;
  readonly dueDate?: string | null | undefined;
  // Project-issue reassignment target (`project_members.id`); null clears it.
  // Ignored on personal issues.
  readonly assigneeMemberId?: string | null | undefined;
}

export async function updateIssue(db: AppDatabase, shortId: string, input: UpdateIssueInput): Promise<IssueRow | undefined> {
  const item = await db.select().from(items).where(
    and(eq(items.shortId, shortId), eq(items.type, "issue"), isNull(items.deletedAt)),
  ).get();
  if (!item)
    return undefined;

  const now = new Date().toISOString();

  const details = await db.select().from(issueDetails).where(eq(issueDetails.itemId, item.id)).get();
  const projectId = details?.projectId ?? null;

  // Project-issue reassignment: validate the member up front (async) and
  // resolve its user id so the legacy user tuple stays in sync.
  let nextMemberId: string | null = null;
  let nextMemberUser: string | null = null;
  if (projectId && input.assigneeMemberId !== undefined && input.assigneeMemberId !== null) {
    const member = await resolveAssignableMember(db, projectId, input.assigneeMemberId);
    if (!member)
      throw new NotFoundError("Project member", input.assigneeMemberId);
    nextMemberId = member.id;
    nextMemberUser = member.userId; // null for external members
  }
  // A project issue resyncs its user tuple whenever the member changes; a
  // personal issue keeps using `assigneeId`.
  const syncMemberTuple = projectId !== null && input.assigneeMemberId !== undefined;

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

    // Resolve the next user-tuple subject. Personal issues use `assigneeId`;
    // project issues derive it from the (internal) member's user id.
    const wantsTupleChange = input.assigneeId !== undefined || syncMemberTuple;
    const tupleSubject = syncMemberTuple ? nextMemberUser : (input.assigneeId ?? null);
    if (wantsTupleChange) {
      // Replace any existing assignee tuple. Even when the subject is null we
      // drop the prior tuple — the canonical "no assignee" state is "no tuple".
      tx.delete(relationTuples).where(and(
        eq(relationTuples.namespace, "item"),
        eq(relationTuples.objectId, item.id),
        eq(relationTuples.relation, "assignee"),
      )).run();
      if (tupleSubject !== null) {
        tx.insert(relationTuples).values({
          id: nanoid(),
          namespace: "item",
          objectId: item.id,
          relation: "assignee",
          subjectNamespace: "user",
          subjectId: tupleSubject,
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

export interface ListIssueParams {
  readonly q?: string | undefined;
  readonly status?: string | undefined;
  readonly priority?: string | undefined;
  readonly assigneeId?: string | undefined;
  readonly creatorId?: string | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
}

async function buildIssueConditions(params: ListIssueParams) {
  const conditions = [eq(items.type, "issue"), isNull(items.deletedAt)];
  if (params.status && params.status !== "__all__")
    conditions.push(eq(items.status, params.status));
  if (params.creatorId)
    conditions.push(eq(items.creatorId, params.creatorId));
  if (params.q)
    conditions.push(like(items.title, `%${escapeLike(params.q)}%`));
  return conditions;
}

/** Item ids that belong to a project (i.e. are work orders, not personal). */
async function projectIssueItemIds(db: AppDatabase): Promise<readonly string[]> {
  const rows = await db.select({ itemId: issueDetails.itemId })
    .from(issueDetails)
    .where(sql`${issueDetails.projectId} IS NOT NULL`)
    .all();
  return rows.map(r => r.itemId);
}

async function paginateIssues(
  db: AppDatabase,
  baseConditions: readonly ReturnType<typeof eq>[],
  params: ListIssueParams,
) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  // priority + assignee filters need joins / tuple lookups. We build the
  // candidate id set in stages so the final SELECT is a simple in-list.
  let where = and(...baseConditions);

  // The personal `/issues` list never surfaces project work orders.
  const projectIds = await projectIssueItemIds(db);
  if (projectIds.length > 0)
    where = and(where, notInArray(items.id, [...projectIds]));

  if (params.priority && params.priority !== "__all__") {
    const ids = await db.select({ itemId: issueDetails.itemId })
      .from(issueDetails)
      .where(eq(issueDetails.priority, params.priority as IssuePriority))
      .all();
    if (ids.length === 0)
      return { data: [] as IssueRow[], total: 0 };
    where = and(where, inArray(items.id, ids.map(r => r.itemId)));
  }

  if (params.assigneeId) {
    const ids = await db.select({ objectId: relationTuples.objectId })
      .from(relationTuples)
      .where(and(
        eq(relationTuples.namespace, "item"),
        eq(relationTuples.relation, "assignee"),
        eq(relationTuples.subjectNamespace, "user"),
        eq(relationTuples.subjectId, params.assigneeId),
      ))
      .all();
    if (ids.length === 0)
      return { data: [] as IssueRow[], total: 0 };
    where = and(where, inArray(items.id, ids.map(r => r.objectId)));
  }

  const totalRow = await db.select({ value: count() }).from(items).where(where).get();
  const total = totalRow?.value ?? 0;

  const rows = await db.select().from(items).where(where).orderBy(desc(items.id)).limit(limit).offset((page - 1) * limit).all();

  const data: IssueRow[] = [];
  for (const r of rows)
    data.push(await composeIssue(db, r));
  return { data, total };
}

export async function listIssues(db: AppDatabase, params: ListIssueParams = {}) {
  const conditions = await buildIssueConditions(params);
  return await paginateIssues(db, conditions, params);
}

export async function listMyIssues(db: AppDatabase, params: ListIssueParams & { userId: string }) {
  // "Mine" = creator OR assignee. Resolve the user-side tuple set first,
  // then OR with creator_id in the items query.
  const assigneeIds = await listUserResources(db, params.userId, "item", "assignee");
  const creatorClause = eq(items.creatorId, params.userId);

  const conditions = await buildIssueConditions(params);
  const baseAnd = and(...conditions);
  const where = assigneeIds.length > 0
    ? and(baseAnd, or(creatorClause, inArray(items.id, [...assigneeIds])))
    : and(baseAnd, creatorClause);

  // Reuse paginate with an explicit override of "where" via baseConditions.
  // Cheaper: inline the count + select here.
  const finalWhere = where;
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? 20));

  let working = finalWhere;
  // "My issues" is the personal inbox — project work orders are excluded.
  const projectIds = await projectIssueItemIds(db);
  if (projectIds.length > 0)
    working = and(working, notInArray(items.id, [...projectIds]));

  if (params.priority && params.priority !== "__all__") {
    const ids = await db.select({ itemId: issueDetails.itemId })
      .from(issueDetails)
      .where(eq(issueDetails.priority, params.priority as IssuePriority))
      .all();
    if (ids.length === 0)
      return { data: [] as IssueRow[], total: 0 };
    working = and(working, inArray(items.id, ids.map(r => r.itemId)));
  }

  const totalRow = await db.select({ value: count() }).from(items).where(working).get();
  const total = totalRow?.value ?? 0;
  const rows = await db.select().from(items).where(working).orderBy(desc(items.id)).limit(limit).offset((page - 1) * limit).all();
  const data: IssueRow[] = [];
  for (const r of rows)
    data.push(await composeIssue(db, r));
  return { data, total };
}

export interface ListByProjectParams {
  readonly projectId: string; // internal ULID
  readonly q?: string | undefined;
  readonly status?: string | undefined;
  readonly priority?: string | undefined;
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

  const detailConditions = [eq(issueDetails.projectId, params.projectId)];
  if (params.priority && params.priority !== "__all__")
    detailConditions.push(eq(issueDetails.priority, params.priority as IssuePriority));
  const detailRows = await db.select({ itemId: issueDetails.itemId })
    .from(issueDetails)
    .where(and(...detailConditions))
    .all();
  if (detailRows.length === 0)
    return { data: [], total: 0 };

  const conditions = [
    eq(items.type, "issue"),
    isNull(items.deletedAt),
    inArray(items.id, detailRows.map(r => r.itemId)),
  ];
  if (params.status && params.status !== "__all__")
    conditions.push(eq(items.status, params.status));
  if (params.q)
    conditions.push(like(items.title, `%${escapeLike(params.q)}%`));
  const where = and(...conditions);

  const totalRow = await db.select({ value: count() }).from(items).where(where).get();
  const total = totalRow?.value ?? 0;
  const rows = await db.select().from(items).where(where).orderBy(desc(items.id)).limit(limit).offset((page - 1) * limit).all();
  const data: IssueRow[] = [];
  for (const r of rows)
    data.push(await composeIssue(db, r));
  return { data, total };
}

// ─── Access helper ────────────────────────────────────────────────────

/**
 * Resolve the actor's relations against the issue's item. Returns the
 * set of role flags the route handlers use to decide visibility / edit
 * rights. Admin bypass is owned by the caller (route layer).
 */
export interface IssueAccess {
  readonly isCreator: boolean;
  readonly isAssignee: boolean;
  readonly canRead: boolean;
  readonly canEdit: boolean;
}

export async function resolveAccess(
  db: AppDatabase,
  item: typeof items.$inferSelect,
  userId: string,
): Promise<IssueAccess> {
  const isCreator = item.creatorId === userId;
  // The policy engine walks the assignee → owner implication automatically,
  // but the route layer needs an explicit "you are the assignee" signal for
  // the existing "assignees can only update status" rule.
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
  const view = await check(db, "item", item.id, "viewer", "user", userId);
  const edit = await check(db, "item", item.id, "editor", "user", userId);
  return { isCreator, isAssignee, canRead: view.allowed, canEdit: edit.allowed };
}

/**
 * Project-issue access. Distinct from `resolveAccess` (personal issues) so the
 * legacy creator/assignee rules stay untouched.
 *
 * - any project member can read
 * - the assignee can change status only (mirrors the personal "assignees can
 *   only update status" rule)
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
  const role = await getRole(db, projectId, userId);
  const isMember = role !== null;
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
  const canEdit = isMember && (role === "pm" || isCreator);
  return { isCreator, isAssignee, canRead: isMember, canEdit };
}

export async function getUserById(db: AppDatabase, id: string) {
  return await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, id)).get();
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
