ALTER TABLE `items` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `items` ADD `pinned_at` text;--> statement-breakpoint
CREATE INDEX `idx_items_pinned` ON `items` (`pinned`,`pinned_at`);