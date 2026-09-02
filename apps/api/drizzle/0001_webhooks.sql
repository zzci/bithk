CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event` text NOT NULL,
	`event_id` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`response_status` integer,
	`error` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_webhook_deliveries_webhook_created` ON `webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_webhook_deliveries_status` ON `webhook_deliveries` (`status`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`secret` text,
	`events` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_delivery_at` text,
	`last_delivery_status` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_webhooks_name` ON `webhooks` (`name`);--> statement-breakpoint
CREATE INDEX `idx_webhooks_enabled` ON `webhooks` (`enabled`);