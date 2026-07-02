import type { HrPayrollStatus } from "./schema";
import type { AppDatabase } from "@/db";
import { and, asc, count, desc, eq, isNotNull, ne, sum } from "drizzle-orm";
import { runWrite } from "@/db";
import { users } from "@/modules/account/users/schema";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { assertActiveColleague } from "./hr.approvals.service";
import { hrColleagues, hrPayrollRecords } from "./schema";

// Joined projection: payroll fields + the colleague's user display data.
const payrollColumns = {
  id: hrPayrollRecords.id,
  colleagueId: hrPayrollRecords.colleagueId,
  period: hrPayrollRecords.period,
  baseSalary: hrPayrollRecords.baseSalary,
  bonus: hrPayrollRecords.bonus,
  deduction: hrPayrollRecords.deduction,
  currency: hrPayrollRecords.currency,
  netAmount: hrPayrollRecords.netAmount,
  status: hrPayrollRecords.status,
  paidAt: hrPayrollRecords.paidAt,
  notes: hrPayrollRecords.notes,
  createdAt: hrPayrollRecords.createdAt,
  updatedAt: hrPayrollRecords.updatedAt,
  colleagueName: users.name,
  colleagueUsername: users.username,
  colleagueIsVirtual: users.isVirtual,
} as const;

interface JoinedColleagueFields {
  colleagueName: string;
  colleagueUsername: string;
  colleagueIsVirtual: boolean;
}

function toPayrollView<T extends JoinedColleagueFields>(row: T) {
  const { colleagueName, colleagueUsername, colleagueIsVirtual, ...record } = row;
  return {
    ...record,
    colleague: {
      name: colleagueName,
      username: colleagueUsername,
      isVirtual: colleagueIsVirtual,
    },
  };
}

/** Net pay is computed server-side and must not go negative. */
function computeNet(baseSalary: number, bonus: number, deduction: number): number {
  const net = baseSalary + bonus - deduction;
  if (net < 0)
    throw new AppError("Net amount must not be negative", 400, "NEGATIVE_NET");
  return net;
}

/** One record per colleague per period — duplicates are a clean 409. */
async function assertPeriodFree(db: AppDatabase, colleagueId: string, period: string, excludeId?: string): Promise<void> {
  const conditions = [
    eq(hrPayrollRecords.colleagueId, colleagueId),
    eq(hrPayrollRecords.period, period),
  ];
  if (excludeId)
    conditions.push(ne(hrPayrollRecords.id, excludeId));
  const existing = await db
    .select({ id: hrPayrollRecords.id })
    .from(hrPayrollRecords)
    .where(and(...conditions))
    .get();
  if (existing)
    throw new AppError("A payroll record for this colleague and period already exists", 409, "CONFLICT");
}

export async function getPayrollRecordById(db: AppDatabase, id: string) {
  const row = await db
    .select(payrollColumns)
    .from(hrPayrollRecords)
    .innerJoin(hrColleagues, eq(hrPayrollRecords.colleagueId, hrColleagues.id))
    .innerJoin(users, eq(hrColleagues.userId, users.id))
    .where(eq(hrPayrollRecords.id, id))
    .get();
  return row ? toPayrollView(row) : undefined;
}

interface ListPayrollParams {
  readonly colleagueId?: string | undefined;
  readonly period?: string | undefined;
  readonly status?: HrPayrollStatus | undefined;
  readonly page: number;
  readonly limit: number;
}

export async function listPayrollRecords(db: AppDatabase, params: ListPayrollParams) {
  const { colleagueId, period, status, page, limit } = params;
  const offset = (page - 1) * limit;
  const conditions = [];

  if (colleagueId)
    conditions.push(eq(hrPayrollRecords.colleagueId, colleagueId));
  if (period)
    conditions.push(eq(hrPayrollRecords.period, period));
  if (status)
    conditions.push(eq(hrPayrollRecords.status, status));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totalResult = await db
    .select({ count: count() })
    .from(hrPayrollRecords)
    .innerJoin(hrColleagues, eq(hrPayrollRecords.colleagueId, hrColleagues.id))
    .innerJoin(users, eq(hrColleagues.userId, users.id))
    .where(where)
    .get();
  const total = totalResult?.count ?? 0;

  const rows = await db
    .select(payrollColumns)
    .from(hrPayrollRecords)
    .innerJoin(hrColleagues, eq(hrPayrollRecords.colleagueId, hrColleagues.id))
    .innerJoin(users, eq(hrColleagues.userId, users.id))
    .where(where)
    // Newest period first; id keeps the order stable within a period.
    .orderBy(desc(hrPayrollRecords.period), asc(hrPayrollRecords.id))
    .limit(limit)
    .offset(offset)
    .all();

  // Net totals per currency across the ENTIRE filtered set (not just the
  // current page), so a summary can sit alongside the paged rows.
  const totalRows = await db
    .select({ currency: hrPayrollRecords.currency, net: sum(hrPayrollRecords.netAmount) })
    .from(hrPayrollRecords)
    .innerJoin(hrColleagues, eq(hrPayrollRecords.colleagueId, hrColleagues.id))
    .innerJoin(users, eq(hrColleagues.userId, users.id))
    .where(where)
    .groupBy(hrPayrollRecords.currency)
    .all();
  const totals = totalRows.map(row => ({ currency: row.currency, net: Number(row.net ?? 0) }));

  return {
    data: rows.map(toPayrollView),
    totals,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Generate pending payroll records for a `YYYY-MM` period from each active
 * colleague's configured salary. Idempotent: a colleague who already has a
 * record for the period is skipped, so a re-run inserts nothing. Colleagues
 * without a salary amount/currency, and archived colleagues, are not
 * candidates and are neither created nor counted. Never marks anything paid.
 */
export async function generatePayrollForPeriod(db: AppDatabase, period: string): Promise<{ created: number; skipped: number }> {
  // Candidates: active colleagues with both a salary amount and currency set.
  const candidates = await db
    .select({
      id: hrColleagues.id,
      salaryAmount: hrColleagues.salaryAmount,
      salaryCurrency: hrColleagues.salaryCurrency,
    })
    .from(hrColleagues)
    .where(and(
      eq(hrColleagues.status, "active"),
      isNotNull(hrColleagues.salaryAmount),
      isNotNull(hrColleagues.salaryCurrency),
    ))
    .all();

  // Colleagues already holding a record for this period — never duplicated.
  const existingRows = await db
    .select({ colleagueId: hrPayrollRecords.colleagueId })
    .from(hrPayrollRecords)
    .where(eq(hrPayrollRecords.period, period))
    .all();
  const existing = new Set(existingRows.map(r => r.colleagueId));

  const now = new Date().toISOString();
  let created = 0;
  let skipped = 0;
  // One transaction for the whole batch — a single fsync instead of one per
  // insert. `onConflictDoNothing` inside it keeps generation idempotent: the
  // unique (colleague_id, period) index is the source of truth (`existing` is
  // a fast-path), so a row another request inserted between our snapshot and
  // this insert counts as skipped (changes === 0), never a 409.
  db.transaction((tx) => {
    for (const candidate of candidates) {
      if (existing.has(candidate.id)) {
        skipped++;
        continue;
      }
      // Narrow the nullable salary columns; the query filter already excludes
      // unset salaries, so this guard is a type-safety backstop only.
      if (candidate.salaryAmount === null || candidate.salaryCurrency === null)
        continue;
      const insertStmt = tx.insert(hrPayrollRecords).values({
        id: nanoid(),
        colleagueId: candidate.id,
        period,
        baseSalary: candidate.salaryAmount,
        bonus: 0,
        deduction: 0,
        currency: candidate.salaryCurrency,
        netAmount: candidate.salaryAmount,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();
      const res = runWrite(() => insertStmt.run());
      if (res.changes > 0)
        created++;
      else
        skipped++;
    }
  });
  return { created, skipped };
}

interface CreatePayrollInput {
  readonly colleagueId: string;
  readonly period: string;
  readonly baseSalary: number;
  readonly bonus?: number | undefined;
  readonly deduction?: number | undefined;
  readonly currency: string;
  readonly notes?: string | undefined;
}

export async function createPayrollRecord(db: AppDatabase, input: CreatePayrollInput) {
  await assertActiveColleague(db, input.colleagueId);
  await assertPeriodFree(db, input.colleagueId, input.period);

  const bonus = input.bonus ?? 0;
  const deduction = input.deduction ?? 0;
  const netAmount = computeNet(input.baseSalary, bonus, deduction);

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(hrPayrollRecords).values({
    id,
    colleagueId: input.colleagueId,
    period: input.period,
    baseSalary: input.baseSalary,
    bonus,
    deduction,
    currency: input.currency,
    netAmount,
    status: "pending",
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return await getPayrollRecordById(db, id);
}

interface UpdatePayrollInput {
  readonly colleagueId?: string | undefined;
  readonly period?: string | undefined;
  readonly baseSalary?: number | undefined;
  readonly bonus?: number | undefined;
  readonly deduction?: number | undefined;
  readonly currency?: string | undefined;
  readonly notes?: string | undefined;
  /** Only the one-way pending -> paid transition is accepted. */
  readonly status?: "paid" | undefined;
}

export async function updatePayrollRecord(db: AppDatabase, id: string, data: UpdatePayrollInput) {
  const existing = await db
    .select({
      id: hrPayrollRecords.id,
      colleagueId: hrPayrollRecords.colleagueId,
      period: hrPayrollRecords.period,
      baseSalary: hrPayrollRecords.baseSalary,
      bonus: hrPayrollRecords.bonus,
      deduction: hrPayrollRecords.deduction,
      status: hrPayrollRecords.status,
    })
    .from(hrPayrollRecords)
    .where(eq(hrPayrollRecords.id, id))
    .get();
  if (!existing)
    throw new NotFoundError("HR payroll record", id);
  if (existing.status === "paid")
    throw new AppError("Payroll record has already been paid", 409, "PAYROLL_PAID");

  const nextColleagueId = data.colleagueId ?? existing.colleagueId;
  const nextPeriod = data.period ?? existing.period;
  if (data.colleagueId !== undefined)
    await assertActiveColleague(db, data.colleagueId);
  if (nextColleagueId !== existing.colleagueId || nextPeriod !== existing.period)
    await assertPeriodFree(db, nextColleagueId, nextPeriod, id);

  const now = new Date().toISOString();
  const setData: Record<string, unknown> = { updatedAt: now };
  if (data.colleagueId !== undefined)
    setData.colleagueId = data.colleagueId;
  if (data.period !== undefined)
    setData.period = data.period;
  if (data.baseSalary !== undefined)
    setData.baseSalary = data.baseSalary;
  if (data.bonus !== undefined)
    setData.bonus = data.bonus;
  if (data.deduction !== undefined)
    setData.deduction = data.deduction;
  if (data.currency !== undefined)
    setData.currency = data.currency;
  if (data.notes !== undefined)
    setData.notes = data.notes;
  if (data.status === "paid") {
    setData.status = "paid";
    setData.paidAt = now;
  }

  // Recompute net whenever any amount component changes.
  if (data.baseSalary !== undefined || data.bonus !== undefined || data.deduction !== undefined) {
    setData.netAmount = computeNet(
      data.baseSalary ?? existing.baseSalary,
      data.bonus ?? existing.bonus,
      data.deduction ?? existing.deduction,
    );
  }

  await db.update(hrPayrollRecords).set(setData).where(eq(hrPayrollRecords.id, id)).run();
  return await getPayrollRecordById(db, id);
}

/** Paid records are immutable history; only pending records can be deleted. */
export async function deletePayrollRecord(db: AppDatabase, id: string): Promise<void> {
  const existing = await db
    .select({ id: hrPayrollRecords.id, status: hrPayrollRecords.status })
    .from(hrPayrollRecords)
    .where(eq(hrPayrollRecords.id, id))
    .get();
  if (!existing)
    throw new NotFoundError("HR payroll record", id);
  if (existing.status === "paid")
    throw new AppError("Payroll record has already been paid", 409, "PAYROLL_PAID");
  await db.delete(hrPayrollRecords).where(eq(hrPayrollRecords.id, id)).run();
}
