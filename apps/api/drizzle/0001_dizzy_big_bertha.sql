CREATE TABLE `maintenance_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`ship_id` text,
	`name` text NOT NULL,
	`category` text,
	`checklist` text,
	`precautions` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ship_id`) REFERENCES `ships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `maintenance_templates_ship_idx` ON `maintenance_templates` (`ship_id`);--> statement-breakpoint
CREATE TABLE `ship_equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`ship_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`manufacturer` text,
	`model` text,
	`serial_number` text,
	`location` text,
	`installed_at` text,
	`status` text DEFAULT 'active' NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ship_id`) REFERENCES `ships`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ship_equipment_ship_idx` ON `ship_equipment` (`ship_id`);--> statement-breakpoint
CREATE TABLE `ships` (
	`id` text PRIMARY KEY NOT NULL,
	`short_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`lifecycle_stage` text DEFAULT 'design' NOT NULL,
	`base_project_id` text,
	`model` text,
	`builder` text,
	`build_year` integer,
	`length_overall` real,
	`beam` real,
	`draft` real,
	`gross_tonnage` real,
	`imo_number` text,
	`mmsi` text,
	`call_sign` text,
	`flag_state` text,
	`registry_port` text,
	`owner_name` text,
	`description` text,
	`creator_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`deleted_at` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`base_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ships_short_id_idx` ON `ships` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ships_code_idx` ON `ships` (`code`);--> statement-breakpoint
CREATE INDEX `ships_status_idx` ON `ships` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `ships_base_project_idx` ON `ships` (`base_project_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `ship_id` text REFERENCES ships(id);--> statement-breakpoint
CREATE INDEX `projects_ship_idx` ON `projects` (`ship_id`);