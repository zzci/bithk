import type { AppDatabase } from "@/db";
import { desc, eq } from "drizzle-orm";
import { runWrite } from "@/db";
import { nanoid } from "@/shared/lib/id";
import { contactCategories } from "./schema";

export type ContactCategoryRow = typeof contactCategories.$inferSelect;

export interface ContactCategoryView {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeContactCategory(row: ContactCategoryRow): ContactCategoryView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listContactCategories(db: AppDatabase): Promise<readonly ContactCategoryRow[]> {
  return await db.select().from(contactCategories).orderBy(desc(contactCategories.createdAt)).all();
}

export async function resolveContactCategory(db: AppDatabase, id: string): Promise<ContactCategoryRow | undefined> {
  return await db.select().from(contactCategories).where(eq(contactCategories.id, id)).get();
}

export interface CreateContactCategoryInput {
  readonly name: string;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function createContactCategory(db: AppDatabase, input: CreateContactCategoryInput): Promise<ContactCategoryRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(contactCategories).values({
    id,
    name: input.name,
    code: input.code ?? null,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await db.select().from(contactCategories).where(eq(contactCategories.id, id)).get())!;
}

export interface UpdateContactCategoryInput {
  readonly name?: string | undefined;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function updateContactCategory(
  db: AppDatabase,
  id: string,
  input: UpdateContactCategoryInput,
): Promise<ContactCategoryRow | undefined> {
  const existing = await resolveContactCategory(db, id);
  if (!existing)
    return undefined;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (input.name !== undefined)
    patch.name = input.name;
  if (input.code !== undefined)
    patch.code = input.code;
  if (input.description !== undefined)
    patch.description = input.description;
  await db.update(contactCategories).set(patch).where(eq(contactCategories.id, id)).run();
  return await db.select().from(contactCategories).where(eq(contactCategories.id, id)).get();
}

export async function deleteContactCategory(db: AppDatabase, id: string): Promise<boolean> {
  const result = runWrite(() => db.delete(contactCategories)
    .where(eq(contactCategories.id, id))
    .run());
  return result.changes > 0;
}
