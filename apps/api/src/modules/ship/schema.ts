import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { projects } from "@/modules/project/schema";

export const SHIP_STATUSES = ["under_construction", "active", "underway", "in_maintenance", "laid_up", "retired"] as const;
export type ShipStatus = typeof SHIP_STATUSES[number];

export const EQUIPMENT_STATUSES = ["active", "retired"] as const;
export type EquipmentStatus = typeof EQUIPMENT_STATUSES[number];

// The `ship-profile` section's 1:1 side table (PLAN-108 §5). A ship IS a
// project: identity, name, cover, creator, version, soft-delete and tags all
// live on the `projects` row, and this table holds only what is specific to a
// vessel. "Section mounted" and "profile row exists" stay equivalent, which is
// why the maritime columns are a side table rather than 14 nullable columns on
// `projects`.
//
// `hull_number` is the former `ships.code`: mutable, case-preserving and
// globally unique — deliberately unlike `projects.code`, which is immutable and
// lowercased. The vessel description folds into `projects.description`; one
// project has exactly one description.
export const shipProfiles = sqliteTable("ship_profiles", {
  projectId: text("project_id").primaryKey().references(() => projects.id, { onDelete: "cascade" }),
  hullNumber: text("hull_number").notNull(),
  shipStatus: text("ship_status", { enum: SHIP_STATUSES }).notNull().default("laid_up"),
  // Yacht core attributes.
  model: text("model"),
  builder: text("builder"),
  buildYear: integer("build_year"),
  lengthOverall: real("length_overall"),
  beam: real("beam"),
  draft: real("draft"),
  airDraft: real("air_draft"),
  grossTonnage: real("gross_tonnage"),
  imoNumber: text("imo_number"),
  mmsi: text("mmsi"),
  callSign: text("call_sign"),
  flagState: text("flag_state"),
  registryPort: text("registry_port"),
  ownerName: text("owner_name"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("ship_profiles_hull_number_idx").on(t.hullNumber),
  index("ship_profiles_status_idx").on(t.shipStatus),
]);

// GLOBAL equipment-category template: an admin-maintained bilingual vocabulary
// (Chinese + English name per row). It is NOT referenced directly by equipment;
// instead its rows are copied per-project into `ship_equipment_categories` when
// the `equipment` section is provisioned (copy-on-create — mirrors the project
// `global_procurement_categories` → `procurement_categories` pattern). Later
// edits here never touch existing projects. The bilingual names are each
// globally unique so the template stays free of duplicates.
export const globalEquipmentCategories = sqliteTable("global_equipment_categories", {
  id: text("id").primaryKey(), // nanoid
  nameZh: text("name_zh").notNull(),
  nameEn: text("name_en").notNull(),
  code: text("code"),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("global_equipment_categories_name_zh_idx").on(t.nameZh),
  uniqueIndex("global_equipment_categories_name_en_idx").on(t.nameEn),
]);

// GLOBAL equipment-manufacturer vocabulary: a standalone admin-maintained brand
// list. Unlike categories it is NOT copied per-project — equipment references a
// row here directly via `ship_equipment.manufacturer_id`. Manufacturer names are
// proper nouns, so each row has a single canonical `name` (no bilingual split).
export const equipmentManufacturers = sqliteTable("equipment_manufacturers", {
  id: text("id").primaryKey(), // nanoid
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  uniqueIndex("equipment_manufacturers_name_idx").on(t.name),
]);

// Per-project equipment categories. Seeded from the global template when the
// `equipment` section is provisioned, then independently editable per project.
// `ship_equipment.category_id` references THIS table, so each project owns its
// own category set. Names are unique *within* a project; different projects may
// reuse the same names. The `ship_` prefix stays: these are maritime-domain
// tables owned by the ship module.
export const shipEquipmentCategories = sqliteTable("ship_equipment_categories", {
  id: text("id").primaryKey(), // nanoid
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  nameZh: text("name_zh").notNull(),
  nameEn: text("name_en").notNull(),
  code: text("code"),
  description: text("description"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  index("ship_equipment_categories_project_idx").on(t.projectId),
  uniqueIndex("ship_equipment_categories_project_name_zh_idx").on(t.projectId, t.nameZh),
  uniqueIndex("ship_equipment_categories_project_name_en_idx").on(t.projectId, t.nameEn),
]);

// Equipment inventory for a project with the `equipment` section mounted.
export const shipEquipment = sqliteTable("ship_equipment", {
  id: text("id").primaryKey(), // nanoid
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  categoryId: text("category_id").references(() => shipEquipmentCategories.id, { onDelete: "set null" }),
  manufacturerId: text("manufacturer_id").references(() => equipmentManufacturers.id, { onDelete: "set null" }),
  model: text("model"),
  serialNumber: text("serial_number"),
  location: text("location"),
  installedAt: text("installed_at"),
  status: text("status", { enum: EQUIPMENT_STATUSES }).notNull().default("active"),
  note: text("note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [
  index("ship_equipment_project_idx").on(t.projectId),
  index("ship_equipment_category_idx").on(t.categoryId),
  index("ship_equipment_manufacturer_idx").on(t.manufacturerId),
]);

// Worklists. `projectId` NULL = a global knowledge-base entry (copy source
// only); a value = a project-level copy the project actually uses.
export const worklists = sqliteTable("worklists", {
  id: text("id").primaryKey(), // nanoid
  projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  checklist: text("checklist"),
  precautions: text("precautions"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, t => [index("worklists_project_idx").on(t.projectId)]);
