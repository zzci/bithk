import type { EquipmentStatus } from "./schema";
import type { AppDatabase } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "@/shared/lib/id";
import { equipmentManufacturers, shipEquipment, shipEquipmentCategories } from "./schema";

export type ShipEquipmentRow = typeof shipEquipment.$inferSelect;

// ─── External view ──────────────────────────────────────────────────────
// `projectId` is the internal project ULID and never leaves the API: equipment
// is always addressed through its owning project's short id in the URL, so the
// view omits it and exposes only the equipment's own (nanoid) id. The category
// is a reference into the project's own `ship_equipment_categories` vocabulary; the
// view carries both the id and the resolved bilingual names (null when unset or
// the referenced row is gone). The manufacturer is a reference into the GLOBAL
// `equipment_manufacturers` vocabulary; the view carries the id and the resolved
// single canonical name (null when unset or the referenced row is gone).

export interface ShipEquipmentView {
  readonly id: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly categoryNameZh: string | null;
  readonly categoryNameEn: string | null;
  readonly manufacturerId: string | null;
  readonly manufacturerName: string | null;
  readonly model: string | null;
  readonly serialNumber: string | null;
  readonly location: string | null;
  readonly installedAt: string | null;
  readonly status: EquipmentStatus;
  readonly note: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function composeEquipment(
  row: ShipEquipmentRow,
  categoryNameZh: string | null,
  categoryNameEn: string | null,
  manufacturerName: string | null,
): ShipEquipmentView {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.categoryId,
    categoryNameZh,
    categoryNameEn,
    manufacturerId: row.manufacturerId,
    manufacturerName,
    model: row.model,
    serialNumber: row.serialNumber,
    location: row.location,
    installedAt: row.installedAt,
    status: row.status,
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Equipment CRUD (scoped to a project by internal id) ───────────────────

export async function listEquipment(db: AppDatabase, projectId: string): Promise<readonly ShipEquipmentView[]> {
  const rows = await db
    .select({ equipment: shipEquipment, category: shipEquipmentCategories, manufacturer: equipmentManufacturers })
    .from(shipEquipment)
    .leftJoin(shipEquipmentCategories, eq(shipEquipment.categoryId, shipEquipmentCategories.id))
    .leftJoin(equipmentManufacturers, eq(shipEquipment.manufacturerId, equipmentManufacturers.id))
    .where(eq(shipEquipment.projectId, projectId))
    .orderBy(desc(shipEquipment.id))
    .all();
  return rows.map(r => composeEquipment(r.equipment, r.category?.nameZh ?? null, r.category?.nameEn ?? null, r.manufacturer?.name ?? null));
}

// Raw row lookup for internal existence/ownership checks (no category join).
async function getEquipmentRow(db: AppDatabase, projectId: string, equipmentId: string): Promise<ShipEquipmentRow | undefined> {
  return await db.select().from(shipEquipment).where(
    and(eq(shipEquipment.projectId, projectId), eq(shipEquipment.id, equipmentId)),
  ).get();
}

export async function getEquipment(db: AppDatabase, projectId: string, equipmentId: string): Promise<ShipEquipmentView | undefined> {
  const row = await db
    .select({ equipment: shipEquipment, category: shipEquipmentCategories, manufacturer: equipmentManufacturers })
    .from(shipEquipment)
    .leftJoin(shipEquipmentCategories, eq(shipEquipment.categoryId, shipEquipmentCategories.id))
    .leftJoin(equipmentManufacturers, eq(shipEquipment.manufacturerId, equipmentManufacturers.id))
    .where(and(eq(shipEquipment.projectId, projectId), eq(shipEquipment.id, equipmentId)))
    .get();
  if (!row)
    return undefined;
  return composeEquipment(row.equipment, row.category?.nameZh ?? null, row.category?.nameEn ?? null, row.manufacturer?.name ?? null);
}

export interface CreateEquipmentInput {
  readonly name: string;
  readonly categoryId?: string | null | undefined;
  readonly manufacturerId?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly serialNumber?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly installedAt?: string | null | undefined;
  readonly status?: EquipmentStatus | undefined;
  readonly note?: string | null | undefined;
}

export async function createEquipment(db: AppDatabase, projectId: string, input: CreateEquipmentInput): Promise<ShipEquipmentView> {
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(shipEquipment).values({
    id,
    projectId,
    name: input.name,
    categoryId: input.categoryId ?? null,
    manufacturerId: input.manufacturerId ?? null,
    model: input.model ?? null,
    serialNumber: input.serialNumber ?? null,
    location: input.location ?? null,
    installedAt: input.installedAt ?? null,
    status: input.status ?? "active",
    note: input.note ?? null,
    createdAt: now,
    updatedAt: now,
  }).run();
  return (await getEquipment(db, projectId, id))!;
}

export interface UpdateEquipmentInput {
  readonly name?: string | undefined;
  readonly categoryId?: string | null | undefined;
  readonly manufacturerId?: string | null | undefined;
  readonly model?: string | null | undefined;
  readonly serialNumber?: string | null | undefined;
  readonly location?: string | null | undefined;
  readonly installedAt?: string | null | undefined;
  readonly status?: EquipmentStatus | undefined;
  readonly note?: string | null | undefined;
}

const UPDATABLE_EQUIPMENT_KEYS = [
  "name",
  "categoryId",
  "manufacturerId",
  "model",
  "serialNumber",
  "location",
  "installedAt",
  "status",
  "note",
] as const;

export async function updateEquipment(db: AppDatabase, projectId: string, equipmentId: string, input: UpdateEquipmentInput): Promise<ShipEquipmentView | undefined> {
  const existing = await getEquipmentRow(db, projectId, equipmentId);
  if (!existing)
    return undefined;

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updatedAt: now };
  for (const key of UPDATABLE_EQUIPMENT_KEYS) {
    if (input[key] !== undefined)
      patch[key] = input[key];
  }

  await db.update(shipEquipment).set(patch).where(eq(shipEquipment.id, existing.id)).run();
  return await getEquipment(db, projectId, existing.id);
}

/** True when the project holds any equipment row — half of the `equipment` section's `hasData`. */
export async function hasProjectEquipment(db: AppDatabase, projectId: string): Promise<boolean> {
  const row = await db.select({ id: shipEquipment.id }).from(shipEquipment).where(eq(shipEquipment.projectId, projectId)).get();
  return row !== undefined;
}

export async function deleteEquipment(db: AppDatabase, projectId: string, equipmentId: string): Promise<boolean> {
  const existing = await getEquipmentRow(db, projectId, equipmentId);
  if (!existing)
    return false;
  await db.delete(shipEquipment).where(eq(shipEquipment.id, existing.id)).run();
  return true;
}
