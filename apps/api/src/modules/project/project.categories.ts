import type { AppDatabase } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { runWrite } from "@/db";
import { nanoid } from "@/shared/lib/id";
import { procurementCategories } from "./schema";

export type ProcurementCategoryRow = typeof procurementCategories.$inferSelect;

export interface ProcurementCategoryView {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeCategory(row: ProcurementCategoryRow): ProcurementCategoryView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listCategories(db: AppDatabase, projectId: string): Promise<readonly ProcurementCategoryRow[]> {
  return await db.select().from(procurementCategories).where(eq(procurementCategories.projectId, projectId)).orderBy(desc(procurementCategories.createdAt)).all();
}

export async function resolveCategory(db: AppDatabase, projectId: string, categoryId: string): Promise<ProcurementCategoryRow | undefined> {
  return await db.select().from(procurementCategories).where(
    and(eq(procurementCategories.id, categoryId), eq(procurementCategories.projectId, projectId)),
  ).get();
}

export interface CreateCategoryInput {
  readonly name: string;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function createCategory(db: AppDatabase, projectId: string, input: CreateCategoryInput): Promise<ProcurementCategoryRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(procurementCategories).values({
    id,
    projectId,
    name: input.name,
    code: input.code ?? null,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await db.select().from(procurementCategories).where(eq(procurementCategories.id, id)).get())!;
}

export interface UpdateCategoryInput {
  readonly name?: string | undefined;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function updateCategory(
  db: AppDatabase,
  projectId: string,
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<ProcurementCategoryRow | undefined> {
  const existing = await resolveCategory(db, projectId, categoryId);
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
  await db.update(procurementCategories).set(patch).where(eq(procurementCategories.id, categoryId)).run();
  return await db.select().from(procurementCategories).where(eq(procurementCategories.id, categoryId)).get();
}

export async function deleteCategory(db: AppDatabase, projectId: string, categoryId: string): Promise<boolean> {
  const result = runWrite(() => db.delete(procurementCategories)
    .where(and(eq(procurementCategories.id, categoryId), eq(procurementCategories.projectId, projectId)))
    .run());
  return result.changes > 0;
}
