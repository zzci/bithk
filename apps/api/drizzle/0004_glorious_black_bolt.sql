CREATE TABLE `global_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`modules` text DEFAULT '[]' NOT NULL,
	`is_system` integer DEFAULT 0 NOT NULL,
	`kind` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `global_roles_name_idx` ON `global_roles` (`name`);--> statement-breakpoint
ALTER TABLE `users` ADD `global_role_id` text REFERENCES global_roles(id) ON DELETE SET NULL;