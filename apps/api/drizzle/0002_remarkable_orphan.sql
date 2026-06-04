PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ships` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'laid_up' NOT NULL,
	`base_project_id` text,
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
	`description` text,
	`cover_reference_id` text,
	`creator_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`base_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cover_reference_id`) REFERENCES `file_references`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ships`("id", "short_id", "code", "name", "status", "base_project_id", "model", "builder", "build_year", "length_overall", "beam", "draft", "air_draft", "gross_tonnage", "imo_number", "mmsi", "call_sign", "flag_state", "registry_port", "owner_name", "description", "cover_reference_id", "creator_id", "version", "deleted_at", "updated_at") SELECT "id", "short_id", "code", "name", "status", "base_project_id", "model", "builder", "build_year", "length_overall", "beam", "draft", "air_draft", "gross_tonnage", "imo_number", "mmsi", "call_sign", "flag_state", "registry_port", "owner_name", "description", "cover_reference_id", "creator_id", "version", "deleted_at", "updated_at" FROM `ships`;--> statement-breakpoint
DROP TABLE `ships`;--> statement-breakpoint
ALTER TABLE `__new_ships` RENAME TO `ships`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ships_short_id_idx` ON `ships` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ships_code_idx` ON `ships` (`code`);--> statement-breakpoint
CREATE INDEX `ships_status_idx` ON `ships` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `ships_base_project_idx` ON `ships` (`base_project_id`);