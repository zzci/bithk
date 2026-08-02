import type { HrColleagueStatus, HrEmergencyContact, HrEmploymentType, HrGender, HrPaymentField } from "./schema";
import type { AppDatabase } from "@/db";
import { and, asc, count, eq, gte, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import { users } from "@/modules/account/users/schema";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { hrColleagues } from "./schema";

// Joined projection: colleague business fields + the linked user's display
// data, so the UI never needs per-row user lookups. `userId` is NOT NULL so
// an inner join is safe.
const colleagueColumns = {
  id: hrColleagues.id,
  userId: hrColleagues.userId,
  code: hrColleagues.code,
  title: hrColleagues.title,
  department: hrColleagues.department,
  status: hrColleagues.status,
  notes: hrColleagues.notes,
  birthday: hrColleagues.birthday,
  hireDate: hrColleagues.hireDate,
  probationEndDate: hrColleagues.probationEndDate,
  contractEndDate: hrColleagues.contractEndDate,
  gender: hrColleagues.gender,
  employmentType: hrColleagues.employmentType,
  nationality: hrColleagues.nationality,
  personalPhone: hrColleagues.personalPhone,
  personalEmail: hrColleagues.personalEmail,
  address: hrColleagues.address,
  workLocation: hrColleagues.workLocation,
  salaryAmount: hrColleagues.salaryAmount,
  salaryCurrency: hrColleagues.salaryCurrency,
  paymentInfo: hrColleagues.paymentInfo,
  emergencyContacts: hrColleagues.emergencyContacts,
  createdAt: hrColleagues.createdAt,
  updatedAt: hrColleagues.updatedAt,
  userName: users.name,
  userUsername: users.username,
  userIsVirtual: users.isVirtual,
  userStatus: users.status,
} as const;

interface JoinedColleagueRow {
  userName: string;
  userUsername: string;
  userIsVirtual: boolean;
  userStatus: "active" | "disabled";
  paymentInfo: string;
  emergencyContacts: string;
}

// The JSON columns are always written by us as a valid array, but stay
// defensive: a malformed value degrades to an empty list rather than throwing
// on read.
function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  }
  catch {
    return [];
  }
}

function toColleagueView<T extends JoinedColleagueRow>(row: T) {
  const { userName, userUsername, userIsVirtual, userStatus, paymentInfo, emergencyContacts, ...colleague } = row;
  return {
    ...colleague,
    paymentInfo: parseJsonArray<HrPaymentField>(paymentInfo),
    emergencyContacts: parseJsonArray<HrEmergencyContact>(emergencyContacts),
    user: {
      name: userName,
      username: userUsername,
      isVirtual: userIsVirtual,
      status: userStatus,
    },
  };
}

/**
 * A colleague may link to active real OR virtual users only. Missing users
 * surface as a clean 404, inactive ones as a 400 — never a raw FK error.
 */
async function assertLinkableUser(db: AppDatabase, userId: string): Promise<void> {
  const user = await db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, userId)).get();
  if (!user)
    throw new NotFoundError("User", userId);
  if (user.status !== "active")
    throw new AppError("User is not active", 400, "USER_NOT_ACTIVE");
}

/** One colleague row per user — a second link is a clean 409 conflict. */
async function assertUserNotLinked(db: AppDatabase, userId: string, excludeId?: string): Promise<void> {
  const existing = await db
    .select({ id: hrColleagues.id })
    .from(hrColleagues)
    .where(eq(hrColleagues.userId, userId))
    .get();
  if (existing && existing.id !== excludeId)
    throw new AppError("User is already an HR colleague", 409, "CONFLICT");
}

export async function getColleagueById(db: AppDatabase, id: string) {
  const row = await db
    .select(colleagueColumns)
    .from(hrColleagues)
    .innerJoin(users, eq(hrColleagues.userId, users.id))
    .where(eq(hrColleagues.id, id))
    .get();
  return row ? toColleagueView(row) : undefined;
}

interface ListColleaguesParams {
  readonly q?: string | undefined;
  readonly status?: HrColleagueStatus | undefined;
  readonly employmentType?: HrEmploymentType | undefined;
  readonly department?: string | undefined;
  readonly workLocation?: string | undefined;
  readonly hireDateFrom?: string | undefined;
  readonly hireDateTo?: string | undefined;
  readonly page: number;
  readonly limit: number;
}

export async function listColleagues(db: AppDatabase, params: ListColleaguesParams) {
  const { q, status, employmentType, department, workLocation, hireDateFrom, hireDateTo, page, limit } = params;
  const offset = (page - 1) * limit;
  const conditions = [];

  if (q) {
    // Same LIKE-escape treatment as the users list: escape backslash and
    // wildcard literals, bind an explicit ESCAPE clause.
    const escaped = q.replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escaped}%`;
    conditions.push(or(
      sql`${users.name} LIKE ${pattern} ESCAPE '\\'`,
      sql`${users.username} LIKE ${pattern} ESCAPE '\\'`,
      sql`${hrColleagues.code} LIKE ${pattern} ESCAPE '\\'`,
    ));
  }
  if (status)
    conditions.push(eq(hrColleagues.status, status));
  if (employmentType)
    conditions.push(eq(hrColleagues.employmentType, employmentType));
  if (department)
    conditions.push(eq(hrColleagues.department, department));
  if (workLocation)
    conditions.push(eq(hrColleagues.workLocation, workLocation));
  // Zero-padded ISO dates compare correctly as strings; NULL/empty hire dates
  // drop out of a range filter by design ("hired between X and Y").
  if (hireDateFrom)
    conditions.push(gte(hrColleagues.hireDate, hireDateFrom));
  // The edit form clears a date by writing "" — which sorts before any real
  // date, so an upper bound alone would wrongly match it without the ne().
  if (hireDateTo)
    conditions.push(and(ne(hrColleagues.hireDate, ""), lte(hrColleagues.hireDate, hireDateTo)));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totalResult = await db
    .select({ count: count() })
    .from(hrColleagues)
    .innerJoin(users, eq(hrColleagues.userId, users.id))
    .where(where)
    .get();
  const total = totalResult?.count ?? 0;

  const rows = await db
    .select(colleagueColumns)
    .from(hrColleagues)
    .innerJoin(users, eq(hrColleagues.userId, users.id))
    .where(where)
    .orderBy(asc(hrColleagues.createdAt), asc(hrColleagues.id))
    .limit(limit)
    .offset(offset)
    .all();

  return {
    data: rows.map(toColleagueView),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Distinct department / work-location values over the whole colleague table,
 * feeding the list-filter dropdowns so options are not limited to the current
 * page. NULL and "" (the edit form's cleared-field value) are dropped.
 */
export async function listColleagueFacets(db: AppDatabase) {
  const departments = await db
    .selectDistinct({ value: hrColleagues.department })
    .from(hrColleagues)
    .where(and(isNotNull(hrColleagues.department), ne(hrColleagues.department, "")))
    .orderBy(asc(hrColleagues.department))
    .all();
  const workLocations = await db
    .selectDistinct({ value: hrColleagues.workLocation })
    .from(hrColleagues)
    .where(and(isNotNull(hrColleagues.workLocation), ne(hrColleagues.workLocation, "")))
    .orderBy(asc(hrColleagues.workLocation))
    .all();
  return {
    departments: departments.map(r => r.value).filter((v): v is string => v !== null),
    workLocations: workLocations.map(r => r.value).filter((v): v is string => v !== null),
  };
}

// Profile metadata shared by create and update. Scalars are plain text;
// `paymentInfo` / `emergencyContacts` are arrays the caller passes already
// validated and the service serialises to their JSON columns.
interface ColleagueProfileInput {
  readonly code?: string | undefined;
  readonly title?: string | undefined;
  readonly department?: string | undefined;
  readonly notes?: string | undefined;
  readonly birthday?: string | undefined;
  readonly hireDate?: string | undefined;
  readonly probationEndDate?: string | undefined;
  readonly contractEndDate?: string | undefined;
  readonly gender?: HrGender | null | undefined;
  readonly employmentType?: HrEmploymentType | null | undefined;
  readonly nationality?: string | undefined;
  readonly personalPhone?: string | undefined;
  readonly personalEmail?: string | undefined;
  readonly address?: string | undefined;
  readonly workLocation?: string | undefined;
  readonly salaryAmount?: number | null | undefined;
  readonly salaryCurrency?: string | null | undefined;
  readonly paymentInfo?: readonly HrPaymentField[] | undefined;
  readonly emergencyContacts?: readonly HrEmergencyContact[] | undefined;
}

interface CreateColleagueInput extends ColleagueProfileInput {
  readonly userId: string;
}

export async function createColleague(db: AppDatabase, input: CreateColleagueInput) {
  await assertLinkableUser(db, input.userId);
  await assertUserNotLinked(db, input.userId);

  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(hrColleagues).values({
    id,
    userId: input.userId,
    code: input.code ?? null,
    title: input.title ?? null,
    department: input.department ?? null,
    status: "active",
    notes: input.notes ?? null,
    birthday: input.birthday ?? null,
    hireDate: input.hireDate ?? null,
    probationEndDate: input.probationEndDate ?? null,
    contractEndDate: input.contractEndDate ?? null,
    gender: input.gender ?? null,
    employmentType: input.employmentType ?? null,
    nationality: input.nationality ?? null,
    personalPhone: input.personalPhone ?? null,
    personalEmail: input.personalEmail ?? null,
    address: input.address ?? null,
    workLocation: input.workLocation ?? null,
    salaryAmount: input.salaryAmount ?? null,
    salaryCurrency: input.salaryCurrency ?? null,
    paymentInfo: JSON.stringify(input.paymentInfo ?? []),
    emergencyContacts: JSON.stringify(input.emergencyContacts ?? []),
    createdAt: now,
    updatedAt: now,
  }).run();
  return await getColleagueById(db, id);
}

interface UpdateColleagueInput extends ColleagueProfileInput {
  readonly userId?: string | undefined;
  readonly status?: HrColleagueStatus | undefined;
}

export async function updateColleague(db: AppDatabase, id: string, data: UpdateColleagueInput) {
  const existing = await db
    .select({ id: hrColleagues.id, userId: hrColleagues.userId })
    .from(hrColleagues)
    .where(eq(hrColleagues.id, id))
    .get();
  if (!existing)
    throw new NotFoundError("HR colleague", id);

  if (data.userId !== undefined && data.userId !== existing.userId) {
    await assertLinkableUser(db, data.userId);
    await assertUserNotLinked(db, data.userId, id);
  }

  const setData: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (data.userId !== undefined)
    setData.userId = data.userId;
  if (data.code !== undefined)
    setData.code = data.code;
  if (data.title !== undefined)
    setData.title = data.title;
  if (data.department !== undefined)
    setData.department = data.department;
  if (data.notes !== undefined)
    setData.notes = data.notes;
  if (data.status !== undefined)
    setData.status = data.status;
  if (data.birthday !== undefined)
    setData.birthday = data.birthday;
  if (data.hireDate !== undefined)
    setData.hireDate = data.hireDate;
  if (data.probationEndDate !== undefined)
    setData.probationEndDate = data.probationEndDate;
  if (data.contractEndDate !== undefined)
    setData.contractEndDate = data.contractEndDate;
  if (data.gender !== undefined)
    setData.gender = data.gender;
  if (data.employmentType !== undefined)
    setData.employmentType = data.employmentType;
  if (data.nationality !== undefined)
    setData.nationality = data.nationality;
  if (data.personalPhone !== undefined)
    setData.personalPhone = data.personalPhone;
  if (data.personalEmail !== undefined)
    setData.personalEmail = data.personalEmail;
  if (data.address !== undefined)
    setData.address = data.address;
  if (data.workLocation !== undefined)
    setData.workLocation = data.workLocation;
  if (data.salaryAmount !== undefined)
    setData.salaryAmount = data.salaryAmount;
  if (data.salaryCurrency !== undefined)
    setData.salaryCurrency = data.salaryCurrency;
  if (data.paymentInfo !== undefined)
    setData.paymentInfo = JSON.stringify(data.paymentInfo);
  if (data.emergencyContacts !== undefined)
    setData.emergencyContacts = JSON.stringify(data.emergencyContacts);

  await db.update(hrColleagues).set(setData).where(eq(hrColleagues.id, id)).run();
  return await getColleagueById(db, id);
}

/**
 * Soft archive instead of hard delete: colleague rows are HR actors
 * that future HR records may reference. Idempotent — archiving an
 * already-archived colleague is a no-op success.
 */
export async function archiveColleague(db: AppDatabase, id: string) {
  const existing = await db
    .select({ id: hrColleagues.id })
    .from(hrColleagues)
    .where(eq(hrColleagues.id, id))
    .get();
  if (!existing)
    throw new NotFoundError("HR colleague", id);

  await db.update(hrColleagues)
    .set({ status: "archived", updatedAt: new Date().toISOString() })
    .where(eq(hrColleagues.id, id))
    .run();
  return await getColleagueById(db, id);
}
