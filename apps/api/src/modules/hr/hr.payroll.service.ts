import type { HrPayrollStatus } from "./schema";
import type { AppDatabase } from "@/db";
import { and, asc, count, desc, eq, ne } from "drizzle-orm";
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

  return {
    data: rows.map(toPayrollView),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
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
