PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_items` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`creator_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`pinned_at` text,
	`deleted_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_items`("id", "short_id", "type", "title", "status", "creator_id", "version", "pinned", "pinned_at", "deleted_at", "updated_at") SELECT "id", "short_id", "type", "title", "status", "creator_id", "version", "pinned", "pinned_at", "deleted_at", "updated_at" FROM `items`;--> statement-breakpoint
DROP TABLE `items`;--> statement-breakpoint
ALTER TABLE `__new_items` RENAME TO `items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_items_short_id` ON `items` (`short_id`);--> statement-breakpoint
CREATE INDEX `idx_items_type_deleted` ON `items` (`type`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_items_creator_deleted` ON `items` (`creator_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_items_type_status_deleted` ON `items` (`type`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_items_pinned` ON `items` (`pinned`,`pinned_at`);--> statement-breakpoint
CREATE TABLE `__new_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`description` text,
	`ship_id` text,
	`cover_reference_id` text,
	`creator_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ship_id`) REFERENCES `ships`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cover_reference_id`) REFERENCES `file_references`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_projects`("id", "short_id", "code", "name", "status", "description", "ship_id", "cover_reference_id", "creator_id", "version", "deleted_at", "updated_at") SELECT "id", "short_id", "code", "name", "status", "description", "ship_id", "cover_reference_id", "creator_id", "version", "deleted_at", "updated_at" FROM `projects`;--> statement-breakpoint
DROP TABLE `projects`;--> statement-breakpoint
ALTER TABLE `__new_projects` RENAME TO `projects`;--> statement-breakpoint
CREATE UNIQUE INDEX `projects_short_id_idx` ON `projects` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_code_idx` ON `projects` (`code`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `projects_ship_idx` ON `projects` (`ship_id`);