CREATE TABLE `equipment_manufacturers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_manufacturers_name_idx` ON `equipment_manufacturers` (`name`);--> statement-breakpoint
ALTER TABLE `ship_equipment` ADD `manufacturer_id` text REFERENCES equipment_manufacturers(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `ship_equipment_manufacturer_idx` ON `ship_equipment` (`manufacturer_id`);--> statement-breakpoint
ALTER TABLE `ship_equipment` DROP COLUMN `manufacturer`;