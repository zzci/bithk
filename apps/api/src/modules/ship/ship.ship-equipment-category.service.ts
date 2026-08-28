import type { AppDatabase, AppTransaction } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { runWrite } from "@/db";
import { ValidationError } from "@/shared/lib/errors";
import { nanoid } from "@/shared/lib/id";
import { globalEquipmentCategories, shipEquipmentCategories } from "./schema";

export type ShipEquipmentCategoryRow = typeof shipEquipmentCategories.$inferSelect;

// ─── External view ──────────────────────────────────────────────────────
// `projectId` is the internal project ULID and never leaves the API: per-project
// categories are always addressed through their owning project's short id in the
// URL, so the view omits it and exposes only the category's own (nanoid) id.
export interface ShipEquipmentCategoryView {
  readonly id: string;
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code: string | null;
  readonly description: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeProjectEquipmentCategory(row: ShipEquipmentCategoryRow): ShipEquipmentCategoryView {
  return {
    id: row.id,
    nameZh: row.nameZh,
    nameEn: row.nameEn,
    code: row.code,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Trim a free-text field; an empty result for the optional code/description
// collapses to null so the vocabulary never stores blank-but-non-null values.
function trimOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null)
    return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Map a SQLite UNIQUE-constraint violation on (project_id, name_zh|name_en) to a
// clean 422 instead of letting it surface as an unhandled 500.
function rethrowUnique(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("UNIQUE constraint failed")) {
    const field = message.includes("name_en") ? "nameEn" : "nameZh";
    throw new ValidationError("Equipment category name already exists", { [field]: "Already exists" });
  }
  throw err;
}

// ─── Per-project category CRUD (scoped to a project by internal id) ────────

export async function listProjectEquipmentCategories(db: AppDatabase, projectId: string): Promise<readonly ShipEquipmentCategoryRow[]> {
  return await db.select().from(shipEquipmentCategories).where(eq(shipEquipmentCategories.projectId, projectId)).orderBy(desc(shipEquipmentCategories.createdAt)).all();
}

export async function resolveProjectEquipmentCategory(db: AppDatabase, projectId: string, id: string): Promise<ShipEquipmentCategoryRow | undefined> {
  return await db.select().from(shipEquipmentCategories).where(
    and(eq(shipEquipmentCategories.id, id), eq(shipEquipmentCategories.projectId, projectId)),
  ).get();
}

export interface CreateProjectEquipmentCategoryInput {
  readonly nameZh: string;
  readonly nameEn: string;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function createProjectEquipmentCategory(db: AppDatabase, projectId: string, input: CreateProjectEquipmentCategoryInput): Promise<ShipEquipmentCategoryRow> {
  const id = nanoid();
  const now = new Date().toISOString();
  try {
    await db.insert(shipEquipmentCategories).values({
      id,
      projectId,
      nameZh: input.nameZh.trim(),
      nameEn: input.nameEn.trim(),
      code: trimOptional(input.code),
      description: trimOptional(input.description),
      createdAt: now,
      updatedAt: now,
    }).run();
  }
  catch (err) {
    rethrowUnique(err);
  }
  return (await resolveProjectEquipmentCategory(db, projectId, id))!;
}

export interface UpdateProjectEquipmentCategoryInput {
  readonly nameZh?: string | undefined;
  readonly nameEn?: string | undefined;
  readonly code?: string | null | undefined;
  readonly description?: string | null | undefined;
}

export async function updateProjectEquipmentCategory(
  db: AppDatabase,
  projectId: string,
  id: string,
  input: UpdateProjectEquipmentCategoryInput,
): Promise<ShipEquipmentCategoryRow | undefined> {
  const existing = await resolveProjectEquipmentCategory(db, projectId, id);
  if (!existing)
    return undefined;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  if (input.nameZh !== undefined)
    patch.nameZh = input.nameZh.trim();
  if (input.nameEn !== undefined)
    patch.nameEn = input.nameEn.trim();
  if (input.code !== undefined)
    patch.code = trimOptional(input.code);
  if (input.description !== undefined)
    patch.description = trimOptional(input.description);
  try {
    await db.update(shipEquipmentCategories).set(patch).where(eq(shipEquipmentCategories.id, existing.id)).run();
  }
  catch (err) {
    rethrowUnique(err);
  }
  return await resolveProjectEquipmentCategory(db, projectId, id);
}

export async function deleteProjectEquipmentCategory(db: AppDatabase, projectId: string, id: string): Promise<boolean> {
  const result = runWrite(() => db.delete(shipEquipmentCategories)
    .where(and(eq(shipEquipmentCategories.id, id), eq(shipEquipmentCategories.projectId, projectId)))
    .run());
  return result.changes > 0;
}

/** True when the project holds any equipment category — half of the `equipment` section's `hasData`. */
export async function hasProjectEquipmentCategories(db: AppDatabase, projectId: string): Promise<boolean> {
  const row = await db.select({ id: shipEquipmentCategories.id })
    .from(shipEquipmentCategories)
    .where(eq(shipEquipmentCategories.projectId, projectId))
    .get();
  return row !== undefined;
}

/**
 * Copy the current global equipment-category template into a project mounting
 * the `equipment` section. Synchronous so it composes into the project-creation
 * transaction (copy-on-create — later global edits never touch this project).
 * Mirrors `seedProjectCategoriesTx` for procurement categories.
 */
export function seedEquipmentCategoriesTx(tx: AppTransaction, projectId: string, now: string): void {
  const globals = tx.select().from(globalEquipmentCategories).all();
  for (const g of globals) {
    tx.insert(shipEquipmentCategories).values({
      id: nanoid(),
      projectId,
      nameZh: g.nameZh,
      nameEn: g.nameEn,
      code: g.code,
      description: g.description,
      createdAt: now,
      updatedAt: now,
    }).run();
  }
}
