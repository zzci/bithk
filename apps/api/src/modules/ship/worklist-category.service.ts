import type { AppDatabase } from "@/db";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "@/shared/lib/id";
import { worklistCategories } from "./schema";

export type WorklistCategoryRow = typeof worklistCategories.$inferSelect;

export interface WorklistCategoryView {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeWorklistCategory(row: WorklistCategoryRow): WorklistCategoryView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listWorklistCategories(db: AppDatabase): Promise<readonly WorklistCategoryRow[]> {
  return await db.select().from(worklistCategories).orderBy(desc(worklistCategories.createdAt)).all();
}

export async function resolveWorklistCategory(db: AppDatabase, id: string): Promise<WorklistCategoryRow | undefined> {
  return await db.select().from(worklistCategories).where(eq(worklistCategories.id, id)).get();
}

export interface CreateWorklistCategoryInput {
  readonly name: string;
  readonly description?: string | null | undefined;
}

export async function createWorklistCategory(db: AppDatabase, input: CreateWorklistCategoryInput): Promise<WorklistCategoryRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(worklistCategories).values({
    id,
    name: input.name,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await db.select().from(worklistCategories).where(eq(worklistCategories.id, id)).get())!;
}

export interface UpdateWorklistCategoryInput {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
}

export async function updateWorklistCategory(
  db: AppDatabase,
  id: string,
  input: UpdateWorklistCategoryInput,
): Promise<WorklistCategoryRow | undefined> {
  const existing = await resolveWorklistCategory(db, id);
  if (!existing)
    return undefined;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (input.name !== undefined)
    patch.name = input.name;
  if (input.description !== undefined)
    patch.description = input.description;
  await db.update(worklistCategories).set(patch).where(eq(worklistCategories.id, id)).run();
  return await db.select().from(worklistCategories).where(eq(worklistCategories.id, id)).get();
}

export async function deleteWorklistCategory(db: AppDatabase, id: string): Promise<boolean> {
  const result = await db.delete(worklistCategories)
    .where(eq(worklistCategories.id, id))
    .run() as unknown as { changes: number };
  return result.changes > 0;
}
