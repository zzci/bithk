import type { AppDatabase, AppTransaction } from "@/db";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "@/shared/lib/id";
import { globalProcurementCategories, procurementCategories } from "./schema";

export type GlobalProcurementCategoryRow = typeof globalProcurementCategories.$inferSelect;

export interface GlobalProcurementCategoryView {
  readonly id: string;
  readonly name: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeGlobalCategory(row: GlobalProcurementCategoryRow): GlobalProcurementCategoryView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listGlobalCategories(db: AppDatabase): Promise<readonly GlobalProcurementCategoryRow[]> {
  return await db.select().from(globalProcurementCategories).orderBy(desc(globalProcurementCategories.createdAt)).all();
}

export async function resolveGlobalCategory(db: AppDatabase, id: string): Promise<GlobalProcurementCategoryRow | undefined> {
  return await db.select().from(globalProcurementCategories).where(eq(globalProcurementCategories.id, id)).get();
}

export interface CreateGlobalCategoryInput {
  readonly name: string;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function createGlobalCategory(db: AppDatabase, input: CreateGlobalCategoryInput): Promise<GlobalProcurementCategoryRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(globalProcurementCategories).values({
    id,
    name: input.name,
    code: input.code ?? null,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await db.select().from(globalProcurementCategories).where(eq(globalProcurementCategories.id, id)).get())!;
}

export interface UpdateGlobalCategoryInput {
  readonly name?: string | undefined;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function updateGlobalCategory(
  db: AppDatabase,
  id: string,
  input: UpdateGlobalCategoryInput,
): Promise<GlobalProcurementCategoryRow | undefined> {
  const existing = await resolveGlobalCategory(db, id);
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
  await db.update(globalProcurementCategories).set(patch).where(eq(globalProcurementCategories.id, id)).run();
  return await db.select().from(globalProcurementCategories).where(eq(globalProcurementCategories.id, id)).get();
}

export async function deleteGlobalCategory(db: AppDatabase, id: string): Promise<boolean> {
  const result = await db.delete(globalProcurementCategories)
    .where(eq(globalProcurementCategories.id, id))
    .run() as unknown as { changes: number };
  return result.changes > 0;
}

/**
 * Copy the current global category set into a newly created project's
 * `procurement_categories`. Synchronous so it composes into the create
 * transaction (copy-on-create — later global edits never touch this project).
 */
export function seedProjectCategoriesTx(tx: AppTransaction, projectId: string, now: string): void {
  const globals = tx.select().from(globalProcurementCategories).all();
  for (const g of globals) {
    tx.insert(procurementCategories).values({
      id: nanoid(),
      projectId,
      name: g.name,
      code: g.code,
      description: g.description,
      createdAt: now,
      updatedAt: now,
    }).run();
  }
}
