CREATE TABLE `ship_profiles` (
	`project_id` text PRIMARY KEY NOT NULL,
	`hull_number` text NOT NULL,
	`ship_status` text DEFAULT 'laid_up' NOT NULL,
	`model` text,
	`builder` text,
	`build_year` integer,
	`length_overall` real,
	`beam` real,
	`draft` real,
	`air_draft` real,
	`gross_tonnage` real,
	`imo_number` text,
	`mmsi` text,
	`call_sign` text,
	`flag_state` text,
	`registry_port` text,
	`owner_name` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ship_profiles_hull_number_idx` ON `ship_profiles` (`hull_number`);--> statement-breakpoint
CREATE INDEX `ship_profiles_status_idx` ON `ship_profiles` (`ship_status`);--> statement-breakpoint
DROP TABLE `ships`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ship_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`category_id` text,
	`manufacturer_id` text,
	`model` text,
	`serial_number` text,
	`location` text,
	`installed_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `ship_equipment_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `equipment_manufacturers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_ship_equipment`("id", "project_id", "name", "category_id", "manufacturer_id", "model", "serial_number", "location", "installed_at", "status", "note", "created_at", "updated_at") SELECT "id", "project_id", "name", "category_id", "manufacturer_id", "model", "serial_number", "location", "installed_at", "status", "note", "created_at", "updated_at" FROM `ship_equipment`;--> statement-breakpoint
DROP TABLE `ship_equipment`;--> statement-breakpoint
ALTER TABLE `__new_ship_equipment` RENAME TO `ship_equipment`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ship_equipment_project_idx` ON `ship_equipment` (`project_id`);--> statement-breakpoint
CREATE INDEX `ship_equipment_category_idx` ON `ship_equipment` (`category_id`);--> statement-breakpoint
CREATE INDEX `ship_equipment_manufacturer_idx` ON `ship_equipment` (`manufacturer_id`);--> statement-breakpoint
CREATE TABLE `__new_ship_equipment_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name_zh` text NOT NULL,
	`name_en` text NOT NULL,
	`code` text,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ship_equipment_categories`("id", "project_id", "name_zh", "name_en", "code", "description", "created_at", "updated_at") SELECT "id", "project_id", "name_zh", "name_en", "code", "description", "created_at", "updated_at" FROM `ship_equipment_categories`;--> statement-breakpoint
DROP TABLE `ship_equipment_categories`;--> statement-breakpoint
ALTER TABLE `__new_ship_equipment_categories` RENAME TO `ship_equipment_categories`;--> statement-breakpoint
CREATE INDEX `ship_equipment_categories_project_idx` ON `ship_equipment_categories` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ship_equipment_categories_project_name_zh_idx` ON `ship_equipment_categories` (`project_id`,`name_zh`);--> statement-breakpoint
CREATE UNIQUE INDEX `ship_equipment_categories_project_name_en_idx` ON `ship_equipment_categories` (`project_id`,`name_en`);--> statement-breakpoint
CREATE TABLE `__new_worklists` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`checklist` text,
	`precautions` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_worklists`("id", "project_id", "name", "checklist", "precautions", "created_at", "updated_at") SELECT "id", "project_id", "name", "checklist", "precautions", "created_at", "updated_at" FROM `worklists`;--> statement-breakpoint
DROP TABLE `worklists`;--> statement-breakpoint
ALTER TABLE `__new_worklists` RENAME TO `worklists`;--> statement-breakpoint
CREATE INDEX `worklists_project_idx` ON `worklists` (`project_id`);--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`description` text,
	`parent_id` text,
	`cover_reference_id` text,
	`creator_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cover_reference_id`) REFERENCES `file_references`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "short_id", "code", "name", "status", "description", "parent_id", "cover_reference_id", "creator_id", "version", "deleted_at", "updated_at") SELECT "id", "short_id", "code", "name", "status", "description", "parent_id", "cover_reference_id", "creator_id", "version", "deleted_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_short_id_idx` ON `projects` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_code_idx` ON `projects` (`code`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `projects_parent_idx` ON `projects` (`parent_id`);