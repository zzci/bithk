import type { HrApprovalStatus, HrApprovalType } from "./schema";
import type { AppDatabase } from "@/db";
import { and, count, desc, eq, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { hrApprovals, hrColleagues } from "./schema";

// Decider rows join `users` a second time, so the applicant join needs a
// distinct alias for the decider side.
const deciders = alias(users, "deciders");

// Joined projection: approval fields + the applicant colleague's user
// display data + the decider's name, so the UI never needs per-row lookups.
const approvalColumns = {
  id: hrApprovals.id,
  colleagueId: hrApprovals.colleagueId,
  type: hrApprovals.type,
  title: hrApprovals.title,
  reason: hrApprovals.reason,
  status: hrApprovals.status,
  decisionNote: hrApprovals.decisionNote,
  decidedAt: hrApprovals.decidedAt,
  createdAt: hrApprovals.createdAt,
  updatedAt: hrApprovals.updatedAt,
  applicantName: users.name,
  applicantUsername: users.username,
  applicantIsVirtual: users.isVirtual,
  decidedByName: deciders.name,
} as const;

interface JoinedApprovalFields {
  applicantName: string;
  applicantUsername: string;
  applicantIsVirtual: boolean;
  decidedByName: string | null;
}

function toApprovalView<T extends JoinedApprovalFields>(row: T) {
  const { applicantName, applicantUsername, applicantIsVirtual, ...approval } = row;
  return {
    ...approval,
    applicant: {
      name: applicantName,
      username: applicantUsername,
      isVirtual: applicantIsVirtual,
    },
  };
}

/** Applicants must be existing, non-archived colleagues. */
export async function assertActiveColleague(db: AppDatabase, colleagueId: string): Promise<void> {
  const colleague = await db
    .select({ id: hrColleagues.id, status: hrColleagues.status })
    .from(hrColleagues)
    .where(eq(hrColleagues.id, colleagueId))
    .get();
  if (!colleague)
    throw new NotFoundError("HR colleague", colleagueId);
  if (colleague.status !== "active")
    throw new AppError("Colleague is archived", 400, "COLLEAGUE_ARCHIVED");
}

export async function getApprovalById(db: AppDatabase, id: string) {
  const row = await db
    .select(approvalColumns)
    .from(hrApprovals)
    .innerJoin(hrColleagues, eq(hrApprovals.colleagueId, hrColleagues.id))
    .innerJoin(users, eq(hrColleagues.userId, users.id))
    .leftJoin(deciders, eq(hrApprovals.decidedBy, deciders.id))
    .where(eq(hrApprovals.id, id))
    .get();
  return row ? toApprovalView(row) : undefined;
}

interface ListApprovalsParams {
  readonly q?: string | undefined;
  readonly status?: HrApprovalStatus | undefined;
  readonly type?: HrApprovalType | undefined;
  readonly page: number;
  readonly limit: number;
}

export async function listApprovals(db: AppDatabase, params: ListApprovalsParams) {
  const { q, status, type, page, limit } = params;
  const offset = (page - 1) * limit;
  const conditions = [];

  if (q) {
    // Same LIKE-escape treatment as the colleagues list.
    const escaped = q.replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escaped}%`;
    conditions.push(or(
      sql`${hrApprovals.title} LIKE ${pattern} ESCAPE '\\'`,
      sql`${users.name} LIKE ${pattern} ESCAPE '\\'`,
      sql`${users.username} LIKE ${pattern} ESCAPE '\\'`,
    ));
  }
  if (status)
    conditions.push(eq(hrApprovals.status, status));
  if (type)
    conditions.push(eq(hrApprovals.type, type));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totalResult = await db
    .select({ count: count() })
    .from(hrApprovals)
    .innerJoin(hrColleagues, eq(hrApprovals.colleagueId, hrColleagues.id))
    .innerJoin(users, eq(hrColleagues.userId, users.id))
    .where(where)
    .get();
  const total = totalResult?.count ?? 0;

  const rows = await db
    .select(approvalColumns)
    .from(hrApprovals)
    .innerJoin(hrColleagues, eq(hrApprovals.colleagueId, hrColleagues.id))
    .innerJoin(users, eq(hrColleagues.userId, users.id))
    .leftJoin(deciders, eq(hrApprovals.decidedBy, deciders.id))
    .where(where)
    .orderBy(desc(hrApprovals.createdAt), desc(hrApprovals.id))
    .limit(limit)
    .offset(offset)
    .all();

  return {
    data: rows.map(toApprovalView),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

interface CreateApprovalInput {
  readonly colleagueId: string;
  readonly type: HrApprovalType;
  readonly title: string;
  readonly reason?: string | undefined;
}

export async function createApproval(db: AppDatabase, input: CreateApprovalInput) {
  await assertActiveColleague(db, input.colleagueId);

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(hrApprovals).values({
    id,
    colleagueId: input.colleagueId,
    type: input.type,
    title: input.title,
    reason: input.reason ?? null,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  }).run();
  return await getApprovalById(db, id);
}

/** Loads the row and rejects mutation of decided (immutable) approvals. */
async function getPendingApproval(db: AppDatabase, id: string) {
  const existing = await db
    .select({ id: hrApprovals.id, status: hrApprovals.status })
    .from(hrApprovals)
    .where(eq(hrApprovals.id, id))
    .get();
  if (!existing)
    throw new NotFoundError("HR approval", id);
  if (existing.status !== "pending")
    throw new AppError("Approval has already been decided", 409, "APPROVAL_DECIDED");
  return existing;
}

interface UpdateApprovalInput {
  readonly colleagueId?: string | undefined;
  readonly type?: HrApprovalType | undefined;
  readonly title?: string | undefined;
  readonly reason?: string | undefined;
}

export async function updateApproval(db: AppDatabase, id: string, data: UpdateApprovalInput) {
  await getPendingApproval(db, id);

  if (data.colleagueId !== undefined)
    await assertActiveColleague(db, data.colleagueId);

  const setData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (data.colleagueId !== undefined)
    setData.colleagueId = data.colleagueId;
  if (data.type !== undefined)
    setData.type = data.type;
  if (data.title !== undefined)
    setData.title = data.title;
  if (data.reason !== undefined)
    setData.reason = data.reason;

  await db.update(hrApprovals).set(setData).where(eq(hrApprovals.id, id)).run();
  return await getApprovalById(db, id);
}

interface DecideApprovalInput {
  readonly status: "approved" | "rejected";
  readonly note?: string | undefined;
  readonly deciderId: string;
}

/** One-way transition: only pending approvals can be decided, exactly once. */
export async function decideApproval(db: AppDatabase, id: string, input: DecideApprovalInput) {
  await getPendingApproval(db, id);

  const now = new Date().toISOString();
  await db.update(hrApprovals)
    .set({
      status: input.status,
      decidedBy: input.deciderId,
      decisionNote: input.note ?? null,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(hrApprovals.id, id))
    .run();
  return await getApprovalById(db, id);
}

/** Only pending requests can be withdrawn; decided records are history. */
export async function deleteApproval(db: AppDatabase, id: string): Promise<void> {
  await getPendingApproval(db, id);
  await db.delete(hrApprovals).where(eq(hrApprovals.id, id)).run();
}
