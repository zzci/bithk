CREATE TABLE `document_tags` (
	`item_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `tag_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX `tags_name_idx`;--> statement-breakpoint
ALTER TABLE `tags` ADD `source_type` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `tags_source_name_idx` ON `tags` (`source_type`,`name`);