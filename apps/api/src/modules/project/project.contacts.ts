import type { ContactStatus, ContactType } from "./schema";
import type { AppDatabase } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "@/shared/lib/id";
import { projectContacts } from "./schema";

export type ProjectContactRow = typeof projectContacts.$inferSelect;

export interface ProjectContactView {
  readonly id: string;
  readonly type: ContactType;
  readonly name: string;
  readonly contactPerson: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly taxId: string | null;
  readonly rating: number | null;
  readonly status: ContactStatus;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeContact(row: ProjectContactRow): ProjectContactView {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    contactPerson: row.contactPerson,
    phone: row.phone,
    email: row.email,
    address: row.address,
    taxId: row.taxId,
    rating: row.rating,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listContacts(db: AppDatabase, projectId: string, type?: ContactType): Promise<readonly ProjectContactRow[]> {
  const conditions = [eq(projectContacts.projectId, projectId)];
  if (type)
    conditions.push(eq(projectContacts.type, type));
  return await db.select().from(projectContacts).where(and(...conditions)).orderBy(desc(projectContacts.createdAt)).all();
}

/** Validate that a contact belongs to the project (and optionally is a supplier). */
export async function resolveContact(
  db: AppDatabase,
  projectId: string,
  contactId: string,
  type?: ContactType,
): Promise<ProjectContactRow | undefined> {
  const row = await db.select().from(projectContacts).where(
    and(eq(projectContacts.id, contactId), eq(projectContacts.projectId, projectId)),
  ).get();
  if (!row)
    return undefined;
  if (type && row.type !== type)
    return undefined;
  return row;
}

export interface CreateContactInput {
  readonly type: ContactType;
  readonly name: string;
  readonly contactPerson?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly taxId?: string | null | undefined;
  readonly rating?: number | null | undefined;
  readonly status?: ContactStatus | undefined;
  readonly note?: string | null | undefined;
}

export async function createContact(db: AppDatabase, projectId: string, input: CreateContactInput): Promise<ProjectContactRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(projectContacts).values({
    id,
    projectId,
    type: input.type,
    name: input.name,
    contactPerson: input.contactPerson ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    taxId: input.taxId ?? null,
    rating: input.rating ?? null,
    status: input.status ?? "active",
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await db.select().from(projectContacts).where(eq(projectContacts.id, id)).get())!;
}

export interface UpdateContactInput {
  readonly type?: ContactType | undefined;
  readonly name?: string | undefined;
  readonly contactPerson?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly address?: string | null | undefined;
  readonly taxId?: string | null | undefined;
  readonly rating?: number | null | undefined;
  readonly status?: ContactStatus | undefined;
  readonly note?: string | null | undefined;
}

export async function updateContact(
  db: AppDatabase,
  projectId: string,
  contactId: string,
  input: UpdateContactInput,
): Promise<ProjectContactRow | undefined> {
  const existing = await resolveContact(db, projectId, contactId);
  if (!existing)
    return undefined;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  for (const key of ["type", "name", "contactPerson", "phone", "email", "address", "taxId", "rating", "status", "note"] as const) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }
  await db.update(projectContacts).set(patch).where(eq(projectContacts.id, contactId)).run();
  return await db.select().from(projectContacts).where(eq(projectContacts.id, contactId)).get();
}

export async function deleteContact(db: AppDatabase, projectId: string, contactId: string): Promise<boolean> {
  const result = await db.delete(projectContacts)
    .where(and(eq(projectContacts.id, contactId), eq(projectContacts.projectId, projectId)))
    .run() as unknown as { changes: number };
  return result.changes > 0;
}
