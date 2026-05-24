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
CREATE INDEX `issue_references_item_idx` ON `issue_references` (`item_id`);