import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "@/modules/account/users/schema";
import { fileReferences } from "@/modules/file/schema";

export const DRIVE_ENTRY_TYPES = ["folder", "file"] as const;
export type DriveEntryType = typeof DRIVE_ENTRY_TYPES[number];

export const DRIVE_ENTRY_STATUSES = ["normal", "trash"] as const;
export type DriveEntryStatus = typeof DRIVE_ENTRY_STATUSES[number];

export const DRIVE_OWNER_TYPES = ["user", "team_directory"] as const;
export type DriveOwnerType = typeof DRIVE_OWNER_TYPES[number];

export const TEAM_DIRECTORY_ROLES = ["admin", "editor", "viewer"] as const;
export type TeamDirectoryRole = typeof TEAM_DIRECTORY_ROLES[number];

export const driveEntries = sqliteTable("drive_entries", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type", { enum: DRIVE_OWNER_TYPES }).notNull(),
  ownerId: text("owner_id").notNull(),
  parentEntryId: text("parent_entry_id").notNull().default(""),
  entryType: text("entry_type", { enum: DRIVE_ENTRY_TYPES }).notNull(),
  name: text("name").notNull(),
  fileReferenceId: text("file_reference_id").references(() => fileReferences.id, { onDelete: "restrict" }),
  favorite: text("favorite", { enum: ["0", "1"] }).notNull().default("0"),
  status: text("status", { enum: DRIVE_ENTRY_STATUSES }).notNull().default("normal"),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
  updatedAt: text("updated_at").notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, table => [
  index("drive_entries_owner_parent_status_idx").on(table.ownerType, table.ownerId, table.parentEntryId, table.status),
  index("drive_entries_owner_status_favorite_idx").on(table.ownerType, table.ownerId, table.status, table.favorite),
  index("drive_entries_file_reference_idx").on(table.fileReferenceId),
  uniqueIndex("drive_entries_owner_parent_name_status_idx").on(
    table.ownerType,
    table.ownerId,
    table.parentEntryId,
    table.name,
    table.status,
  ),
]);

export const teamDirectories = sqliteTable("team_directories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$defaultFn(() => new Date().toISOString()).$onUpdateFn(() => new Date().toISOString()),
}, table => [
  index("team_directories_created_by_idx").on(table.createdBy),
]);

export const teamDirectoryMembers = sqliteTable("team_directory_members", {
  id: text("id").primaryKey(),
  directoryId: text("directory_id").notNull().references(() => teamDirectories.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: TEAM_DIRECTORY_ROLES }).notNull().default("viewer"),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [
  uniqueIndex("team_directory_members_unique_idx").on(table.directoryId, table.userId),
  index("team_directory_members_user_idx").on(table.userId),
]);

export const driveFileVersions = sqliteTable("drive_file_versions", {
  id: text("id").primaryKey(),
  driveEntryId: text("drive_entry_id").notNull().references(() => driveEntries.id, { onDelete: "cascade" }),
  fileReferenceId: text("file_reference_id").notNull().references(() => fileReferences.id, { onDelete: "restrict" }),
  versionNo: integer("version_no").notNull(),
  uploadedBy: text("uploaded_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at").notNull().$defaultFn(() => new Date().toISOString()),
}, table => [
  uniqueIndex("drive_file_versions_entry_version_idx").on(table.driveEntryId, table.versionNo),
  index("drive_file_versions_entry_created_idx").on(table.driveEntryId, table.createdAt),
  index("drive_file_versions_file_reference_idx").on(table.fileReferenceId),
]);

// Token-based shares (direct + public link) moved to the unified `shares`
// table in `modules/share`. Direct-share access is resolved there by
// `drive.permission.ts`; public links are served by the share module.
