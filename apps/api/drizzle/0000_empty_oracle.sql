CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`contact_person` text,
	`phone` text,
	`email` text,
	`address` text,
	`tax_id` text,
	`note` text,
	`status` text DEFAULT 'active' NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`confidential` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `contacts_owner_idx` ON `contacts` (`owner_id`);--> statement-breakpoint
CREATE TABLE `auth_lockouts` (
	`key` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_auth_lockouts_locked_until` ON `auth_lockouts` (`locked_until`);--> statement-breakpoint
CREATE TABLE `pkce_challenges` (
	`state` text PRIMARY KEY NOT NULL,
	`code_verifier` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pkce_expires` ON `pkce_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_groups_name` ON `groups` (`name`);--> statement-breakpoint
CREATE TABLE `totp_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_in` integer,
	`redirect_uri` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_totp_challenge_expires` ON `totp_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_totp_devices` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`secret` text NOT NULL,
	`verified` integer DEFAULT false NOT NULL,
	`last_used_timestep` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_totp_user` ON `user_totp_devices` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`oauth_sub` text NOT NULL,
	`username` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`avatar` text,
	`role` text DEFAULT 'user' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`last_login_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_oauth_sub` ON `users` (`oauth_sub`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_username` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `idx_users_status` ON `users` (`status`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`actor_name` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`resource_name` text NOT NULL,
	`detail` text,
	`ip` text NOT NULL,
	`user_agent` text NOT NULL,
	`result` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_actor_created` ON `audit_events` (`actor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_action_created` ON `audit_events` (`action`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_audit_resource_created` ON `audit_events` (`resource_type`,`resource_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `cron_job_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`status` text NOT NULL,
	`result` text,
	`error` text,
	FOREIGN KEY (`job_id`) REFERENCES `cron_jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_cron_job_logs_job` ON `cron_job_logs` (`job_id`);--> statement-breakpoint
CREATE INDEX `idx_cron_job_logs_job_started` ON `cron_job_logs` (`job_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `idx_cron_job_logs_status` ON `cron_job_logs` (`status`);--> statement-breakpoint
CREATE TABLE `cron_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`cron` text NOT NULL,
	`task_type` text NOT NULL,
	`task_config` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_deleted` integer DEFAULT false NOT NULL,
	`max_consecutive_failures` integer DEFAULT 3 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_cron_jobs_name` ON `cron_jobs` (`name`);--> statement-breakpoint
CREATE INDEX `idx_cron_jobs_enabled` ON `cron_jobs` (`enabled`);--> statement-breakpoint
CREATE TABLE `document_details` (
	`item_id` text PRIMARY KEY NOT NULL,
	`content` text,
	`parent_id` text,
	`comments_locked` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_details_parent` ON `document_details` (`parent_id`);--> statement-breakpoint
CREATE TABLE `document_pins` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_document_pins_user` ON `document_pins` (`user_id`);--> statement-breakpoint
CREATE TABLE `drive_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`parent_entry_id` text DEFAULT '' NOT NULL,
	`entry_type` text NOT NULL,
	`name` text NOT NULL,
	`file_reference_id` text,
	`favorite` text DEFAULT '0' NOT NULL,
	`status` text DEFAULT 'normal' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`file_reference_id`) REFERENCES `file_references`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `drive_entries_owner_parent_status_idx` ON `drive_entries` (`owner_type`,`owner_id`,`parent_entry_id`,`status`);--> statement-breakpoint
CREATE INDEX `drive_entries_owner_status_favorite_idx` ON `drive_entries` (`owner_type`,`owner_id`,`status`,`favorite`);--> statement-breakpoint
CREATE INDEX `drive_entries_file_reference_idx` ON `drive_entries` (`file_reference_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `drive_entries_owner_parent_name_status_idx` ON `drive_entries` (`owner_type`,`owner_id`,`parent_entry_id`,`name`,`status`);--> statement-breakpoint
CREATE TABLE `drive_file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`drive_entry_id` text NOT NULL,
	`file_reference_id` text NOT NULL,
	`version_no` integer NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`drive_entry_id`) REFERENCES `drive_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_reference_id`) REFERENCES `file_references`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drive_file_versions_entry_version_idx` ON `drive_file_versions` (`drive_entry_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `drive_file_versions_entry_created_idx` ON `drive_file_versions` (`drive_entry_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `drive_file_versions_file_reference_idx` ON `drive_file_versions` (`file_reference_id`);--> statement-breakpoint
CREATE TABLE `team_directories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `team_directories_created_by_idx` ON `team_directories` (`created_by`);--> statement-breakpoint
CREATE TABLE `team_directory_members` (
	`id` text PRIMARY KEY NOT NULL,
	`directory_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'viewer' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`directory_id`) REFERENCES `team_directories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_directory_members_unique_idx` ON `team_directory_members` (`directory_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `team_directory_members_user_idx` ON `team_directory_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `file_references` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`owner_type` text NOT NULL,
	`owner_id` text NOT NULL,
	`filename` text NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_file_refs_unique` ON `file_references` (`owner_type`,`owner_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `idx_file_refs_owner` ON `file_references` (`owner_type`,`owner_id`);--> statement-breakpoint
CREATE INDEX `idx_file_refs_file` ON `file_references` (`file_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`size` integer NOT NULL,
	`mimetype` text NOT NULL,
	`storage_driver` text NOT NULL,
	`storage_key` text NOT NULL,
	`ref_count` integer DEFAULT 0 NOT NULL,
	`uploaded_by` text NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_files_sha_driver` ON `files` (`sha256`,`storage_driver`);--> statement-breakpoint
CREATE INDEX `idx_files_sha` ON `files` (`sha256`);--> statement-breakpoint
CREATE INDEX `idx_files_driver` ON `files` (`storage_driver`);--> statement-breakpoint
CREATE INDEX `idx_files_unreferenced` ON `files` (`id`) WHERE ref_count = 0;--> statement-breakpoint
CREATE TABLE `issue_details` (
	`item_id` text PRIMARY KEY NOT NULL,
	`description` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`due_date` text,
	`project_id` text NOT NULL,
	`assignee_member_id` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_member_id`) REFERENCES `project_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `issue_project_idx` ON `issue_details` (`project_id`);--> statement-breakpoint
CREATE TABLE `issue_references` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`ref_type` text NOT NULL,
	`ref_id` text NOT NULL,
	`label` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `issue_references_item_idx` ON `issue_references` (`item_id`);--> statement-breakpoint
CREATE TABLE `item_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`author_id` text NOT NULL,
	`reply_to_id` text,
	`content` text NOT NULL,
	`is_internal` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reply_to_id`) REFERENCES `item_comments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_item_comments_item` ON `item_comments` (`item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_item_comments_author` ON `item_comments` (`author_id`);--> statement-breakpoint
CREATE INDEX `idx_item_comments_reply` ON `item_comments` (`reply_to_id`);--> statement-breakpoint
CREATE TABLE `items` (
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
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_items_short_id` ON `items` (`short_id`);--> statement-breakpoint
CREATE INDEX `idx_items_type_deleted` ON `items` (`type`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_items_creator_deleted` ON `items` (`creator_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_items_type_status_deleted` ON `items` (`type`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_items_pinned` ON `items` (`pinned`,`pinned_at`);--> statement-breakpoint
CREATE TABLE `relation_tuples` (
	`id` text PRIMARY KEY NOT NULL,
	`namespace` text NOT NULL,
	`object_id` text NOT NULL,
	`relation` text NOT NULL,
	`subject_namespace` text NOT NULL,
	`subject_id` text NOT NULL,
	`subject_relation` text,
	`created_by` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_tuples_object` ON `relation_tuples` (`namespace`,`object_id`,`relation`);--> statement-breakpoint
CREATE INDEX `idx_tuples_subject` ON `relation_tuples` (`subject_namespace`,`subject_id`,`subject_relation`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_tuples_unique` ON `relation_tuples` (`namespace`,`object_id`,`relation`,`subject_namespace`,`subject_id`,`subject_relation`);--> statement-breakpoint
CREATE TABLE `procurement_details` (
	`item_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`supplier_id` text,
	`category_id` text,
	`assignee_member_id` text,
	`item_name` text NOT NULL,
	`quantity` integer,
	`amount` integer,
	`currency` text,
	`description` text,
	`priority` text DEFAULT 'medium' NOT NULL,
	`due_date` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplier_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `procurement_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`assignee_member_id`) REFERENCES `project_members`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `procurement_project_idx` ON `procurement_details` (`project_id`);--> statement-breakpoint
CREATE TABLE `global_procurement_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `procurement_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`description` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `procurement_categories_project_idx` ON `procurement_categories` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_members` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`user_id` text,
	`display_name` text,
	`role_id` text NOT NULL,
	`title` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `project_roles`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `project_members_project_idx` ON `project_members` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_members_role_idx` ON `project_members` (`role_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_members_project_user_idx` ON `project_members` (`project_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `project_roles` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`is_system` integer DEFAULT 0 NOT NULL,
	`kind` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_roles_project_idx` ON `project_roles` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
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
	FOREIGN KEY (`creator_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_short_id_idx` ON `projects` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_code_idx` ON `projects` (`code`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `projects_ship_idx` ON `projects` (`ship_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`token` text NOT NULL,
	`share_type` text DEFAULT 'public_link' NOT NULL,
	`shared_with_user_id` text,
	`permission` text DEFAULT 'view' NOT NULL,
	`password` text,
	`expires_at` text,
	`max_downloads` integer,
	`download_count` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`shared_with_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_idx` ON `shares` (`token`);--> statement-breakpoint
CREATE INDEX `shares_resource_idx` ON `shares` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `shares_created_by_idx` ON `shares` (`created_by`);--> statement-breakpoint
CREATE INDEX `shares_shared_with_idx` ON `shares` (`shared_with_user_id`);--> statement-breakpoint
CREATE INDEX `shares_share_type_idx` ON `shares` (`share_type`);--> statement-breakpoint
CREATE INDEX `shares_active_expires_idx` ON `shares` (`is_active`,`expires_at`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `ships_short_id_idx` ON `ships` (`short_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ships_code_idx` ON `ships` (`code`);--> statement-breakpoint
CREATE INDEX `ships_status_idx` ON `ships` (`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `ships_base_project_idx` ON `ships` (`base_project_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_type_name_idx` ON `tags` (`type`,`name`);--> statement-breakpoint
CREATE TABLE `tags_refs` (
	`resource_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`resource_id`, `tag_id`),
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tags_refs_tag_id_idx` ON `tags_refs` (`tag_id`);